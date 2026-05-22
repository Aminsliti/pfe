import { extractTasksFromDiagram } from './simulationEngine.js';

export const PROCESS_STATUSES = new Set(['draft', 'review', 'approved', 'archived']);

export function normalizeProcessStatus(status, fallback = 'draft') {
  const candidate = String(status || fallback || 'draft').toLowerCase();

  if (candidate === 'active') {
    return 'approved';
  }

  return PROCESS_STATUSES.has(candidate) ? candidate : fallback;
}

function countPattern(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

export function summarizeBpmnDefinition(bpmnXml = '') {
  const source = typeof bpmnXml === 'string' ? bpmnXml : '';

  return {
    tasks: countPattern(source, /<(?:[\w.-]+:)?(?:userTask|serviceTask|scriptTask|manualTask|sendTask|receiveTask|businessRuleTask|task|subProcess|callActivity)\b/gi),
    gateways: countPattern(source, /<(?:[\w.-]+:)?(?:exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway)\b/gi),
    events: countPattern(source, /<(?:[\w.-]+:)?(?:startEvent|endEvent|intermediate(?:Catch|Throw)?Event)\b/gi),
    sequenceFlows: countPattern(source, /<(?:[\w.-]+:)?sequenceFlow\b/gi),
  };
}

export function buildProcessVersionSnapshot(record = {}) {
  return {
    version_number: Number(record.version_number || record.version || 0),
    name: record.name || '',
    description: record.description || '',
    category_id: record.category_id ?? null,
    company_id: record.company_id ?? null,
    status: normalizeProcessStatus(record.status, 'draft'),
    bpmn_xml: record.bpmn_xml || '',
    change_description: record.change_description || '',
    created_at: record.created_at || null,
    created_by_name: record.created_by_name || null,
  };
}

function diffMetadata(left, right) {
  const fields = [
    ['name', 'Nom'],
    ['description', 'Description'],
    ['status', 'Status'],
    ['category_id', 'Category'],
  ];

  return fields.reduce((changes, [key, label]) => {
    const from = left[key] ?? null;
    const to = right[key] ?? null;

    if (from === to) {
      return changes;
    }

    changes.push({
      field: key,
      label,
      from,
      to,
    });
    return changes;
  }, []);
}

function diffTasks(left, right) {
  const leftTasks = new Map(extractTasksFromDiagram(left.bpmn_xml).map((task) => [task.task_id, task]));
  const rightTasks = new Map(extractTasksFromDiagram(right.bpmn_xml).map((task) => [task.task_id, task]));

  const added = [];
  const removed = [];
  const renamed = [];

  rightTasks.forEach((task, taskId) => {
    if (!leftTasks.has(taskId)) {
      added.push(task);
      return;
    }

    const previous = leftTasks.get(taskId);
    if ((previous.task_name || previous.task_id) !== (task.task_name || task.task_id)) {
      renamed.push({
        task_id: taskId,
        from: previous.task_name || previous.task_id,
        to: task.task_name || task.task_id,
      });
    }
  });

  leftTasks.forEach((task, taskId) => {
    if (!rightTasks.has(taskId)) {
      removed.push(task);
    }
  });

  return {
    added,
    removed,
    renamed,
  };
}

function diffBpmnSummary(left, right) {
  const leftSummary = summarizeBpmnDefinition(left.bpmn_xml);
  const rightSummary = summarizeBpmnDefinition(right.bpmn_xml);

  const changes = Object.keys(rightSummary).reduce((items, key) => {
    if (leftSummary[key] === rightSummary[key]) {
      return items;
    }

    items.push({
      metric: key,
      from: leftSummary[key],
      to: rightSummary[key],
    });
    return items;
  }, []);

  return {
    left: leftSummary,
    right: rightSummary,
    xml_changed: (left.bpmn_xml || '') !== (right.bpmn_xml || ''),
    changes,
  };
}

export function buildVersionDiff(leftVersion, rightVersion) {
  const left = buildProcessVersionSnapshot(leftVersion);
  const right = buildProcessVersionSnapshot(rightVersion);
  const metadata = diffMetadata(left, right);
  const tasks = diffTasks(left, right);
  const bpmn = diffBpmnSummary(left, right);

  return {
    from: left,
    to: right,
    metadata_changes: metadata,
    task_changes: tasks,
    bpmn_changes: bpmn,
    change_count:
      metadata.length +
      tasks.added.length +
      tasks.removed.length +
      tasks.renamed.length +
      bpmn.changes.length,
  };
}
