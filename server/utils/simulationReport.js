import { buildPdfDocument } from './pdfDocument.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return Number(value).toFixed(decimals);
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

export function buildSimulationExplanation(scenario, extras = {}) {
  const results = scenario?.results || {};
  const taskResults = Array.isArray(results.task_results) ? results.task_results : [];
  const resourceResults = Array.isArray(results.resource_results) ? results.resource_results : [];
  const bottlenecks = Array.isArray(results.bottlenecks) ? results.bottlenecks : [];
  const monteCarlo = extras.monteCarlo || results.monte_carlo || null;
  const sensitivity = extras.sensitivity || results.sensitivity || null;
  const planning = extras.resourcePlanning || results.resource_planning || null;

  const longestTasks = [...taskResults]
    .sort((left, right) => Number(right.avg_duration || 0) - Number(left.avg_duration || 0))
    .slice(0, 3);
  const longestQueues = [...taskResults]
    .sort((left, right) => Number(right.avg_wait_min || 0) - Number(left.avg_wait_min || 0))
    .slice(0, 3);
  const busiestResources = [...resourceResults]
    .sort((left, right) => Number(right.utilization_rate || 0) - Number(left.utilization_rate || 0))
    .slice(0, 3);

<<<<<<< HEAD
  const scenarioName = scenario?.name || `Scenario #${scenario?.id}`;
  const overview = results.avg_duration_min !== undefined
    ? `${scenarioName} processed ${results.instances ?? 0} instance(s). The empirical mean cycle time is ${formatNumber(results.avg_duration_min)} minutes, the empirical P95 is ${formatNumber(results.p95_duration_min)} minutes, and the aggregate cost is ${formatNumber(results.total_cost, 2)} EUR.`
    : `${scenarioName} has not been executed yet, so no empirical measurements are available.`;

  const modelNarrative = `The run uses the offset rule ${results.instance_offset_rule || 'offset(i) = 3 * (i - 1) minutes'}. For each task, start time is computed as max(ready time, resource-ready time), wait time is start time minus ready time, and cycle time is final finish time minus the instance offset.`;

  const throughputNarrative = longestTasks.length
    ? `The largest mean service times are ${humanJoin(longestTasks.map((task) => `${task.task_name} (${formatNumber(task.avg_duration)} min)`))}.`
    : 'No task-level duration samples are available yet.';

  const waitNarrative = longestQueues.some((task) => Number(task.avg_wait_min || 0) > 0)
    ? `The largest mean waits are ${humanJoin(longestQueues.map((task) => `${task.task_name} (${formatNumber(task.avg_wait_min)} min)`))}.`
    : 'The measured queueing delay is negligible in the current run.';

  const resourceNarrative = busiestResources.length
    ? `The highest utilisation values are ${humanJoin(busiestResources.map((resource) => `${resource.resource_name} (${formatNumber(resource.utilization_rate)}%)`))}.`
    : 'No resource utilisation data is available.';

  const bottleneckNarrative = bottlenecks.length
    ? `The dominant signals are ${humanJoin(bottlenecks.slice(0, 4).map((entry) => `${entry.name} (${formatNumber(entry.metric)} ${entry.unit})`))}.`
    : 'No dominant bottleneck signal was detected in the current run.';

  return {
    generated_at: new Date().toISOString(),
    summary: `${overview} ${modelNarrative} ${throughputNarrative} ${resourceNarrative}`.trim(),
    sections: [
      {
        title: 'Model equations',
        body: modelNarrative,
        bullets: [
          `Offset rule: ${results.instance_offset_rule || 'offset(i) = 3 * (i - 1) minutes'}`,
          'Task start = max(instance ready time, resource ready time)',
          'Task wait = task start - instance ready time',
          'Cycle time = final finish time - instance offset',
          'Resource utilisation = busy time / theoretical capacity',
        ],
      },
      {
        title: 'Empirical aggregates',
        body: overview,
        bullets: [
          `Instances simulated: ${results.instances ?? 0}`,
          `Active instances: ${results.active_instances ?? 0}`,
          `Average cycle time: ${formatNumber(results.avg_duration_min)} min`,
          `P95 cycle time: ${formatNumber(results.p95_duration_min)} min`,
          `Simulation horizon: ${formatNumber(results.simulation_horizon_min)} min`,
=======
  const overview = [
    `${scenario?.name || `Scenario #${scenario?.id}` } is ${scenario?.status || 'draft'} and targets the process ${scenario?.process_name || '-'}.`,
    results.avg_duration_min !== undefined
      ? `The last run processed ${results.instances ?? 0} instance(s) with an average cycle time of ${formatNumber(results.avg_duration_min)} minutes and a total cost of ${formatNumber(results.total_cost, 2)} EUR.`
      : 'The scenario has not been executed yet, so no performance evidence is available.',
    results.arrival_source ? `Instance arrivals came from the ${results.arrival_source} schedule.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const throughputNarrative = longestTasks.length
    ? `The slowest activities are ${humanJoin(longestTasks.map((task) => `${task.task_name} (${formatNumber(task.avg_duration)} min)`))}.`
    : 'No task-level performance data is available yet.';

  const waitNarrative = longestQueues.some((task) => Number(task.avg_wait_min || 0) > 0)
    ? `The largest waiting times appear around ${humanJoin(longestQueues.map((task) => `${task.task_name} (${formatNumber(task.avg_wait_min)} min)`))}.`
    : 'The run does not show significant queueing delays.';

  const resourceNarrative = busiestResources.length
    ? `The most loaded resources are ${humanJoin(busiestResources.map((resource) => `${resource.resource_name} (${formatNumber(resource.utilization_rate)}%)`))}.`
    : 'No resource utilisation data is available.';

  const bottleneckNarrative = bottlenecks.length
    ? `The dominant bottlenecks are ${humanJoin(bottlenecks.slice(0, 4).map((entry) => `${entry.name} (${formatNumber(entry.metric)} ${entry.unit})`))}.`
    : 'No critical bottleneck was detected in the current run.';

  return {
    generated_at: new Date().toISOString(),
    summary: `${overview} ${throughputNarrative} ${resourceNarrative}`.trim(),
    sections: [
      {
        title: 'Run overview',
        body: overview,
        bullets: [
          `Instances simulated: ${results.instances ?? 0}`,
          `Average cycle time: ${formatNumber(results.avg_duration_min)} min`,
          `P95 cycle time: ${formatNumber(results.p95_duration_min)} min`,
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
          `Total cost: ${formatNumber(results.total_cost, 2)} EUR`,
        ],
      },
      {
<<<<<<< HEAD
        title: 'Queueing and capacity',
        body: `${throughputNarrative} ${waitNarrative} ${resourceNarrative} ${bottleneckNarrative}`.trim(),
        bullets: [
          ...longestTasks.map((task) => `${task.task_name}: mean duration ${formatNumber(task.avg_duration)} min`),
          ...longestQueues.slice(0, 2).map((task) => `${task.task_name}: mean wait ${formatNumber(task.avg_wait_min)} min`),
          ...busiestResources.map((resource) => `${resource.resource_name}: utilisation ${formatNumber(resource.utilization_rate)}%`),
        ],
      },
      {
        title: 'Constraints and uncertainty',
        body:
          results.sla_summary
            ? `The run tracked ${results.sla_summary.monitored_tasks ?? 0} SLA-constrained task(s), produced ${results.sla_summary.total_breaches ?? 0} breach(es), and finished with ${formatNumber(results.sla_summary.late_instance_rate ?? 0)}% late instances.`
            : 'No SLA metrics were available for this run.',
        bullets: [
          monteCarlo ? `Monte Carlo iterations: ${monteCarlo.iterations}` : null,
          monteCarlo ? `Empirical 90% band for mean cycle time: ${formatNumber(monteCarlo.duration?.ci_low)} to ${formatNumber(monteCarlo.duration?.ci_high)} min` : null,
          sensitivity?.impacts?.[0] ? `Largest sensitivity driver: ${sensitivity.impacts[0].name}` : null,
          planning?.recommendations?.[0]
            ? `Best capacity action: add ${planning.recommendations[0].add_units} unit(s) to ${planning.recommendations[0].resource_name}`
=======
        title: 'Performance interpretation',
        body: `${throughputNarrative} ${waitNarrative}`.trim(),
        bullets: longestTasks.map((task) => `${task.task_name}: ${formatNumber(task.avg_duration)} min avg duration`),
      },
      {
        title: 'Resources and bottlenecks',
        body: `${resourceNarrative} ${bottleneckNarrative}`.trim(),
        bullets: [
          ...busiestResources.map((resource) => `${resource.resource_name}: ${formatNumber(resource.utilization_rate)}% utilisation`),
          ...bottlenecks.slice(0, 3).map((entry) => `${entry.name}: ${formatNumber(entry.metric)} ${entry.unit}`),
        ],
      },
      {
        title: 'Service levels and planning',
        body:
          results.sla_summary
            ? `The simulation tracked ${results.sla_summary.monitored_tasks ?? 0} task(s) with ${results.sla_summary.total_breaches ?? 0} SLA breach(es), and ${formatNumber(results.sla_summary.late_instance_rate ?? 0)}% late instances.`
            : 'No SLA metrics were available for this run.',
        bullets: [
          monteCarlo ? `Monte Carlo iterations: ${monteCarlo.iterations}` : null,
          monteCarlo ? `Cycle-time confidence interval: ${formatNumber(monteCarlo.duration?.ci_low)} - ${formatNumber(monteCarlo.duration?.ci_high)} min` : null,
          sensitivity?.impacts?.[0] ? `Highest sensitivity driver: ${sensitivity.impacts[0].name}` : null,
          planning?.recommendations?.[0]
            ? `Best staffing action: add ${planning.recommendations[0].add_units} to ${planning.recommendations[0].resource_name}`
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
            : null,
        ].filter(Boolean),
      },
    ],
    highlights: {
      longest_tasks: longestTasks,
      longest_queues: longestQueues,
      busiest_resources: busiestResources,
      bottlenecks,
      monte_carlo: monteCarlo,
      sensitivity,
      planning,
    },
  };
}

function buildMetricCards(scenario) {
  const results = scenario.results || {};
  const metrics = [
    ['Average cycle time', `${formatNumber(results.avg_duration_min)} min`],
    ['P95 cycle time', `${formatNumber(results.p95_duration_min)} min`],
    ['Total cost', `${formatNumber(results.total_cost, 2)} EUR`],
    ['Late instances', `${results.late_instances ?? 0}`],
    ['Max utilisation', `${formatNumber(Math.max(0, ...(results.resource_results || []).map((resource) => Number(resource.utilization_rate || 0))))}%`],
<<<<<<< HEAD
    ['Simulation horizon', `${formatNumber(results.simulation_horizon_min)} min`],
=======
    ['Arrival source', results.arrival_source || '-'],
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
  ];

  return metrics
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `
    )
    .join('');
}

function buildRows(rows = [], columns = []) {
  return rows
    .map(
      (row) => `
        <tr>
          ${columns.map((column) => `<td>${escapeHtml(column.format ? column.format(row[column.key], row) : row[column.key] ?? '')}</td>`).join('')}
        </tr>
      `
    )
    .join('');
}

export function buildSimulationReportHtml(scenario, extras = {}) {
  const results = scenario.results || {};
  const monteCarlo = extras.monteCarlo || results.monte_carlo || null;
  const sensitivity = extras.sensitivity || results.sensitivity || null;
  const planning = extras.resourcePlanning || results.resource_planning || null;
  const explanation = buildSimulationExplanation(scenario, extras);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(scenario.name)} - Simulation Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 28px; color: #111827; background: #f8fafc; }
    .report-shell { background: #ffffff; border-radius: 18px; padding: 28px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08); }
    .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 10px; font-size: 30px; }
    .eyebrow { display: inline-block; color: #b91c1c; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; }
    .hero-meta { font-size: 13px; color: #64748b; line-height: 1.7; }
    .metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 24px 0; }
    .metric-card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; background: linear-gradient(180deg, #fff 0%, #f8fafc 100%); }
    .metric-card span { display: block; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
    .metric-card strong { font-size: 24px; color: #111827; }
    .section { margin-top: 30px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; }
    .section p { color: #4b5563; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { background: #f8fafc; color: #475569; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
    .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .chip { display: inline-flex; align-items: center; border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 700; background: #fee2e2; color: #991b1b; }
    .subgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    @media print { body { margin: 0; background: #fff; } .report-shell { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="report-shell">
    <div class="hero">
      <div>
        <span class="eyebrow">Simulation report</span>
        <h1>${escapeHtml(scenario.name || `Scenario #${scenario.id}`)}</h1>
        <div class="hero-meta">
          Process: ${escapeHtml(scenario.process_name || '-')}<br />
          Status: ${escapeHtml(scenario.status || 'draft')}<br />
          Simulated at: ${escapeHtml(results.simulated_at || '-')}
        </div>
      </div>
      <div class="hero-meta">
        Instances: ${escapeHtml(results.instances ?? '-')}<br />
        Active instances: ${escapeHtml(results.active_instances ?? '-')}<br />
<<<<<<< HEAD
        Offset rule: ${escapeHtml(results.instance_offset_rule || '-')}
=======
        Arrival source: ${escapeHtml(results.arrival_source || '-')}
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      </div>
    </div>

    <div class="metrics">${buildMetricCards(scenario)}</div>

    <div class="section">
<<<<<<< HEAD
      <h2>Mathematical explanation</h2>
=======
      <h2>Executive explanation</h2>
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      <p>${escapeHtml(explanation.summary || '')}</p>
      ${explanation.sections
        .map(
          (section) => `
            <h3 style="margin:18px 0 6px;font-size:16px;">${escapeHtml(section.title)}</h3>
            <p>${escapeHtml(section.body || '')}</p>
            ${
              section.bullets?.length
                ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
                : ''
            }
          `
        )
        .join('')}
    </div>

    <div class="section">
<<<<<<< HEAD
      <h2>Task metrics</h2>
=======
      <h2>Task performance</h2>
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Avg duration</th>
            <th>Avg wait</th>
            <th>SLA target</th>
            <th>SLA breach rate</th>
            <th>Resource</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(results.task_results || [], [
            { key: 'task_name' },
            { key: 'avg_duration', format: (value) => `${formatNumber(value)} min` },
            { key: 'avg_wait_min', format: (value) => `${formatNumber(value)} min` },
            { key: 'sla_target_min', format: (value) => (value ? `${formatNumber(value)} min` : '-') },
            { key: 'sla_breach_rate', format: (value) => `${formatNumber(value)}%` },
            { key: 'resource_name' },
          ])}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Resource utilisation</h2>
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Quantity</th>
            <th>Busy time</th>
<<<<<<< HEAD
            <th>Theoretical capacity</th>
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
            <th>Tasks handled</th>
            <th>Utilisation</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(results.resource_results || [], [
            { key: 'resource_name' },
            { key: 'quantity' },
            { key: 'total_busy_min', format: (value) => `${formatNumber(value)} min` },
<<<<<<< HEAD
            { key: 'theoretical_capacity_min', format: (value) => `${formatNumber(value)} min` },
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
            { key: 'tasks_handled' },
            { key: 'utilization_rate', format: (value) => `${formatNumber(value)}%` },
          ])}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Bottlenecks</h2>
      <div class="chips">
        ${(results.bottlenecks || [])
          .map(
            (bottleneck) =>
              `<span class="chip">${escapeHtml(`${bottleneck.name} - ${formatNumber(bottleneck.metric)} ${bottleneck.unit}`)}</span>`
          )
          .join('') || '<span class="chip" style="background:#e2e8f0;color:#334155;">No bottlenecks detected</span>'}
      </div>
    </div>

    <div class="section">
      <h2>SLA summary</h2>
      <p>
        Monitored tasks: ${escapeHtml(results.sla_summary?.monitored_tasks ?? 0)}<br />
        Total breaches: ${escapeHtml(results.sla_summary?.total_breaches ?? 0)}<br />
        Late instance rate: ${escapeHtml(formatNumber(results.sla_summary?.late_instance_rate ?? 0))}%
      </p>
    </div>

    ${
      monteCarlo
        ? `
    <div class="section">
      <h2>Monte Carlo summary</h2>
      <div class="subgrid">
        <div>
          <p>Iterations: ${escapeHtml(monteCarlo.iterations)}</p>
          <p>Mean cycle time: ${escapeHtml(formatNumber(monteCarlo.duration?.mean))} min</p>
<<<<<<< HEAD
          <p>Empirical 90% band: ${escapeHtml(formatNumber(monteCarlo.duration?.ci_low))} - ${escapeHtml(formatNumber(monteCarlo.duration?.ci_high))} min</p>
        </div>
        <div>
          <p>Mean total cost: ${escapeHtml(formatNumber(monteCarlo.total_cost?.mean, 2))} EUR</p>
          <p>Late-rate band: ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_low))}% - ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_high))}%</p>
=======
          <p>Confidence range: ${escapeHtml(formatNumber(monteCarlo.duration?.ci_low))} - ${escapeHtml(formatNumber(monteCarlo.duration?.ci_high))} min</p>
        </div>
        <div>
          <p>Mean total cost: ${escapeHtml(formatNumber(monteCarlo.total_cost?.mean, 2))} EUR</p>
          <p>Late rate range: ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_low))}% - ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_high))}%</p>
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
        </div>
      </div>
    </div>`
        : ''
    }

    ${
      sensitivity?.impacts?.length
        ? `
    <div class="section">
      <h2>Sensitivity analysis</h2>
      <table>
        <thead>
          <tr>
            <th>Driver</th>
            <th>Change</th>
            <th>Cycle impact</th>
            <th>Cost impact</th>
            <th>Late-rate impact</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(sensitivity.impacts.slice(0, 8), [
            { key: 'name' },
            { key: 'change' },
            { key: 'cycle_impact_min', format: (value) => `${formatNumber(value)} min` },
            { key: 'cost_impact', format: (value) => `${formatNumber(value, 2)} EUR` },
            { key: 'late_rate_impact', format: (value) => `${formatNumber(value)}%` },
          ])}
        </tbody>
      </table>
    </div>`
        : ''
    }

    ${
      planning?.recommendations?.length
        ? `
    <div class="section">
<<<<<<< HEAD
      <h2>Capacity planning</h2>
=======
      <h2>Resource planning</h2>
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      <p>${escapeHtml(planning.summary || '')}</p>
      <table>
        <thead>
          <tr>
            <th>Resource</th>
            <th>Add units</th>
            <th>Projected cycle time</th>
            <th>Projected cost</th>
            <th>Target met</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(planning.recommendations.slice(0, 6), [
            { key: 'resource_name' },
            { key: 'add_units' },
            { key: 'projected_avg_duration_min', format: (value) => `${formatNumber(value)} min` },
            { key: 'projected_total_cost', format: (value) => `${formatNumber(value, 2)} EUR` },
            { key: 'meets_target', format: (value) => (value ? 'Yes' : 'No') },
          ])}
        </tbody>
      </table>
    </div>`
        : ''
    }
  </div>
</body>
</html>`;
}

export function buildSimulationReportExcel(scenario, extras = {}) {
  return `\uFEFF${buildSimulationReportHtml(scenario, extras)}`;
}

export function buildSimulationReportPdf(scenario, extras = {}) {
  const results = scenario.results || {};
  const monteCarlo = extras.monteCarlo || results.monte_carlo || null;
  const sensitivity = extras.sensitivity || results.sensitivity || null;
  const planning = extras.resourcePlanning || results.resource_planning || null;
  const explanation = buildSimulationExplanation(scenario, extras);
  return buildPdfDocument({
    title: `Simulation report: ${scenario.name || `Scenario #${scenario.id}`}`,
    subtitle: `Process: ${scenario.process_name || '-'} | Status: ${scenario.status || 'draft'}`,
    sections: [
      {
        title: 'Executive summary',
        paragraphs: [
          explanation.summary || '',
          `Average cycle time: ${formatNumber(results.avg_duration_min)} min | P95: ${formatNumber(results.p95_duration_min)} min | Total cost: ${formatNumber(results.total_cost, 2)} EUR | Late instance rate: ${formatNumber(results.sla_summary?.late_instance_rate ?? 0)}%`,
        ],
      },
      ...explanation.sections.map((section) => ({
        title: section.title,
        paragraphs: [section.body || ''],
        bullets: section.bullets || [],
      })),
      {
        title: 'Top bottlenecks',
        bullets: (results.bottlenecks || [])
          .slice(0, 6)
          .map((entry) => `${entry.name}: ${formatNumber(entry.metric)} ${entry.unit}`),
      },
      {
        title: 'Top tasks',
        bullets: (results.task_results || [])
          .slice(0, 8)
          .map(
            (task) =>
              `${task.task_name}: avg ${formatNumber(task.avg_duration)} min, wait ${formatNumber(task.avg_wait_min)} min, SLA breaches ${formatNumber(task.sla_breach_rate)}%`
          ),
      },
      ...(monteCarlo
        ? [{
            title: 'Monte Carlo',
            bullets: [
              `Iterations: ${monteCarlo.iterations}`,
<<<<<<< HEAD
              `Empirical 90% band for cycle time: ${formatNumber(monteCarlo.duration?.ci_low)} - ${formatNumber(monteCarlo.duration?.ci_high)} min`,
              `Empirical 90% band for cost: ${formatNumber(monteCarlo.total_cost?.ci_low, 2)} - ${formatNumber(monteCarlo.total_cost?.ci_high, 2)} EUR`,
=======
              `Cycle-time confidence interval: ${formatNumber(monteCarlo.duration?.ci_low)} - ${formatNumber(monteCarlo.duration?.ci_high)} min`,
              `Cost confidence interval: ${formatNumber(monteCarlo.total_cost?.ci_low, 2)} - ${formatNumber(monteCarlo.total_cost?.ci_high, 2)} EUR`,
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
            ],
          }]
        : []),
      ...(sensitivity?.impacts?.length
        ? [{
            title: 'Sensitivity',
            bullets: sensitivity.impacts
              .slice(0, 5)
              .map((impact) => `${impact.name} (${impact.change}): ${formatNumber(impact.cycle_impact_min)} min cycle impact`),
          }]
        : []),
      ...(planning?.recommendations?.length
        ? [{
<<<<<<< HEAD
            title: 'Capacity planning',
=======
            title: 'Resource planning',
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
            paragraphs: [planning.summary || ''],
            bullets: planning.recommendations
              .slice(0, 5)
              .map((recommendation) => `${recommendation.resource_name}: +${recommendation.add_units} => ${formatNumber(recommendation.projected_avg_duration_min)} min`),
          }]
        : []),
    ],
  });
}
