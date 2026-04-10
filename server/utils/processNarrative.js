import { extractTasksFromDiagram } from './simulationEngine.js';
import { normalizeProcessStatus, summarizeBpmnDefinition } from './processDiff.js';
import { buildPdfDocument } from './pdfDocument.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return Number(value).toFixed(decimals);
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

export function buildProcessReportHtml(process = {}, explanation = null) {
  const narrative = explanation || buildProcessExplanation(process);
  const sectionsHtml = (narrative.sections || [])
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(process.name || 'Process')} - Diagram Explanation</title>
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
        <span class="eyebrow">Process explanation</span>
        <h1>${escapeHtml(process.name || `Process #${process.id || ''}`)}</h1>
        <div class="hero-meta">
          Status: ${escapeHtml(normalizeProcessStatus(process.status, 'draft'))}<br />
          Version: ${escapeHtml(process.version ? `v${process.version}` : '-') }<br />
          Category: ${escapeHtml(process.category_name || '-')}
        </div>
      </div>
      <div class="hero-meta">
        Generated at: ${escapeHtml(narrative.generated_at || '-') }<br />
        Company: ${escapeHtml(process.company_name || '-')}
      </div>
    </div>

    <p style="font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(narrative.summary || '')}</p>

    <div class="metrics">
      ${[
        ['Participants', narrative.metrics?.participants],
        ['Lanes', narrative.metrics?.lanes],
        ['Activities', narrative.metrics?.activities],
        ['Gateways', narrative.metrics?.gateways],
        ['Events', narrative.metrics?.events],
        ['Sub-processes', narrative.metrics?.subprocesses],
        ['Seq. flows', narrative.metrics?.sequence_flows],
        ['Msg. flows', narrative.metrics?.message_flows],
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

    ${sectionsHtml}

    <div class="section">
      <h2>Activity inventory</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(narrative.details?.tasks || [], [
            { key: 'task_id' },
            { key: 'task_name' },
          ])}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

export function buildProcessReportPdf(process = {}, explanation = null, options = {}) {
  const narrative = explanation || buildProcessExplanation(process);
  return buildPdfDocument({
    title: `Process explanation: ${process.name || `Process #${process.id}`}`,
    subtitle: `Status: ${normalizeProcessStatus(process.status, 'draft')} | Version: ${process.version ? `v${process.version}` : '-'}`,
    heroImage: options.diagramImageDataUrl
      ? { dataUrl: options.diagramImageDataUrl }
      : null,
    sections: [
      {
        title: 'Executive summary',
        paragraphs: [narrative.summary || ''],
      },
      ...((narrative.sections || []).map((section) => ({
        title: section.title,
        paragraphs: [section.body || ''],
        bullets: section.bullets || [],
      }))),
      {
        title: 'Activities',
        bullets: (narrative.details?.tasks || [])
          .slice(0, 24)
          .map((task) => `${task.task_name || task.task_id} (${task.task_id})`),
      },
    ],
  });
}
