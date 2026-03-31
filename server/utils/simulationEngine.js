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

function normalizeArrivalValue(arrival, index) {
  if (typeof arrival === 'number' && Number.isFinite(arrival)) {
    return arrival;
  }

  const candidates = [
    arrival?.arrival_offset_min,
    arrival?.arrivalOffsetMin,
    arrival?.offset_minutes,
    arrival?.offsetMinutes,
    arrival?.offset,
    arrival?.minutes,
    arrival?.value,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return index * 3;
}

function buildArrivalSchedule(totalInstances, arrivals = []) {
  if (Array.isArray(arrivals) && arrivals.length > 0) {
    return arrivals
      .map((arrival, index) => normalizeArrivalValue(arrival, index))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right);
  }

  return Array.from({ length: totalInstances }, (_, index) => index * 3);
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

function getBottlenecks(taskResults, resourceResults) {
  const taskBottlenecks = taskResults
    .filter((task) => task.avg_wait_min > 0.1)
    .map((task) => ({
      type: 'task',
      name: task.task_name || task.task_id,
      metric: round(task.avg_wait_min, 1),
      unit: 'min wait',
      severity: task.avg_wait_min >= 15 ? 'high' : task.avg_wait_min >= 5 ? 'medium' : 'low',
      details: 'Average queue delay before the task starts.',
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
      details: 'Resource capacity is close to saturation.',
    }));

  return [...taskBottlenecks, ...resourceBottlenecks]
    .sort((left, right) => right.metric - left.metric)
    .slice(0, 5);
}

export function createDefaultTask(taskId, taskName) {
  return {
    task_id: taskId,
    task_name: taskName || taskId,
    duration_min: 30,
    duration_type: 'fixed',
    duration_std: 0,
    cost: 0,
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

export function runSimulation({
  scenario,
  tasks,
  resources = [],
  arrivals = [],
  random = Math.random,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const resourceList = Array.isArray(resources) ? resources : [];
  const importedArrivals = Array.isArray(arrivals) ? arrivals : [];
  const totalInstances =
    importedArrivals.length > 0
      ? importedArrivals.length
      : Math.max(0, Number(scenario?.process_instances) || 0);
  const arrivalSchedule = buildArrivalSchedule(totalInstances, importedArrivals);
  const warmup = Math.floor(totalInstances * ((scenario?.warmup_percent || 0) / 100));
  const cooldown = Math.floor(totalInstances * ((scenario?.cooldown_percent || 0) / 100));
  const activeInstances = Math.max(0, totalInstances - warmup - cooldown);
  const infiniteResources = Boolean(scenario?.infinite_resources);
  const resourceRuntime = createResourceRuntime(resourceList, infiniteResources);

  const sample = (type, mean, std) => {
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
  };

  const instanceRecords = [];
  const taskStats = Object.fromEntries(
    taskList.map((task) => [
      task.task_id,
      {
        task_id: task.task_id,
        task_name: task.task_name,
        durations: [],
        waits: [],
        costs: [],
        resource_id: task.resource_id ? Number(task.resource_id) : null,
      },
    ])
  );

  for (let instanceIndex = 0; instanceIndex < totalInstances; instanceIndex += 1) {
    const arrivalTime = arrivalSchedule[instanceIndex] ?? instanceIndex * 3;
    let currentTime = arrivalTime;
    let totalCost = 0;

    for (const task of taskList) {
      const baseDuration = sample(
        task.duration_type,
        Number(task.duration_min) || 0,
        Number(task.duration_std) || 0
      );
      const resourceId = task.resource_id ? Number(task.resource_id) : null;
      const resourceState = resourceId ? resourceRuntime.get(resourceId) : null;
      const availabilityRatio = clamp(
        (Number(resourceState?.availability) || 100) / 100,
        0.1,
        1
      );
      const effectiveDuration =
        resourceState && !infiniteResources ? baseDuration / availabilityRatio : baseDuration;

      let startTime = currentTime;
      let waitMinutes = 0;

      if (resourceState && !infiniteResources) {
        const [slotIndex, slotReadyAt] = findEarliestSlot(resourceState.slots);
        startTime = Math.max(currentTime, slotReadyAt);
        waitMinutes = Math.max(0, startTime - currentTime);
        resourceState.slots[slotIndex] = startTime + effectiveDuration;
        resourceState.busyMinutes += effectiveDuration;
        resourceState.totalWaitMinutes += waitMinutes;
        resourceState.tasksHandled += 1;
      }

      const endTime = startTime + effectiveDuration;
      const executionCost =
        (effectiveDuration / 60) *
        ((Number(task.cost) || 0) + (Number(resourceState?.cost_per_hour) || 0));

      taskStats[task.task_id].durations.push(effectiveDuration);
      taskStats[task.task_id].waits.push(waitMinutes);
      taskStats[task.task_id].costs.push(executionCost);
      totalCost += executionCost;
      currentTime = endTime;
    }

    instanceRecords.push({
      arrivalTime,
      finishTime: currentTime,
      cycleTime: currentTime - arrivalTime,
      totalCost,
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
      ? Math.max(...instanceRecords.map((record) => record.finishTime)) - Math.min(...arrivalSchedule)
      : 0;

  const taskResults = taskList.map((task) => {
    const durations = taskStats[task.task_id]?.durations ?? [];
    const waits = taskStats[task.task_id]?.waits ?? [];
    const costs = taskStats[task.task_id]?.costs ?? [];
    const sortedDurations = [...durations].sort((left, right) => left - right);
    const resourceState = task.resource_id ? resourceRuntime.get(Number(task.resource_id)) : null;

    return {
      task_id: task.task_id,
      task_name: task.task_name,
      avg_duration: round(durations.reduce((sum, value) => sum + value, 0) / (durations.length || 1), 1),
      min_duration: round(durations.length ? Math.min(...durations) : 0, 1),
      max_duration: round(durations.length ? Math.max(...durations) : 0, 1),
      p95_duration: round(percentile(sortedDurations, 0.95), 1),
      avg_wait_min: round(waits.reduce((sum, value) => sum + value, 0) / (waits.length || 1), 1),
      executions: durations.length,
      resource_name: resourceState?.name ?? null,
      total_cost: round(costs.reduce((sum, value) => sum + value, 0), 2),
    };
  });

  const resourceResults = resourceList.map((resource) => {
    const state = resourceRuntime.get(Number(resource.id));
    const quantity = Math.max(1, Number(resource.quantity) || 1);
    const utilizationRate =
      simulationHorizon > 0 && state
        ? (state.busyMinutes / (simulationHorizon * quantity)) * 100
        : 0;

    return {
      resource_id: Number(resource.id),
      resource_name: resource.name,
      quantity,
      availability: Number(resource.availability) || 100,
      total_busy_min: round(state?.busyMinutes || 0, 1),
      avg_wait_min: round(
        (state?.totalWaitMinutes || 0) / ((state?.tasksHandled || 0) || 1),
        1
      ),
      tasks_handled: state?.tasksHandled || 0,
      utilization_rate: round(utilizationRate, 1),
    };
  });

  const arrivalPreview = arrivalSchedule.slice(0, 10).map((value, index) => ({
    index: index + 1,
    offset_min: round(value, 2),
  }));

  return {
    simulated_at: new Date().toISOString(),
    instances: totalInstances,
    active_instances: activeInstances,
    status: 'completed',
    arrival_source: importedArrivals.length > 0 ? 'csv' : 'generated',
    avg_duration_min: round(cycleTimes.reduce((sum, value) => sum + value, 0) / (cycleTimes.length || 1), 1),
    min_duration_min: round(cycleTimes.length ? Math.min(...cycleTimes) : 0, 1),
    max_duration_min: round(cycleTimes.length ? Math.max(...cycleTimes) : 0, 1),
    p95_duration_min: round(percentile(sortedCycleTimes, 0.95), 1),
    p99_duration_min: round(percentile(sortedCycleTimes, 0.99), 1),
    total_cost: round(totalCost, 2),
    avg_cost_per_instance: round(totalCost / (activeRecords.length || 1), 2),
    simulation_horizon_min: round(simulationHorizon, 1),
    task_results: taskResults,
    resource_results: resourceResults,
    bottlenecks: getBottlenecks(taskResults, resourceResults),
    histogram: buildHistogram(cycleTimes, 10),
    arrival_preview: arrivalPreview,
  };
}
