-- ═══════════════════════════════════════════════════════════
-- Migration : Scénarios de simulation
-- À exécuter via :  node server/migrate-simulations.js
-- ═══════════════════════════════════════════════════════════

-- Table principale des scénarios
CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id                    SERIAL PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  description           TEXT,
  process_id            INTEGER REFERENCES processes(id) ON DELETE CASCADE,
  status                VARCHAR(50)  DEFAULT 'draft',   -- draft | running | completed | error

  -- Paramètres généraux
  start_date            DATE,
  process_instances     INTEGER      DEFAULT 100,
  warmup_percent        NUMERIC(5,2) DEFAULT 5,
  cooldown_percent      NUMERIC(5,2) DEFAULT 10,
  infinite_resources    BOOLEAN      DEFAULT FALSE,
  simulate_all_levels   BOOLEAN      DEFAULT FALSE,
  import_csv_arrivals   BOOLEAN      DEFAULT FALSE,

  -- Résultats (stockés en JSON après exécution)
  results               JSONB,

  created_by            INTEGER REFERENCES users(id),
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ressources du scénario (RH, machines…)
CREATE TABLE IF NOT EXISTS simulation_resources (
  id              SERIAL PRIMARY KEY,
  scenario_id     INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  resource_type   VARCHAR(50)  DEFAULT 'human',   -- human | machine | system
  quantity        INTEGER      DEFAULT 1,
  cost_per_hour   NUMERIC(10,2) DEFAULT 0,
  availability    NUMERIC(5,2)  DEFAULT 100,       -- % disponibilité
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Données de simulation par tâche
CREATE TABLE IF NOT EXISTS simulation_task_data (
  id              SERIAL PRIMARY KEY,
  scenario_id     INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  task_id         VARCHAR(255) NOT NULL,   -- id de l'élément BPMN
  task_name       VARCHAR(255),
  duration_min    NUMERIC(10,2) DEFAULT 0,  -- minutes
  duration_type   VARCHAR(50)   DEFAULT 'fixed',  -- fixed | normal | uniform | exponential
  duration_std    NUMERIC(10,2) DEFAULT 0,  -- écart-type si normal
  resource_id     INTEGER REFERENCES simulation_resources(id) ON DELETE SET NULL,
  cost            NUMERIC(10,2) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Probabilités des enchainements (pour les gateways)
CREATE TABLE IF NOT EXISTS simulation_flow_probabilities (
  id              SERIAL PRIMARY KEY,
  scenario_id     INTEGER REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
  flow_id         VARCHAR(255) NOT NULL,   -- id du sequenceFlow BPMN
  flow_name       VARCHAR(255),
  from_element    VARCHAR(255),
  to_element      VARCHAR(255),
  probability     NUMERIC(5,2) DEFAULT 100,  -- % de 0 à 100
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_process ON simulation_scenarios(process_id);
CREATE INDEX IF NOT EXISTS idx_sim_resources_scenario ON simulation_resources(scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_task_data_scenario ON simulation_task_data(scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_flow_prob_scenario ON simulation_flow_probabilities(scenario_id);
