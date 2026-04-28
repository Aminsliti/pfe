import { extractTasksFromDiagram } from './simulationEngine.js';
import { normalizeProcessStatus, summarizeBpmnDefinition } from './processDiff.js';
import { buildPdfDocument } from './pdfDocument.js';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return Number(value).toFixed(decimals);
}

function formatDisplayDate(value) {
  if (!value) {
    return '-';
  }

  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return '-';
  }

  return candidate.toLocaleString('fr-FR');
}

function matchNamedElements(bpmnXml = '', elementNames = []) {
  const names = new Set();
  const items = [];
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?(${elementNames.join('|')})\\b([^>]*)`,
    'gi'
  );
  let match;

  while ((match = pattern.exec(String(bpmnXml || ''))) !== null) {
    const attrs = match[2] || '';
    const id = attrs.match(/\bid=(["'])(.*?)\1/i)?.[2] || '';
    const name = attrs.match(/\bname=(["'])(.*?)\1/i)?.[2] || id || match[1];
    const key = `${match[1]}:${id || name}`;
    if (names.has(key)) {
      continue;
    }
    names.add(key);
    items.push({
      type: match[1],
      id: id || null,
      name,
    });
  }

  return items;
}

function getXmlAttr(attrs = '', attrName = '') {
  const pattern = new RegExp(`\\b${escapeRegExp(attrName)}=(["'])(.*?)\\1`, 'i');
  const match = String(attrs || '').match(pattern);
  return match ? decodeXmlEntities(match[2]) : '';
}

function parseNamedElementsWithAttrs(bpmnXml = '', elementNames = []) {
  const items = [];
  const seen = new Set();
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?(${elementNames.map((name) => escapeRegExp(name)).join('|')})\\b([^>]*)`,
    'gi'
  );
  let match;

  while ((match = pattern.exec(String(bpmnXml || ''))) !== null) {
    const attrs = match[2] || '';
    const id = getXmlAttr(attrs, 'id');
    const name = getXmlAttr(attrs, 'name') || id || match[1];
    const key = `${match[1]}:${id || name}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({
      type: match[1],
      id: id || null,
      name,
      attrs,
    });
  }

  return items;
}

function uniqueValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function normalizeNameList(values = [], fallbackValue = null) {
  if (Array.isArray(values) && values.length > 0) {
    return uniqueValues(values);
  }

  return uniqueValues(fallbackValue ? [fallbackValue] : []);
}

function takeNames(items = [], limit = 6) {
  return items
    .map((item) => item?.name || item?.task_name || item?.label || item?.id || item?.task_id)
    .filter(Boolean)
    .slice(0, limit);
}

function humanJoin(items = []) {
  const values = items.filter(Boolean);
  if (!values.length) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function stripXmlTags(value = '') {
  return decodeXmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return uniqueValues(value);
  }

  if (typeof value === 'string') {
    return uniqueValues(
      value
        .split(/[\r\n;,]+/u)
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
  }

  return [];
}

function normalizeManualData(value = {}) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    code: normalizeText(source.code),
    objective: normalizeText(source.objective),
    owner: normalizeText(source.owner),
    scope: normalizeText(source.scope),
    trigger: normalizeText(source.trigger),
    expected_result: normalizeText(source.expected_result || source.expectedResult),
    frequency: normalizeText(source.frequency),
    context: normalizeText(source.context),
    kpis: normalizeTextList(source.kpis),
    controls: normalizeTextList(source.controls),
    support_systems: normalizeTextList(source.support_systems || source.supportSystems),
    support_documents: normalizeTextList(source.support_documents || source.supportDocuments),
    support_data: normalizeTextList(source.support_data || source.supportData),
  };
}

function displayValue(value, fallback = 'Non renseigne') {
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function buildDisplayList(values = [], fallback = 'Non renseigne') {
  const normalized = normalizeTextList(values);
  return normalized.length ? normalized : [fallback];
}

const PROCEDURE_ELEMENT_NAMES = [
  'participant',
  'lane',
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
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'eventBasedGateway',
  'boundaryEvent',
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
];

const ACTIVITY_ELEMENT_NAMES = [
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
];

const SUPPORT_ELEMENT_NAMES = [
  'dataObject',
  'dataObjectReference',
  'dataStoreReference',
];

function normalizeRiskRecord(risk = {}, index = 0, source = {}) {
  return {
    id: String(risk?.id || `risk_${index + 1}`),
    title: String(risk?.title || '').trim() || `Risk ${index + 1}`,
    severity: String(risk?.severity || 'medium').toLowerCase(),
    category: String(risk?.category || 'operational').toLowerCase(),
    status: String(risk?.status || 'open').toLowerCase(),
    description: String(risk?.description || '').trim(),
    mitigation: String(risk?.mitigation || '').trim(),
    elementId: source.id || '',
    elementName: source.name || source.id || 'Unnamed element',
    elementType: source.type || '',
  };
}

function extractActorAssignments(bpmnXml = '') {
  const grouped = new Map();

  parseNamedElementsWithAttrs(bpmnXml, PROCEDURE_ELEMENT_NAMES).forEach((element) => {
    const actorNodeId = getXmlAttr(element.attrs, 'pfe:actorNodeId');
    const actorName = getXmlAttr(element.attrs, 'pfe:actorName');

    if (!actorNodeId && !actorName) {
      return;
    }

    const actorType = getXmlAttr(element.attrs, 'pfe:actorType');
    const actorPath = getXmlAttr(element.attrs, 'pfe:actorPath');
    const key = actorNodeId || actorName;
    const bucket = grouped.get(key) || {
      actorNodeId: actorNodeId || '',
      actorName: actorName || `Actor ${actorNodeId}`,
      actorType: actorType || '',
      actorPath: actorPath || '',
      elements: [],
    };

    bucket.elements.push({
      id: element.id || '',
      name: element.name || element.id || element.type,
      type: element.type,
    });

    grouped.set(key, bucket);
  });

  return [...grouped.values()]
    .map((actor) => ({
      ...actor,
      elements: actor.elements.sort((left, right) => left.name.localeCompare(right.name)),
      count: actor.elements.length,
    }))
    .sort((left, right) => left.actorName.localeCompare(right.actorName));
}

function extractRiskRegister(bpmnXml = '') {
  const register = [];

  parseNamedElementsWithAttrs(bpmnXml, PROCEDURE_ELEMENT_NAMES).forEach((element) => {
    const rawRisks = getXmlAttr(element.attrs, 'pfe:risks');
    if (!rawRisks) {
      return;
    }

    try {
      const parsed = JSON.parse(rawRisks);
      if (!Array.isArray(parsed)) {
        return;
      }

      parsed.forEach((risk, index) => {
        register.push(normalizeRiskRecord(risk, index, element));
      });
    } catch {
      // Ignore malformed risk payloads so the export can still proceed.
    }
  });

  return register.sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.elementName.localeCompare(right.elementName)
  );
}

