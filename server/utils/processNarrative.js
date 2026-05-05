import { Buffer } from 'node:buffer';
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
  PageOrientation,
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
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&#60;/g, '<')
    .replace(/&#x3c;/gi, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#62;/g, '>')
    .replace(/&#x3e;/gi, '>')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value = '') {
  return String(value || '').trim();
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

function normalizeManualRowList(value, fields = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : {};
      const normalized = {};
      let hasValue = false;

      fields.forEach((field) => {
        const resolved = normalizeText(source[field]);
        normalized[field] = resolved;
        if (resolved) {
          hasValue = true;
        }
      });

      return hasValue ? normalized : null;
    })
    .filter(Boolean);
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
    workflow_notes: normalizeTextList(source.workflow_notes || source.workflowNotes),
    raci_responsible: normalizeTextList(source.raci_responsible || source.raciResponsible),
    raci_accountable: normalizeTextList(source.raci_accountable || source.raciAccountable),
    raci_consulted: normalizeTextList(source.raci_consulted || source.raciConsulted),
    raci_informed: normalizeTextList(source.raci_informed || source.raciInformed),
    kpi_details: normalizeManualRowList(source.kpi_details || source.kpiDetails, ['name', 'target', 'source']),
    support_data_details: normalizeManualRowList(source.support_data_details || source.supportDataDetails, ['name', 'description', 'format', 'source', 'destination', 'criticality']),
    support_document_details: normalizeManualRowList(source.support_document_details || source.supportDocumentDetails, ['name', 'type', 'generated_by', 'output_of', 'version']),
    support_system_details: normalizeManualRowList(source.support_system_details || source.supportSystemDetails, ['name', 'role']),
    risk_details: normalizeManualRowList(source.risk_details || source.riskDetails, ['title', 'severity', 'status', 'category', 'element', 'description', 'mitigation']),
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

  // Risks can be attached to any visible BPMN element in the editor, including
  // data objects / data stores / annotations. The manual should reflect those too.
  const riskElementNames = [
    ...PROCEDURE_ELEMENT_NAMES,
    ...SUPPORT_ELEMENT_NAMES,
    'group',
    'textAnnotation',
  ];

  parseNamedElementsWithAttrs(bpmnXml, riskElementNames).forEach((element) => {
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

function hasMeaningfulValue(value = '') {
  const normalized = normalizeText(value);
  return Boolean(normalized) && normalized.toLowerCase() !== 'non renseigne';
}

function joinMatrixCellValues(values = [], separator = ' | ', fallback = 'Non renseigne') {
  const normalized = uniqueValues(values.map((value) => normalizeText(value)).filter(Boolean));
  return normalized.length ? normalized.join(separator) : fallback;
}

function formatActivityTypeLabel(type = '') {
  const labels = {
    task: 'Tache',
    userTask: 'Tache utilisateur',
    serviceTask: 'Tache de service',
    scriptTask: 'Tache script',
    manualTask: 'Tache manuelle',
    sendTask: 'Tache d envoi',
    receiveTask: 'Tache de reception',
    businessRuleTask: 'Tache de regle metier',
    subProcess: 'Sous-processus',
    callActivity: 'Sous-processus appele',
  };

  return labels[type] || type || 'Activite';
}

function buildActivityDescription({
  documentation = '',
  type = '',
  systems = '',
  inputs = '',
  outputs = '',
  rules = '',
  exceptions = '',
} = {}) {
  const details = [];

  if (hasMeaningfulValue(documentation)) {
    details.push(normalizeText(documentation));
  }

  details.push(`Type BPMN: ${formatActivityTypeLabel(type)}`);

  if (type === 'subProcess' || type === 'callActivity') {
    details.push('Sous-processus inclus dans le manuel.');
  }

  if (hasMeaningfulValue(inputs)) {
    details.push(`Entrees: ${normalizeText(inputs)}`);
  }
  if (hasMeaningfulValue(outputs)) {
    details.push(`Sorties: ${normalizeText(outputs)}`);
  }
  if (hasMeaningfulValue(systems)) {
    details.push(`SI: ${normalizeText(systems)}`);
  }
  if (hasMeaningfulValue(rules)) {
    details.push(`Regles: ${normalizeText(rules)}`);
  }
  if (hasMeaningfulValue(exceptions)) {
    details.push(`Exceptions: ${normalizeText(exceptions)}`);
  }

  return joinMatrixCellValues(details);
}

function buildActivityRows(process = {}, documentationById = new Map(), actorAssignments = [], manualData = {}) {
  const actorByElementId = new Map();
  actorAssignments.forEach((actor) => {
    actor.elements.forEach((element) => {
      actorByElementId.set(String(element.id || ''), actor);
    });
  });

  const fallbackActor = normalizeText(manualData.raci_responsible?.[0] || manualData.owner || '');

  return parseNamedElementsWithAttrs(process.bpmn_xml || '', ACTIVITY_ELEMENT_NAMES).map((element, index) => {
    const actor = actorByElementId.get(String(element.id || ''));
    const isSystemActivity = element.type === 'serviceTask' || /system|core banking|swift|api|application/i.test(element.name || '');
    const documentation = documentationById.get(String(element.id || '')) || '';
    const systems = isSystemActivity ? element.name || element.id || 'Interaction systeme' : 'Non renseigne';

    return {
      order: index + 1,
      activity: element.name || element.id || `Activity ${index + 1}`,
      element_id: element.id || '',
      type: element.type,
      type_label: formatActivityTypeLabel(element.type),
      actor: actor?.actorName || fallbackActor || 'Non assigne',
      documentation,
      description: buildActivityDescription({
        documentation,
        type: element.type,
        systems,
      }),
      systems,
    };
  });
}

function buildDiagramDescription(process = {}, narrative = {}) {
  const metrics = narrative.metrics || {};
  const parts = [
    `${process.name || 'Ce processus'} est represente par un diagramme BPMN ${normalizeProcessStatus(process.status, 'draft')}.`,
    `Il contient ${Number(metrics.activities || 0)} activite(s), ${Number(metrics.gateways || 0)} passerelle(s), ${Number(metrics.events || 0)} evenement(s) et ${Number(metrics.sequence_flows || 0)} flux de sequence.`,
  ];

  if (
    metrics.participants !== undefined ||
    metrics.lanes !== undefined ||
    metrics.subprocesses !== undefined ||
    metrics.message_flows !== undefined
  ) {
    parts.push(
      `Le diagramme mobilise ${Number(metrics.participants || 0)} participant(s), ${Number(metrics.lanes || 0)} lane(s), ${Number(metrics.subprocesses || 0)} sous-processus et ${Number(metrics.message_flows || 0)} flux de message.`
    );
  }

  return parts.join(' ');
}

function buildTaskWhenValue(activityRows = [], index = 0, manualData = {}, startEnd = {}) {
  const previousActivity = index > 0 ? activityRows[index - 1]?.activity : '';
  const expectedResult = normalizeText(manualData.expected_result || startEnd.expectedResult || '');
  const values = [];

  if (index === 0) {
    values.push(normalizeText(manualData.trigger || startEnd.trigger || 'Au debut du processus'));
    if (hasMeaningfulValue(manualData.frequency)) {
      values.push(`Frequence: ${manualData.frequency}`);
    }
  } else if (previousActivity) {
    values.push(`Apres ${previousActivity}`);
  } else {
    values.push(`Etape ${index + 1} du processus`);
  }

  if (index === activityRows.length - 1 && expectedResult) {
    values.push(`Jusqu a ${expectedResult}`);
  }

  return joinMatrixCellValues(values);
}

function buildTaskWhyValue(process = {}, activityRows = [], index = 0, manualData = {}, startEnd = {}) {
  const nextActivity = index < activityRows.length - 1 ? activityRows[index + 1]?.activity : '';
  const objective = normalizeText(manualData.objective || process.description || '');
  const expectedResult = normalizeText(manualData.expected_result || startEnd.expectedResult || '');
  const values = [];

  if (objective) {
    values.push(objective);
  }

  if (nextActivity) {
    values.push(`Prepare ${nextActivity}`);
  } else if (expectedResult) {
    values.push(`Permet d obtenir ${expectedResult}`);
  } else {
    values.push('Contribue au resultat attendu du processus');
  }

  return joinMatrixCellValues(values);
}

function buildWhatWhoWhenWhyMatrix(process = {}, manualData = {}, accountable = [], activityRows = [], startEnd = {}) {
  if (!activityRows.length) {
    return {
      columns: [
        { key: 'activity', label: 'Activite', width: 28 },
        { key: 'what', label: 'What', width: 18 },
        { key: 'who', label: 'Who', width: 18 },
        { key: 'when', label: 'When', width: 18 },
        { key: 'why', label: 'Why', width: 18 },
      ],
      rows: [
        {
          activity: 'Aucune activite disponible.',
          what: 'Non renseigne',
          who: accountable[0] || manualData.owner || 'Non assigne',
          when: normalizeText(manualData.trigger || startEnd.trigger || 'Non renseigne') || 'Non renseigne',
          why: normalizeText(manualData.objective || process.description || 'Non renseigne') || 'Non renseigne',
        },
      ],
    };
  }

  const columns = [
    { key: 'activity', label: 'Activite', width: 24 },
    { key: 'what', label: 'What', width: 22 },
    { key: 'who', label: 'Who', width: 16 },
    { key: 'when', label: 'When', width: 18 },
    { key: 'why', label: 'Why', width: 20 },
  ];
  const rows = activityRows.map((activity, index) => ({
    activity: activity.activity,
    what: hasMeaningfulValue(activity.documentation)
      ? activity.documentation
      : `Executer ${activity.activity} (${activity.type_label}).`,
    who: hasMeaningfulValue(activity.actor)
      ? activity.actor
      : (accountable[0] || manualData.owner || 'Non assigne'),
    when: buildTaskWhenValue(activityRows, index, manualData, startEnd),
    why: buildTaskWhyValue(process, activityRows, index, manualData, startEnd),
  }));

  return {
    columns,
    rows,
  };
}

function inferDataFormat(label = '') {
  const normalized = String(label || '').toLowerCase();
  if (/(date|deadline|echeance|due)/i.test(normalized)) {
    return 'Date';
  }
  if (/(montant|amount|prix|price|total|quantite|quantity|nombre|number|id|code)/i.test(normalized)) {
    return 'Numerique';
  }
  return 'Texte';
}

function inferCriticality(label = '') {
  const normalized = String(label || '').toLowerCase();
  if (/(client|customer|compte|account|carte|card|montant|amount|budget|pricing|prix)/i.test(normalized)) {
    return 'Elevee';
  }
  return 'Moyenne';
}

function inferDocumentType(label = '') {
  const normalized = String(label || '').toLowerCase();
  if (/(justificatif|evidence|preuve|piece)/i.test(normalized)) {
    return 'Justificatif';
  }
  if (/(form|formulaire|fiche|demande|request)/i.test(normalized)) {
    return 'Formulaire';
  }
  return 'Document';
}

function isDocumentSupport(label = '', manualData = {}) {
  const normalized = normalizeText(label).toLowerCase();
  if (!normalized) {
    return false;
  }

  const manualDocuments = new Set(normalizeTextList(manualData.support_documents).map((entry) => entry.toLowerCase()));
  if (manualDocuments.has(normalized)) {
    return true;
  }

  return /(document|dossier|formulaire|contrat|piece|justificatif|fiche|demande|report|rapport|bon|order|request|checklist)/i.test(normalized);
}

function buildActivityIndex(activityRows = []) {
  return new Map(activityRows.map((activity) => [String(activity.element_id || ''), activity]));
}

function buildRowKey(row = {}, keyFields = []) {
  const parts = keyFields
    .map((field) => normalizeText(row?.[field]))
    .filter(Boolean);
  return parts.length ? parts.join('||').toLowerCase() : '';
}

function mergeRowsByKey(baseRows = [], manualRows = [], keyFields = []) {
  const resolvedKeyFields = Array.isArray(keyFields) ? keyFields : [keyFields];
  const manualMap = new Map();

  manualRows.forEach((row) => {
    const key = buildRowKey(row, resolvedKeyFields);
    if (key) {
      manualMap.set(key, row);
    }
  });

  const consumed = new Set();
  const merged = baseRows.map((row) => {
    const key = buildRowKey(row, resolvedKeyFields);
    if (key && manualMap.has(key)) {
      consumed.add(key);
      return {
        ...row,
        ...manualMap.get(key),
      };
    }
    return row;
  });

  manualRows.forEach((row) => {
    const key = buildRowKey(row, resolvedKeyFields);
    if (!key || consumed.has(key)) {
      return;
    }
    merged.push(row);
  });

  return merged;
}

function dropPlaceholderRows(rows = [], keyField = 'name') {
  const hasMeaningfulRow = rows.some((row) => {
    const value = normalizeText(row?.[keyField]);
    return value && value.toLowerCase() !== 'non renseigne';
  });

  if (!hasMeaningfulRow) {
    return rows;
  }

  return rows.filter((row) => normalizeText(row?.[keyField]).toLowerCase() !== 'non renseigne');
}

function extractSupportEdges(bpmnXml = '') {
  const edges = [];
  const addEdge = (sourceRef, targetRef) => {
    if (sourceRef && targetRef) {
      edges.push({ sourceRef: String(sourceRef).trim(), targetRef: String(targetRef).trim() });
    }
  };

  const attrPattern = /<(?:[\w.-]+:)?association\b([^>]*)\/?>/gi;
  let attrMatch;
  while ((attrMatch = attrPattern.exec(String(bpmnXml || ''))) !== null) {
    const attrs = attrMatch[1] || '';
    addEdge(getXmlAttr(attrs, 'sourceRef'), getXmlAttr(attrs, 'targetRef'));
  }

  const blockPattern = /<(?:[\w.-]+:)?(?:dataInputAssociation|dataOutputAssociation)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?(?:dataInputAssociation|dataOutputAssociation)>/gi;
  let blockMatch;
  while ((blockMatch = blockPattern.exec(String(bpmnXml || ''))) !== null) {
    const innerXml = blockMatch[1] || '';
    const sourceRefs = [...innerXml.matchAll(/<(?:[\w.-]+:)?sourceRef\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?sourceRef>/gi)]
      .map((match) => stripXmlTags(match[1] || ''))
      .filter(Boolean);
    const targetRefs = [...innerXml.matchAll(/<(?:[\w.-]+:)?targetRef\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?targetRef>/gi)]
      .map((match) => stripXmlTags(match[1] || ''))
      .filter(Boolean);

    sourceRefs.forEach((sourceRef) => {
      targetRefs.forEach((targetRef) => {
        addEdge(sourceRef, targetRef);
      });
    });
  }

  return edges;
}

function buildSupportObjectMatrix(process = {}, manualData = {}, activityRows = []) {
  const activityById = buildActivityIndex(activityRows);
  const supportElements = parseNamedElementsWithAttrs(process.bpmn_xml || '', SUPPORT_ELEMENT_NAMES);
  const supportDocumentationById = extractDocumentationByElementId(process.bpmn_xml || '', SUPPORT_ELEMENT_NAMES);
  const supportEdges = extractSupportEdges(process.bpmn_xml || '');
  const relationMap = new Map();
  const sectionByKey = {
    data: [],
    documents: [],
    systems: [],
  };

  const ensureRelations = (supportId) => {
    if (!relationMap.has(supportId)) {
      relationMap.set(supportId, {
        sources: [],
        destinations: [],
      });
    }
    return relationMap.get(supportId);
  };

  supportEdges.forEach((edge) => {
    const sourceActivity = activityById.get(edge.sourceRef);
    const targetActivity = activityById.get(edge.targetRef);

    if (sourceActivity && !targetActivity) {
      const relations = ensureRelations(edge.targetRef);
      relations.sources.push(sourceActivity.activity);
    } else if (!sourceActivity && targetActivity) {
      const relations = ensureRelations(edge.sourceRef);
      relations.destinations.push(targetActivity.activity);
    }
  });

  const dedupeRows = (rows, keyBuilder) => {
    const seen = new Set();
    return rows.filter((row) => {
      const key = keyBuilder(row);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  };

  const createDataRow = (entry = {}) => {
    const label = normalizeText(entry.label || entry.name || '');
    const relations = relationMap.get(String(entry.id || '')) || { sources: [], destinations: [] };
    return {
      name: label || 'Non renseigne',
      description: normalizeText(entry.description || supportDocumentationById.get(String(entry.id || '')) || `Donnee de support utilisee dans ${process.name || 'le processus'}`) || 'Non renseigne',
      format: inferDataFormat(label),
      source: joinMatrixCellValues(relations.sources, ', ', 'Non renseigne'),
      destination: joinMatrixCellValues(relations.destinations, ', ', 'Non renseigne'),
      criticality: inferCriticality(label),
    };
  };

  const createDocumentRow = (entry = {}) => {
    const label = normalizeText(entry.label || entry.name || '');
    const relations = relationMap.get(String(entry.id || '')) || { sources: [], destinations: [] };
    return {
      name: label || 'Non renseigne',
      type: inferDocumentType(label),
      generated_by: joinMatrixCellValues(relations.sources, ', ', 'Non renseigne'),
      output_of: joinMatrixCellValues(relations.destinations, ', ', 'Non renseigne'),
      version: normalizeText(entry.version || 'Non renseignee') || 'Non renseignee',
    };
  };

  const createSystemRow = (label = '', role = '') => ({
    name: normalizeText(label) || 'Non renseigne',
    role: normalizeText(role) || 'Support du processus',
  });

  supportElements.forEach((support) => {
    if (isDocumentSupport(support.name, manualData)) {
      sectionByKey.documents.push(createDocumentRow(support));
      return;
    }

    sectionByKey.data.push(createDataRow(support));
  });

  normalizeTextList(manualData.support_data).forEach((label) => {
    sectionByKey.data.push(createDataRow({ label }));
  });

  normalizeTextList(manualData.support_documents).forEach((label) => {
    sectionByKey.documents.push(createDocumentRow({ label }));
  });

  manualData.support_data_details.forEach((entry) => {
    sectionByKey.data.push(createDataRow(entry));
  });

  manualData.support_document_details.forEach((entry) => {
    sectionByKey.documents.push(createDocumentRow(entry));
  });

  const systemsFromActivities = {};
  activityRows.forEach((activity) => {
    if (!hasMeaningfulValue(activity.systems)) {
      return;
    }
    const key = normalizeText(activity.systems).toLowerCase();
    if (!systemsFromActivities[key]) {
      systemsFromActivities[key] = {
        name: normalizeText(activity.systems),
        roles: [],
      };
    }
    systemsFromActivities[key].roles.push(activity.activity);
  });

  normalizeTextList(manualData.support_systems).forEach((label) => {
    const key = normalizeText(label).toLowerCase();
    if (!systemsFromActivities[key]) {
      systemsFromActivities[key] = {
        name: normalizeText(label),
        roles: [],
      };
    }
  });

  Object.values(systemsFromActivities).forEach((entry) => {
    sectionByKey.systems.push(
      createSystemRow(entry.name, entry.roles.length ? `Intervient dans ${entry.roles.join(', ')}` : 'Support du processus')
    );
  });

  manualData.support_system_details.forEach((entry) => {
    sectionByKey.systems.push(createSystemRow(entry.name, entry.role));
  });

  const dataRows = dropPlaceholderRows(
    dedupeRows(
      mergeRowsByKey(sectionByKey.data, manualData.support_data_details.map((entry) => createDataRow(entry)), ['name']),
      (row) => row.name.toLowerCase()
    ),
    'name'
  );
  const documentRows = dropPlaceholderRows(
    dedupeRows(
      mergeRowsByKey(sectionByKey.documents, manualData.support_document_details.map((entry) => createDocumentRow(entry)), ['name']),
      (row) => row.name.toLowerCase()
    ),
    'name'
  );
  const systemRows = dropPlaceholderRows(
    dedupeRows(
      mergeRowsByKey(sectionByKey.systems, manualData.support_system_details.map((entry) => createSystemRow(entry.name, entry.role)), ['name']),
      (row) => row.name.toLowerCase()
    ),
    'name'
  );

  return {
    intro: 'Ces objets viennent du referentiel BPM/GRC.',
    sections: [
      {
        title: '4.1 Donnees',
        columns: [
          { key: 'name', label: 'Nom de la donnee', width: 20 },
          { key: 'description', label: 'Definition', width: 30 },
          { key: 'format', label: 'Format', width: 12 },
          { key: 'source', label: 'Source', width: 14 },
          { key: 'destination', label: 'Cible', width: 14 },
          { key: 'criticality', label: 'Sensibilite', width: 10 },
        ],
        rows: dataRows.length ? dataRows : [{
          name: 'Non renseigne',
          description: 'Aucune donnee de support detectee.',
          format: 'Non renseigne',
          source: 'Non renseigne',
          destination: 'Non renseigne',
          criticality: 'Non renseigne',
        }],
      },
      {
        title: '4.2 Documents',
        columns: [
          { key: 'name', label: 'Nom', width: 30 },
          { key: 'type', label: 'Type', width: 18 },
          { key: 'generated_by', label: 'Genere par', width: 20 },
          { key: 'output_of', label: 'Sortie de', width: 20 },
          { key: 'version', label: 'Version', width: 12 },
        ],
        rows: documentRows.length ? documentRows : [{
          name: 'Non renseigne',
          type: 'Non renseigne',
          generated_by: 'Non renseigne',
          output_of: 'Non renseigne',
          version: 'Non renseignee',
        }],
      },
      {
        title: '4.3 Systemes d information',
        columns: [
          { key: 'name', label: 'Nom de l application', width: 34 },
          { key: 'role', label: 'Role dans le processus', width: 66 },
        ],
        rows: systemRows.length ? systemRows : [{
          name: 'Non renseigne',
          role: 'Aucun systeme support detecte.',
        }],
      },
    ],
  };
}

function buildKpiRows(manualData = {}) {
  const baseRows = normalizeTextList(manualData.kpis).map((label) => ({
    name: label,
    target: 'A definir',
    source: 'Saisie manuelle',
  }));
  const detailRows = manualData.kpi_details.map((entry) => ({
    name: entry.name,
    target: entry.target || 'Non renseigne',
    source: entry.source || 'Saisie manuelle',
  }));
  const rows = mergeRowsByKey(baseRows, detailRows, ['name']);

  return rows.length
    ? rows
    : [
        { name: 'Delai de traitement', target: 'Non renseigne', source: 'A definir' },
        { name: 'Volume traite', target: 'Non renseigne', source: 'A definir' },
        { name: 'Taux de conformite', target: 'Non renseigne', source: 'A definir' },
      ];
}

function buildRiskRows(risks = []) {
  const baseRows = risks.length
    ? risks.map((risk) => ({
        title: risk.title,
        severity: risk.severity,
        status: risk.status,
        category: risk.category,
        element: risk.elementName || '-',
        description: risk.description || 'Non renseigne',
        mitigation: risk.mitigation || 'Non renseigne',
      }))
    : [];

  return baseRows.length
    ? baseRows
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

export function buildProcedureManual(process = {}, workflow = null, explanation = null) {
  const narrative = explanation || buildProcessExplanation(process, workflow);
  const actors = extractActorAssignments(process.bpmn_xml || '');
  const risks = extractRiskRegister(process.bpmn_xml || '');
  const controlPoints = buildControlPointRegister(process.bpmn_xml || '', risks);
  const manualData = normalizeManualData(process.manual_data);
  const startEnd = extractStartEndSummary(process.bpmn_xml || '');
  const documentationById = extractDocumentationByElementId(process.bpmn_xml || '');
  const activityRows = buildActivityRows(process, documentationById, actors, manualData);
  const supportObjectMatrix = buildSupportObjectMatrix(process, manualData, activityRows);
  const kpiRows = buildKpiRows(manualData);
  const riskRows = (() => {
    const generatedRiskRows = buildRiskRows(risks);
    const manualRiskRows = manualData.risk_details.map((entry) => ({
      title: entry.title || 'Risque manuel',
      severity: entry.severity || 'medium',
      status: entry.status || 'open',
      category: entry.category || 'operational',
      element: entry.element || '-',
      description: entry.description || 'Non renseigne',
      mitigation: entry.mitigation || 'Non renseigne',
    }));

    if (!manualRiskRows.length) {
      return generatedRiskRows;
    }

    const hasGeneratedRiskEntries = risks.length > 0;
    if (!hasGeneratedRiskEntries) {
      return manualRiskRows;
    }

    return mergeRowsByKey(generatedRiskRows, manualRiskRows, ['title']);
  })();
  const responsible = manualData.raci_responsible.length
    ? manualData.raci_responsible
    : uniqueValues(actors.map((actor) => actor.actorName));
  const accountable = manualData.raci_accountable.length
    ? manualData.raci_accountable
    : normalizeNameList(
      manualData.owner ? [manualData.owner] : process.assigned_validator_names,
    manualData.owner || process.assigned_validator_name || process.created_by_name
    );
  const consulted = manualData.raci_consulted.length
    ? manualData.raci_consulted
    : normalizeNameList(process.assigned_designer_names, process.assigned_designer_name);
  const informed = manualData.raci_informed.length
    ? manualData.raci_informed
    : uniqueValues([process.created_by_name, workflow?.approved_by_name, process.approved_by_name]);
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
  const whatWhoWhenWhyMatrix = buildWhatWhoWhenWhyMatrix(process, manualData, accountable, activityRows, startEnd);

  return {
    narrative,
    diagramDescription: buildDiagramDescription(process, narrative),
    manualData,
    actors,
    risks,
    controlPoints,
    matrices: {
      identity: identityRows,
      activities: activityRows,
      whatWhoWhenWhy: whatWhoWhenWhyMatrix,
      supportObjects: supportObjectMatrix,
      kpis: kpiRows,
      risks: riskRows,
    },
    raci: {
      responsible: buildDisplayList(responsible),
      accountable,
      consulted: buildDisplayList(consulted),
      informed: buildDisplayList(informed),
    },
    workflowBullets: uniqueValues([
      ...manualData.workflow_notes,
      `Status: ${normalizeProcessStatus(process.status, 'draft')}`,
      process.version ? `Version: v${process.version}` : null,
      process.company_name ? `Company: ${process.company_name}` : null,
      process.category_name ? `Category: ${process.category_name}` : null,
      process.created_by_name ? `Process owner record created by: ${process.created_by_name}` : null,
      workflow?.submitted_at ? `Submitted on ${formatDisplayDate(workflow.submitted_at)}` : null,
      workflow?.approved_at ? `Approved on ${formatDisplayDate(workflow.approved_at)}` : null,
      workflow?.approved_by_name ? `Approved by ${workflow.approved_by_name}` : null,
    ].filter(Boolean)),
  };
}

function buildWorkflowRowsForManual(manual = {}) {
  const bullets = Array.isArray(manual.workflowBullets) ? manual.workflowBullets.filter(Boolean) : [];
  return bullets.length
    ? bullets.map((value, index) => ({ label: `Note ${index + 1}`, value }))
    : [{ label: 'Note 1', value: 'No workflow notes generated.' }];
}

function buildRaciRowsForManual(manual = {}) {
  const joinValues = (values) => (Array.isArray(values) && values.length ? values.join(', ') : '-');

  return [
    { label: 'Responsible', value: joinValues(manual.raci?.responsible) },
    { label: 'Accountable', value: joinValues(manual.raci?.accountable) },
    { label: 'Consulted', value: joinValues(manual.raci?.consulted) },
    { label: 'Informed', value: joinValues(manual.raci?.informed) },
  ];
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
            .map((column) => {
              const rawValue = column.format ? column.format(row[column.key], row) : (row[column.key] ?? '');
              const safeValue = column.html ? String(rawValue ?? '') : escapeHtml(rawValue ?? '');
              return `<td>${safeValue}</td>`;
            })
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

function createDocxTableCell(text = '', options = {}) {
  const { header = false, width = null, size = 18, headerSize = 20, fill = null, color = null } = options;

  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: header || fill
      ? {
          fill: (fill || (header ? 'e2e8f0' : 'ffffff')).replace('#', ''),
          color: color || 'auto',
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
        size: header ? headerSize : size,
        color: header ? '334155' : '111827',
        spacing: { after: 0 },
      }),
    ],
  });
}

function createDocxTableSection(title, columns = [], rows = [], options = {}) {
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
          children: columns.map((column) => createDocxTableCell(column.label, {
            header: true,
            width: column.width,
            headerSize: options.headerSize,
          })),
        }),
        ...safeRows.map((row) => new TableRow({
          children: columns.map((column, columnIndex) => {
            const isPlaceholderRow = columnIndex === 0 && !rows.length;
            const rawValue = isPlaceholderRow
              ? (row[column.key] ?? '')
              : (column.format ? column.format(row[column.key], row) : row[column.key]) ?? '';

            if (typeof column.cell === 'function') {
              const resolved = column.cell(rawValue, row) || {};
              return createDocxTableCell(resolved.text ?? rawValue ?? '', {
                width: column.width,
                size: options.cellSize,
                headerSize: options.headerSize,
                fill: resolved.fill || null,
              });
            }

            return createDocxTableCell(rawValue, { width: column.width, size: options.cellSize, headerSize: options.headerSize });
          }),
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

export function buildProcessReportHtml(process = {}, explanation = null, options = {}) {
  const manual = buildProcedureManual(process, options.workflow || null, explanation);
  const workflowRows = buildWorkflowRowsForManual(manual);
  const raciRows = buildRaciRowsForManual(manual);
  const renderTable = (title, columns, rows) => `
    <div class="section">
      <h2>${escapeHtml(title)}</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${buildRows(rows, columns)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  const supportObjectsHtml = `
    <div class="section">
      <h2>4. NIVEAU OBJETS SUPPORTS</h2>
      <p>${escapeHtml(manual.matrices.supportObjects.intro || '')}</p>
      ${manual.matrices.supportObjects.sections.map((section) => `
        <div class="subsection">
          <h3>${escapeHtml(section.title)}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>${section.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${buildRows(section.rows, section.columns)}
              </tbody>
            </table>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  const diagramHtml = options.diagramImageDataUrl
    ? `
      <div class="section">
        <h2>Diagramme</h2>
        <div class="diagram-card">
          <img src="${escapeHtml(options.diagramImageDataUrl)}" alt="Diagramme du processus" />
        </div>
      </div>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(process.name || 'Process')} - Manuel de procedure</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; color: #111827; background: #f8fafc; }
    .report-shell { background: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08); }
    .hero { margin-bottom: 24px; }
    .hero h1 { margin: 0; font-size: 30px; }
    .eyebrow { display: inline-block; color: #b91c1c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; }
    .section { margin-top: 30px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; }
    .subsection { margin-top: 20px; }
    .subsection h3 { margin: 0 0 10px; font-size: 16px; color: #1f2937; }
    .section p { margin: 0 0 12px; color: #475569; font-size: 14px; line-height: 1.6; }
    .diagram-description { margin-top: 14px; color: #334155; font-size: 15px; line-height: 1.7; }
    .diagram-card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 16px; background: #ffffff; }
    .diagram-card img { width: 100%; height: auto; display: block; border-radius: 12px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; min-width: 100%; }
    th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
    .risk-pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .risk-pill--low { background: #dcfce7; color: #166534; }
    .risk-pill--medium { background: #fef9c3; color: #854d0e; }
    .risk-pill--high { background: #ffedd5; color: #9a3412; }
    .risk-pill--critical { background: #fee2e2; color: #991b1b; }
    @media print { body { margin: 0; background: #fff; } .report-shell { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="report-shell">
    <div class="hero">
      <span class="eyebrow">Manuel de procedure</span>
      <h1>${escapeHtml(process.name || `Process #${process.id || ''}`)}</h1>
      <p class="diagram-description">${escapeHtml(manual.diagramDescription || '')}</p>
    </div>

    ${diagramHtml}

    ${renderTable('1. Identite du processus', [
      { key: 'label', label: 'Champ' },
      { key: 'value', label: 'Valeur' },
    ], manual.matrices.identity)}

    ${renderTable('2. Matrice what who when why', [
      ...manual.matrices.whatWhoWhenWhy.columns,
    ], manual.matrices.whatWhoWhenWhy.rows)}

    ${renderTable('3. Matrice des activites', [
      { key: 'activity', label: 'Activite' },
      { key: 'actor', label: 'Acteur' },
      { key: 'description', label: 'Description' },
    ], manual.matrices.activities)}

    ${renderTable('Workflow notes', [
      { key: 'label', label: 'Note' },
      { key: 'value', label: 'Value' },
    ], workflowRows)}

    ${renderTable('RACI', [
      { key: 'label', label: 'Role' },
      { key: 'value', label: 'Value' },
    ], raciRows)}
    ${supportObjectsHtml}

    ${renderTable('5.1 Matrice KPI', [
      { key: 'name', label: 'KPI' },
      { key: 'target', label: 'Cible' },
      { key: 'source', label: 'Source' },
    ], manual.matrices.kpis)}

    ${renderTable('5.2 Matrice des risques', [
      { key: 'title', label: 'Risque' },
      {
        key: 'severity',
        label: 'Severite',
        html: true,
        format: (value) => {
          const severity = String(value || '').toLowerCase();
          const label = escapeHtml(String(value || '-'));
          const klass = ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium';
          return `<span class="risk-pill risk-pill--${klass}">${label}</span>`;
        },
      },
      { key: 'status', label: 'Statut' },
      { key: 'category', label: 'Categorie' },
      { key: 'element', label: 'Element BPMN' },
      { key: 'description', label: 'Description' },
      { key: 'mitigation', label: 'Mitigation / Controle' },
    ], manual.matrices.risks)}
  </div>
</body>
</html>`;
}

export function buildProcessReportPdf(process = {}, explanation = null, options = {}) {
  const manual = buildProcedureManual(process, options.workflow || null, explanation);
  const workflowRows = buildWorkflowRowsForManual(manual);
  const raciRows = buildRaciRowsForManual(manual);
  const severityFill = (value) => {
    const severity = String(value || '').toLowerCase();
    if (severity === 'low') return [0.863, 0.988, 0.906]; // green (#dcfce7)
    if (severity === 'medium') return [0.996, 0.976, 0.765]; // yellow (#fef9c3)
    if (severity === 'high') return [1.0, 0.929, 0.835]; // orange (#ffedd5)
    if (severity === 'critical') return [0.996, 0.886, 0.886]; // red (#fee2e2)
    return null;
  };

  return buildPdfDocument({
    title: `Manuel de procedure - ${process.name || `Process #${process.id}`}`,
    description: manual.diagramDescription,
    heroImage: options.diagramImageDataUrl
      ? { dataUrl: options.diagramImageDataUrl }
      : null,
    orientation: 'landscape',
    sections: [
      {
        title: '1. Identite du processus',
        table: {
          columns: [
            { key: 'label', label: 'Champ', width: 30 },
            { key: 'value', label: 'Valeur', width: 70 },
          ],
          rows: manual.matrices.identity,
        },
      },
      {
        title: '2. Matrice what who when why',
        table: {
          columns: manual.matrices.whatWhoWhenWhy.columns,
          rows: manual.matrices.whatWhoWhenWhy.rows,
          fontSize: manual.matrices.whatWhoWhenWhy.columns.length > 6 ? 7.2 : 8,
          headerFontSize: manual.matrices.whatWhoWhenWhy.columns.length > 6 ? 7.6 : 8.4,
        },
      },
      {
        title: '3. Matrice des activites',
        table: {
          columns: [
            { key: 'activity', label: 'Activite', width: 20 },
            { key: 'actor', label: 'Acteur', width: 20 },
            { key: 'description', label: 'Description', width: 60 },
          ],
          rows: manual.matrices.activities,
        },
      },
      {
        title: 'Workflow notes',
        table: {
          columns: [
            { key: 'label', label: 'Note', width: 18 },
            { key: 'value', label: 'Value', width: 82 },
          ],
          rows: workflowRows,
        },
      },
      {
        title: 'RACI',
        table: {
          columns: [
            { key: 'label', label: 'Role', width: 18 },
            { key: 'value', label: 'Value', width: 82 },
          ],
          rows: raciRows,
        },
      },
      {
        title: '4. NIVEAU OBJETS SUPPORTS',
        paragraphs: [manual.matrices.supportObjects.intro],
        tables: manual.matrices.supportObjects.sections.map((section) => ({
          ...section,
          fontSize: 8.6,
          headerFontSize: 9,
        })),
      },
      {
        title: '5.1 Matrice KPI',
        table: {
          columns: [
            { key: 'name', label: 'KPI', width: 34 },
            { key: 'target', label: 'Cible', width: 26 },
            { key: 'source', label: 'Source', width: 40 },
          ],
          rows: manual.matrices.kpis,
        },
      },
      {
        title: '5.2 Matrice des risques',
        table: {
          columns: [
            { key: 'title', label: 'Risque', width: 14 },
            {
              key: 'severity',
              label: 'Severite',
              width: 8,
              cellFill: (row) => severityFill(row?.severity),
            },
            { key: 'status', label: 'Statut', width: 8 },
            { key: 'category', label: 'Categorie', width: 10 },
            { key: 'element', label: 'Element BPMN', width: 16 },
            { key: 'description', label: 'Description', width: 22 },
            { key: 'mitigation', label: 'Mitigation / Controle', width: 22 },
          ],
          rows: manual.matrices.risks,
          fontSize: 8.2,
          headerFontSize: 8.8,
        },
      },
    ],
  });
}

export async function buildProcessReportDocx(process = {}, explanation = null, options = {}) {
  const manual = buildProcedureManual(process, options.workflow || null, explanation);
  const workflowRows = buildWorkflowRowsForManual(manual);
  const raciRows = buildRaciRowsForManual(manual);
  const severityDocxFill = (value) => {
    const severity = String(value || '').toLowerCase();
    if (severity === 'low') return 'dcfce7';
    if (severity === 'medium') return 'fef9c3';
    if (severity === 'high') return 'ffedd5';
    if (severity === 'critical') return 'fee2e2';
    return null;
  };
  const docChildren = [
    createDocxParagraph('Manuel de procedure', {
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    }),
    createDocxParagraph(process.name || `Process #${process.id || ''}`, {
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    createDocxParagraph(manual.diagramDescription || '', {
      spacing: { after: 180 },
    }),
  ];
  const diagramImageBuffer = parseDocxImageDataUrl(options.diagramImageDataUrl);

  if (diagramImageBuffer) {
    docChildren.push(
      createDocxParagraph('Diagramme', {
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 120, after: 120 },
      }),
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
    ...createDocxTableSection('1. Identite du processus', [
      { key: 'label', label: 'Champ', width: 30 },
      { key: 'value', label: 'Valeur', width: 70 },
    ], manual.matrices.identity)
  );

  docChildren.push(
    ...createDocxTableSection(
      '2. Matrice what who when why',
      manual.matrices.whatWhoWhenWhy.columns,
      manual.matrices.whatWhoWhenWhy.rows,
      { cellSize: manual.matrices.whatWhoWhenWhy.columns.length > 6 ? 13 : 15, headerSize: manual.matrices.whatWhoWhenWhy.columns.length > 6 ? 14 : 16 }
    ),
    ...createDocxTableSection('3. Matrice des activites', [
      { key: 'activity', label: 'Activite', width: 28 },
      { key: 'actor', label: 'Acteur', width: 22 },
      { key: 'description', label: 'Description', width: 50 },
    ], manual.matrices.activities),
    ...createDocxTableSection(
      'Workflow notes',
      [
        { key: 'label', label: 'Note', width: 18 },
        { key: 'value', label: 'Value', width: 82 },
      ],
      workflowRows
    ),
    ...createDocxTableSection(
      'RACI',
      [
        { key: 'label', label: 'Role', width: 18 },
        { key: 'value', label: 'Value', width: 82 },
      ],
      raciRows
    ),
    createDocxParagraph('4. NIVEAU OBJETS SUPPORTS', {
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 120 },
    }),
    createDocxParagraph(manual.matrices.supportObjects.intro || '', {
      spacing: { after: 140 },
    }),
    ...manual.matrices.supportObjects.sections.flatMap((section) =>
      createDocxTableSection(section.title, section.columns, section.rows, { cellSize: 16, headerSize: 18 })
    ),
    ...createDocxTableSection('5.1 Matrice KPI', [
      { key: 'name', label: 'KPI', width: 34 },
      { key: 'target', label: 'Cible', width: 26 },
      { key: 'source', label: 'Source', width: 40 },
    ], manual.matrices.kpis),
    ...createDocxTableSection('5.2 Matrice des risques', [
      { key: 'title', label: 'Risque', width: 16 },
      {
        key: 'severity',
        label: 'Severite',
        width: 10,
        cell: (value, row) => ({
          text: String(value ?? ''),
          fill: severityDocxFill(row?.severity),
        }),
      },
      { key: 'status', label: 'Statut', width: 10 },
      { key: 'category', label: 'Categorie', width: 12 },
      { key: 'element', label: 'Element BPMN', width: 16 },
      { key: 'description', label: 'Description', width: 18 },
      { key: 'mitigation', label: 'Mitigation / Controle', width: 18 },
    ], manual.matrices.risks)
  );

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return Packer.toBuffer(document);
}
