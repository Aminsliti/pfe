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

function buildMetricCards(scenario) {
  const results = scenario.results || {};
  const metrics = [
    ['Average cycle time', `${formatNumber(results.avg_duration_min)} min`],
    ['P95 cycle time', `${formatNumber(results.p95_duration_min)} min`],
    ['Total cost', `${formatNumber(results.total_cost, 2)} EUR`],
    ['Late instances', `${results.late_instances ?? 0}`],
    ['Max utilisation', `${formatNumber(Math.max(0, ...(results.resource_results || []).map((resource) => Number(resource.utilization_rate || 0))))}%`],
    ['Arrival source', results.arrival_source || '-'],
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
        Arrival source: ${escapeHtml(results.arrival_source || '-')}
      </div>
    </div>

    <div class="metrics">${buildMetricCards(scenario)}</div>

    <div class="section">
      <h2>Task performance</h2>
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
            <th>Tasks handled</th>
            <th>Utilisation</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(results.resource_results || [], [
            { key: 'resource_name' },
            { key: 'quantity' },
            { key: 'total_busy_min', format: (value) => `${formatNumber(value)} min` },
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
          <p>Confidence range: ${escapeHtml(formatNumber(monteCarlo.duration?.ci_low))} - ${escapeHtml(formatNumber(monteCarlo.duration?.ci_high))} min</p>
        </div>
        <div>
          <p>Mean total cost: ${escapeHtml(formatNumber(monteCarlo.total_cost?.mean, 2))} EUR</p>
          <p>Late rate range: ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_low))}% - ${escapeHtml(formatNumber(monteCarlo.late_instance_rate?.ci_high))}%</p>
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
      <h2>Resource planning</h2>
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

function pdfEscape(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildSimulationReportPdf(scenario, extras = {}) {
  const results = scenario.results || {};
  const monteCarlo = extras.monteCarlo || results.monte_carlo || null;
  const sensitivity = extras.sensitivity || results.sensitivity || null;
  const planning = extras.resourcePlanning || results.resource_planning || null;

  const lines = [
    `Simulation report: ${scenario.name || `Scenario #${scenario.id}`}`,
    `Process: ${scenario.process_name || '-'}`,
    `Status: ${scenario.status || 'draft'}`,
    `Average cycle time: ${formatNumber(results.avg_duration_min)} min`,
    `P95 cycle time: ${formatNumber(results.p95_duration_min)} min`,
    `Total cost: ${formatNumber(results.total_cost, 2)} EUR`,
    `Late instance rate: ${formatNumber(results.sla_summary?.late_instance_rate ?? 0)}%`,
    '',
    'Top bottlenecks:',
    ...(results.bottlenecks || []).slice(0, 6).map((entry) => `- ${entry.name}: ${formatNumber(entry.metric)} ${entry.unit}`),
    '',
    'Top tasks:',
    ...(results.task_results || []).slice(0, 8).map(
      (task) =>
        `- ${task.task_name}: avg ${formatNumber(task.avg_duration)} min, wait ${formatNumber(task.avg_wait_min)} min, SLA breaches ${formatNumber(task.sla_breach_rate)}%`
    ),
  ];

  if (monteCarlo) {
    lines.push(
      '',
      `Monte Carlo iterations: ${monteCarlo.iterations}`,
      `Cycle-time CI: ${formatNumber(monteCarlo.duration?.ci_low)} - ${formatNumber(monteCarlo.duration?.ci_high)} min`,
      `Cost CI: ${formatNumber(monteCarlo.total_cost?.ci_low, 2)} - ${formatNumber(monteCarlo.total_cost?.ci_high, 2)} EUR`
    );
  }

  if (sensitivity?.impacts?.length) {
    lines.push('', 'Sensitivity:');
    sensitivity.impacts.slice(0, 5).forEach((impact) => {
      lines.push(`- ${impact.name} (${impact.change}): ${formatNumber(impact.cycle_impact_min)} min`);
    });
  }

  if (planning?.recommendations?.length) {
    lines.push('', 'Resource planning:');
    planning.recommendations.slice(0, 5).forEach((recommendation) => {
      lines.push(
        `- ${recommendation.resource_name}: +${recommendation.add_units} => ${formatNumber(recommendation.projected_avg_duration_min)} min`
      );
    });
  }

  const pages = [];
  const linesPerPage = 42;
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [];

  const objects = [];
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const fontObjectId = 3 + pages.length * 2;

  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  objects.push(`2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n`);

  pages.forEach((pageLines, pageIndex) => {
    const pageId = pageObjectIds[pageIndex];
    const contentId = contentObjectIds[pageIndex];
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >> endobj\n`
    );

    const textCommands = pageLines
      .map((line, lineIndex) => `BT /F1 11 Tf 40 ${780 - lineIndex * 18} Td (${pdfEscape(line)}) Tj ET`)
      .join('\n');
    objects.push(
      `${contentId} 0 obj << /Length ${textCommands.length} >> stream\n${textCommands}\nendstream endobj\n`
    );
  });

  objects.push(`${fontObjectId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`);

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}
