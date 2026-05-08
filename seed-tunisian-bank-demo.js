import bcrypt from 'bcryptjs';
import pool from './server/db.js';
import { ensureAccessBootstrap } from './server/utils/access.js';
import { ensureSimulationSchema } from './server/utils/simulationSchema.js';
import {
  runMonteCarloSimulation,
  runResourcePlanning,
  runSensitivityAnalysis,
  runSimulation,
} from './server/utils/simulationEngine.js';
import { ensureOrgChartSchema } from './server/routes/orgchart.js';

const COMPANY_NAME = 'Banque Demo Tunisie';
const COMPANY_DESCRIPTION =
  'Synthetic Tunisian retail bank demo dataset for local testing: branches, loans, operations, cards, and compliance.';
const DEFAULT_PASSWORD = 'bank123';

const HOLIDAYS_2026 = ['2026-03-20', '2026-04-09', '2026-05-01', '2026-07-25', '2026-08-13'];

const USERS = [
  { username: 'bdt_admin', email: 'sonia.benyoussef@bdt-demo.tn', full_name: 'Sonia Ben Youssef', role: 'Company Administrator' },
  { username: 'bdt_branch_mgr', email: 'walid.trabelsi@bdt-demo.tn', full_name: 'Walid Trabelsi', role: 'Process Owner' },
  { username: 'bdt_credit', email: 'marwa.gharbi@bdt-demo.tn', full_name: 'Marwa Gharbi', role: 'Business Analyst' },
  { username: 'bdt_compliance', email: 'aymen.jlassi@bdt-demo.tn', full_name: 'Aymen Jlassi', role: 'Risk Manager' },
  { username: 'bdt_ops', email: 'rim.bensalem@bdt-demo.tn', full_name: 'Rim Ben Salem', role: 'Business Analyst' },
  { username: 'bdt_viewer', email: 'youssef.karray@bdt-demo.tn', full_name: 'Youssef Karray', role: 'Viewer' },
];

const CATEGORIES = [
  ['Retail Banking', 'Retail branch and customer account processes'],
  ['Credit', 'Retail and SME credit workflows'],
  ['Operations', 'Operational banking and back-office execution'],
  ['Cards & Payments', 'Card servicing and payment operations'],
  ['Compliance', 'KYC, AML, and regulatory control processes'],
];

const PROCESS_DEFINITIONS = [
  {
    key: 'macro_retail',
    kind: 'macro',
    owner: 'bdt_branch_mgr',
    name: 'BDT - Distribution retail et credits particuliers',
    description:
      'Macro-processus pilotant l entree en relation, la distribution retail et la mise en place des credits particuliers.',
    category: 'Retail Banking',
    laneNames: ['Distribution', 'Risque credit', 'Execution retail'],
    macroSteps: [
      { type: 'subProcess', processKey: 'account_opening', lane: 0 },
      { type: 'subProcess', processKey: 'consumer_loan', lane: 1 },
      { type: 'serviceTask', name: 'Pilotage portefeuille retail', lane: 2 },
    ],
  },
  {
    key: 'macro_operations',
    kind: 'macro',
    owner: 'bdt_ops',
    name: 'BDT - Paiements, monetique et back office',
    description:
      'Macro-processus couvrant les paiements, les virements internationaux, la monetique et la relation back office.',
    category: 'Operations',
    laneNames: ['Front office', 'Monetique et paiements', 'Back office'],
    macroSteps: [
      { type: 'subProcess', processKey: 'international_transfer', lane: 2 },
      { type: 'subProcess', processKey: 'card_dispute', lane: 1 },
      { type: 'userTask', name: 'Supervision incidents operations', lane: 0 },
    ],
  },
  {
    key: 'macro_governance',
    kind: 'macro',
    owner: 'bdt_compliance',
    name: 'BDT - Gouvernance, risques et conformite',
    description:
      'Macro-processus de pilotage regroupant la conformite, la gestion des alertes LCB-FT et la supervision des risques.',
    category: 'Compliance',
    laneNames: ['Monitoring', 'Conformite', 'Comite risques'],
    macroSteps: [
      { type: 'serviceTask', name: 'Monitoring reglementaire', lane: 0 },
      { type: 'subProcess', processKey: 'aml_alert', lane: 1 },
      { type: 'userTask', name: 'Comite risques et plans d action', lane: 2 },
    ],
  },
  {
    key: 'account_opening',
    kind: 'detail',
    parentKey: 'macro_retail',
    owner: 'bdt_branch_mgr',
    name: 'BDT - Ouverture de compte courant particulier',
    description:
      'Retail branch account opening with document control, KYC screening, core banking setup, and customer activation.',
    category: 'Retail Banking',
    laneNames: ['Agence', 'Conformite KYC', 'Back office retail'],
    customerAction: 'Deposer dossier d ouverture',
    customerReply: 'Recevoir activation et RIB',
    stepTypes: ['receiveTask', 'userTask', 'subProcess', 'serviceTask', 'userTask', 'sendTask'],
    lanePattern: [0, 0, 1, 2, 0, 2],
    taskNames: [
      'Accueil client en agence',
      'Verification CIN et justificatifs',
      'Controle KYC et LCB-FT',
      'Creation client et compte dans le core banking',
      'Signature conventions et depot initial',
      'Activation compte et remise RIB',
    ],
  },
  {
    key: 'consumer_loan',
    kind: 'detail',
    parentKey: 'macro_retail',
    owner: 'bdt_credit',
    name: 'BDT - Octroi credit consommation',
    description:
      'Consumer-loan workflow from application receipt to scoring, risk review, decision, contract, and disbursement.',
    category: 'Credit',
    laneNames: ['Commercial', 'Risque credit', 'Decaissement'],
    customerAction: 'Soumettre dossier de credit',
    customerReply: 'Recevoir decision et contrat',
    stepTypes: ['receiveTask', 'userTask', 'serviceTask', 'subProcess', 'subProcess', 'sendTask'],
    lanePattern: [0, 0, 1, 1, 1, 2],
    taskNames: [
      'Reception demande de credit',
      'Controle dossier et revenus',
      'Scoring interne',
      'Analyse risque credit',
      'Decision delegation ou comite',
      'Edition contrat et decaissement',
    ],
  },
  {
    key: 'international_transfer',
    kind: 'detail',
    parentKey: 'macro_operations',
    owner: 'bdt_ops',
    name: 'BDT - Traitement virement international',
    description:
      'International transfer processing with compliance review, FX validation, Swift preparation, and posting.',
    category: 'Operations',
    laneNames: ['Agence / Corporate', 'Conformite et FX', 'Back office Swift'],
    customerAction: 'Transmettre ordre de virement',
    customerReply: 'Recevoir avis d execution',
    stepTypes: ['receiveTask', 'subProcess', 'serviceTask', 'subProcess', 'userTask', 'sendTask'],
    lanePattern: [0, 1, 1, 2, 2, 0],
    taskNames: [
      'Reception ordre client',
      'Controle conformite et sanctions',
      'Verification disponibilite devises',
      'Preparation message Swift',
      'Validation back office',
      'Comptabilisation et avis client',
    ],
  },
  {
    key: 'card_dispute',
    kind: 'detail',
    parentKey: 'macro_operations',
    owner: 'bdt_ops',
    name: 'BDT - Gestion reclamation carte bancaire',
    description:
      'Card-dispute and claim handling across branch reception, monetics support, investigation, and client response.',
    category: 'Cards & Payments',
    laneNames: ['Agence / CRC', 'Monetique', 'Qualite de service'],
    customerAction: 'Declarer une reclamation carte',
    customerReply: 'Recevoir reponse et decision',
    stepTypes: ['receiveTask', 'userTask', 'subProcess', 'userTask', 'sendTask'],
    lanePattern: [0, 0, 1, 2, 0],
    taskNames: [
      'Reception reclamation client',
      'Qualification dossier monetique',
      'Analyse transaction contestee',
      'Decision remboursement ou rejet',
      'Notification client',
    ],
  },
  {
    key: 'aml_alert',
    kind: 'detail',
    parentKey: 'macro_governance',
    owner: 'bdt_compliance',
    name: 'BDT - Revue alerte LCB-FT',
    description:
      'AML alert review for transaction monitoring, enhanced due diligence, escalation, and closure.',
    category: 'Compliance',
    laneNames: ['Monitoring', 'Analyste conformite', 'Responsable LCB-FT'],
    customerAction: 'Signal monitoring',
    customerReply: 'Clore alerte',
    stepTypes: ['serviceTask', 'userTask', 'subProcess', 'userTask', 'sendTask'],
    lanePattern: [0, 1, 1, 2, 1],
    taskNames: [
      'Generation alerte monitoring',
      'Analyse profil client',
      'Collecte justificatifs complementaires',
      'Escalade conformite si necessaire',
      'Cloture alerte',
    ],
  },
];

