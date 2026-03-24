import express from 'express';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensureCompanyAccess,
  ensurePermission,
  isGlobalAdmin,
} from '../utils/access.js';

const router = express.Router();

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

const notFound = (res, what = 'Resource') => res.status(404).json({ error: `${what} not found` });
const serverErr = (res, err) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
};

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

function createDefaultTask(taskId, taskName) {
  return {
    task_id: taskId,
    task_name: taskName || taskId,
    duration_min: 30,
    duration_type: 'fixed',
    duration_std: 0,
    cost: 0,
  };
}

function extractTasksFromLegacyJson(definition) {
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

function extractTasksFromBpmn(bpmnXml) {
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

function extractTasksFromDiagram(definition) {
  const legacyTasks = extractTasksFromLegacyJson(definition);
  if (legacyTasks.length > 0) {
    return legacyTasks;
  }

  return extractTasksFromBpmn(definition);
}

function buildHistogram(values, buckets = 10) {
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

    if (!isGlobalAdmin(req.user)) {
      if (!req.user.companyId) {
        return res.json([]);
      }

      query += ` AND p.company_id = $${paramIndex}`;
      params.push(req.user.companyId);
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
      resources: resources.rows,
      task_data: tasks.rows,
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
      import_csv_arrivals = false,
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
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `,
      [
        name,
        description || null,
        process.id,
        status,
        start_date || null,
        process_instances,
        warmup_percent,
        cooldown_percent,
        infinite_resources,
        simulate_all_levels,
        import_csv_arrivals,
        req.user.id,
      ]
    );

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
      import_csv_arrivals,
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
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12
        RETURNING *
      `,
      [
        name,
        description || null,
        nextProcess.id,
        status,
        start_date || null,
        process_instances,
        warmup_percent,
        cooldown_percent,
        infinite_resources,
        simulate_all_levels,
        import_csv_arrivals,
        req.params.id,
      ]
    );

    if (!result.rows.length) {
      return notFound(res, 'Simulation');
    }

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
    res.json({ message: 'Simulation deleted' });
  } catch (error) {
    serverErr(res, error);
  }
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

    res.json(result.rows);
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
          availability
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
      `,
      [scenario.id, name, resource_type, quantity, cost_per_hour, availability]
    );

    res.status(201).json(result.rows[0]);
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
          availability = $5
        WHERE id = $6 AND scenario_id = $7
        RETURNING *
      `,
      [name, resource_type, quantity, cost_per_hour, availability, req.params.rid, scenario.id]
    );

    if (!result.rows.length) {
      return notFound(res, 'Resource');
    }

    res.json(result.rows[0]);
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

    res.json(result.rows);
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
            cost = $6
          WHERE scenario_id = $7 AND task_id = $8
          RETURNING *
        `,
        [
          task_name,
          duration_min,
          duration_type,
          duration_std,
          resource_id,
          cost,
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
            cost
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
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
        ]
      );
    }

    res.json(result.rows[0]);
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

    res.json(result.rows[0]);
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/run', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    await pool.query(
      "UPDATE simulation_scenarios SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
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

    const taskList = tasks.rows;
    const resourceList = resources.rows;
    const totalInstances = Number(scenario.process_instances) || 0;
    const warmup = Math.floor(totalInstances * (scenario.warmup_percent / 100));
    const cooldown = Math.floor(totalInstances * (scenario.cooldown_percent / 100));
    const activeInstances = totalInstances - warmup - cooldown;

    const sample = (type, mean, std) => {
      switch (type) {
        case 'normal': {
          const u1 = Math.random();
          const u2 = Math.random();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          return Math.max(0, mean + std * z);
        }
        case 'uniform':
          return mean * 0.5 + Math.random() * mean;
        case 'exponential':
          return -mean * Math.log(Math.random());
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
    const results = {
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

    await pool.query(
      "UPDATE simulation_scenarios SET status = 'completed', results = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [JSON.stringify(results), scenario.id]
    );

    res.json({ message: 'Simulation completed', results });
  } catch (error) {
    await pool
      .query(
        "UPDATE simulation_scenarios SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [req.params.id]
      )
      .catch(() => {});

    serverErr(res, error);
  }
});

export default router;
