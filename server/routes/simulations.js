// server/routes/simulations.js
import express from 'express';
import pool    from '../db.js';

const router = express.Router();

// ─── helpers ─────────────────────────────────────────────────────────────────
const notFound = (res, what = 'Resource') => res.status(404).json({ error: `${what} not found` });
const serverErr = (res, err) => { console.error(err); res.status(500).json({ error: 'Server error' }); };

// ══════════════════════════════════════════════════════════════════════════════
//  SCÉNARIOS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/simulations  — liste (filtre optionnel par process_id)
router.get('/simulations', async (req, res) => {
  try {
    const { process_id } = req.query;
    let q = `
      SELECT s.*, p.name AS process_name, u.full_name AS created_by_name
      FROM simulation_scenarios s
      LEFT JOIN processes p ON s.process_id = p.id
      LEFT JOIN users     u ON s.created_by  = u.id
      WHERE 1=1
    `;
    const params = [];
    if (process_id) { q += ` AND s.process_id = $1`; params.push(process_id); }
    q += ' ORDER BY s.updated_at DESC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) { serverErr(res, err); }
});

// GET /api/simulations/:id  — détail complet
router.get('/simulations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sc = await pool.query(`
      SELECT s.*, p.name AS process_name, u.full_name AS created_by_name
      FROM simulation_scenarios s
      LEFT JOIN processes p ON s.process_id = p.id
      LEFT JOIN users     u ON s.created_by  = u.id
      WHERE s.id = $1`, [id]);
    if (!sc.rows.length) return notFound(res, 'Simulation');

    const [resources, tasks, flows] = await Promise.all([
      pool.query('SELECT * FROM simulation_resources          WHERE scenario_id=$1 ORDER BY id', [id]),
      pool.query('SELECT * FROM simulation_task_data          WHERE scenario_id=$1 ORDER BY id', [id]),
      pool.query('SELECT * FROM simulation_flow_probabilities WHERE scenario_id=$1 ORDER BY id', [id]),
    ]);

    res.json({
      ...sc.rows[0],
      resources:   resources.rows,
      task_data:   tasks.rows,
      flow_probs:  flows.rows,
    });
  } catch (err) { serverErr(res, err); }
});

// POST /api/simulations  — créer
router.post('/simulations', async (req, res) => {
  try {
    const {
      name, description, process_id, status = 'draft',
      start_date, process_instances = 100,
      warmup_percent = 5, cooldown_percent = 10,
      infinite_resources = false, simulate_all_levels = false,
      import_csv_arrivals = false,
    } = req.body;
    const created_by = req.user?.id || 1;

    if (!name)       return res.status(400).json({ error: 'Name is required' });
    if (!process_id) return res.status(400).json({ error: 'process_id is required' });

    const result = await pool.query(`
      INSERT INTO simulation_scenarios
        (name, description, process_id, status, start_date, process_instances,
         warmup_percent, cooldown_percent, infinite_resources, simulate_all_levels,
         import_csv_arrivals, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [name, description || null, process_id, status,
       start_date || null, process_instances,
       warmup_percent, cooldown_percent,
       infinite_resources, simulate_all_levels, import_csv_arrivals,
       created_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { serverErr(res, err); }
});

// PUT /api/simulations/:id  — mettre à jour les paramètres généraux
router.put('/simulations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, description, process_id, status,
      start_date, process_instances,
      warmup_percent, cooldown_percent,
      infinite_resources, simulate_all_levels, import_csv_arrivals,
    } = req.body;

    const result = await pool.query(`
      UPDATE simulation_scenarios SET
        name                = $1,
        description         = $2,
        process_id          = $3,
        status              = $4,
        start_date          = $5,
        process_instances   = $6,
        warmup_percent      = $7,
        cooldown_percent    = $8,
        infinite_resources  = $9,
        simulate_all_levels = $10,
        import_csv_arrivals = $11,
        updated_at          = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *`,
      [name, description || null, process_id, status,
       start_date || null, process_instances,
       warmup_percent, cooldown_percent,
       infinite_resources, simulate_all_levels, import_csv_arrivals,
       id]
    );
    if (!result.rows.length) return notFound(res, 'Simulation');
    res.json(result.rows[0]);
  } catch (err) { serverErr(res, err); }
});

// DELETE /api/simulations/:id
router.delete('/simulations/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM simulation_scenarios WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return notFound(res, 'Simulation');
    res.json({ message: 'Simulation deleted' });
  } catch (err) { serverErr(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RESSOURCES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/simulations/:id/resources', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM simulation_resources WHERE scenario_id=$1 ORDER BY id',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { serverErr(res, err); }
});

