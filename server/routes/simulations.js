import express from 'express';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensureCompanyAccess,
  ensurePermission,
  isGlobalAdmin,
} from '../utils/access.js';
import { parseArrivalCsv } from '../utils/simulationCsv.js';
import {
  extractTasksFromDiagram,
  runSimulation,
} from '../utils/simulationEngine.js';
import { ensureSimulationSchema } from '../utils/simulationSchema.js';

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

    const [resources, tasks, flows, arrivals] = await Promise.all([
      pool.query('SELECT * FROM simulation_resources WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
      pool.query('SELECT * FROM simulation_task_data WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
      pool.query('SELECT * FROM simulation_flow_probabilities WHERE scenario_id = $1 ORDER BY id', [req.params.id]),
      getScenarioArrivals(req.params.id),
    ]);

    res.json({
      ...scenario,
      resources: resources.rows,
      task_data: tasks.rows,
      flow_probs: flows.rows,
      arrival_times: arrivals,
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
        normalizeStatus(status),
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
        normalizeStatus(status, currentScenario.status),
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

router.get('/simulations/:id/arrival-times', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const arrivals = await getScenarioArrivals(scenario.id);
    res.json({
      count: arrivals.length,
      arrivals,
    });
  } catch (error) {
    serverErr(res, error);
  }
});

router.post('/simulations/:id/arrival-times/import', async (req, res) => {
  const client = await pool.connect();

  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    const csvText = String(req.body?.csvText || '');
    if (!csvText.trim()) {
      return res.status(400).json({ error: 'csvText is required.' });
    }

    const arrivals = parseArrivalCsv(csvText);

    await client.query('BEGIN');
    await client.query('DELETE FROM simulation_arrival_times WHERE scenario_id = $1', [scenario.id]);

    for (const arrival of arrivals) {
      await client.query(
        `
          INSERT INTO simulation_arrival_times (
            scenario_id,
            arrival_order,
            raw_value,
            arrival_at,
            arrival_offset_min
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          scenario.id,
          arrival.arrivalOrder,
          arrival.rawValue,
          arrival.arrivalAt,
          arrival.arrivalOffsetMin,
        ]
      );
    }

    await client.query(
      `
        UPDATE simulation_scenarios
        SET
          import_csv_arrivals = TRUE,
          process_instances = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `,
      [arrivals.length, scenario.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Arrival times imported successfully.',
      count: arrivals.length,
      arrivals,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures.
    }

    if (error.message?.includes('CSV') || error.message?.includes('arrival')) {
      return res.status(400).json({ error: error.message });
    }

    serverErr(res, error);
  } finally {
    client.release();
  }
});

router.delete('/simulations/:id/arrival-times', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const scenario = await ensureScenarioAccess(req, res, req.params.id);
    if (!scenario) {
      return;
    }

    await pool.query('DELETE FROM simulation_arrival_times WHERE scenario_id = $1', [scenario.id]);
    await pool.query(
      `
        UPDATE simulation_scenarios
        SET import_csv_arrivals = FALSE,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [scenario.id]
    );

    res.json({ message: 'Imported arrival times cleared.' });
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

    const [tasks, resources, arrivals] = await Promise.all([
      pool.query('SELECT * FROM simulation_task_data WHERE scenario_id = $1', [scenario.id]),
      pool.query('SELECT * FROM simulation_resources WHERE scenario_id = $1', [scenario.id]),
      scenario.import_csv_arrivals ? getScenarioArrivals(scenario.id) : Promise.resolve([]),
    ]);

    if (scenario.import_csv_arrivals && arrivals.length === 0) {
      throw new Error('CSV arrivals are enabled but no arrival times have been imported.');
    }

    const results = runSimulation({
      scenario: {
        ...scenario,
        process_instances: scenario.import_csv_arrivals ? arrivals.length : scenario.process_instances,
      },
      tasks: tasks.rows,
      resources: resources.rows,
      arrivals,
    });

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
      [JSON.stringify(results), results.instances, scenario.id]
    );

    const updatedScenario = await getScenarioById(scenario.id);

    res.json({
      message: 'Simulation completed',
      status: 'completed',
      scenario: updatedScenario,
      results,
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

    const statusCode =
      error.message?.includes('CSV arrivals') || error.message?.includes('arrival')
        ? 400
        : 500;

    console.error(error);
    res.status(statusCode).json({ error: error.message || 'Simulation failed.' });
  }
});

export default router;