function buildControlPointRegister(bpmnXml = '', riskRegister = []) {
  const controls = [];
  const gateways = matchNamedElements(bpmnXml, ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway']);
  const boundaryEvents = matchNamedElements(bpmnXml, ['boundaryEvent']);
  const ruleTasks = matchNamedElements(bpmnXml, ['businessRuleTask', 'receiveTask']);
  const reviewTasks = parseNamedElementsWithAttrs(bpmnXml, ['task', 'userTask', 'manualTask', 'serviceTask', 'receiveTask', 'businessRuleTask'])
    .filter((task) => /(approve|review|validate|control|check|verify|reconcile|authorize)/i.test(task.name || ''));

  gateways.forEach((gateway) => {
    controls.push(`Decision gateway: ${gateway.name || gateway.id || gateway.type}.`);
  });

  boundaryEvents.forEach((event) => {
    controls.push(`Exception or deadline guard: ${event.name || event.id || event.type}.`);
  });

  ruleTasks.forEach((task) => {
    controls.push(`Rule or intake checkpoint: ${task.name || task.id || task.type}.`);
  });

  reviewTasks.forEach((task) => {
    controls.push(`Approval or verification step: ${task.name || task.id || task.type}.`);
  });

  riskRegister
    .filter((risk) => risk.mitigation)
    .forEach((risk) => {
      controls.push(`Risk mitigation on ${risk.elementName}: ${risk.mitigation}.`);
    });

  return uniqueValues(controls);
}

function extractDocumentationByElementId(bpmnXml = '', elementNames = ACTIVITY_ELEMENT_NAMES) {
  const documentationById = new Map();
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?(${elementNames.map((name) => escapeRegExp(name)).join('|')})\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?\\1>`,
    'gi'
  );
  let match;

  while ((match = pattern.exec(String(bpmnXml || ''))) !== null) {
    const attrs = match[2] || '';
    const innerXml = match[3] || '';
    const id = getXmlAttr(attrs, 'id');
    if (!id) {
      continue;
    }

    const documentationMatch = innerXml.match(
      /<(?:[\w.-]+:)?documentation\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?documentation>/i
    );
    if (!documentationMatch) {
      continue;
    }

    const text = stripXmlTags(documentationMatch[1] || '');
    if (text) {
      documentationById.set(id, text);
    }
  }

  return documentationById;
}

function extractStartEndSummary(bpmnXml = '') {
  const startEvents = matchNamedElements(bpmnXml, ['startEvent']);
  const endEvents = matchNamedElements(bpmnXml, ['endEvent']);

  return {
    trigger:
      startEvents.map((event) => normalizeText(event.name)).filter(Boolean)[0] ||
      '',
    expectedResult:
      endEvents.map((event) => normalizeText(event.name)).filter(Boolean)[0] ||
      '',
    startEvents,
    endEvents,
  };
}

function buildActivityRows(process = {}, documentationById = new Map(), actorAssignments = []) {
  const actorByElementId = new Map();
  actorAssignments.forEach((actor) => {
    actor.elements.forEach((element) => {
      actorByElementId.set(String(element.id || ''), actor);
    });
  });

  return parseNamedElementsWithAttrs(process.bpmn_xml || '', ACTIVITY_ELEMENT_NAMES).map((element, index) => {
    const actor = actorByElementId.get(String(element.id || ''));
    const isSystemActivity = element.type === 'serviceTask' || /system|core banking|swift|api|application/i.test(element.name || '');

    return {
      order: index + 1,
      activity: element.name || element.id || `Activity ${index + 1}`,
      element_id: element.id || '',
      type: element.type,
      actor: actor?.actorName || 'Non assigne',
      description: documentationById.get(String(element.id || '')) || 'Non renseigne',
      inputs: 'Non renseigne',
      outputs: 'Non renseigne',
      systems: isSystemActivity ? element.name || element.id || 'Interaction systeme' : 'Non renseigne',
      rules: 'Non renseigne',
      exceptions: 'Non renseigne',
    };
  });
}

function buildProcedureStepRows(activityRows = [], controlPoints = []) {
  return activityRows.map((activity, index) => {
    const relatedControls = controlPoints.filter((control) =>
      activity.activity && control.toLowerCase().includes(activity.activity.toLowerCase())
    );

    return {
      step_number: index + 1,
      activity: activity.activity,
      actor: activity.actor,
      steps: activity.description !== 'Non renseigne' ? activity.description : `Executer ${activity.activity}.`,
      validations: relatedControls.length ? humanJoin(relatedControls.slice(0, 3)) : 'Non renseigne',
      exceptions: activity.exceptions || 'Non renseigne',
      systems: activity.systems || 'Non renseigne',
    };
  });
}

function buildSupportObjectRows(process = {}, manualData = {}, activityRows = []) {
  const rows = [];
  const seen = new Set();

  const pushRow = (type, label, attachedTo = '', source = 'manuel') => {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel) {
      return;
    }

    const key = `${type}:${normalizedLabel.toLowerCase()}:${normalizeText(attachedTo).toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    rows.push({
      type,
      label: normalizedLabel,
      attached_to: normalizeText(attachedTo) || 'Processus',
      source,
    });
  };

  manualData.support_systems.forEach((label) => pushRow('Systeme', label));
  manualData.support_documents.forEach((label) => pushRow('Document', label));
  manualData.support_data.forEach((label) => pushRow('Donnee', label));

  activityRows
    .filter((activity) => activity.systems && activity.systems !== 'Non renseigne')
    .forEach((activity) => pushRow('Systeme', activity.systems, activity.activity, 'diagramme'));

  matchNamedElements(process.bpmn_xml || '', SUPPORT_ELEMENT_NAMES).forEach((item) => {
    const label = normalizeText(item.name || item.id || '');
    if (!label) {
      return;
    }

    if (/(document|dossier|formulaire|contrat|piece|justificatif|fiche|demande|report)/i.test(label)) {
      pushRow('Document', label, 'Diagramme', 'diagramme');
      return;
    }

    pushRow('Donnee', label, 'Diagramme', 'diagramme');
  });

  return rows.length
    ? rows
    : [{
        type: 'Support',
        label: 'Non renseigne',
        attached_to: 'Processus',
        source: 'manuel',
      }];
}

function buildKpiRows(manualData = {}) {
  const rows = normalizeTextList(manualData.kpis).map((label) => ({
    name: label,
    target: 'A definir',
    source: 'Saisie manuelle',
  }));

  return rows.length
    ? rows
    : [
        { name: 'Delai de traitement', target: 'Non renseigne', source: 'A definir' },
        { name: 'Volume traite', target: 'Non renseigne', source: 'A definir' },
        { name: 'Taux de conformite', target: 'Non renseigne', source: 'A definir' },
      ];
}

function buildRiskRows(risks = []) {
  return risks.length
    ? risks.map((risk) => ({
        title: risk.title,
        severity: risk.severity,
        status: risk.status,
        category: risk.category,
        element: risk.elementName || '-',
        description: risk.description || 'Non renseigne',
        mitigation: risk.mitigation || 'Non renseigne',
      }))
    : [{
        title: 'Aucun risque rattache',
        severity: '-',
        status: '-',
        category: '-',
        element: '-',
        description: 'Aucun risque n est attache au diagramme.',
        mitigation: 'Non renseigne',
      }];
}

function buildControlRows(controlPoints = [], manualData = {}) {
  const rows = [
    ...normalizeTextList(manualData.controls).map((label) => ({
      control: label,
      source: 'Saisie manuelle',
    })),
    ...uniqueValues(controlPoints).map((label) => ({
      control: label,
      source: 'Inference BPMN',
    })),
  ];

  return rows.length
    ? rows
    : [{
        control: 'Aucun controle explicite detecte',
        source: 'Inference BPMN',
      }];
}

export function buildProcedureManual(process = {}, workflow = null, explanation = null) {
  const narrative = explanation || buildProcessExplanation(process, workflow);
  const actors = extractActorAssignments(process.bpmn_xml || '');
  const risks = extractRiskRegister(process.bpmn_xml || '');
  const controlPoints = buildControlPointRegister(process.bpmn_xml || '', risks);
  const manualData = normalizeManualData(process.manual_data);
  const startEnd = extractStartEndSummary(process.bpmn_xml || '');
  const documentationById = extractDocumentationByElementId(process.bpmn_xml || '');
  const activityRows = buildActivityRows(process, documentationById, actors);
  const procedureRows = buildProcedureStepRows(activityRows, controlPoints);
  const supportRows = buildSupportObjectRows(process, manualData, activityRows);
  const kpiRows = buildKpiRows(manualData);
  const riskRows = buildRiskRows(risks);
  const controlRows = buildControlRows(controlPoints, manualData);
  const responsible = uniqueValues(actors.map((actor) => actor.actorName));
  const accountable = normalizeNameList(
    manualData.owner ? [manualData.owner] : process.assigned_validator_names,
    manualData.owner || process.assigned_validator_name || process.created_by_name
  );
  const consulted = normalizeNameList(process.assigned_designer_names, process.assigned_designer_name);
  const informed = uniqueValues([process.created_by_name, workflow?.approved_by_name, process.approved_by_name]);
  const identityRows = [
    { label: 'Code', value: displayValue(manualData.code, `PROC-${process.id || '-'}`) },
    { label: 'Nom du processus', value: displayValue(process.name) },
    { label: 'Objectif', value: displayValue(manualData.objective, process.description || 'Non renseigne') },
    { label: 'Owner', value: displayValue(manualData.owner, accountable[0] || process.created_by_name || 'Non renseigne') },
    { label: 'Perimetre', value: displayValue(manualData.scope, process.category_name || 'Non renseigne') },
    { label: 'Declencheur', value: displayValue(manualData.trigger, startEnd.trigger || 'Non renseigne') },
    { label: 'Resultat attendu', value: displayValue(manualData.expected_result, startEnd.expectedResult || 'Non renseigne') },
    { label: 'Frequence', value: displayValue(manualData.frequency) },
    { label: 'Contexte', value: displayValue(manualData.context, process.description || 'Non renseigne') },
  ];

  return {
    narrative,
    manualData,
    actors,
    risks,
    controlPoints,
    matrices: {
      identity: identityRows,
      activities: activityRows,
      procedures: procedureRows,
      supportObjects: supportRows,
      kpis: kpiRows,
      risks: riskRows,
      controls: controlRows,
    },
    raci: {
      responsible: buildDisplayList(responsible),
      accountable,
      consulted: buildDisplayList(consulted),
      informed: buildDisplayList(informed),
    },
    workflowBullets: [
      `Status: ${normalizeProcessStatus(process.status, 'draft')}`,
      process.version ? `Version: v${process.version}` : null,
      process.company_name ? `Company: ${process.company_name}` : null,
      process.category_name ? `Category: ${process.category_name}` : null,
      process.created_by_name ? `Process owner record created by: ${process.created_by_name}` : null,
      workflow?.submitted_at ? `Submitted on ${formatDisplayDate(workflow.submitted_at)}` : null,
      workflow?.approved_at ? `Approved on ${formatDisplayDate(workflow.approved_at)}` : null,
      workflow?.approved_by_name ? `Approved by ${workflow.approved_by_name}` : null,
    ].filter(Boolean),
  };
}

export function buildProcessExplanation(process = {}, workflow = null) {
  const bpmnXml = process.bpmn_xml || '';
  const summary = summarizeBpmnDefinition(bpmnXml);
  const participants = matchNamedElements(bpmnXml, ['participant']);
  const lanes = matchNamedElements(bpmnXml, ['lane']);
  const gateways = matchNamedElements(bpmnXml, ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway']);
  const events = matchNamedElements(bpmnXml, ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent']);
  const messageFlows = matchNamedElements(bpmnXml, ['messageFlow']);
  const subprocesses = matchNamedElements(bpmnXml, ['subProcess', 'callActivity']);
  const tasks = extractTasksFromDiagram(bpmnXml);
  const orderedTaskNames = tasks
    .map((task) => task?.task_name || task?.name || task?.task_id || task?.id)
    .filter(Boolean)
    .slice(0, 8);
  const currentStatus = normalizeProcessStatus(process.status, 'draft');

  const overviewLine = [
    `This ${currentStatus} process contains ${summary.tasks} activities, ${summary.gateways} gateways, ${summary.events} events, and ${summary.sequenceFlows} sequence flows.`,
    participants.length
      ? `It is modeled as a collaboration between ${participants.length} participant(s): ${humanJoin(takeNames(participants, 4))}.`
      : 'It is modeled as a single-process workflow without explicit participants.',
    lanes.length ? `Responsibility is split across ${lanes.length} lane(s): ${humanJoin(takeNames(lanes, 5))}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pathNarrative = orderedTaskNames.length
    ? `The main activity path starts with ${orderedTaskNames[0]} and continues through ${humanJoin(orderedTaskNames.slice(1))}.`
    : 'No task-level activity path could be extracted from the BPMN definition.';

  const collaborationNarrative = messageFlows.length
    ? `The diagram uses ${messageFlows.length} message flow(s), which indicates explicit handoffs between participants or external actors.`
    : 'The diagram does not use explicit message flows, so collaboration is implied inside a single execution path.';

  const controlNarrative = gateways.length
    ? `Control logic is handled by ${gateways.length} gateway node(s), allowing the process to branch, synchronize, or make event-based decisions.`
    : 'The process follows a largely linear control path with no explicit gateway branching.';

  const workflowBullets = [
    `Status: ${currentStatus}`,
    process.version ? `Current version: v${process.version}` : null,
    workflow?.submitted_at ? `Submitted for review on ${new Date(workflow.submitted_at).toLocaleString()}` : null,
    workflow?.approved_at ? `Approved on ${new Date(workflow.approved_at).toLocaleString()}` : null,
    workflow?.approved_by_name ? `Approved by ${workflow.approved_by_name}` : null,
    workflow?.archived_at ? `Archived on ${new Date(workflow.archived_at).toLocaleString()}` : null,
  ].filter(Boolean);

  return {
    generated_at: new Date().toISOString(),
    summary:
      `${process.name || 'Process'} is a ${currentStatus} BPMN workflow. ${overviewLine} ${pathNarrative}`.trim(),
    metrics: {
      participants: participants.length,
      lanes: lanes.length,
      activities: summary.tasks,
      gateways: summary.gateways,
      events: summary.events,
      sequence_flows: summary.sequenceFlows,
      subprocesses: subprocesses.length,
      message_flows: messageFlows.length,
    },
    ordered_tasks: orderedTaskNames,
    sections: [
      {
        title: 'Structure overview',
        body: overviewLine,
        bullets: [
          `Participants: ${participants.length || 0}`,
          `Lanes: ${lanes.length || 0}`,
          `Sub-processes: ${subprocesses.length || 0}`,
          `Message flows: ${messageFlows.length || 0}`,
        ],
      },
      {
        title: 'Activity walkthrough',
        body: pathNarrative,
        bullets: orderedTaskNames.length ? orderedTaskNames.map((name, index) => `${index + 1}. ${name}`) : [],
      },
      {
        title: 'Collaboration and routing',
        body: `${collaborationNarrative} ${controlNarrative}`.trim(),
        bullets: [
          participants.length ? `Participants involved: ${humanJoin(takeNames(participants, 6))}` : null,
          lanes.length ? `Lane ownership: ${humanJoin(takeNames(lanes, 6))}` : null,
          subprocesses.length ? `Embedded work areas: ${humanJoin(takeNames(subprocesses, 6))}` : null,
        ].filter(Boolean),
      },
      {
        title: 'Workflow lifecycle',
        body:
          workflowBullets.length > 0
            ? 'The process record keeps workflow and governance data alongside the BPMN diagram.'
            : 'No workflow governance metadata is currently available for this process.',
        bullets: workflowBullets,
      },
    ],
    details: {
      participants,
      lanes,
      tasks: tasks.map((task) => ({
        task_id: task.task_id,
        task_name: task.task_name,
      })),
      gateways,
      events,
      subprocesses,
      message_flows: messageFlows,
    },
  };
}

function buildRows(rows = [], columns = []) {
  return rows
    .map(
      (row) => `
        <tr>
          ${columns
            .map((column) => `<td>${escapeHtml(column.format ? column.format(row[column.key], row) : row[column.key] ?? '')}</td>`)
            .join('')}
        </tr>
      `
    )
    .join('');
}

function createDocxTextRun(text = '', options = {}) {
  return new TextRun({
    text: String(text ?? ''),
    size: options.size ?? 22,
    color: options.color ?? '1f2937',
    bold: options.bold ?? false,
    italics: options.italics ?? false,
  });
}

function createDocxParagraph(text = '', options = {}) {
  const {
    children,
    heading,
    alignment,
    bullet,
    spacing,
    thematicBreak,
    size,
    color,
    bold,
    italics,
  } = options;

  return new Paragraph({
    heading,
    alignment,
    bullet,
    spacing,
    thematicBreak,
    children: children || [createDocxTextRun(text, { size, color, bold, italics })],
  });
}

function createDocxBullets(items = []) {
  return items
    .filter(Boolean)
    .map((item) => createDocxParagraph(item, {
      bullet: { level: 0 },
      spacing: { after: 120 },
    }));
}

function createDocxTableCell(text = '', options = {}) {
  const { header = false, width = null } = options;

  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header
      ? {
          fill: 'e2e8f0',
          color: 'auto',
          type: ShadingType.CLEAR,
        }
      : undefined,
    margins: {
      top: 100,
      bottom: 100,
      left: 120,
      right: 120,
    },
    children: [
      createDocxParagraph(String(text ?? ''), {
        bold: header,
        size: header ? 20 : 18,
        color: header ? '334155' : '111827',
        spacing: { after: 0 },
      }),
    ],
  });
}

function createDocxTableSection(title, columns = [], rows = []) {
  const safeRows = rows.length
    ? rows
    : [{
        [columns[0]?.key || 'value']: 'Aucune donnee disponible.',
      }];

  return [
    createDocxParagraph(title, {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 140 },
    }),
    new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'cbd5e1' },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'e2e8f0' },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'e2e8f0' },
      },
      rows: [
        new TableRow({
          children: columns.map((column) => createDocxTableCell(column.label, { header: true, width: column.width })),
        }),
        ...safeRows.map((row) => new TableRow({
          children: columns.map((column, columnIndex) => createDocxTableCell(
            columnIndex === 0 && !rows.length
              ? row[column.key] ?? ''
              : (column.format ? column.format(row[column.key], row) : row[column.key]) ?? '',
            { width: column.width }
          )),
        })),
      ],
    }),
  ];
}

function parseDocxImageDataUrl(value = '') {
  const match = String(value || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/u);
  if (!match) {
    return null;
  }

  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

export function buildProcessReportHtml(process = {}, explanation = null) {
  const manual = buildProcedureManual(process, null, explanation);
  const sectionsHtml = (manual.narrative.sections || [])
    .map(
      (section) => `
        <div class="section">
          <h2>${escapeHtml(section.title)}</h2>
          <p>${escapeHtml(section.body || '')}</p>
          ${
            section.bullets?.length
              ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
              : ''
          }
        </div>
      `
    )
    .join('');

  const renderTable = (title, columns, rows) => `
    <div class="section">
      <h2>${escapeHtml(title)}</h2>
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${buildRows(rows, columns)}
        </tbody>
      </table>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(process.name || 'Process')} - Manuel de procedure</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; color: #111827; background: #f8fafc; }
    .report-shell { background: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08); }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 10px; font-size: 30px; }
    .eyebrow { display: inline-block; color: #b91c1c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; }
    .hero-meta { font-size: 13px; color: #64748b; line-height: 1.7; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 24px 0; }
    .metric-card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; background: linear-gradient(180deg, #fff 0%, #f8fafc 100%); }
    .metric-card span { display: block; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .metric-card strong { font-size: 24px; color: #111827; }
    .section { margin-top: 30px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; }
    .section p { color: #4b5563; font-size: 14px; line-height: 1.7; }
    ul { margin: 10px 0 0 18px; color: #334155; }
    li { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
    @media print { body { margin: 0; background: #fff; } .report-shell { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="report-shell">
    <div class="hero">
      <div>
        <span class="eyebrow">Manuel de procedure</span>
        <h1>${escapeHtml(process.name || `Process #${process.id || ''}`)}</h1>
        <div class="hero-meta">
          Status: ${escapeHtml(normalizeProcessStatus(process.status, 'draft'))}<br />
          Version: ${escapeHtml(process.version ? `v${process.version}` : '-') }<br />
          Category: ${escapeHtml(process.category_name || '-')}
        </div>
      </div>
      <div class="hero-meta">
        Generated at: ${escapeHtml(manual.narrative.generated_at || '-') }
      </div>
    </div>

    <p style="font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(manual.narrative.summary || '')}</p>

    <div class="metrics">
      ${[
        ['Participants', manual.narrative.metrics?.participants],
        ['Lanes', manual.narrative.metrics?.lanes],
        ['Activities', manual.narrative.metrics?.activities],
        ['Gateways', manual.narrative.metrics?.gateways],
        ['Events', manual.narrative.metrics?.events],
        ['Sub-processes', manual.narrative.metrics?.subprocesses],
        ['Seq. flows', manual.narrative.metrics?.sequence_flows],
        ['Msg. flows', manual.narrative.metrics?.message_flows],
      ]
        .map(
          ([label, value]) => `
            <div class="metric-card">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(formatNumber(value, 0))}</strong>
            </div>
          `
        )
        .join('')}
    </div>

    ${renderTable('1. Identite du processus', [
      { key: 'label', label: 'Champ' },
      { key: 'value', label: 'Valeur' },
    ], manual.matrices.identity)}

    ${sectionsHtml}

    ${renderTable('2. Matrice des activites', [
      { key: 'order', label: '#' },
      { key: 'activity', label: 'Activite' },
      { key: 'type', label: 'Type BPMN' },
      { key: 'actor', label: 'Acteur' },
      { key: 'description', label: 'Description' },
      { key: 'inputs', label: 'Entrees' },
      { key: 'outputs', label: 'Sorties' },
      { key: 'systems', label: 'SI' },
    ], manual.matrices.activities)}

    ${renderTable('3. Matrice des procedures detaillees', [
      { key: 'step_number', label: 'Etape' },
      { key: 'activity', label: 'Activite' },
      { key: 'actor', label: 'Acteur' },
      { key: 'steps', label: 'Procedure' },
      { key: 'validations', label: 'Validations / Controles' },
      { key: 'exceptions', label: 'Exceptions' },
      { key: 'systems', label: 'SI' },
    ], manual.matrices.procedures)}

    ${renderTable('4. Matrice des objets supports', [
      { key: 'type', label: 'Type' },
      { key: 'label', label: 'Libelle' },
      { key: 'attached_to', label: 'Rattachement' },
      { key: 'source', label: 'Source' },
    ], manual.matrices.supportObjects)}

    ${renderTable('5.1 Matrice KPI', [
      { key: 'name', label: 'KPI' },
      { key: 'target', label: 'Cible' },
      { key: 'source', label: 'Source' },
    ], manual.matrices.kpis)}

    ${renderTable('5.2 Matrice des risques', [
      { key: 'title', label: 'Risque' },
      { key: 'severity', label: 'Severite' },
      { key: 'status', label: 'Statut' },
      { key: 'category', label: 'Categorie' },
      { key: 'element', label: 'Element BPMN' },
      { key: 'description', label: 'Description' },
      { key: 'mitigation', label: 'Mitigation / Controle' },
    ], manual.matrices.risks)}

    ${renderTable('5.3 Matrice des controles', [
      { key: 'control', label: 'Controle' },
      { key: 'source', label: 'Source' },
    ], manual.matrices.controls)}
  </div>
</body>
</html>`;
}

export function buildProcessReportPdf(process = {}, explanation = null, options = {}) {
  const manual = buildProcedureManual(process, options.workflow || null, explanation);
  const actorBullets = manual.actors.length
    ? manual.actors.map((actor) => {
        const elementPreview = actor.elements.slice(0, 4).map((element) => element.name);
        const remainder = actor.elements.length - elementPreview.length;
        const suffix = remainder > 0 ? ` (+${remainder} more)` : '';
        const actorLabel = actor.actorType ? `${actor.actorName} (${actor.actorType})` : actor.actorName;
        const pathLabel = actor.actorPath ? ` | ${actor.actorPath}` : '';
        return `${actorLabel}${pathLabel}: ${humanJoin(elementPreview)}${suffix}.`;
      })
    : ['No BPMN actor assignments were found in the current diagram.'];
  const riskBullets = manual.risks.length
    ? manual.risks.map((risk) => {
        const riskPrefix = `[${risk.severity.toUpperCase()} / ${risk.status}] ${risk.title}`;
        const riskDetails = [risk.elementName ? `Element: ${risk.elementName}` : null, risk.description || null, risk.mitigation ? `Mitigation: ${risk.mitigation}` : null]
          .filter(Boolean)
          .join(' | ');
        return `${riskPrefix}${riskDetails ? ` - ${riskDetails}` : ''}`;
      })
    : ['No managed risks are currently attached to BPMN elements.'];
  const taskBullets = (manual.narrative.details?.tasks || [])
    .slice(0, 28)
    .map((task) => `${task.task_name || task.task_id} (${task.task_id})`);

  return buildPdfDocument({
    title: `Manuel de procedure: ${process.name || `Process #${process.id}`}`,
    subtitle: `Status: ${normalizeProcessStatus(process.status, 'draft')} | Version: ${process.version ? `v${process.version}` : '-'} | Generated: ${formatDisplayDate(manual.narrative.generated_at)}`,
    heroImage: options.diagramImageDataUrl
      ? { dataUrl: options.diagramImageDataUrl }
      : null,
    sections: [
      {
        title: '1. Identite du processus',
        paragraphs: [manual.narrative.summary || ''],
        bullets: manual.matrices.identity.map((row) => `${row.label}: ${row.value}`),
      },
      {
        title: '2. Matrice des activites',
        bullets: manual.matrices.activities.length
          ? manual.matrices.activities.map((row) => `${row.order}. ${row.activity} | Acteur: ${row.actor} | Description: ${row.description}`)
          : ['Aucune activite extraite du diagramme.'],
      },
      {
        title: '3. Procedures detaillees',
        bullets: manual.matrices.procedures.length
          ? manual.matrices.procedures.map((row) => `Etape ${row.step_number}: ${row.activity} | ${row.steps}`)
          : ['Aucune procedure detaillee disponible.'],
      },
      {
        title: '4. Objets supports',
        bullets: manual.matrices.supportObjects.map((row) => `${row.type}: ${row.label} (${row.attached_to})`),
      },
      {
        title: '5. Pilotage et gouvernance',
        paragraphs: [manual.narrative.summary || ''],
        bullets: manual.workflowBullets,
      },
      {
        title: 'Actors and ownership',
        bullets: actorBullets,
      },
      {
        title: 'RACI snapshot',
        bullets: [
          `Responsible (R): ${humanJoin(manual.raci.responsible) || 'Not assigned'}`,
          `Accountable (A): ${humanJoin(manual.raci.accountable) || 'Not assigned'}`,
          `Consulted (C): ${humanJoin(manual.raci.consulted) || 'Not assigned'}`,
          `Informed (I): ${humanJoin(manual.raci.informed) || 'Not assigned'}`,
        ],
      },
      ...((manual.narrative.sections || []).map((section) => ({
        title: section.title,
        paragraphs: [section.body || ''],
        bullets: section.bullets || [],
      }))),
      {
        title: 'Activity inventory',
        bullets: taskBullets.length ? taskBullets : ['No task inventory could be extracted from the BPMN definition.'],
      },
      {
        title: 'Risk register',
        bullets: riskBullets,
      },
      {
        title: 'Control points',
        bullets: manual.matrices.controls.length
          ? manual.matrices.controls.map((row) => `${row.control} (${row.source})`)
          : ['No explicit control points could be inferred from the current BPMN diagram.'],
      },
      {
        title: 'KPI',
        bullets: manual.matrices.kpis.map((row) => `${row.name}: ${row.target} (${row.source})`),
      },
    ],
  });
}

export async function buildProcessReportDocx(process = {}, explanation = null, options = {}) {
  const manual = buildProcedureManual(process, options.workflow || null, explanation);
  const actorBullets = manual.actors.length
    ? manual.actors.map((actor) => {
        const actorLabel = actor.actorType ? `${actor.actorName} (${actor.actorType})` : actor.actorName;
        const pathLabel = actor.actorPath ? ` | ${actor.actorPath}` : '';
        const elementPreview = actor.elements.slice(0, 4).map((element) => element.name);
        const remainder = actor.elements.length - elementPreview.length;
        const suffix = remainder > 0 ? ` (+${remainder} more)` : '';
        return `${actorLabel}${pathLabel}: ${humanJoin(elementPreview)}${suffix}.`;
      })
    : ['No BPMN actor assignments were found in the current diagram.'];
  const docChildren = [
    createDocxParagraph('Manuel de procedure', {
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    }),
    createDocxParagraph(process.name || `Process #${process.id || ''}`, {
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
    }),
    createDocxParagraph(
      `Status: ${normalizeProcessStatus(process.status, 'draft')} | Version: ${process.version ? `v${process.version}` : '-'} | Category: ${process.category_name || '-'}`,
      {
        color: '475569',
        spacing: { after: 60 },
      }
    ),
    createDocxParagraph(`Generated at: ${formatDisplayDate(manual.narrative.generated_at)}`, {
      color: '64748b',
      spacing: { after: 220 },
    }),
  ];
  const diagramImageBuffer = parseDocxImageDataUrl(options.diagramImageDataUrl);

  if (diagramImageBuffer) {
    docChildren.push(
      createDocxParagraph('', {
        alignment: AlignmentType.CENTER,
        spacing: { after: 220 },
        children: [
          new ImageRun({
            data: diagramImageBuffer,
            transformation: {
              width: 620,
              height: 340,
            },
          }),
        ],
      })
    );
  }

  docChildren.push(
    createDocxParagraph(manual.narrative.summary || '', {
      spacing: { after: 200 },
    }),
    createDocxParagraph('Indicateurs du diagramme', {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 120, after: 120 },
    }),
    ...createDocxBullets([
      `Participants: ${formatNumber(manual.narrative.metrics?.participants, 0)}`,
      `Lanes: ${formatNumber(manual.narrative.metrics?.lanes, 0)}`,
      `Activities: ${formatNumber(manual.narrative.metrics?.activities, 0)}`,
      `Gateways: ${formatNumber(manual.narrative.metrics?.gateways, 0)}`,
      `Events: ${formatNumber(manual.narrative.metrics?.events, 0)}`,
      `Sub-processes: ${formatNumber(manual.narrative.metrics?.subprocesses, 0)}`,
      `Sequence flows: ${formatNumber(manual.narrative.metrics?.sequence_flows, 0)}`,
      `Message flows: ${formatNumber(manual.narrative.metrics?.message_flows, 0)}`,
    ]),
    ...createDocxTableSection('1. Identite du processus', [
      { key: 'label', label: 'Champ', width: 30 },
      { key: 'value', label: 'Valeur', width: 70 },
    ], manual.matrices.identity)
  );

  (manual.narrative.sections || []).forEach((section) => {
    docChildren.push(
      createDocxParagraph(section.title, {
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280, after: 100 },
      }),
      createDocxParagraph(section.body || '', {
        spacing: { after: 120 },
      }),
      ...createDocxBullets(section.bullets || [])
    );
  });

  docChildren.push(
    ...createDocxTableSection('2. Matrice des activites', [
      { key: 'order', label: '#', width: 8 },
      { key: 'activity', label: 'Activite', width: 18 },
      { key: 'type', label: 'Type BPMN', width: 14 },
      { key: 'actor', label: 'Acteur', width: 15 },
      { key: 'description', label: 'Description', width: 17 },
      { key: 'inputs', label: 'Entrees', width: 10 },
      { key: 'outputs', label: 'Sorties', width: 10 },
      { key: 'systems', label: 'SI', width: 8 },
    ], manual.matrices.activities),
    ...createDocxTableSection('3. Matrice des procedures detaillees', [
      { key: 'step_number', label: 'Etape', width: 8 },
      { key: 'activity', label: 'Activite', width: 18 },
      { key: 'actor', label: 'Acteur', width: 15 },
      { key: 'steps', label: 'Procedure', width: 23 },
      { key: 'validations', label: 'Validations / Controles', width: 18 },
      { key: 'exceptions', label: 'Exceptions', width: 10 },
      { key: 'systems', label: 'SI', width: 8 },
    ], manual.matrices.procedures),
    ...createDocxTableSection('4. Matrice des objets supports', [
      { key: 'type', label: 'Type', width: 18 },
      { key: 'label', label: 'Libelle', width: 34 },
      { key: 'attached_to', label: 'Rattachement', width: 24 },
      { key: 'source', label: 'Source', width: 24 },
    ], manual.matrices.supportObjects),
    createDocxParagraph('5. Pilotage et gouvernance', {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 120 },
    }),
    ...createDocxBullets(manual.workflowBullets || []),
    createDocxParagraph('Acteurs et responsabilites', {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 120 },
    }),
    ...createDocxBullets(actorBullets),
    createDocxParagraph('Synthese RACI', {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 120 },
    }),
    ...createDocxBullets([
      `Responsible (R): ${humanJoin(manual.raci.responsible) || 'Not assigned'}`,
      `Accountable (A): ${humanJoin(manual.raci.accountable) || 'Not assigned'}`,
      `Consulted (C): ${humanJoin(manual.raci.consulted) || 'Not assigned'}`,
      `Informed (I): ${humanJoin(manual.raci.informed) || 'Not assigned'}`,
    ]),
    ...createDocxTableSection('5.1 Matrice KPI', [
      { key: 'name', label: 'KPI', width: 34 },
      { key: 'target', label: 'Cible', width: 26 },
      { key: 'source', label: 'Source', width: 40 },
    ], manual.matrices.kpis),
    ...createDocxTableSection('5.2 Matrice des risques', [
      { key: 'title', label: 'Risque', width: 16 },
      { key: 'severity', label: 'Severite', width: 10 },
      { key: 'status', label: 'Statut', width: 10 },
      { key: 'category', label: 'Categorie', width: 12 },
      { key: 'element', label: 'Element BPMN', width: 16 },
      { key: 'description', label: 'Description', width: 18 },
      { key: 'mitigation', label: 'Mitigation / Controle', width: 18 },
    ], manual.matrices.risks),
    ...createDocxTableSection('5.3 Matrice des controles', [
      { key: 'control', label: 'Controle', width: 48 },
      { key: 'source', label: 'Source', width: 52 },
    ], manual.matrices.controls)
  );

  const document = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  return Packer.toBuffer(document);
}
