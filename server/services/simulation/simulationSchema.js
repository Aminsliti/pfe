import pool from '../../db.js';

let schemaPromise = null;

export async function ensureSimulationSchema() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS simulation_scenarios (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
          status VARCHAR(50) DEFAULT 'draft',
          start_date DATE,
          process_instances INTEGER DEFAULT 100,
          warmup_percent NUMERIC(5,2) DEFAULT 5,
          cooldown_percent NUMERIC(5,2) DEFAULT 10,
          infinite_resources BOOLEAN DEFAULT FALSE,
          simulate_all_levels BOOLEAN DEFAULT FALSE,
          import_csv_arrivals BOOLEAN DEFAULT FALSE,
          results JSONB,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_run_started_at TIMESTAMP,
          last_run_finished_at TIMESTAMP,
          last_error TEXT,
          calendar_settings JSONB DEFAULT '{}'::jsonb,
          monte_carlo_runs INTEGER DEFAULT 1,
          notifications_enabled BOOLEAN DEFAULT TRUE
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS simulation_resources (
          id SERIAL PRIMARY KEY,
          scenario_id INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          resource_type VARCHAR(50) DEFAULT 'human',
          quantity INTEGER DEFAULT 1,
          cost_per_hour NUMERIC(10,2) DEFAULT 0,
          availability NUMERIC(5,2) DEFAULT 100,
          availability_windows JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS simulation_task_data (
          id SERIAL PRIMARY KEY,
          scenario_id INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
          task_id VARCHAR(255) NOT NULL,
          task_name VARCHAR(255),
          duration_min NUMERIC(10,2) DEFAULT 0,
          duration_type VARCHAR(50) DEFAULT 'fixed',
          duration_std NUMERIC(10,2) DEFAULT 0,
          resource_id INTEGER REFERENCES simulation_resources(id) ON DELETE SET NULL,
          cost NUMERIC(10,2) DEFAULT 0,
          sla_target_min NUMERIC(10,2),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS simulation_flow_probabilities (
          id SERIAL PRIMARY KEY,
          scenario_id INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
          flow_id VARCHAR(255) NOT NULL,
          flow_name VARCHAR(255),
          from_element VARCHAR(255),
          to_element VARCHAR(255),
          probability NUMERIC(5,2) DEFAULT 100,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_scenarios_process
        ON simulation_scenarios(process_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_resources_scenario
        ON simulation_resources(scenario_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_task_data_scenario
        ON simulation_task_data(scenario_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_flow_prob_scenario
        ON simulation_flow_probabilities(scenario_id)
      `);

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