const CALENDAR_STANDARD = {
  business_hours: { start: '08:00', end: '16:30' },
  weekend_days: [0, 6],
  holidays: HOLIDAYS_2026,
  shifts: [
    { start: '08:00', end: '12:30', days: [1, 2, 3, 4, 5] },
    { start: '13:30', end: '16:30', days: [1, 2, 3, 4, 5] },
  ],
};

const SCENARIO_DEFINITIONS = [
  {
    processKey: 'account_opening',
    name: 'BDT - Agence Tunis Centre - Journee standard',
    description: 'Standard branch activity for current-account opening in Tunis Centre.',
    start_date: '2026-03-02',
    daily_counts: [12, 14, 13, 11, 10],
    monte_carlo_runs: 15,
    planningTarget: 85,
    resources: [
      { key: 'advisor', name: 'Conseiller clientele agence', resource_type: 'human', quantity: 3, cost_per_hour: 38, availability: 95, availability_windows: [] },
      { key: 'kyc', name: 'Analyste KYC', resource_type: 'human', quantity: 2, cost_per_hour: 42, availability: 94, availability_windows: [] },
      { key: 'core', name: 'Core banking retail', resource_type: 'system', quantity: 1, cost_per_hour: 12, availability: 99, availability_windows: [{ start: '08:00', end: '16:30', days: [1, 2, 3, 4, 5] }] },
      { key: 'backoffice', name: 'Operations back office', resource_type: 'human', quantity: 2, cost_per_hour: 29, availability: 96, availability_windows: [] },
    ],
    tasks: [
      { task_id: 'Task_1', task_name: 'Accueil client en agence', duration_min: 6, duration_type: 'normal', duration_std: 1.5, resource: 'advisor', cost: 6, sla_target_min: 12 },
      { task_id: 'Task_2', task_name: 'Verification CIN et justificatifs', duration_min: 12, duration_type: 'normal', duration_std: 3, resource: 'advisor', cost: 8, sla_target_min: 18 },
      { task_id: 'Task_3', task_name: 'Controle KYC et LCB-FT', duration_min: 10, duration_type: 'normal', duration_std: 2, resource: 'kyc', cost: 10, sla_target_min: 18 },
      { task_id: 'Task_4', task_name: 'Creation client et compte dans le core banking', duration_min: 8, duration_type: 'fixed', duration_std: 0, resource: 'core', cost: 4, sla_target_min: 12 },
      { task_id: 'Task_5', task_name: 'Signature conventions et depot initial', duration_min: 15, duration_type: 'normal', duration_std: 3, resource: 'advisor', cost: 9, sla_target_min: 20 },
      { task_id: 'Task_6', task_name: 'Activation compte et remise RIB', duration_min: 7, duration_type: 'fixed', duration_std: 0, resource: 'backoffice', cost: 4, sla_target_min: 12 },
    ],
  },
  {
    processKey: 'consumer_loan',
    name: 'BDT - Credit conso - Baseline mensuelle',
    description: 'Baseline monthly retail consumer-loan volume with standard staffing.',
    start_date: '2026-03-09',
    daily_counts: [4, 5, 5, 6, 5],
    monte_carlo_runs: 20,
    planningTarget: 300,
    resources: [
      { key: 'credit_advisor', name: 'Conseiller credit', resource_type: 'human', quantity: 3, cost_per_hour: 45, availability: 94, availability_windows: [] },
      { key: 'scoring', name: 'Moteur de scoring', resource_type: 'system', quantity: 1, cost_per_hour: 16, availability: 99, availability_windows: [{ start: '08:00', end: '16:30', days: [1, 2, 3, 4, 5] }] },
      { key: 'risk', name: 'Analyste risque credit', resource_type: 'human', quantity: 2, cost_per_hour: 55, availability: 93, availability_windows: [] },
      { key: 'committee', name: 'Delegation ou comite credit', resource_type: 'human', quantity: 1, cost_per_hour: 70, availability: 90, availability_windows: [{ start: '09:30', end: '12:30', days: [1, 2, 3, 4, 5] }] },
      { key: 'disbursement', name: 'Operations decaissement', resource_type: 'human', quantity: 2, cost_per_hour: 34, availability: 95, availability_windows: [] },
    ],
    tasks: [
      { task_id: 'Task_1', task_name: 'Reception demande de credit', duration_min: 18, duration_type: 'normal', duration_std: 4, resource: 'credit_advisor', cost: 12, sla_target_min: 30 },
      { task_id: 'Task_2', task_name: 'Controle dossier et revenus', duration_min: 24, duration_type: 'normal', duration_std: 6, resource: 'credit_advisor', cost: 14, sla_target_min: 40 },
      { task_id: 'Task_3', task_name: 'Scoring interne', duration_min: 5, duration_type: 'fixed', duration_std: 0, resource: 'scoring', cost: 4, sla_target_min: 10 },
      { task_id: 'Task_4', task_name: 'Analyse risque credit', duration_min: 45, duration_type: 'normal', duration_std: 8, resource: 'risk', cost: 18, sla_target_min: 60 },
      { task_id: 'Task_5', task_name: 'Decision delegation ou comite', duration_min: 35, duration_type: 'uniform', duration_std: 0, resource: 'committee', cost: 12, sla_target_min: 55 },
      { task_id: 'Task_6', task_name: 'Edition contrat et decaissement', duration_min: 28, duration_type: 'normal', duration_std: 5, resource: 'disbursement', cost: 11, sla_target_min: 40 },
    ],
  },
  {
    processKey: 'consumer_loan',
    name: 'BDT - Credit conso - Campagne salariale',
    description: 'Higher-demand scenario during salary season and commercial campaigns.',
    start_date: '2026-03-23',
    daily_counts: [7, 8, 9, 8, 8],
    monte_carlo_runs: 20,
    planningTarget: 300,
    resources: [
      { key: 'credit_advisor', name: 'Conseiller credit', resource_type: 'human', quantity: 3, cost_per_hour: 45, availability: 94, availability_windows: [] },
      { key: 'scoring', name: 'Moteur de scoring', resource_type: 'system', quantity: 1, cost_per_hour: 16, availability: 99, availability_windows: [{ start: '08:00', end: '16:30', days: [1, 2, 3, 4, 5] }] },
      { key: 'risk', name: 'Analyste risque credit', resource_type: 'human', quantity: 2, cost_per_hour: 55, availability: 93, availability_windows: [] },
      { key: 'committee', name: 'Delegation ou comite credit', resource_type: 'human', quantity: 1, cost_per_hour: 70, availability: 90, availability_windows: [{ start: '09:30', end: '12:30', days: [1, 2, 3, 4, 5] }] },
      { key: 'disbursement', name: 'Operations decaissement', resource_type: 'human', quantity: 2, cost_per_hour: 34, availability: 95, availability_windows: [] },
    ],
    tasks: [
      { task_id: 'Task_1', task_name: 'Reception demande de credit', duration_min: 19, duration_type: 'normal', duration_std: 4, resource: 'credit_advisor', cost: 12, sla_target_min: 30 },
      { task_id: 'Task_2', task_name: 'Controle dossier et revenus', duration_min: 26, duration_type: 'normal', duration_std: 6, resource: 'credit_advisor', cost: 14, sla_target_min: 40 },
      { task_id: 'Task_3', task_name: 'Scoring interne', duration_min: 5, duration_type: 'fixed', duration_std: 0, resource: 'scoring', cost: 4, sla_target_min: 10 },
      { task_id: 'Task_4', task_name: 'Analyse risque credit', duration_min: 48, duration_type: 'normal', duration_std: 9, resource: 'risk', cost: 18, sla_target_min: 60 },
      { task_id: 'Task_5', task_name: 'Decision delegation ou comite', duration_min: 38, duration_type: 'uniform', duration_std: 0, resource: 'committee', cost: 12, sla_target_min: 55 },
      { task_id: 'Task_6', task_name: 'Edition contrat et decaissement', duration_min: 30, duration_type: 'normal', duration_std: 6, resource: 'disbursement', cost: 11, sla_target_min: 40 },
    ],
  },
];

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseTimeToMinutes(value) {
  const [hours = '0', minutes = '0'] = String(value || '00:00').split(':');
  return Number(hours) * 60 + Number(minutes);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildArrivalSchedule(startDate, dailyCounts = []) {
  const windows = [
    { start: '08:20', end: '10:30', weight: 0.45 },
    { start: '10:40', end: '12:00', weight: 0.25 },
    { start: '13:40', end: '15:40', weight: 0.30 },
  ];
  const baseDate = new Date(`${startDate}T00:00:00`);
  const arrivals = [];
  let arrivalOrder = 1;

  dailyCounts.forEach((count, dayIndex) => {
    if (!count) {
      return;
    }

    const countsByWindow = windows.map((window, index) => {
      if (index === windows.length - 1) {
        const assigned = windows
          .slice(0, -1)
          .reduce((sum, entry, entryIndex) => sum + Math.floor(count * windows[entryIndex].weight), 0);
        return { ...window, count: Math.max(0, count - assigned) };
      }

      return { ...window, count: Math.floor(count * window.weight) };
    });

    let assignedCount = countsByWindow.reduce((sum, window) => sum + window.count, 0);
    let cursor = 0;
    while (assignedCount < count) {
      countsByWindow[cursor % countsByWindow.length].count += 1;
      assignedCount += 1;
      cursor += 1;
    }

    countsByWindow.forEach((window) => {
      const startMinutes = parseTimeToMinutes(window.start);
      const endMinutes = parseTimeToMinutes(window.end);
      const span = Math.max(1, endMinutes - startMinutes);

      for (let index = 0; index < window.count; index += 1) {
        const ratio = window.count === 1 ? 0.5 : index / (window.count - 1);
        const minuteOfDay = Math.round(startMinutes + ratio * span);
        const arrivalOffsetMin = dayIndex * 24 * 60 + minuteOfDay;
        const arrivalAt = new Date(baseDate.getTime() + arrivalOffsetMin * 60 * 1000);
        const rawValue = `${arrivalAt.getFullYear()}-${pad(arrivalAt.getMonth() + 1)}-${pad(arrivalAt.getDate())} ${pad(arrivalAt.getHours())}:${pad(arrivalAt.getMinutes())}`;

        arrivals.push({
          arrival_order: arrivalOrder,
          raw_value: rawValue,
          arrival_at: arrivalAt.toISOString(),
          arrival_offset_min: arrivalOffsetMin,
        });
        arrivalOrder += 1;
      }
    });
  });

  return arrivals.sort((left, right) => left.arrival_offset_min - right.arrival_offset_min);
}

function sequenceMarkup(stepIds, startId = 'StartEvent_1', endId = 'EndEvent_1') {
  const flows = [];
  const edges = [];
  const path = [startId, ...stepIds, endId];
  for (let index = 0; index < path.length - 1; index += 1) {
    const flowId = `Flow_${index + 1}`;
    flows.push(`<bpmn:sequenceFlow id="${flowId}" sourceRef="${path[index]}" targetRef="${path[index + 1]}" />`);
  }
  return { flows, edges };
}

function shapeForStep(step) {
  const width = step.w || (step.type === 'exclusiveGateway' ? 64 : step.type === 'subProcess' ? 340 : 160);
  const height = step.h || (step.type === 'exclusiveGateway' ? 64 : step.type === 'subProcess' ? 138 : 88);
  const expandedAttr = step.type === 'subProcess' ? ' isExpanded="true"' : '';
  return `<bpmndi:BPMNShape id="${step.id}_di" bpmnElement="${step.id}"${expandedAttr}><dc:Bounds x="${step.x}" y="${step.y}" width="${width}" height="${height}" /></bpmndi:BPMNShape>`;
}

function edgeMarkup(flowId, points) {
  return `<bpmndi:BPMNEdge id="${flowId}_di" bpmnElement="${flowId}">${points.map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>`;
}

function roundPoint(x, y) {
  return { x: Math.round(x), y: Math.round(y) };
}

function leftMid(shape) {
  return roundPoint(shape.x, shape.y + shape.h / 2);
}

function rightMid(shape) {
  return roundPoint(shape.x + shape.w, shape.y + shape.h / 2);
}

function topMid(shape) {
  return roundPoint(shape.x + shape.w / 2, shape.y);
}

function bottomMid(shape) {
  return roundPoint(shape.x + shape.w / 2, shape.y + shape.h);
}

function routeHorizontal(start, end) {
  if (Math.abs(start.y - end.y) < 4) {
    return [start, end];
  }
  const bendX = Math.round((start.x + end.x) / 2);
  return [start, roundPoint(bendX, start.y), roundPoint(bendX, end.y), end];
}

function routeVertical(start, end) {
  if (Math.abs(start.x - end.x) < 4) {
    return [start, end];
  }
  const bendY = Math.round((start.y + end.y) / 2);
  return [start, roundPoint(start.x, bendY), roundPoint(end.x, bendY), end];
}

function shortWords(value, limit = 2) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, limit)
    .join(' ');
}

