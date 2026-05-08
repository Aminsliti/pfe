import express from 'express';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensureCompanyAccess,
  ensurePermission,
} from '../utils/access.js';
import {
  extractTasksFromDiagram,
  runSimulation,
  runMonteCarloSimulation,
  runResourcePlanning,
  runSensitivityAnalysis,
  runWhatIfAnalysis,
} from '../utils/simulationEngine.js';
import { ensureSimulationSchema } from '../utils/simulationSchema.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { createNotification } from '../utils/collaboration.js';
import {
  buildSimulationExplanation,
  buildSimulationReportExcel,
  buildSimulationReportHtml,
  buildSimulationReportPdf,
} from '../utils/simulationReport.js';

const router = express.Router();
const VALID_STATUSES = new Set(['draft', 'running', 'completed', 'failed']);

const notFound = (res, what = 'Resource') => res.status(404).json({ error: `${what} not found` });
const serverErr = (res, err) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
};

function normalizeStatus(status, fallback = 'draft') {
  if (!status) {
    return fallback;
  }

  if (status === 'error') {
    return 'failed';
  }

  return VALID_STATUSES.has(status) ? status : fallback;
}

async function getProcessForAccess(processId) {
  const result = await pool.query(
    'SELECT id, name, company_id, bpmn_xml FROM processes WHERE id = $1',
    [processId]
  );

  return result.rows[0] || null;
}

async function ensureProcessAccess(req, res, processId) {
  const process = await getProcessForAccess(processId);
  if (!process) {
    notFound(res, 'Process');
    return null;
  }

  if (!ensureCompanyAccess(req, res, process.company_id)) {
    return null;
  }

  return process;
}

