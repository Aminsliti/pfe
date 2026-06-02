const SIMULATED_TASK_TYPES = new Set([
  'task',
  'userTask',
  'serviceTask',
  'scriptTask',
  'manualTask',
  'sendTask',
  'receiveTask',
  'businessRuleTask',
  'subProcess',
  'callActivity',
]);

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * ratio))
  );

  return sortedValues[index] ?? 0;
}

function buildInstanceOffsets(totalInstances, stepMinutes = 3) {
  return Array.from({ length: totalInstances }, (_, index) => index * stepMinutes);
}

function createResourceRuntime(resources = [], infiniteResources = false) {
  if (infiniteResources) {
    return new Map();
  }

  return new Map(
    resources.map((resource) => {
      const quantity = Math.max(1, Number(resource.quantity) || 1);

      return [
        Number(resource.id),
        {
          ...resource,
          id: Number(resource.id),
          quantity,
          slots: Array.from({ length: quantity }, () => 0),
          busyMinutes: 0,
          totalWaitMinutes: 0,
          totalQueueWaitMinutes: 0,
          tasksHandled: 0,
        },
      ];
    })
  );
}

function findEarliestSlot(slots = []) {
  let nextIndex = 0;
  let nextValue = slots[0] ?? 0;

  for (let index = 1; index < slots.length; index += 1) {
    if ((slots[index] ?? 0) < nextValue) {
      nextValue = slots[index] ?? 0;
      nextIndex = index;
    }
  }

  return [nextIndex, nextValue];
}

function sampleDuration(type, mean, std, random) {
  switch (type) {
    case 'normal': {
      const u1 = clamp(random(), Number.EPSILON, 1);
      const u2 = clamp(random(), Number.EPSILON, 1);
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, mean + std * z);
    }
    case 'uniform':
      return Math.max(0, mean * 0.5 + random() * mean);
    case 'exponential':
      return Math.max(0, -mean * Math.log(clamp(random(), Number.EPSILON, 1)));
    default:
      return Math.max(0, mean);
  }
}

function buildSlaSummary(taskResults, lateInstances, totalInstances) {
  const monitoredTasks = taskResults.filter((task) => Number(task.sla_target_min) > 0);
  const totalBreaches = monitoredTasks.reduce((sum, task) => sum + (task.sla_breach_count || 0), 0);
  const worstTask = [...monitoredTasks].sort(
    (left, right) => (right.sla_breach_rate || 0) - (left.sla_breach_rate || 0)
  )[0];

  return {
    monitored_tasks: monitoredTasks.length,
    total_breaches: totalBreaches,
    late_instances: lateInstances,
    late_instance_rate: totalInstances > 0 ? round((lateInstances / totalInstances) * 100, 1) : 0,
    worst_task: worstTask
      ? {
          task_id: worstTask.task_id,
          task_name: worstTask.task_name,
          breach_rate: worstTask.sla_breach_rate,
          target_min: worstTask.sla_target_min,
        }
      : null,
  };
}