router.post('/simulations/:id/resources', async (req, res) => {
  try {
    const { name, resource_type='human', quantity=1, cost_per_hour=0, availability=100 } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const r = await pool.query(`
      INSERT INTO simulation_resources (scenario_id,name,resource_type,quantity,cost_per_hour,availability)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, name, resource_type, quantity, cost_per_hour, availability]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { serverErr(res, err); }
});

router.put('/simulations/:id/resources/:rid', async (req, res) => {
  try {
    const { name, resource_type, quantity, cost_per_hour, availability } = req.body;
    const r = await pool.query(`
      UPDATE simulation_resources SET name=$1,resource_type=$2,quantity=$3,cost_per_hour=$4,availability=$5
      WHERE id=$6 AND scenario_id=$7 RETURNING *`,
      [name, resource_type, quantity, cost_per_hour, availability, req.params.rid, req.params.id]
    );
    if (!r.rows.length) return notFound(res, 'Resource');
    res.json(r.rows[0]);
  } catch (err) { serverErr(res, err); }
});

router.delete('/simulations/:id/resources/:rid', async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM simulation_resources WHERE id=$1 AND scenario_id=$2',
      [req.params.rid, req.params.id]
    );
    if (!r.rowCount) return notFound(res, 'Resource');
    res.json({ message: 'Resource deleted' });
  } catch (err) { serverErr(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  DONNÉES DE SIMULATION DES TÂCHES
// ══════════════════════════════════════════════════════════════════════════════

router.get('/simulations/:id/tasks', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT td.*, sr.name AS resource_name
       FROM simulation_task_data td
       LEFT JOIN simulation_resources sr ON td.resource_id = sr.id
       WHERE td.scenario_id=$1 ORDER BY td.id`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { serverErr(res, err); }
});

// Upsert tâche (créer ou mettre à jour par task_id)
router.put('/simulations/:id/tasks/:taskId', async (req, res) => {
  try {
    const { task_name, duration_min=0, duration_type='fixed', duration_std=0, resource_id=null, cost=0 } = req.body;
    const { id: scenario_id, taskId: task_id } = req.params;

    const existing = await pool.query(
      'SELECT id FROM simulation_task_data WHERE scenario_id=$1 AND task_id=$2',
      [scenario_id, task_id]
    );

    let result;
    if (existing.rows.length) {
      result = await pool.query(`
        UPDATE simulation_task_data SET
          task_name=$1, duration_min=$2, duration_type=$3,
          duration_std=$4, resource_id=$5, cost=$6
        WHERE scenario_id=$7 AND task_id=$8 RETURNING *`,
        [task_name, duration_min, duration_type, duration_std, resource_id, cost, scenario_id, task_id]
      );
    } else {
      result = await pool.query(`
        INSERT INTO simulation_task_data
          (scenario_id,task_id,task_name,duration_min,duration_type,duration_std,resource_id,cost)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [scenario_id, task_id, task_name, duration_min, duration_type, duration_std, resource_id, cost]
      );
    }
    res.json(result.rows[0]);
  } catch (err) { serverErr(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  PROBABILITÉS DES ENCHAINEMENTS
// ══════════════════════════════════════════════════════════════════════════════

router.get('/simulations/:id/flows', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM simulation_flow_probabilities WHERE scenario_id=$1 ORDER BY id',
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { serverErr(res, err); }
});

// Upsert flux par flow_id
router.put('/simulations/:id/flows/:flowId', async (req, res) => {
  try {
    const { flow_name, from_element, to_element, probability=100 } = req.body;
    const { id: scenario_id, flowId: flow_id } = req.params;

    const existing = await pool.query(
      'SELECT id FROM simulation_flow_probabilities WHERE scenario_id=$1 AND flow_id=$2',
      [scenario_id, flow_id]
    );

    let result;
    if (existing.rows.length) {
      result = await pool.query(`
        UPDATE simulation_flow_probabilities SET
          flow_name=$1, from_element=$2, to_element=$3, probability=$4
        WHERE scenario_id=$5 AND flow_id=$6 RETURNING *`,
        [flow_name, from_element, to_element, probability, scenario_id, flow_id]
      );
    } else {
      result = await pool.query(`
        INSERT INTO simulation_flow_probabilities
          (scenario_id,flow_id,flow_name,from_element,to_element,probability)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [scenario_id, flow_id, flow_name, from_element, to_element, probability]
      );
    }
    res.json(result.rows[0]);
  } catch (err) { serverErr(res, err); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  SIMULATION — lancer et stocker les résultats
// ══════════════════════════════════════════════════════════════════════════════

router.post('/simulations/:id/run', async (req, res) => {
  try {
    const { id } = req.params;

    // Marquer comme en cours
    await pool.query(
      "UPDATE simulation_scenarios SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=$1",
      [id]
    );

    // Récupérer toutes les données
    const [sc, tasks, resources, flows] = await Promise.all([
      pool.query('SELECT * FROM simulation_scenarios WHERE id=$1', [id]),
      pool.query('SELECT * FROM simulation_task_data WHERE scenario_id=$1', [id]),
      pool.query('SELECT * FROM simulation_resources WHERE scenario_id=$1', [id]),
      pool.query('SELECT * FROM simulation_flow_probabilities WHERE scenario_id=$1', [id]),
    ]);

    if (!sc.rows.length) return notFound(res, 'Simulation');
    const scenario = sc.rows[0];

    // ── Moteur de simulation (Monte Carlo simplifié) ──────────────────────
    const taskList   = tasks.rows;
    const flowList   = flows.rows;
    const N          = scenario.process_instances;
    const warmup     = Math.floor(N * (scenario.warmup_percent / 100));
    const cooldown   = Math.floor(N * (scenario.cooldown_percent / 100));
    const activeN    = N - warmup - cooldown;

    const sample = (type, mean, std) => {
      switch (type) {
        case 'normal': {
          // Box-Muller
          const u1 = Math.random(), u2 = Math.random();
          const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          return Math.max(0, mean + std * z);
        }
        case 'uniform':     return mean * 0.5 + Math.random() * mean;
        case 'exponential': return -mean * Math.log(Math.random());
        default:            return mean; // fixed
      }
    };

    // Simuler chaque instance
    const instanceDurations = [];
    const taskStats = {};
    taskList.forEach(t => { taskStats[t.task_id] = { durations: [], count: 0 }; });

    for (let i = 0; i < N; i++) {
      let totalDuration = 0;
      for (const t of taskList) {
        const d = sample(t.duration_type, +t.duration_min, +t.duration_std);
        totalDuration += d;
        if (taskStats[t.task_id]) {
          taskStats[t.task_id].durations.push(d);
          taskStats[t.task_id].count++;
        }
      }
      instanceDurations.push(totalDuration);
    }

    // Statistiques globales (excluant warmup/cooldown)
    const active = instanceDurations.slice(warmup, N - cooldown);
    const avg    = active.reduce((a, b) => a + b, 0) / (active.length || 1);
    const sorted = [...active].sort((a, b) => a - b);
    const p95    = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const p99    = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const minD   = Math.min(...active);
    const maxD   = Math.max(...active);

    // Statistiques par tâche
    const taskResults = taskList.map(t => {
      const arr   = taskStats[t.task_id]?.durations ?? [];
      const tAvg  = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
      const tSorted = [...arr].sort((a, b) => a - b);
      const res   = resources.find(r => r.id === t.resource_id);
      const totalCost = tAvg * (N / 60) * (+t.cost || 0); // durée en heures * coût
      return {
        task_id:       t.task_id,
        task_name:     t.task_name,
        avg_duration:  Math.round(tAvg * 10) / 10,
        min_duration:  Math.round((Math.min(...arr) || 0) * 10) / 10,
        max_duration:  Math.round((Math.max(...arr) || 0) * 10) / 10,
        p95_duration:  Math.round((tSorted[Math.floor(tSorted.length * 0.95)] ?? 0) * 10) / 10,
        resource_name: res?.name ?? null,
        total_cost:    Math.round(totalCost * 100) / 100,
      };
    });

    // Coût total
    const totalCost = taskResults.reduce((s, t) => s + t.total_cost, 0);

    // Résultats finaux
    const results = {
      simulated_at:       new Date().toISOString(),
      instances:          N,
      active_instances:   activeN,
      avg_duration_min:   Math.round(avg * 10) / 10,
      min_duration_min:   Math.round(minD * 10) / 10,
      max_duration_min:   Math.round(maxD * 10) / 10,
      p95_duration_min:   Math.round(p95 * 10) / 10,
      p99_duration_min:   Math.round(p99 * 10) / 10,
      total_cost:         Math.round(totalCost * 100) / 100,
      task_results:       taskResults,
      histogram:          buildHistogram(active, 10),
    };

    // Persister les résultats
    await pool.query(
      "UPDATE simulation_scenarios SET status='completed', results=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2",
      [JSON.stringify(results), id]
    );

    res.json({ message: 'Simulation completed', results });
  } catch (err) {
    await pool.query(
      "UPDATE simulation_scenarios SET status='error', updated_at=CURRENT_TIMESTAMP WHERE id=$1",
      [req.params.id]
    ).catch(() => {});
    serverErr(res, err);
  }
});

// ─── Histogramme helper ───────────────────────────────────────────────────────
function buildHistogram(values, buckets = 10) {
  if (!values.length) return [];
  const min  = Math.min(...values);
  const max  = Math.max(...values);
  const step = (max - min) / buckets || 1;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    label: `${Math.round(min + i * step)}–${Math.round(min + (i + 1) * step)}`,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / step), buckets - 1);
    bins[idx].count++;
  }
  return bins;
}

export default router;