async function getScenarioById(id) {
  const result = await pool.query(
    `
      SELECT
        s.*,
        p.name AS process_name,
        p.bpmn_xml,
        p.company_id AS process_company_id,
        u.full_name AS created_by_name
      FROM simulation_scenarios s
      LEFT JOIN processes p ON s.process_id = p.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function ensureScenarioAccess(req, res, scenarioId) {
  const scenario = await getScenarioById(scenarioId);
  if (!scenario) {
    notFound(res, 'Simulation');
    return null;
  }

  if (!ensureCompanyAccess(req, res, scenario.process_company_id)) {
    return null;
  }

  return scenario;
}

async function getScenarioArrivals(scenarioId) {
  const result = await pool.query(
    `
      SELECT
        id,
        scenario_id,
        arrival_order,
        raw_value,
        arrival_at,
        arrival_offset_min
      FROM simulation_arrival_times
      WHERE scenario_id = $1
      ORDER BY arrival_order
    `,
    [scenarioId]
  );

  return result.rows;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (/[;"\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function buildCsvSection(title, headers, rows) {
  if (!rows.length) {
    return '';
  }

  return [
    title,
    headers.join(';'),
    ...rows.map((row) => row.map(escapeCsvValue).join(';')),
  ].join('\r\n');
}

function buildSimulationExportCsv(scenario) {
  const results = scenario.results || {};
  const summaryRows = [
    ['scenario_id', scenario.id],
    ['scenario_name', scenario.name],
    ['process_name', scenario.process_name || ''],
    ['status', scenario.status || results.status || 'draft'],
    ['simulated_at', results.simulated_at || ''],
    ['instances', results.instances ?? ''],
    ['active_instances', results.active_instances ?? ''],
    ['instance_offset_rule', results.instance_offset_rule || ''],
    ['avg_duration_min', results.avg_duration_min ?? ''],
    ['min_duration_min', results.min_duration_min ?? ''],
    ['max_duration_min', results.max_duration_min ?? ''],
    ['p95_duration_min', results.p95_duration_min ?? ''],
    ['p99_duration_min', results.p99_duration_min ?? ''],
    ['total_cost', results.total_cost ?? ''],
    ['avg_cost_per_instance', results.avg_cost_per_instance ?? ''],
    ['simulation_horizon_min', results.simulation_horizon_min ?? ''],
  ];

  const taskRows = Array.isArray(results.task_results)
    ? results.task_results.map((task) => [
        task.task_id,
        task.task_name,
        task.avg_duration,
        task.min_duration,
        task.max_duration,
        task.p95_duration,
        task.avg_wait_min,
        task.executions,
        task.resource_name,
        task.total_cost,
      ])
    : [];

  const resourceRows = Array.isArray(results.resource_results)
    ? results.resource_results.map((resource) => [
        resource.resource_id,
        resource.resource_name,
        resource.quantity,
        resource.availability,
        resource.tasks_handled,
        resource.total_busy_min,
        resource.avg_wait_min,
        resource.utilization_rate,
      ])
    : [];

  const bottleneckRows = Array.isArray(results.bottlenecks)
    ? results.bottlenecks.map((bottleneck) => [
        bottleneck.type,
        bottleneck.name,
        bottleneck.metric,
        bottleneck.unit,
        bottleneck.severity,
        bottleneck.details,
      ])
    : [];

  return [
    'sep=;',
    buildCsvSection('Scenario Summary', ['field', 'value'], summaryRows),
    buildCsvSection(
      'Task Results',
      ['task_id', 'task_name', 'avg_duration', 'min_duration', 'max_duration', 'p95_duration', 'avg_wait_min', 'executions', 'resource_name', 'total_cost'],
      taskRows
    ),
    buildCsvSection(
      'Resource Results',
      ['resource_id', 'resource_name', 'quantity', 'availability', 'tasks_handled', 'total_busy_min', 'avg_wait_min', 'utilization_rate'],
      resourceRows
    ),
    buildCsvSection(
      'Bottlenecks',
      ['type', 'name', 'metric', 'unit', 'severity', 'details'],
      bottleneckRows
    ),
  ]
    .filter(Boolean)
    .join('\r\n\r\n');
}

function compareMetric(label, key, primaryResults = {}, secondaryResults = {}, unit = '') {
  const resolveValue = (results) => {
    if (key === 'max_resource_utilization') {
      return Math.max(0, ...(results?.resource_results || []).map((resource) => Number(resource.utilization_rate ?? 0)));
    }

    return Number(results?.[key] ?? 0);
  };

  const primary = resolveValue(primaryResults);
  const secondary = resolveValue(secondaryResults);

  return {
    key,
    label,
    unit,
    primary,
    secondary,
    delta: Math.round((primary - secondary) * 100) / 100,
  };
}

function buildScenarioComparison(primaryScenario, secondaryScenario) {
  const primaryResults = primaryScenario.results || {};
  const secondaryResults = secondaryScenario.results || {};

  const resourceMap = new Map();
  const addResourceRow = (resource, side) => {
    const key = resource.resource_name || String(resource.resource_id || side);
    const current = resourceMap.get(key) || {
      resource_name: key,
      primary_utilization: null,
      secondary_utilization: null,
      primary_wait: null,
      secondary_wait: null,
      primary_tasks: null,
      secondary_tasks: null,
    };

    current[`${side}_utilization`] = Number(resource.utilization_rate ?? 0);
    current[`${side}_wait`] = Number(resource.avg_wait_min ?? 0);
    current[`${side}_tasks`] = Number(resource.tasks_handled ?? 0);
    resourceMap.set(key, current);
  };

  (primaryResults.resource_results || []).forEach((resource) => addResourceRow(resource, 'primary'));
  (secondaryResults.resource_results || []).forEach((resource) => addResourceRow(resource, 'secondary'));

  const taskMap = new Map();
  const addTaskRow = (task, side) => {
    const key = task.task_id || task.task_name;
    const current = taskMap.get(key) || {
      task_id: key,
      task_name: task.task_name || key,
      primary_duration: null,
      secondary_duration: null,
      primary_wait: null,
      secondary_wait: null,
      primary_cost: null,
      secondary_cost: null,
    };

    current[`${side}_duration`] = Number(task.avg_duration ?? 0);
    current[`${side}_wait`] = Number(task.avg_wait_min ?? 0);
    current[`${side}_cost`] = Number(task.total_cost ?? 0);
    taskMap.set(key, current);
  };

  (primaryResults.task_results || []).forEach((task) => addTaskRow(task, 'primary'));
  (secondaryResults.task_results || []).forEach((task) => addTaskRow(task, 'secondary'));

  const taskDeltas = Array.from(taskMap.values())
    .map((task) => ({
      ...task,
      duration_delta: Math.round(((task.primary_duration ?? 0) - (task.secondary_duration ?? 0)) * 100) / 100,
      wait_delta: Math.round(((task.primary_wait ?? 0) - (task.secondary_wait ?? 0)) * 100) / 100,
      cost_delta: Math.round(((task.primary_cost ?? 0) - (task.secondary_cost ?? 0)) * 100) / 100,
    }))
    .sort((left, right) => Math.abs(right.duration_delta) - Math.abs(left.duration_delta))
    .slice(0, 12);

  return {
    same_process: primaryScenario.process_id === secondaryScenario.process_id,
    primary: {
      id: primaryScenario.id,
      name: primaryScenario.name,
      process_name: primaryScenario.process_name,
      status: primaryScenario.status,
    },
    secondary: {
      id: secondaryScenario.id,
      name: secondaryScenario.name,
      process_name: secondaryScenario.process_name,
      status: secondaryScenario.status,
    },
    summary: [
      compareMetric('Cycle time moyen', 'avg_duration_min', primaryResults, secondaryResults, 'min'),
      compareMetric('P95', 'p95_duration_min', primaryResults, secondaryResults, 'min'),
      compareMetric('Cout total', 'total_cost', primaryResults, secondaryResults, 'EUR'),
      compareMetric('Cout / instance', 'avg_cost_per_instance', primaryResults, secondaryResults, 'EUR'),
      compareMetric('Utilisation max', 'max_resource_utilization', primaryResults, secondaryResults, '%'),
    ],
    resource_comparison: Array.from(resourceMap.values())
      .map((resource) => ({
        ...resource,
        utilization_delta: Math.round(((resource.primary_utilization ?? 0) - (resource.secondary_utilization ?? 0)) * 100) / 100,
      }))
      .sort((left, right) => Math.abs(right.utilization_delta) - Math.abs(left.utilization_delta)),
    bottlenecks: {
      primary: primaryResults.bottlenecks || [],
      secondary: secondaryResults.bottlenecks || [],
    },
    task_comparison: taskDeltas,
  };
}

function safeJsonParse(value, fallbackValue) {
  if (typeof value !== 'string') {
    return value ?? fallbackValue;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

function normalizeInteger(value, fallbackValue = null) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallbackValue;
}

function normalizeCalendarSettingsInput(input = {}) {
  return {
    business_hours: {
      start: String(input?.business_hours?.start || '09:00'),
      end: String(input?.business_hours?.end || '17:00'),
    },
    weekend_days: Array.isArray(input?.weekend_days)
      ? input.weekend_days.map((day) => Number(day)).filter((day) => Number.isInteger(day))
      : [0, 6],
    holidays: Array.isArray(input?.holidays)
      ? input.holidays.map((holiday) => String(holiday).trim()).filter(Boolean)
      : [],
    shifts: Array.isArray(input?.shifts)
      ? input.shifts
          .map((shift) => ({
            start: String(shift?.start || ''),
            end: String(shift?.end || ''),
            ...(Array.isArray(shift?.days) ? { days: shift.days.map((day) => Number(day)).filter((day) => Number.isInteger(day)) } : {}),
          }))
          .filter((shift) => shift.start && shift.end)
      : [],
  };
}

function normalizeAvailabilityWindowsInput(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((window) => ({
      start: String(window?.start || ''),
      end: String(window?.end || ''),
      ...(Array.isArray(window?.days)
        ? { days: window.days.map((day) => Number(day)).filter((day) => Number.isInteger(day)) }
        : {}),
    }))
    .filter((window) => window.start && window.end);
}

function mergeScenarioInsights(results, insights = {}) {
  return {
    ...results,
    ...(insights.monteCarlo ? { monte_carlo: insights.monteCarlo } : {}),
    ...(insights.sensitivity ? { sensitivity: insights.sensitivity } : {}),
    ...(insights.resourcePlanning ? { resource_planning: insights.resourcePlanning } : {}),
  };
}

async function loadScenarioInputs(scenarioId) {
  const [tasks, resources] = await Promise.all([
    pool.query('SELECT * FROM simulation_task_data WHERE scenario_id = $1 ORDER BY id', [scenarioId]),
    pool.query('SELECT * FROM simulation_resources WHERE scenario_id = $1 ORDER BY id', [scenarioId]),
  ]);

  return {
    tasks: tasks.rows.map((task) => ({
      ...task,
      sla_target_min: task.sla_target_min === null || task.sla_target_min === undefined ? null : Number(task.sla_target_min),
    })),
    resources: resources.rows,
    arrivals: [],
  };
}

async function buildScenarioInsights(scenario, inputs) {
  const monteCarloRuns = Math.max(1, Number(scenario?.monte_carlo_runs) || 1);
  const monteCarlo =
    monteCarloRuns > 1
      ? runMonteCarloSimulation({
          scenario,
          tasks: inputs.tasks,
          resources: inputs.resources,
          arrivals: inputs.arrivals,
          iterations: monteCarloRuns,
        })
      : null;

  const sensitivity = runSensitivityAnalysis({
    scenario,
    tasks: inputs.tasks,
    resources: inputs.resources,
    arrivals: inputs.arrivals,
  });

  const worstTaskTarget = Math.max(
    0,
    ...inputs.tasks.map((task) => Number(task.sla_target_min) || 0)
  );
  const resourcePlanning = runResourcePlanning({
    scenario,
    tasks: inputs.tasks,
    resources: inputs.resources,
    arrivals: inputs.arrivals,
    targetCycleTimeMin:
      Number(scenario?.target_cycle_time_min) ||
      (worstTaskTarget > 0 ? worstTaskTarget * Math.max(1, inputs.tasks.length || 1) : 0),
  });

  return {
    monteCarlo,
    sensitivity,
    resourcePlanning,
  };
}

router.use(async (req, res, next) => {
  try {
    await ensureSimulationSchema();
    next();
  } catch (error) {
    console.error('simulation schema error:', error);
    res.status(500).json({ error: 'Failed to prepare simulation storage.' });
  }
});

router.get('/simulations', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { process_id } = req.query;
    const params = [];
    let query = `
      SELECT
        s.*,
        p.name AS process_name,
        u.full_name AS created_by_name
      FROM simulation_scenarios s
      LEFT JOIN processes p ON s.process_id = p.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE 1=1
    `;
    let paramIndex = 1;

    if (process_id) {
      query += ` AND s.process_id = $${paramIndex}`;
      params.push(process_id);
      paramIndex += 1;
    }

    query += ' ORDER BY s.updated_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const [resources, tasks, flows] = await Promise.all([
      pool.query('SELECT * FROM simulation_resources WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
      pool.query('SELECT * FROM simulation_task_data WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
      pool.query('SELECT * FROM simulation_flow_probabilities WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
    ]);

    res.json({
      ...scenario,
      resources: resources.rows.map((resource) => ({
        ...resource,
        availability_windows: [],
      })),
      task_data: tasks.rows.map((task) => ({
        ...task,
        sla_target_min: task.sla_target_min === null || task.sla_target_min === undefined ? null : Number(task.sla_target_min),
      })),
      flow_probs: flows.rows,
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const {
      name,
      description,
      process_id,
      status = 'draft',
      start_date,
      process_instances = 100,
      warmup_percent = 5,
      cooldown_percent = 10,
      infinite_resources = false,
      simulate_all_levels = false,
      monte_carlo_runs = 1,
      notifications_enabled = true,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!process_id) {
      return res.status(400).json({ error: 'process_id is required' });
    }

    const process = await ensureProcessAccess(req, res, process_id);
    if (!process) {
      return;
    }

    const result = await pool.query(
      `
        INSERT INTO simulation_scenarios (
          name,
          description,
          process_id,
          status,
          start_date,
          process_instances,
          warmup_percent,
          cooldown_percent,
          infinite_resources,
          simulate_all_levels,
          import_csv_arrivals,
          calendar_settings,
          monte_carlo_runs,
          notifications_enabled,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
        RETURNING *
      `,
      [
        name,
        description || null,
        process.id,
        normalizeStatus(status),
        start_date || null,
        process_instances,
        warmup_percent,
        cooldown_percent,
        infinite_resources,
        simulate_all_levels,
        false,
        JSON.stringify({}),
        Math.max(1, Number(monte_carlo_runs) || 1),
        notifications_enabled !== false,
        req.user.id,
      ]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: result.rows[0].id,
      companyId: process.company_id,
      action: 'create',
      summary: `Created simulation scenario "${result.rows[0].name}"`,
      details: {
        process_id: process.id,
        status: result.rows[0].status,
      },
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    serverErr(res, error);
  }
});

router.put('/simulations/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const currentScenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!currentScenario) {
      return;
    }

    const {
      name,
      description,
      process_id,
      status,
      start_date,
      process_instances,
      warmup_percent,
      cooldown_percent,
      infinite_resources,
      simulate_all_levels,
      monte_carlo_runs,
      notifications_enabled,
    } = req.body;

    const nextProcess = await ensureProcessAccess(req, res, process_id || currentScenario.process_id);
    if (!nextProcess) {
      return;
    }

    const result = await pool.query(
      `
        UPDATE simulation_scenarios
        SET
          name = $1,
          description = $2,
          process_id = $3,
          status = $4,
          start_date = $5,
          process_instances = $6,
          warmup_percent = $7,
          cooldown_percent = $8,
          infinite_resources = $9,
          simulate_all_levels = $10,
          import_csv_arrivals = $11,
          calendar_settings = $12::jsonb,
          monte_carlo_runs = $13,
          notifications_enabled = $14,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $15
        RETURNING *
      `,
      [
        name,
        description || null,
        nextProcess.id,
        normalizeStatus(status, currentScenario.status),
        start_date || null,
        process_instances,
        warmup_percent,
        cooldown_percent,
        infinite_resources,
        simulate_all_levels,
        false,
        JSON.stringify({}),
        Math.max(1, Number(monte_carlo_runs) || Number(currentScenario.monte_carlo_runs) || 1),
        notifications_enabled ?? currentScenario.notifications_enabled ?? true,
        req.params.id,
      ]
    );

    if (!result.rows.length) {
      return notFound(res, 'Simulation');
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: result.rows[0].id,
      companyId: nextProcess.company_id,
      action: 'update',
      summary: `Updated simulation scenario "${result.rows[0].name}"`,
      details: {
        process_id: nextProcess.id,
        status: result.rows[0].status,
      },
    });

    res.json(result.rows[0]);
  } catch (error) {
    serverErr(res, error);
  }
});

router.delete('/simulations/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    await pool.query('DELETE FROM simulation_scenarios WHERE id = $1', [req.params.id]);
    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: 'delete',
      summary: `Deleted simulation scenario "${scenario.name}"`,
      details: {},
    });
    res.json({ message: 'Simulation deleted' });
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/compare/:otherId', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const primaryScenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!primaryScenario) {
      return;
    }

    const secondaryScenario = await ensureScenarioAccess(req, res, req.params.otherId);
    if (!secondaryScenario) {
      return;
    }

    if (!primaryScenario.results || !secondaryScenario.results) {
      return res.status(400).json({ error: 'Both scenarios need completed results before comparison.' });
    }

    res.json(buildScenarioComparison(primaryScenario, secondaryScenario));
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/arrival-times', async (req, res) => {
  res.status(410).json({ error: 'Arrival imports were removed from the mathematical simulation model.' });
});

router.get('/simulations/:id/export', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    if (!scenario.results) {
      return res.status(400).json({ error: 'No simulation results are available to export.' });
    }

    const filenameBase =
      String(scenario.name || `simulation-${scenario.id}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `simulation-${scenario.id}`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-results.csv"`);
    res.send(`\uFEFF${buildSimulationExportCsv(scenario)}`);
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/sensitivity', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const inputs = await loadScenarioInputs(scenario.id);
    const sensitivity = runSensitivityAnalysis({
      scenario,
      tasks: inputs.tasks,
      resources: inputs.resources,
    });

    res.json(sensitivity);
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/what-if', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const inputs = await loadScenarioInputs(scenario.id);
    const analysis = runWhatIfAnalysis({
      scenario,
      tasks: inputs.tasks,
      resources: inputs.resources,
      overrides: req.body || {},
    });

    res.json(analysis);
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/resource-plan', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const targetCycleTimeMin = Number(req.body?.target_cycle_time_min) || 0;
    const inputs = await loadScenarioInputs(scenario.id);
    const planning = runResourcePlanning({
      scenario,
      tasks: inputs.tasks,
      resources: inputs.resources,
      targetCycleTimeMin,
    });

    res.json(planning);
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/report', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    if (!scenario.results) {
      return res.status(400).json({ error: 'No simulation results are available to report.' });
    }

    const inputs = await loadScenarioInputs(scenario.id);
    const extras = await buildScenarioInsights(scenario, inputs);
    const reportScenario = {
      ...scenario,
      results: mergeScenarioInsights(scenario.results, extras),
    };
    const filenameBase =
      String(scenario.name || `simulation-${scenario.id}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `simulation-${scenario.id}`;
    const format = String(req.query.format || 'html').toLowerCase();

    if (format === 'excel' || format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-report.xls"`);
      return res.send(buildSimulationReportExcel(reportScenario, extras));
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-report.pdf"`);
      return res.send(buildSimulationReportPdf(reportScenario, extras));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-report.html"`);
    res.send(buildSimulationReportHtml(reportScenario, extras));
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/explanation', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const inputs = await loadScenarioInputs(scenario.id);
    const extras = await buildScenarioInsights(scenario, inputs);
    const enrichedScenario = {
      ...scenario,
      results: scenario.results ? mergeScenarioInsights(scenario.results, extras) : scenario.results,
    };

    res.json({
      scenario: enrichedScenario,
      explanation: buildSimulationExplanation(enrichedScenario, extras),
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/arrival-times/import', async (req, res) => {
  res.status(410).json({ error: 'Arrival imports were removed from the mathematical simulation model.' });
});

router.delete('/simulations/:id/arrival-times', async (req, res) => {
  res.status(410).json({ error: 'Arrival imports were removed from the mathematical simulation model.' });
});

router.get('/simulations/:id/resources', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const result = await pool.query(
      'SELECT * FROM simulation_resources WHERE scenario_id = $1 ORDER BY id',
      [scenario.id]
    );

    res.json(
      result.rows.map((resource) => ({
        ...resource,
        availability_windows: [],
      }))
    );
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/resources', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const {
      name,
      resource_type = 'human',
      quantity = 1,
      cost_per_hour = 0,
      availability = 100,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `
        INSERT INTO simulation_resources (
          scenario_id,
          name,
          resource_type,
          quantity,
          cost_per_hour,
          availability,
          availability_windows
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        RETURNING *
      `,
      [
        scenario.id,
        name,
        resource_type,
        quantity,
        cost_per_hour,
        availability,
        JSON.stringify([]),
      ]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: 'resource_create',
      summary: `Added simulation resource "${result.rows[0].name}"`,
      details: {
        resource_id: result.rows[0].id,
      },
    });

    res.status(201).json({
      ...result.rows[0],
      availability_windows: [],
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.put('/simulations/:id/resources/:rid', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const { name, resource_type, quantity, cost_per_hour, availability } = req.body;
    const result = await pool.query(
      `
        UPDATE simulation_resources
        SET
          name = $1,
          resource_type = $2,
          quantity = $3,
          cost_per_hour = $4,
          availability = $5,
          availability_windows = $6::jsonb
        WHERE id = $7 AND scenario_id = $8
        RETURNING *
      `,
      [
        name,
        resource_type,
        quantity,
        cost_per_hour,
        availability,
        JSON.stringify([]),
        req.params.rid,
        scenario.id,
      ]
    );

    if (!result.rows.length) {
      return notFound(res, 'Resource');
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: 'resource_update',
      summary: `Updated simulation resource "${result.rows[0].name}"`,
      details: {
        resource_id: result.rows[0].id,
      },
    });

    res.json({
      ...result.rows[0],
      availability_windows: [],
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.delete('/simulations/:id/resources/:rid', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const result = await pool.query(
      'DELETE FROM simulation_resources WHERE id = $1 AND scenario_id = $2',
      [req.params.rid, scenario.id]
    );

    if (!result.rowCount) {
      return notFound(res, 'Resource');
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: 'resource_delete',
      summary: `Deleted simulation resource #${req.params.rid}`,
      details: {
        resource_id: req.params.rid,
      },
    });

    res.json({ message: 'Resource deleted' });
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/tasks', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const result = await pool.query(
      `
        SELECT td.*, sr.name AS resource_name
        FROM simulation_task_data td
        LEFT JOIN simulation_resources sr ON td.resource_id = sr.id
        WHERE td.scenario_id = $1
        ORDER BY td.id
      `,
      [scenario.id]
    );

    res.json(
      result.rows.map((task) => ({
        ...task,
        sla_target_min: task.sla_target_min === null || task.sla_target_min === undefined ? null : Number(task.sla_target_min),
      }))
    );
  } catch (error) {
    serverErr(res, error);
  }
});

router.put('/simulations/:id/tasks/:taskId', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const {
      task_name,
      duration_min = 0,
      duration_type = 'fixed',
      duration_std = 0,
      resource_id = null,
      cost = 0,
      sla_target_min = null,
    } = req.body;

    const existing = await pool.query(
      'SELECT id FROM simulation_task_data WHERE scenario_id = $1 AND task_id = $2',
      [scenario.id, req.params.taskId]
    );

    let result;
    if (existing.rows.length) {
      result = await pool.query(
        `
          UPDATE simulation_task_data
          SET
            task_name = $1,
            duration_min = $2,
            duration_type = $3,
            duration_std = $4,
            resource_id = $5,
            cost = $6,
            sla_target_min = $7
          WHERE scenario_id = $8 AND task_id = $9
          RETURNING *
        `,
        [
          task_name,
          duration_min,
          duration_type,
          duration_std,
          resource_id,
          cost,
          sla_target_min,
          scenario.id,
          req.params.taskId,
        ]
      );
    } else {
      result = await pool.query(
        `
          INSERT INTO simulation_task_data (
            scenario_id,
            task_id,
            task_name,
            duration_min,
            duration_type,
            duration_std,
            resource_id,
            cost,
            sla_target_min
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          RETURNING *
        `,
        [
          scenario.id,
          req.params.taskId,
          task_name,
          duration_min,
          duration_type,
          duration_std,
          resource_id,
          cost,
          sla_target_min,
        ]
      );
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: existing.rows.length ? 'task_update' : 'task_create',
      summary: `${existing.rows.length ? 'Updated' : 'Added'} simulation task "${result.rows[0].task_name}"`,
      details: {
        task_id: result.rows[0].task_id,
      },
    });

    res.json({
      ...result.rows[0],
      sla_target_min:
        result.rows[0].sla_target_min === null || result.rows[0].sla_target_min === undefined
          ? null
          : Number(result.rows[0].sla_target_min),
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.get('/simulations/:id/flows', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const result = await pool.query(
      'SELECT * FROM simulation_flow_probabilities WHERE scenario_id = $1 ORDER BY id',
      [scenario.id]
    );

    res.json(result.rows);
  } catch (error) {
    serverErr(res, error);
  }
});

router.put('/simulations/:id/flows/:flowId', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const { flow_name, from_element, to_element, probability = 100 } = req.body;
    const existing = await pool.query(
      'SELECT id FROM simulation_flow_probabilities WHERE scenario_id = $1 AND flow_id = $2',
      [scenario.id, req.params.flowId]
    );

    let result;
    if (existing.rows.length) {
      result = await pool.query(
        `
          UPDATE simulation_flow_probabilities
          SET
            flow_name = $1,
            from_element = $2,
            to_element = $3,
            probability = $4
          WHERE scenario_id = $5 AND flow_id = $6
          RETURNING *
        `,
        [flow_name, from_element, to_element, probability, scenario.id, req.params.flowId]
      );
    } else {
      result = await pool.query(
        `
          INSERT INTO simulation_flow_probabilities (
            scenario_id,
            flow_id,
            flow_name,
            from_element,
            to_element,
            probability
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          RETURNING *
        `,
        [scenario.id, req.params.flowId, flow_name, from_element, to_element, probability]
      );
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: existing.rows.length ? 'flow_update' : 'flow_create',
      summary: `${existing.rows.length ? 'Updated' : 'Added'} flow probability "${result.rows[0].flow_id}"`,
      details: {
        flow_id: result.rows[0].flow_id,
      },
    });

    res.json(result.rows[0]);
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/run', async (req, res) => {
  let scenario = null;

  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    await pool.query(
      `
        UPDATE simulation_scenarios
        SET
          status = 'running',
          last_run_started_at = CURRENT_TIMESTAMP,
          last_run_finished_at = NULL,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [scenario.id]
    );

    const existingTasks = await pool.query(
      'SELECT task_id FROM simulation_task_data WHERE scenario_id = $1',
      [scenario.id]
    );
    const existingIds = new Set(existingTasks.rows.map((row) => row.task_id));
    const bpmnTasks = extractTasksFromDiagram(scenario.bpmn_xml);

    for (const task of bpmnTasks) {
      if (existingIds.has(task.task_id)) {
        continue;
      }

      await pool.query(
        `
          INSERT INTO simulation_task_data (
            scenario_id,
            task_id,
            task_name,
            duration_min,
            duration_type,
            duration_std,
            cost
          )
          SELECT
            $1::integer,
            $2::varchar(255),
            $3::varchar(255),
            $4::numeric,
            $5::varchar(50),
            $6::numeric,
            $7::numeric
          WHERE NOT EXISTS (
            SELECT 1
            FROM simulation_task_data
            WHERE scenario_id = $1::integer AND task_id = $2::varchar(255)
          )
        `,
        [
          scenario.id,
          task.task_id,
          task.task_name,
          task.duration_min,
          task.duration_type,
          task.duration_std,
          task.cost,
        ]
      );
    }

    const [tasks, resources] = await Promise.all([
      pool.query('SELECT * FROM simulation_task_data WHERE scenario_id = $1', [scenario.id]),
      pool.query('SELECT * FROM simulation_resources WHERE scenario_id = $1', [scenario.id]),
    ]);

    const normalizedScenario = {
      ...scenario,
      process_instances: scenario.process_instances,
    };
    const normalizedTasks = tasks.rows.map((task) => ({
      ...task,
      sla_target_min: task.sla_target_min === null || task.sla_target_min === undefined ? null : Number(task.sla_target_min),
    }));
    const normalizedResources = resources.rows;

    const results = runSimulation({
      scenario: normalizedScenario,
      tasks: normalizedTasks,
      resources: normalizedResources,
    });
    const insights = await buildScenarioInsights(normalizedScenario, {
      tasks: normalizedTasks,
      resources: normalizedResources,
    });
    const enrichedResults = mergeScenarioInsights(results, insights);

    await pool.query(
      `
        UPDATE simulation_scenarios
        SET
          status = 'completed',
          results = $1,
          process_instances = $2,
          last_run_finished_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [JSON.stringify(enrichedResults), enrichedResults.instances, scenario.id]
    );

    const updatedScenario = await getScenarioById(scenario.id);

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: scenario.id,
      companyId: scenario.process_company_id,
      action: 'run_complete',
      summary: `Completed simulation "${scenario.name}"`,
      details: {
        avg_duration_min: enrichedResults.avg_duration_min,
        total_cost: enrichedResults.total_cost,
      },
    });

    if ((enrichedResults.sla_summary?.late_instance_rate || 0) > 0 && scenario.notifications_enabled !== false) {
      await createNotification({
        companyId: scenario.process_company_id,
        type: 'simulation_sla_alert',
        title: 'Simulation breached SLA',
        message: `${scenario.name} reports ${enrichedResults.sla_summary.late_instance_rate}% late instances.`,
        entityType: 'simulation',
        entityId: scenario.id,
        severity: 'warning',
      });
    }

    res.json({
      message: 'Simulation completed',
      status: 'completed',
      scenario: updatedScenario,
      results: enrichedResults,
    });
  } catch (error) {
    try {
      await pool.query(
        `
          UPDATE simulation_scenarios
          SET
            status = 'failed',
            last_run_finished_at = CURRENT_TIMESTAMP,
            last_error = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
        `,
        [error.message || 'Simulation failed.', req.params.id]
      );
    } catch {
      // Ignore follow-up status update failures so we can return the original error.
    }

    const statusCode = 500;

    console.error(error);

    await logAuditEvent({
      actor: req.user,
      entityType: 'simulation',
      entityId: req.params.id,
      companyId: scenario?.process_company_id ?? req.user.companyId ?? null,
      action: 'run_failed',
      summary: `Simulation #${req.params.id} failed`,
      details: {
        error: error.message || 'Simulation failed.',
      },
    });

    if (scenario?.notifications_enabled !== false) {
      await createNotification({
        companyId: scenario?.process_company_id ?? req.user.companyId ?? null,
        type: 'simulation_failed',
        title: 'Simulation failed',
        message: `${scenario?.name || `Simulation #${req.params.id}`} failed: ${error.message || 'Simulation failed.'}`,
        entityType: 'simulation',
        entityId: req.params.id,
        severity: 'danger',
      });
    }

    res.status(statusCode).json({ error: error.message || 'Simulation failed.' });
  }
});

export default router;
