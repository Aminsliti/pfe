import pool from '../db.js';

let schemaPromise = null;

export async function ensureSimulationSchema() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS import_csv_arrivals BOOLEAN DEFAULT FALSE
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS last_run_started_at TIMESTAMP
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS last_run_finished_at TIMESTAMP
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS last_error TEXT
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS calendar_settings JSONB DEFAULT '{}'::jsonb
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS monte_carlo_runs INTEGER DEFAULT 1
      `);

      await pool.query(`
        ALTER TABLE simulation_scenarios
        ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE
      `);

      await pool.query(`
        ALTER TABLE simulation_resources
        ADD COLUMN IF NOT EXISTS availability_windows JSONB DEFAULT '[]'::jsonb
      `);

      await pool.query(`
        ALTER TABLE simulation_task_data
        ADD COLUMN IF NOT EXISTS sla_target_min NUMERIC(10,2)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS simulation_arrival_times (
          id SERIAL PRIMARY KEY,
          scenario_id INTEGER NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
          arrival_order INTEGER NOT NULL,
          raw_value VARCHAR(255),
          arrival_at TIMESTAMP,
          arrival_offset_min NUMERIC(12,2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_arrival_times_scenario
        ON simulation_arrival_times(scenario_id, arrival_order)
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

export default ensureSimulationSchema;