function buildEmbeddedSubProcess(step, options = {}) {
  const labels = options.labels?.length
    ? options.labels.slice(0, 3)
    : [
        `Preparation ${shortWords(step.name, 2)}`.trim(),
        `Traitement ${shortWords(step.name, 2)}`.trim(),
        `Validation ${shortWords(step.name, 2)}`.trim(),
      ];

  const startId = `${step.id}_Start`;
  const task1Id = `${step.id}_TaskA`;
  const task2Id = `${step.id}_TaskB`;
  const endId = `${step.id}_End`;
  const flow1Id = `${step.id}_Flow_1`;
  const flow2Id = `${step.id}_Flow_2`;
  const flow3Id = `${step.id}_Flow_3`;

  const subprocessStart = {
    x: step.x + 18,
    y: step.y + step.h / 2 - 16,
    w: 32,
    h: 32,
  };
  const innerY = step.y + step.h / 2 - 28;
  const task1 = {
    x: step.x + 64,
    y: innerY,
    w: 96,
    h: 56,
  };
  const task2 = {
    x: step.x + 182,
    y: innerY,
    w: 96,
    h: 56,
  };
  const subprocessEnd = {
    x: step.x + step.w - 50,
    y: step.y + step.h / 2 - 16,
    w: 32,
    h: 32,
  };

  return {
    xml: `<bpmn:subProcess id="${step.id}" name="${escapeXml(step.name)}"><bpmn:incoming>${step.incoming}</bpmn:incoming><bpmn:outgoing>${step.outgoing}</bpmn:outgoing><bpmn:startEvent id="${startId}" name="Debut"><bpmn:outgoing>${flow1Id}</bpmn:outgoing></bpmn:startEvent><bpmn:userTask id="${task1Id}" name="${escapeXml(labels[0] || 'Preparation')}"><bpmn:incoming>${flow1Id}</bpmn:incoming><bpmn:outgoing>${flow2Id}</bpmn:outgoing></bpmn:userTask><bpmn:serviceTask id="${task2Id}" name="${escapeXml(labels[1] || labels[2] || 'Traitement')}"><bpmn:incoming>${flow2Id}</bpmn:incoming><bpmn:outgoing>${flow3Id}</bpmn:outgoing></bpmn:serviceTask><bpmn:endEvent id="${endId}" name="Fin"><bpmn:incoming>${flow3Id}</bpmn:incoming></bpmn:endEvent><bpmn:sequenceFlow id="${flow1Id}" sourceRef="${startId}" targetRef="${task1Id}" /><bpmn:sequenceFlow id="${flow2Id}" sourceRef="${task1Id}" targetRef="${task2Id}" /><bpmn:sequenceFlow id="${flow3Id}" sourceRef="${task2Id}" targetRef="${endId}" /></bpmn:subProcess>`,
    di: [
      `<bpmndi:BPMNShape id="${startId}_di" bpmnElement="${startId}"><dc:Bounds x="${subprocessStart.x}" y="${subprocessStart.y}" width="${subprocessStart.w}" height="${subprocessStart.h}" /></bpmndi:BPMNShape>`,
      `<bpmndi:BPMNShape id="${task1Id}_di" bpmnElement="${task1Id}"><dc:Bounds x="${task1.x}" y="${task1.y}" width="${task1.w}" height="${task1.h}" /></bpmndi:BPMNShape>`,
      `<bpmndi:BPMNShape id="${task2Id}_di" bpmnElement="${task2Id}"><dc:Bounds x="${task2.x}" y="${task2.y}" width="${task2.w}" height="${task2.h}" /></bpmndi:BPMNShape>`,
      `<bpmndi:BPMNShape id="${endId}_di" bpmnElement="${endId}"><dc:Bounds x="${subprocessEnd.x}" y="${subprocessEnd.y}" width="${subprocessEnd.w}" height="${subprocessEnd.h}" /></bpmndi:BPMNShape>`,
      edgeMarkup(flow1Id, routeHorizontal(rightMid(subprocessStart), leftMid(task1))),
      edgeMarkup(flow2Id, routeHorizontal(rightMid(task1), leftMid(task2))),
      edgeMarkup(flow3Id, routeHorizontal(rightMid(task2), leftMid(subprocessEnd))),
    ],
  };
}