function getBottlenecks(taskResults, resourceResults, slaSummary) {
  const taskBottlenecks = taskResults
    .filter((task) => task.avg_wait_min > 0.1)
    .map((task) => ({
      type: 'task',
      name: task.task_name || task.task_id,
      metric: round(task.avg_wait_min, 1),
      unit: 'min wait',
      severity: task.avg_wait_min >= 15 ? 'high' : task.avg_wait_min >= 5 ? 'medium' : 'low',
      details: 'Average queue delay before service begins.',
    }));

  const resourceBottlenecks = resourceResults
    .filter((resource) => resource.utilization_rate >= 70)
    .map((resource) => ({
      type: 'resource',
      name: resource.resource_name,
      metric: round(resource.utilization_rate, 1),
      unit: '% utilisation',
      severity:
        resource.utilization_rate >= 90 ? 'high' : resource.utilization_rate >= 80 ? 'medium' : 'low',
      details: 'Busy time divided by theoretical capacity is high.',
    }));

  const slaBottlenecks =
    slaSummary?.worst_task && Number(slaSummary.worst_task.breach_rate) > 0
      ? [
          {
            type: 'sla',
            name: slaSummary.worst_task.task_name,
            metric: round(slaSummary.worst_task.breach_rate, 1),
            unit: '% breaches',
            severity:
              slaSummary.worst_task.breach_rate >= 40
                ? 'high'
                : slaSummary.worst_task.breach_rate >= 15
                  ? 'medium'
                  : 'low',
            details: `Task lead time exceeds its ${slaSummary.worst_task.target_min}-minute threshold too often.`,
          },
        ]
      : [];

  return [...taskBottlenecks, ...resourceBottlenecks, ...slaBottlenecks]
    .sort((left, right) => right.metric - left.metric)
    .slice(0, 8);
}

export function createDefaultTask(taskId, taskName) {
  return {
    task_id: taskId,
    task_name: taskName || taskId,
    duration_min: 30,
    duration_type: 'fixed',
    duration_std: 0,
    cost: 0,
    sla_target_min: null,
  };
}

export function extractTasksFromLegacyJson(definition) {
  try {
    const parsed = typeof definition === 'string' ? JSON.parse(definition) : definition;
    const elements = Array.isArray(parsed?.elements) ? parsed.elements : [];
    const seen = new Set();

    return elements.reduce((tasks, element) => {
      if (!element?.id || !SIMULATED_TASK_TYPES.has(element.type) || seen.has(element.id)) {
        return tasks;
      }

      seen.add(element.id);
      tasks.push(createDefaultTask(element.id, element.label || element.name || element.id));
      return tasks;
    }, []);
  } catch {
    return [];
  }
}

