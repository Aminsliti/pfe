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
    const taskRegex = /<(?:[\w.-]+:)?(userTask|serviceTask|scriptTask|manualTask|sendTask|receiveTask|businessRuleTask|task|subProcess|callActivity)\b([^>]*)\/?>/gi;
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
  random = Math.random,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const resourceList = Array.isArray(resources) ? resources : [];
  const totalInstances = Number(scenario?.process_instances) || 0;
  const warmup = Math.floor(totalInstances * ((scenario?.warmup_percent || 0) / 100));
  const cooldown = Math.floor(totalInstances * ((scenario?.cooldown_percent || 0) / 100));
  const activeInstances = totalInstances - warmup - cooldown;

  const sample = (type, mean, std) => {
    switch (type) {
      case 'normal': {
        const u1 = random();
        const u2 = random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(0, mean + std * z);
      }
      case 'uniform':
        return mean * 0.5 + random() * mean;
      case 'exponential':
        return -mean * Math.log(random());
      default:
        return mean;
    }
  };

  const instanceDurations = [];
  const taskStats = {};
  taskList.forEach((task) => {
    taskStats[task.task_id] = { durations: [], count: 0 };
  });

  for (let index = 0; index < totalInstances; index += 1) {
    let totalDuration = 0;
    for (const task of taskList) {
      const duration = sample(task.duration_type, +task.duration_min, +task.duration_std);
      totalDuration += duration;
      taskStats[task.task_id].durations.push(duration);
      taskStats[task.task_id].count += 1;
    }
    instanceDurations.push(totalDuration);
  }

  const activeDurations = instanceDurations.slice(warmup, totalInstances - cooldown);
  const averageDuration = activeDurations.reduce((sum, value) => sum + value, 0) / (activeDurations.length || 1);
  const sortedDurations = [...activeDurations].sort((a, b) => a - b);
  const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)] ?? 0;
  const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)] ?? 0;
  const minDuration = activeDurations.length ? Math.min(...activeDurations) : 0;
  const maxDuration = activeDurations.length ? Math.max(...activeDurations) : 0;

  const taskResults = taskList.map((task) => {
    const durations = taskStats[task.task_id]?.durations ?? [];
    const averageTaskDuration = durations.reduce((sum, value) => sum + value, 0) / (durations.length || 1);
    const sortedTaskDurations = [...durations].sort((a, b) => a - b);
    const resource = resourceList.find((item) => item.id === task.resource_id);
    const totalCost = averageTaskDuration * (totalInstances / 60) * (+task.cost || 0);

    return {
      task_id: task.task_id,
      task_name: task.task_name,
      avg_duration: Math.round(averageTaskDuration * 10) / 10,
      min_duration: Math.round((Math.min(...durations) || 0) * 10) / 10,
      max_duration: Math.round((Math.max(...durations) || 0) * 10) / 10,
      p95_duration: Math.round((sortedTaskDurations[Math.floor(sortedTaskDurations.length * 0.95)] ?? 0) * 10) / 10,
      resource_name: resource?.name ?? null,
      total_cost: Math.round(totalCost * 100) / 100,
    };
  });

  const totalCost = taskResults.reduce((sum, task) => sum + task.total_cost, 0);

  return {
    simulated_at: new Date().toISOString(),
    instances: totalInstances,
    active_instances: activeInstances,
    avg_duration_min: Math.round(averageDuration * 10) / 10,
    min_duration_min: Math.round(minDuration * 10) / 10,
    max_duration_min: Math.round(maxDuration * 10) / 10,
    p95_duration_min: Math.round(p95 * 10) / 10,
    p99_duration_min: Math.round(p99 * 10) / 10,
    total_cost: Math.round(totalCost * 100) / 100,
    task_results: taskResults,
    histogram: buildHistogram(activeDurations, 10),
  };
}