function buildMacroProcessBpmn(definition, definitionsByKey) {
  const processId = `Process_${definition.key}`;
  const collaborationId = `Collaboration_${definition.key}`;
  const participantId = `Participant_${definition.key}`;
  const laneIds = definition.laneNames.map((_, index) => `Lane_${definition.key}_${index + 1}`);
  const participant = { x: 120, y: 120, w: 1900, h: 620 };
  const laneHeights = [170, 170, 280];
  const laneBounds = laneHeights.map((height, index) => ({
    y: participant.y + laneHeights.slice(0, index).reduce((sum, value) => sum + value, 0),
    h: height,
  }));
  const laneCenterY = laneBounds.map((lane) => lane.y + lane.h / 2);
  const steps = definition.macroSteps.map((step, index) => {
    const name = step.processKey ? definitionsByKey.get(step.processKey)?.name || step.processKey : step.name;
    const type = step.type || 'userTask';
    const size = type === 'subProcess' ? { w: 340, h: 138 } : { w: 180, h: 90 };
    const lane = step.lane || 0;
    return {
      id: `Step_${definition.key}_${index + 1}`,
      type,
      name,
      x: 420 + index * 450,
      y: laneCenterY[lane] - size.h / 2,
      lane,
      ...size,
    };
  });
  const startEvent = { x: 220, y: laneCenterY[0] - 18, w: 36, h: 36 };
  const endEvent = {
    x: 1880,
    y: steps[steps.length - 1].y + steps[steps.length - 1].h / 2 - 18,
    w: 36,
    h: 36,
  };

  const subprocessEmbeds = [];
  const nodeMarkup = steps
    .map((step, index) => {
      step.incoming = index === 0 ? 'Flow_1' : `Flow_${index + 1}`;
      step.outgoing = index === steps.length - 1 ? `Flow_${steps.length + 1}` : `Flow_${index + 2}`;
      if (step.type === 'subProcess') {
        const referenced = definition.macroSteps[index]?.processKey ? definitionsByKey.get(definition.macroSteps[index].processKey) : null;
        const embedded = buildEmbeddedSubProcess(step, {
          labels: referenced?.taskNames?.slice(0, 3),
        });
        subprocessEmbeds.push(...embedded.di);
        return embedded.xml;
      }
      return `<bpmn:${step.type} id="${step.id}" name="${escapeXml(step.name)}"><bpmn:incoming>${step.incoming}</bpmn:incoming><bpmn:outgoing>${step.outgoing}</bpmn:outgoing></bpmn:${step.type}>`;
    })
    .join('');

  const flows = sequenceMarkup(steps.map((step) => step.id)).flows;
  const edges = [
    edgeMarkup('Flow_1', routeHorizontal(rightMid(startEvent), leftMid(steps[0]))),
    ...steps.map((step, index) =>
      edgeMarkup(`Flow_${index + 2}`, [
        ...routeHorizontal(
          rightMid(step),
          index === steps.length - 1 ? leftMid(endEvent) : leftMid(steps[index + 1])
        ),
      ])
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${definition.key}" targetNamespace="http://demo.bdt.tn/bpmn">
  <bpmn:collaboration id="${collaborationId}">
    <bpmn:participant id="${participantId}" name="${escapeXml(definition.name)}" processRef="${processId}" />
  </bpmn:collaboration>
  <bpmn:process id="${processId}" name="${escapeXml(definition.name)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_${definition.key}">
      ${definition.laneNames.map((laneName, index) => `<bpmn:lane id="${laneIds[index]}" name="${escapeXml(laneName)}">${index === 0 ? '<bpmn:flowNodeRef>StartEvent_1</bpmn:flowNodeRef>' : ''}${steps.filter((step) => step.lane === index).map((step) => `<bpmn:flowNodeRef>${step.id}</bpmn:flowNodeRef>`).join('')}${index === definition.laneNames.length - 1 ? '<bpmn:flowNodeRef>EndEvent_1</bpmn:flowNodeRef>' : ''}</bpmn:lane>`).join('')}
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_1" name="Debut"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    ${nodeMarkup}
    <bpmn:endEvent id="EndEvent_1" name="Fin"><bpmn:incoming>Flow_${steps.length + 1}</bpmn:incoming></bpmn:endEvent>
    ${flows.join('')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${definition.key}">
    <bpmndi:BPMNPlane id="BPMNPlane_${definition.key}" bpmnElement="${collaborationId}">
      <bpmndi:BPMNShape id="${participantId}_di" bpmnElement="${participantId}" isHorizontal="true"><dc:Bounds x="${participant.x}" y="${participant.y}" width="${participant.w}" height="${participant.h}" /></bpmndi:BPMNShape>
      ${laneIds.map((laneId, index) => `<bpmndi:BPMNShape id="${laneId}_di" bpmnElement="${laneId}" isHorizontal="true"><dc:Bounds x="${participant.x + 30}" y="${laneBounds[index].y}" width="${participant.w - 30}" height="${laneBounds[index].h}" /></bpmndi:BPMNShape>`).join('')}
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="${startEvent.x}" y="${startEvent.y}" width="${startEvent.w}" height="${startEvent.h}" /></bpmndi:BPMNShape>
      ${steps.map((step) => shapeForStep(step)).join('')}
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="${endEvent.x}" y="${endEvent.y}" width="${endEvent.w}" height="${endEvent.h}" /></bpmndi:BPMNShape>
      ${subprocessEmbeds.join('')}
      ${edges.join('')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function buildDetailedProcessBpmn(definition) {
  const bankProcessId = `Process_${definition.key}_Bank`;
  const clientProcessId = `Process_${definition.key}_Client`;
  const collaborationId = `Collaboration_${definition.key}`;
  const bankParticipantId = `Participant_${definition.key}_Bank`;
  const clientParticipantId = `Participant_${definition.key}_Client`;
  const laneIds = definition.laneNames.map((_, index) => `Lane_${definition.key}_${index + 1}`);
  const clientParticipant = { x: 120, y: 80, w: 1960, h: 130 };
  const bankParticipant = { x: 120, y: 250, w: 1960, h: 580 };
  const laneHeights = [180, 180, 220];
  const laneBounds = laneHeights.map((height, index) => ({
    y: bankParticipant.y + laneHeights.slice(0, index).reduce((sum, value) => sum + value, 0),
    h: height,
  }));
  const laneCenterY = laneBounds.map((lane) => lane.y + lane.h / 2);
  const steps = definition.taskNames.map((taskName, index) => {
    const type = definition.stepTypes?.[index] || 'userTask';
    const lane = definition.lanePattern?.[index] ?? Math.min(2, Math.floor(index / 2));
    const size = type === 'subProcess' ? { w: 340, h: 138 } : type === 'exclusiveGateway' ? { w: 64, h: 64 } : { w: 170, h: 88 };
    return {
      id: `Task_${definition.key}_${index + 1}`,
      name: taskName,
      type,
      lane,
      x: 430 + index * 260,
      y: laneCenterY[lane] - size.h / 2,
      ...size,
    };
  });
  const clientStart = { x: 180, y: clientParticipant.y + clientParticipant.h / 2 - 18, w: 36, h: 36 };
  const clientTask = { x: 260, y: clientParticipant.y + clientParticipant.h / 2 - 40, w: 180, h: 80 };
  const clientReceive = { x: 1680, y: clientParticipant.y + clientParticipant.h / 2 - 18, w: 36, h: 36 };
  const clientEnd = { x: 1760, y: clientParticipant.y + clientParticipant.h / 2 - 18, w: 36, h: 36 };
  const bankStart = { x: 220, y: laneCenterY[0] - 18, w: 36, h: 36 };
  const bankEnd = {
    x: 1920,
    y: steps[steps.length - 1].y + steps[steps.length - 1].h / 2 - 18,
    w: 36,
    h: 36,
  };

  const subprocessEmbeds = [];
  const bankNodeMarkup = steps
    .map((step, index) => {
      step.incoming = index === 0 ? 'Flow_1' : `Flow_${index + 1}`;
      step.outgoing = index === steps.length - 1 ? `Flow_${steps.length + 1}` : `Flow_${index + 2}`;
      if (step.type === 'subProcess') {
        const embedded = buildEmbeddedSubProcess(step, {
          labels: [
            `Verifier ${shortWords(step.name, 2)}`,
            `Traiter ${shortWords(step.name, 2)}`,
            `Valider ${shortWords(step.name, 2)}`,
          ],
        });
        subprocessEmbeds.push(...embedded.di);
        return embedded.xml;
      }
      return `<bpmn:${step.type} id="${step.id}" name="${escapeXml(step.name)}"><bpmn:incoming>${step.incoming}</bpmn:incoming><bpmn:outgoing>${step.outgoing}</bpmn:outgoing></bpmn:${step.type}>`;
    })
    .join('');

  const bankFlows = sequenceMarkup(steps.map((step) => step.id)).flows;
  const clientTaskId = `Task_${definition.key}_ClientRequest`;
  const clientReceiveId = `Event_${definition.key}_ClientReply`;
  const clientFlows = [
    `<bpmn:sequenceFlow id="Flow_Client_1" sourceRef="StartEvent_Client" targetRef="${clientTaskId}" />`,
    `<bpmn:sequenceFlow id="Flow_Client_2" sourceRef="${clientTaskId}" targetRef="${clientReceiveId}" />`,
    `<bpmn:sequenceFlow id="Flow_Client_3" sourceRef="${clientReceiveId}" targetRef="EndEvent_Client" />`,
  ];

  const bankEdges = [
    edgeMarkup('Flow_1', routeHorizontal(rightMid(bankStart), leftMid(steps[0]))),
    ...steps.map((step, index) =>
      edgeMarkup(`Flow_${index + 2}`, [
        ...routeHorizontal(
          rightMid(step),
          index === steps.length - 1 ? leftMid(bankEnd) : leftMid(steps[index + 1])
        ),
      ])
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${definition.key}" targetNamespace="http://demo.bdt.tn/bpmn">
  <bpmn:collaboration id="${collaborationId}">
    <bpmn:participant id="${clientParticipantId}" name="Client" processRef="${clientProcessId}" />
    <bpmn:participant id="${bankParticipantId}" name="Banque Demo Tunisie" processRef="${bankProcessId}" />
    <bpmn:messageFlow id="MessageFlow_1" sourceRef="${clientTaskId}" targetRef="StartEvent_1" />
    <bpmn:messageFlow id="MessageFlow_2" sourceRef="${steps[steps.length - 1].id}" targetRef="${clientReceiveId}" />
  </bpmn:collaboration>
  <bpmn:process id="${clientProcessId}" name="Client" isExecutable="false">
    <bpmn:startEvent id="StartEvent_Client" name="Debut" />
    <bpmn:sendTask id="${clientTaskId}" name="${escapeXml(definition.customerAction || 'Envoyer demande')}" />
    <bpmn:intermediateCatchEvent id="${clientReceiveId}" name="${escapeXml(definition.customerReply || 'Recevoir retour')}" />
    <bpmn:endEvent id="EndEvent_Client" name="Fin" />
    ${clientFlows.join('')}
  </bpmn:process>
  <bpmn:process id="${bankProcessId}" name="${escapeXml(definition.name)}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_${definition.key}">
      ${definition.laneNames.map((laneName, index) => `<bpmn:lane id="${laneIds[index]}" name="${escapeXml(laneName)}">${index === 0 ? '<bpmn:flowNodeRef>StartEvent_1</bpmn:flowNodeRef>' : ''}${steps.filter((step) => step.lane === index).map((step) => `<bpmn:flowNodeRef>${step.id}</bpmn:flowNodeRef>`).join('')}${index === definition.laneNames.length - 1 ? '<bpmn:flowNodeRef>EndEvent_1</bpmn:flowNodeRef>' : ''}</bpmn:lane>`).join('')}
    </bpmn:laneSet>
    <bpmn:startEvent id="StartEvent_1" name="Reception demande"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    ${bankNodeMarkup}
    <bpmn:endEvent id="EndEvent_1" name="Cloture"><bpmn:incoming>Flow_${steps.length + 1}</bpmn:incoming></bpmn:endEvent>
    ${bankFlows.join('')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_${definition.key}">
    <bpmndi:BPMNPlane id="BPMNPlane_${definition.key}" bpmnElement="${collaborationId}">
      <bpmndi:BPMNShape id="${clientParticipantId}_di" bpmnElement="${clientParticipantId}" isHorizontal="true"><dc:Bounds x="${clientParticipant.x}" y="${clientParticipant.y}" width="${clientParticipant.w}" height="${clientParticipant.h}" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="${bankParticipantId}_di" bpmnElement="${bankParticipantId}" isHorizontal="true"><dc:Bounds x="${bankParticipant.x}" y="${bankParticipant.y}" width="${bankParticipant.w}" height="${bankParticipant.h}" /></bpmndi:BPMNShape>
      ${laneIds.map((laneId, index) => `<bpmndi:BPMNShape id="${laneId}_di" bpmnElement="${laneId}" isHorizontal="true"><dc:Bounds x="${bankParticipant.x + 30}" y="${laneBounds[index].y}" width="${bankParticipant.w - 30}" height="${laneBounds[index].h}" /></bpmndi:BPMNShape>`).join('')}
      <bpmndi:BPMNShape id="StartEvent_Client_di" bpmnElement="StartEvent_Client"><dc:Bounds x="${clientStart.x}" y="${clientStart.y}" width="${clientStart.w}" height="${clientStart.h}" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="${clientTaskId}_di" bpmnElement="${clientTaskId}"><dc:Bounds x="${clientTask.x}" y="${clientTask.y}" width="${clientTask.w}" height="${clientTask.h}" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="${clientReceiveId}_di" bpmnElement="${clientReceiveId}"><dc:Bounds x="${clientReceive.x}" y="${clientReceive.y}" width="${clientReceive.w}" height="${clientReceive.h}" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_Client_di" bpmnElement="EndEvent_Client"><dc:Bounds x="${clientEnd.x}" y="${clientEnd.y}" width="${clientEnd.w}" height="${clientEnd.h}" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="${bankStart.x}" y="${bankStart.y}" width="${bankStart.w}" height="${bankStart.h}" /></bpmndi:BPMNShape>
      ${steps.map((step) => shapeForStep(step)).join('')}
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="${bankEnd.x}" y="${bankEnd.y}" width="${bankEnd.w}" height="${bankEnd.h}" /></bpmndi:BPMNShape>
      ${subprocessEmbeds.join('')}
      <bpmndi:BPMNEdge id="Flow_Client_1_di" bpmnElement="Flow_Client_1">${routeHorizontal(rightMid(clientStart), leftMid(clientTask)).map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Client_2_di" bpmnElement="Flow_Client_2">${routeHorizontal(rightMid(clientTask), leftMid(clientReceive)).map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_Client_3_di" bpmnElement="Flow_Client_3">${routeHorizontal(rightMid(clientReceive), leftMid(clientEnd)).map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>
      ${bankEdges.join('')}
      <bpmndi:BPMNEdge id="MessageFlow_1_di" bpmnElement="MessageFlow_1">${routeVertical(bottomMid(clientTask), topMid(bankStart)).map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="MessageFlow_2_di" bpmnElement="MessageFlow_2">${routeVertical(topMid(steps[steps.length - 1]), bottomMid(clientReceive)).map((point) => `<di:waypoint x="${point.x}" y="${point.y}" />`).join('')}</bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

async function ensureProcessEnhancements() {
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE processes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`);
  await pool.query(`ALTER TABLE process_versions ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
  await pool.query(`ALTER TABLE process_versions ADD COLUMN IF NOT EXISTS description TEXT`);
  await pool.query(`ALTER TABLE process_versions ADD COLUMN IF NOT EXISTS category_id INTEGER`);
  await pool.query(`ALTER TABLE process_versions ADD COLUMN IF NOT EXISTS company_id INTEGER`);
  await pool.query(`ALTER TABLE process_versions ADD COLUMN IF NOT EXISTS status VARCHAR(50)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS process_workflow_comments (
      id SERIAL PRIMARY KEY,
      process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
      action VARCHAR(50) NOT NULL,
      status_from VARCHAR(50),
      status_to VARCHAR(50),
      comment TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function upsertCategory(name, description) {
  const result = await pool.query(
    `
      INSERT INTO process_categories (name, description)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
      RETURNING id
    `,
    [name, description]
  );
  return result.rows[0].id;
}

async function upsertUser(companyId, user, hashedPassword) {
  const result = await pool.query(
    `
      INSERT INTO users (username, password, email, full_name, role, company_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (username) DO UPDATE
      SET password = EXCLUDED.password,
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          company_id = EXCLUDED.company_id,
          updated_at = CURRENT_TIMESTAMP
      RETURNING id, username, full_name, role
    `,
    [user.username, hashedPassword, user.email, user.full_name, user.role, companyId]
  );
  return result.rows[0];
}

async function createProcess({ companyId, categoryId, createdBy, definition, parentId, definitionsByKey }) {
  const bpmnXml =
    definition.kind === 'macro'
      ? buildMacroProcessBpmn(definition, definitionsByKey)
      : buildDetailedProcessBpmn(definition);
  const processResult = await pool.query(
    `
      INSERT INTO processes (
        name, description, bpmn_xml, category_id, company_id, created_by, parent_id,
        status, version, submitted_at, approved_at, approved_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)
      RETURNING *
    `,
    [definition.name, definition.description, bpmnXml, categoryId, companyId, createdBy, parentId]
  );

  const process = processResult.rows[0];
  await pool.query(
    `
      INSERT INTO process_versions (
        process_id, version_number, bpmn_xml, created_by, change_description, name, description, category_id, company_id, status
      )
      VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'approved')
    `,
    [process.id, bpmnXml, createdBy, 'Seeded Tunisian bank demo process', process.name, process.description, process.category_id, process.company_id]
  );
  await pool.query(
    `
      INSERT INTO process_workflow_comments (
        process_id, action, status_from, status_to, comment, created_by
      )
      VALUES ($1, 'approve', 'draft', 'approved', $2, $3)
    `,
    [
      process.id,
      definition.kind === 'macro'
        ? 'Macro-processus approuve avec decomposition vers ses sous-processus.'
        : 'Sous-processus detaille approuve avec diagramme BPMN bancaire.',
      createdBy,
    ]
  );

  return { ...process, bpmn_xml: bpmnXml };
}

async function createScenario({ companyId, createdBy, process, definition }) {
  const arrivals = buildArrivalSchedule(definition.start_date, definition.daily_counts);
  const scenarioResult = await pool.query(
    `
      INSERT INTO simulation_scenarios (
        name, description, process_id, status, start_date, process_instances, warmup_percent, cooldown_percent,
        infinite_resources, simulate_all_levels, import_csv_arrivals, calendar_settings, monte_carlo_runs,
        notifications_enabled, created_by
      )
      VALUES ($1, $2, $3, 'draft', $4, $5, 5, 10, FALSE, FALSE, FALSE, $6::jsonb, $7, TRUE, $8)
      RETURNING *
    `,
    [
      definition.name,
      definition.description,
      process.id,
      definition.start_date,
      arrivals.length,
      JSON.stringify(CALENDAR_STANDARD),
      definition.monte_carlo_runs,
      createdBy,
    ]
  );

  const scenario = {
    ...scenarioResult.rows[0],
    process_company_id: companyId,
    calendar_settings: CALENDAR_STANDARD,
  };

  const resourceIds = {};
  const insertedResources = [];
  for (const resource of definition.resources) {
    const result = await pool.query(
      `
        INSERT INTO simulation_resources (
          scenario_id, name, resource_type, quantity, cost_per_hour, availability, availability_windows
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [
        scenario.id,
        resource.name,
        resource.resource_type,
        resource.quantity,
        resource.cost_per_hour,
        resource.availability,
        JSON.stringify(resource.availability_windows || []),
      ]
    );
    resourceIds[resource.key] = result.rows[0].id;
    insertedResources.push({
      ...result.rows[0],
      availability_windows: resource.availability_windows || [],
    });
  }

  const insertedTasks = [];
  for (const task of definition.tasks) {
    const result = await pool.query(
      `
        INSERT INTO simulation_task_data (
          scenario_id, task_id, task_name, duration_min, duration_type, duration_std, resource_id, cost, sla_target_min
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        scenario.id,
        task.task_id,
        task.task_name,
        task.duration_min,
        task.duration_type,
        task.duration_std,
        resourceIds[task.resource] || null,
        task.cost,
        task.sla_target_min,
      ]
    );
    insertedTasks.push(result.rows[0]);
  }

  for (const arrival of arrivals) {
    await pool.query(
      `
        INSERT INTO simulation_arrival_times (
          scenario_id, arrival_order, raw_value, arrival_at, arrival_offset_min
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        scenario.id,
        arrival.arrival_order,
        arrival.raw_value,
        arrival.arrival_at,
        arrival.arrival_offset_min,
      ]
    );
  }

  const baseResults = runSimulation({
    scenario,
    tasks: insertedTasks,
    resources: insertedResources,
    arrivals,
  });
  const monteCarlo =
    definition.monte_carlo_runs > 1
      ? runMonteCarloSimulation({
          scenario,
          tasks: insertedTasks,
          resources: insertedResources,
          arrivals,
          iterations: definition.monte_carlo_runs,
        })
      : null;
  const sensitivity = runSensitivityAnalysis({
    scenario,
    tasks: insertedTasks,
    resources: insertedResources,
    arrivals,
  });
  const planning = runResourcePlanning({
    scenario,
    tasks: insertedTasks,
    resources: insertedResources,
    arrivals,
    targetCycleTimeMin: definition.planningTarget,
  });

  const results = {
    ...baseResults,
    ...(monteCarlo ? { monte_carlo: monteCarlo } : {}),
    sensitivity,
    resource_planning: planning,
  };

  await pool.query(
    `
      UPDATE simulation_scenarios
      SET status = 'completed',
          import_csv_arrivals = TRUE,
          results = $1::jsonb,
          last_run_started_at = CURRENT_TIMESTAMP,
          last_run_finished_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [JSON.stringify(results), scenario.id]
  );

  return { id: scenario.id, name: scenario.name, process_id: process.id, results };
}

async function createOrgChart(companyId, usersByUsername) {
  await pool.query('DELETE FROM org_chart_nodes WHERE company_id = $1', [companyId]);

  const nodes = [
    { key: 'company', parent: null, name: COMPANY_NAME, title: 'Banque universelle', node_type: 'company', color: '#dc2626' },
    { key: 'executive', parent: 'company', name: 'Direction generale', title: 'Pilotage strategique', node_type: 'division', color: '#2563eb' },
    { key: 'branch_network', parent: 'company', name: 'Reseau agences', title: 'Distribution retail', node_type: 'division', color: '#2563eb' },
    { key: 'credits', parent: 'company', name: 'Direction credits retail', title: 'Credit particuliers', node_type: 'division', color: '#2563eb' },
    { key: 'operations', parent: 'company', name: 'Operations bancaires', title: 'Back office et execution', node_type: 'division', color: '#2563eb' },
    { key: 'compliance', parent: 'company', name: 'Conformite et LCB-FT', title: 'Controle permanent', node_type: 'division', color: '#2563eb' },
    { key: 'agency_tunis', parent: 'branch_network', name: 'Agence Tunis Centre', title: 'Agence urbaine grand public', node_type: 'department', color: '#7c3aed' },
    { key: 'platform_admin', parent: 'executive', name: 'Administration plateforme', title: 'Company administrator', node_type: 'position', user: 'bdt_admin', color: '#475569' },
    { key: 'branch_manager', parent: 'agency_tunis', name: 'Direction agence Tunis Centre', title: 'Directeur agence', node_type: 'position', user: 'bdt_branch_mgr', color: '#475569' },
    { key: 'credit_analyst', parent: 'credits', name: 'Pole analyse credit', title: 'Analyste risque credit', node_type: 'position', user: 'bdt_credit', color: '#475569' },
    { key: 'operations_manager', parent: 'operations', name: 'Cellule back office retail', title: 'Responsable operations', node_type: 'position', user: 'bdt_ops', color: '#475569' },
    { key: 'compliance_manager', parent: 'compliance', name: 'Cellule conformite', title: 'Responsable conformite', node_type: 'position', user: 'bdt_compliance', color: '#475569' },
    { key: 'reporting', parent: 'executive', name: 'Pilotage et reporting', title: 'Charge reporting', node_type: 'position', user: 'bdt_viewer', color: '#475569' },
  ];

  const ids = {};
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const parentId = node.parent ? ids[node.parent] : null;
    const userId = node.user ? usersByUsername[node.user]?.id || null : null;
    const result = await pool.query(
      `
        INSERT INTO org_chart_nodes (
          parent_id, company_id, user_id, name, title, node_type, description, color, sort_order, is_vacant
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
        RETURNING id
      `,
      [parentId, companyId, userId, node.name, node.title, node.node_type, null, node.color, index]
    );
    ids[node.key] = result.rows[0].id;
  }
}

async function cleanupExistingDemo(companyId) {
  await pool.query(
    `
      DELETE FROM simulation_arrival_times
      WHERE scenario_id IN (
        SELECT s.id
        FROM simulation_scenarios s
        INNER JOIN processes p ON p.id = s.process_id
        WHERE p.company_id = $1 AND p.name LIKE 'BDT - %'
      )
    `,
    [companyId]
  );
  await pool.query(
    `
      DELETE FROM simulation_task_data
      WHERE scenario_id IN (
        SELECT s.id
        FROM simulation_scenarios s
        INNER JOIN processes p ON p.id = s.process_id
        WHERE p.company_id = $1 AND p.name LIKE 'BDT - %'
      )
    `,
    [companyId]
  );
  await pool.query(
    `
      DELETE FROM simulation_resources
      WHERE scenario_id IN (
        SELECT s.id
        FROM simulation_scenarios s
        INNER JOIN processes p ON p.id = s.process_id
        WHERE p.company_id = $1 AND p.name LIKE 'BDT - %'
      )
    `,
    [companyId]
  );
  await pool.query('DELETE FROM org_chart_nodes WHERE company_id = $1', [companyId]);
  await pool.query(
    `DELETE FROM simulation_scenarios WHERE process_id IN (SELECT id FROM processes WHERE company_id = $1 AND name LIKE 'BDT - %')`,
    [companyId]
  );
  await pool.query(`DELETE FROM processes WHERE company_id = $1 AND name LIKE 'BDT - %'`, [companyId]);
  await pool.query(`DELETE FROM users WHERE company_id = $1 AND username LIKE 'bdt_%'`, [companyId]);
}

async function main() {
  try {
    await ensureAccessBootstrap();
    await ensureProcessEnhancements();
    await ensureSimulationSchema();
    await ensureOrgChartSchema();

    const companyResult = await pool.query(
      `
        INSERT INTO companies (name, description)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [COMPANY_NAME, COMPANY_DESCRIPTION]
    );
    const company = companyResult.rows[0];

    await cleanupExistingDemo(company.id);

    const categoryIds = {};
    for (const [name, description] of CATEGORIES) {
      categoryIds[name] = await upsertCategory(name, description);
    }

    const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const usersByUsername = {};
    for (const user of USERS) {
      const created = await upsertUser(company.id, user, hashedPassword);
      usersByUsername[user.username] = created;
    }

    const definitionsByKey = new Map(PROCESS_DEFINITIONS.map((definition) => [definition.key, definition]));
    const processes = {};
    const orderedDefinitions = [
      ...PROCESS_DEFINITIONS.filter((definition) => !definition.parentKey),
      ...PROCESS_DEFINITIONS.filter((definition) => definition.parentKey),
    ];
    for (const definition of orderedDefinitions) {
      processes[definition.key] = await createProcess({
        companyId: company.id,
        categoryId: categoryIds[definition.category],
        createdBy: usersByUsername[definition.owner || 'bdt_admin']?.id || usersByUsername.bdt_admin.id,
        definition,
        parentId: definition.parentKey ? processes[definition.parentKey]?.id || null : null,
        definitionsByKey,
      });
    }

    const scenarios = [];
    for (const definition of SCENARIO_DEFINITIONS) {
      const scenario = await createScenario({
        companyId: company.id,
        createdBy: usersByUsername.bdt_credit.id,
        process: processes[definition.processKey],
        definition,
      });
      scenarios.push(scenario);
    }

    await createOrgChart(company.id, usersByUsername);

    console.log(
      JSON.stringify(
        {
          company: { id: company.id, name: company.name },
          users: USERS.map((user) => ({ username: user.username, password: DEFAULT_PASSWORD, role: user.role })),
          processes: Object.values(processes).map((process) => ({ id: process.id, name: process.name })),
          scenarios: scenarios.map((scenario) => ({
            id: scenario.id,
            name: scenario.name,
            avg_duration_min: scenario.results.avg_duration_min,
            total_cost: scenario.results.total_cost,
          })),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Tunisian bank seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