export function extractTasksFromBpmn(bpmnXml) {
  if (!bpmnXml || typeof bpmnXml !== 'string') {
    return [];
  }

  const tasks = [];
  const seen = new Set();

  try {
    const taskRegex =
      /<(?:[\w.-]+:)?(userTask|serviceTask|scriptTask|manualTask|sendTask|receiveTask|businessRuleTask|task|subProcess|callActivity)\b([^>]*)\/?>/gi;
    let match;

    while ((match = taskRegex.exec(bpmnXml)) !== null) {
      const attrs = match[2] || '';
      const idMatch = attrs.match(/\bid=(["'])(.*?)\1/i);
      const taskId = idMatch?.[2];

      if (!taskId || seen.has(taskId)) {
        continue;
      }

      const nameMatch = attrs.match(/\bname=(["'])(.*?)\1/i);
      seen.add(taskId);
      tasks.push(createDefaultTask(taskId, nameMatch?.[2] || taskId));
    }
  } catch (error) {
    console.error('Error parsing BPMN:', error);
  }

  return tasks;
}

export function extractTasksFromDiagram(definition) {
  const legacyTasks = extractTasksFromLegacyJson(definition);
  if (legacyTasks.length > 0) {
    return legacyTasks;
  }

  return extractTasksFromBpmn(definition);
}

export function buildHistogram(values, buckets = 10) {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / buckets || 1;
  const bins = Array.from({ length: buckets }, (_, index) => ({
    label: `${Math.round(min + index * step)}-${Math.round(min + (index + 1) * step)}`,
    count: 0,
  }));

  for (const value of values) {
    const index = Math.min(Math.floor((value - min) / step), buckets - 1);
    bins[index].count += 1;
  }

  return bins;
}

export function createSeededRandom(seed = 12345) {
  let state = Math.abs(Number(seed) || 12345) % 2147483647;
  if (state === 0) {
    state = 12345;
  }

  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function cloneTasks(tasks = []) {
  return tasks.map((task) => ({ ...task }));
}

function cloneResources(resources = []) {
  return resources.map((resource) => ({ ...resource }));
}

export function runSimulation({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
  random = Math.random,
}) {
  const taskList = Array.isArray(tasks) ? cloneTasks(tasks) : [];
  const resourceList = Array.isArray(resources) ? cloneResources(resources) : [];
  const useCsvArrivals = Array.isArray(arrivals) && arrivals.length > 0;
  const totalInstances = useCsvArrivals
    ? arrivals.length
    : Math.max(0, Number(scenario?.process_instances) || 0);
  const instanceOffsets = useCsvArrivals
    ? arrivals.map((a) => Number(a.arrival_offset_min) || 0)
    : buildInstanceOffsets(totalInstances);
  const warmup = Math.floor(totalInstances * ((scenario?.warmup_percent || 0) / 100));
  const cooldown = Math.floor(totalInstances * ((scenario?.cooldown_percent || 0) / 100));
  const activeInstances = Math.max(0, totalInstances - warmup - cooldown);
  const infiniteResources = Boolean(scenario?.infinite_resources);
  const resourceRuntime = createResourceRuntime(resourceList, infiniteResources);

  const instanceRecords = [];
  const taskStats = Object.fromEntries(
    taskList.map((task) => [
      task.task_id,
      {
        task_id: task.task_id,
        task_name: task.task_name,
        durations: [],
        waits: [],
        queueWaits: [],
        costs: [],
        resource_id: task.resource_id ? Number(task.resource_id) : null,
        sla_target_min: Number(task.sla_target_min) || null,
        slaBreaches: 0,
      },
    ])
  );

  for (let instanceIndex = 0; instanceIndex < totalInstances; instanceIndex += 1) {
    const instanceOffset = instanceOffsets[instanceIndex] ?? 0;
    let currentTime = instanceOffset;
    let totalCost = 0;
    let breached = false;

    for (const task of taskList) {
      const baseDuration = sampleDuration(
        task.duration_type,
        Number(task.duration_min) || 0,
        Number(task.duration_std) || 0,
        random
      );
      const resourceId = task.resource_id ? Number(task.resource_id) : null;
      const resourceState = resourceId ? resourceRuntime.get(resourceId) : null;
      const availabilityRatio = clamp((Number(resourceState?.availability) || 100) / 100, 0.1, 1);
      const effectiveDuration =
        resourceState && !infiniteResources ? baseDuration / availabilityRatio : baseDuration;

      let startTime = currentTime;
      let queueWaitMinutes = 0;

      if (resourceState && !infiniteResources) {
        const [slotIndex, slotReadyAt] = findEarliestSlot(resourceState.slots);
        startTime = Math.max(currentTime, slotReadyAt);
        queueWaitMinutes = Math.max(0, startTime - currentTime);
        resourceState.slots[slotIndex] = startTime + effectiveDuration;
        resourceState.busyMinutes += effectiveDuration;
        resourceState.totalWaitMinutes += queueWaitMinutes;
        resourceState.totalQueueWaitMinutes += queueWaitMinutes;
        resourceState.tasksHandled += 1;
      }

      const endTime = startTime + effectiveDuration;
      const executionCost =
        (effectiveDuration / 60) *
        ((Number(task.cost) || 0) + (Number(resourceState?.cost_per_hour) || 0));
      const taskLeadTime = Math.max(0, endTime - currentTime);
      const slaTarget = Number(task.sla_target_min) || null;
      const slaBreached = slaTarget ? taskLeadTime > slaTarget : false;

      taskStats[task.task_id].durations.push(effectiveDuration);
      taskStats[task.task_id].waits.push(queueWaitMinutes);
      taskStats[task.task_id].queueWaits.push(queueWaitMinutes);
      taskStats[task.task_id].costs.push(executionCost);
      if (slaBreached) {
        taskStats[task.task_id].slaBreaches += 1;
        breached = true;
      }

      totalCost += executionCost;
      currentTime = endTime;
    }

    instanceRecords.push({
      instanceOffset,
      finishTime: currentTime,
      cycleTime: currentTime - instanceOffset,
      totalCost,
      breached,
    });
  }

  const activeRecords =
    activeInstances > 0
      ? instanceRecords.slice(warmup, Math.max(warmup, totalInstances - cooldown))
      : instanceRecords;
  const cycleTimes = activeRecords.map((record) => record.cycleTime);
  const sortedCycleTimes = [...cycleTimes].sort((left, right) => left - right);
  const totalCost = activeRecords.reduce((sum, record) => sum + record.totalCost, 0);
  const simulationHorizon =
    instanceRecords.length > 0
      ? Math.max(...instanceRecords.map((record) => record.finishTime)) - Math.min(...instanceOffsets)
      : 0;
  const lateInstances = activeRecords.filter((record) => record.breached).length;

  const taskResults = taskList.map((task) => {
    const stats = taskStats[task.task_id] || {};
    const durations = stats.durations || [];
    const waits = stats.waits || [];
    const queueWaits = stats.queueWaits || [];
    const costs = stats.costs || [];
    const sortedDurations = [...durations].sort((left, right) => left - right);
    const resourceState = task.resource_id ? resourceRuntime.get(Number(task.resource_id)) : null;
    const executions = durations.length;
    const slaBreachCount = stats.slaBreaches || 0;
    const averageDuration = round(durations.reduce((sum, value) => sum + value, 0) / (executions || 1), 1);

    return {
      task_id: task.task_id,
      task_name: task.task_name,
      avg_duration: averageDuration,
      min_duration: round(durations.length ? Math.min(...durations) : 0, 1),
      max_duration: round(durations.length ? Math.max(...durations) : 0, 1),
      p95_duration: round(percentile(sortedDurations, 0.95), 1),
      avg_elapsed_duration: averageDuration,
      p95_elapsed_duration: round(percentile(sortedDurations, 0.95), 1),
      avg_wait_min: round(waits.reduce((sum, value) => sum + value, 0) / (waits.length || 1), 1),
      avg_queue_wait_min: round(
        queueWaits.reduce((sum, value) => sum + value, 0) / (queueWaits.length || 1),
        1
      ),
      executions,
      resource_name: resourceState?.name ?? null,
      total_cost: round(costs.reduce((sum, value) => sum + value, 0), 2),
      sla_target_min: stats.sla_target_min,
      sla_breach_count: slaBreachCount,
      sla_breach_rate: executions > 0 ? round((slaBreachCount / executions) * 100, 1) : 0,
    };
  });

  const resourceResults = resourceList.map((resource) => {
    const state = resourceRuntime.get(Number(resource.id));
    const quantity = Math.max(1, Number(resource.quantity) || 1);
    const theoreticalCapacityMinutes = simulationHorizon * quantity;
    const utilizationRate =
      theoreticalCapacityMinutes > 0
        ? ((state?.busyMinutes || 0) / theoreticalCapacityMinutes) * 100
        : 0;

    return {
      resource_id: Number(resource.id),
      resource_name: resource.name,
      quantity,
      availability: Number(resource.availability) || 100,
      total_busy_min: round(state?.busyMinutes || 0, 1),
      avg_wait_min: round((state?.totalWaitMinutes || 0) / ((state?.tasksHandled || 0) || 1), 1),
      avg_queue_wait_min: round(
        (state?.totalQueueWaitMinutes || 0) / ((state?.tasksHandled || 0) || 1),
        1
      ),
      tasks_handled: state?.tasksHandled || 0,
      theoretical_capacity_min: round(theoreticalCapacityMinutes, 1),
      utilization_rate: round(utilizationRate, 1),
    };
  });

  const slaSummary = buildSlaSummary(taskResults, lateInstances, activeRecords.length);

  return {
    simulated_at: new Date().toISOString(),
    instances: totalInstances,
    active_instances: activeInstances,
    status: 'completed',
    instance_offset_rule: 'offset(i) = 3 * (i - 1) minutes',
    avg_duration_min: round(cycleTimes.reduce((sum, value) => sum + value, 0) / (cycleTimes.length || 1), 1),
    min_duration_min: round(cycleTimes.length ? Math.min(...cycleTimes) : 0, 1),
    max_duration_min: round(cycleTimes.length ? Math.max(...cycleTimes) : 0, 1),
    p95_duration_min: round(percentile(sortedCycleTimes, 0.95), 1),
    p99_duration_min: round(percentile(sortedCycleTimes, 0.99), 1),
    total_cost: round(totalCost, 2),
    avg_cost_per_instance: round(totalCost / (activeRecords.length || 1), 2),
    simulation_horizon_min: round(simulationHorizon, 1),
    late_instances: lateInstances,
    sla_summary: slaSummary,
    task_results: taskResults,
    resource_results: resourceResults,
    bottlenecks: getBottlenecks(taskResults, resourceResults, slaSummary),
    arrival_source: useCsvArrivals ? 'csv' : 'generated',
    histogram: buildHistogram(cycleTimes, 10),
    arrival_preview: instanceOffsets.slice(0, 10).map((value, index) => ({
      index: index + 1,
      offset_min: round(value, 2),
    })),
  };
}

function summarizeNumericSamples(values = []) {
  const numericValues = values.map((value) => Number(value) || 0);
  const sorted = [...numericValues].sort((left, right) => left - right);
  return {
    mean: round(numericValues.reduce((sum, value) => sum + value, 0) / (numericValues.length || 1), 2),
    min: round(sorted[0] || 0, 2),
    max: round(sorted[sorted.length - 1] || 0, 2),
    ci_low: round(percentile(sorted, 0.05), 2),
    ci_high: round(percentile(sorted, 0.95), 2),
  };
}

export function runMonteCarloSimulation({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
  iterations = 20,
}) {
  const safeIterations = Math.max(2, Number(iterations) || 2);
  const runs = [];
  const bottleneckCounts = new Map();

  for (let index = 0; index < safeIterations; index += 1) {
    const runResult = runSimulation({
      scenario,
      tasks,
      resources,
      arrivals,
      random: createSeededRandom(12345 + index * 97),
    });
    runs.push(runResult);
    (runResult.bottlenecks || []).forEach((bottleneck) => {
      const key = `${bottleneck.type}:${bottleneck.name}`;
      bottleneckCounts.set(key, {
        type: bottleneck.type,
        name: bottleneck.name,
        count: (bottleneckCounts.get(key)?.count || 0) + 1,
      });
    });
  }

  return {
    iterations: safeIterations,
    duration: summarizeNumericSamples(runs.map((run) => run.avg_duration_min)),
    p95_duration: summarizeNumericSamples(runs.map((run) => run.p95_duration_min)),
    total_cost: summarizeNumericSamples(runs.map((run) => run.total_cost)),
    late_instance_rate: summarizeNumericSamples(
      runs.map((run) => run.sla_summary?.late_instance_rate || 0)
    ),
    bottleneck_frequency: Array.from(bottleneckCounts.values())
      .map((entry) => ({
        ...entry,
        rate: round((entry.count / safeIterations) * 100, 1),
      }))
      .sort((left, right) => right.rate - left.rate)
      .slice(0, 8),
    sample_runs: runs.slice(0, 5).map((run, index) => ({
      run: index + 1,
      avg_duration_min: run.avg_duration_min,
      total_cost: run.total_cost,
      late_instance_rate: run.sla_summary?.late_instance_rate || 0,
    })),
  };
}

function normalizeBaseForAnalysis(result) {
  return {
    avg_duration_min: Number(result?.avg_duration_min) || 0,
    total_cost: Number(result?.total_cost) || 0,
    p95_duration_min: Number(result?.p95_duration_min) || 0,
    late_instance_rate: Number(result?.sla_summary?.late_instance_rate) || 0,
  };
}

export function runSensitivityAnalysis({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
}) {
  const baseline = runSimulation({
    scenario,
    tasks,
    resources,
    arrivals,
    random: createSeededRandom(2026),
  });
  const baselineMetrics = normalizeBaseForAnalysis(baseline);
  const impacts = [];

  tasks.forEach((task) => {
    const adjustedTasks = cloneTasks(tasks).map((entry) =>
      entry.task_id === task.task_id
        ? { ...entry, duration_min: round((Number(entry.duration_min) || 0) * 1.1, 2) }
        : entry
    );
    const candidate = runSimulation({
      scenario,
      tasks: adjustedTasks,
      resources,
      arrivals,
      random: createSeededRandom(2026),
    });
    impacts.push({
      type: 'task',
      id: task.task_id,
      name: task.task_name || task.task_id,
      change: '+10% duration',
      cycle_impact_min: round(candidate.avg_duration_min - baselineMetrics.avg_duration_min, 2),
      cost_impact: round(candidate.total_cost - baselineMetrics.total_cost, 2),
      late_rate_impact: round(
        (candidate.sla_summary?.late_instance_rate || 0) - baselineMetrics.late_instance_rate,
        2
      ),
    });
  });

  resources.forEach((resource) => {
    const adjustedResources = cloneResources(resources).map((entry) => {
      if (Number(entry.id) !== Number(resource.id)) {
        return entry;
      }

      if ((Number(entry.quantity) || 1) > 1) {
        return { ...entry, quantity: Math.max(1, Number(entry.quantity) - 1) };
      }

      return {
        ...entry,
        availability: round((Number(entry.availability) || 100) * 0.9, 2),
      };
    });
    const candidate = runSimulation({
      scenario,
      tasks,
      resources: adjustedResources,
      arrivals,
      random: createSeededRandom(2026),
    });
    impacts.push({
      type: 'resource',
      id: resource.id,
      name: resource.name,
      change: (Number(resource.quantity) || 1) > 1 ? '-1 capacity unit' : '-10% availability',
      cycle_impact_min: round(candidate.avg_duration_min - baselineMetrics.avg_duration_min, 2),
      cost_impact: round(candidate.total_cost - baselineMetrics.total_cost, 2),
      late_rate_impact: round(
        (candidate.sla_summary?.late_instance_rate || 0) - baselineMetrics.late_instance_rate,
        2
      ),
    });
  });

  return {
    baseline: baselineMetrics,
    impacts: impacts.sort((left, right) => Math.abs(right.cycle_impact_min) - Math.abs(left.cycle_impact_min)),
  };
}

export function runResourcePlanning({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
  targetCycleTimeMin,
}) {
  const baseline = runSimulation({
    scenario,
    tasks,
    resources,
    arrivals,
    random: createSeededRandom(4040),
  });
  const target = Number(targetCycleTimeMin) || 0;

  if (!target) {
    return {
      baseline,
      target_cycle_time_min: null,
      meets_target: false,
      recommendations: [],
      summary: 'Provide a valid target cycle time to calculate a capacity plan.',
    };
  }

  if (baseline.avg_duration_min <= target) {
    return {
      baseline,
      target_cycle_time_min: target,
      meets_target: true,
      recommendations: [],
      summary: 'Current resource capacity already meets the requested target.',
    };
  }

  const recommendations = [];

  resources.forEach((resource) => {
    for (let extraUnits = 1; extraUnits <= 5; extraUnits += 1) {
      const adjustedResources = cloneResources(resources).map((entry) =>
        Number(entry.id) === Number(resource.id)
          ? { ...entry, quantity: Math.max(1, Number(entry.quantity) || 1) + extraUnits }
          : entry
      );
      const candidate = runSimulation({
        scenario,
        tasks,
        resources: adjustedResources,
        arrivals,
        random: createSeededRandom(4040),
      });

      const recommendation = {
        resource_id: resource.id,
        resource_name: resource.name,
        add_units: extraUnits,
        projected_avg_duration_min: candidate.avg_duration_min,
        projected_total_cost: candidate.total_cost,
        improvement_min: round(baseline.avg_duration_min - candidate.avg_duration_min, 2),
        meets_target: candidate.avg_duration_min <= target,
      };

      recommendations.push(recommendation);

      if (recommendation.meets_target) {
        break;
      }
    }
  });

  const sortedRecommendations = recommendations.sort((left, right) => {
    if (left.meets_target !== right.meets_target) {
      return left.meets_target ? -1 : 1;
    }
    return left.projected_avg_duration_min - right.projected_avg_duration_min;
  });

  return {
    baseline,
    target_cycle_time_min: target,
    meets_target: sortedRecommendations[0]?.meets_target || false,
    recommendations: sortedRecommendations.slice(0, 8),
    summary: sortedRecommendations[0]?.meets_target
      ? `Adding ${sortedRecommendations[0].add_units} unit(s) to ${sortedRecommendations[0].resource_name} reaches the target.`
      : 'No tested capacity change reached the target within the allowed search range.',
  };
}

export function buildWhatIfScenario({
  scenario,
  tasks,
  resources = [],
  overrides = {},
}) {
  const nextScenario = { ...scenario };
  const nextTasks = cloneTasks(tasks);
  const nextResources = cloneResources(resources);

  if (overrides?.scenario_overrides && typeof overrides.scenario_overrides === 'object') {
    Object.assign(nextScenario, overrides.scenario_overrides);
  }

  if (Array.isArray(overrides?.task_overrides)) {
    overrides.task_overrides.forEach((override) => {
      const target = nextTasks.find((task) => task.task_id === override.task_id);
      if (!target) {
        return;
      }

      if (override.duration_multiplier !== undefined) {
        target.duration_min = round(
          (Number(target.duration_min) || 0) * Number(override.duration_multiplier || 1),
          2
        );
      }

      Object.entries(override).forEach(([key, value]) => {
        if (key !== 'task_id' && key !== 'duration_multiplier' && value !== undefined) {
          target[key] = value;
        }
      });
    });
  }

  if (Array.isArray(overrides?.resource_overrides)) {
    overrides.resource_overrides.forEach((override) => {
      const target = nextResources.find((resource) => Number(resource.id) === Number(override.resource_id));
      if (!target) {
        return;
      }

      Object.entries(override).forEach(([key, value]) => {
        if (key !== 'resource_id' && value !== undefined) {
          target[key] = value;
        }
      });
    });
  }

  return {
    scenario: nextScenario,
    tasks: nextTasks,
    resources: nextResources,
  };
}

export function runWhatIfAnalysis({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
  overrides = {},
}) {
  const baseline = runSimulation({
    scenario,
    tasks,
    resources,
    arrivals,
    random: createSeededRandom(9090),
  });

  const candidateInputs = buildWhatIfScenario({ scenario, tasks, resources, overrides });
  const candidate = runSimulation({
    scenario: candidateInputs.scenario,
    tasks: candidateInputs.tasks,
    resources: candidateInputs.resources,
    arrivals,
    random: createSeededRandom(9090),
  });

  return {
    baseline,
    candidate,
    comparison: {
      avg_duration_delta: round(candidate.avg_duration_min - baseline.avg_duration_min, 2),
      p95_duration_delta: round(candidate.p95_duration_min - baseline.p95_duration_min, 2),
      total_cost_delta: round(candidate.total_cost - baseline.total_cost, 2),
      late_rate_delta: round(
        (candidate.sla_summary?.late_instance_rate || 0) -
          (baseline.sla_summary?.late_instance_rate || 0),
        2
      ),
    },
  };
}
