import pool from './server/db.js';
import { ensureSimulationSchema } from './server/utils/simulationSchema.js';
import {
  extractTasksFromDiagram,
  runMonteCarloSimulation,
  runResourcePlanning,
  runSensitivityAnalysis,
  runSimulation,
} from './server/utils/simulationEngine.js';

const PROCESS_NAME = 'purchase request control demo';
const SCENARIO_NAME = 'Purchase Request Control Demo - Baseline';
const TARGET_CYCLE_TIME_MIN = 180;
const CALENDAR_STANDARD = {
  business_hours: { start: '08:00', end: '16:30' },
  weekend_days: [0, 6],
  holidays: [],
  shifts: [
    { start: '08:00', end: '12:30', days: [1, 2, 3, 4, 5] },
    { start: '13:00', end: '16:30', days: [1, 2, 3, 4, 5] },
  ],
};

const RESOURCE_DEFINITIONS = [
  {
    key: 'requester',
    name: 'Requester Team',
    resource_type: 'human',
    quantity: 3,
    cost_per_hour: 18,
    availability: 95,
    availability_windows: [],
  },
  {
    key: 'manager',
    name: 'Department Manager',
    resource_type: 'human',
    quantity: 1,
    cost_per_hour: 38,
    availability: 82,
    availability_windows: [],
  },
  {
    key: 'buyer',
    name: 'Procurement Buyer',
    resource_type: 'human',
    quantity: 2,
    cost_per_hour: 26,
    availability: 90,
    availability_windows: [],
  },
  {
    key: 'control',
    name: 'Control Officer',
    resource_type: 'human',
    quantity: 1,
    cost_per_hour: 34,
    availability: 88,
    availability_windows: [],
  },
];

const TASK_BASELINE = [
  {
    task_id: 'Task_PrepareRequest',
    duration_min: 22,
    duration_type: 'normal',
    duration_std: 6,
    resource_key: 'requester',
    cost: 8,
    sla_target_min: 90,
  },
  {
    task_id: 'Task_ManagerReview',
    duration_min: 16,
    duration_type: 'normal',
    duration_std: 5,
    resource_key: 'manager',
    cost: 10,
    sla_target_min: 120,
  },
  {
    task_id: 'Task_SendApprovedRequest',
    duration_min: 4,
    duration_type: 'fixed',
    duration_std: 0,
    resource_key: 'requester',
    cost: 2,
    sla_target_min: 30,
  },
  {
    task_id: 'Task_ReceiveApprovedRequest',
    duration_min: 7,
    duration_type: 'fixed',
    duration_std: 0,
    resource_key: 'buyer',
    cost: 3,
    sla_target_min: 45,
  },
  {
    task_id: 'Task_ComplianceCheck',
    duration_min: 28,
    duration_type: 'normal',
    duration_std: 8,
    resource_key: 'control',
    cost: 12,
    sla_target_min: 180,
  },
  {
    task_id: 'Task_CreatePurchaseOrder',
    duration_min: 18,
    duration_type: 'normal',
    duration_std: 4,
    resource_key: 'buyer',
    cost: 9,
    sla_target_min: 120,
  },
  {
    task_id: 'Task_RequestClarification',
    duration_min: 35,
    duration_type: 'fixed',
    duration_std: 0,
    resource_key: 'control',
    cost: 7,
    sla_target_min: 240,
  },
  {
    task_id: 'Task_EscalateControlDelay',
    duration_min: 10,
    duration_type: 'fixed',
    duration_std: 0,
    resource_key: 'control',
    cost: 5,
    sla_target_min: 60,
  },
];

const FLOW_PROBABILITIES = [
  {
    flow_id: 'Flow_Request_3',
    flow_name: 'Manager approval bypassed',
    from_element: 'Gateway_ManagerApprovalRequired',
    to_element: 'Task_SendApprovedRequest',
    probability: 65,
  },
  {
    flow_id: 'Flow_Request_4',
    flow_name: 'Manager review required',
    from_element: 'Gateway_ManagerApprovalRequired',
    to_element: 'Task_ManagerReview',
    probability: 35,
  },
  {
    flow_id: 'Flow_Proc_4',
    flow_name: 'Controls passed',
    from_element: 'Gateway_ControlsPassed',
    to_element: 'Task_CreatePurchaseOrder',
    probability: 78,
  },
  {
    flow_id: 'Flow_Proc_6',
    flow_name: 'Clarification required',
    from_element: 'Gateway_ControlsPassed',
    to_element: 'Task_RequestClarification',
    probability: 22,
  },
];

async function upsertScenario(processRecord) {
  const existing = await pool.query(
    `
      SELECT id
      FROM simulation_scenarios
      WHERE process_id = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
    [processRecord.id, SCENARIO_NAME]
  );

  if (existing.rows[0]) {
    const scenarioId = existing.rows[0].id;
    await pool.query('DELETE FROM simulation_arrival_times WHERE scenario_id = $1', [scenarioId]);
    await pool.query('DELETE FROM simulation_flow_probabilities WHERE scenario_id = $1', [scenarioId]);
    await pool.query('DELETE FROM simulation_task_data WHERE scenario_id = $1', [scenarioId]);
    await pool.query('DELETE FROM simulation_resources WHERE scenario_id = $1', [scenarioId]);

    const updated = await pool.query(
      `
        UPDATE simulation_scenarios
        SET
          description = $2,
          status = 'draft',
          start_date = $3,
          process_instances = $4,
          warmup_percent = $5,
          cooldown_percent = $6,
          infinite_resources = FALSE,
          simulate_all_levels = FALSE,
          import_csv_arrivals = FALSE,
          results = NULL,
          calendar_settings = $7::jsonb,
          monte_carlo_runs = $8,
          notifications_enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [
        scenarioId,
        'Baseline simulation scenario for the purchase request control demo, covering requester preparation, approval, procurement control, and purchase-order creation.',
        '2026-05-12',
        36,
        5,
        10,
        JSON.stringify(CALENDAR_STANDARD),
        200,
      ]
    );

    return updated.rows[0];
  }

  const inserted = await pool.query(
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
      VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, FALSE, FALSE, FALSE, $8::jsonb, $9, TRUE, $10)
      RETURNING *
    `,
    [
      SCENARIO_NAME,
      'Baseline simulation scenario for the purchase request control demo, covering requester preparation, approval, procurement control, and purchase-order creation.',
      processRecord.id,
      '2026-05-12',
      36,
      5,
      10,
      JSON.stringify(CALENDAR_STANDARD),
      200,
      processRecord.created_by || 1,
    ]
  );

  return inserted.rows[0];
}

async function main() {
  await ensureSimulationSchema();

  const processResult = await pool.query(
    `
      SELECT id, name, bpmn_xml, company_id, created_by
      FROM processes
      WHERE LOWER(name) = LOWER($1)
      ORDER BY id DESC
      LIMIT 1
    `,
    [PROCESS_NAME]
  );

  const processRecord = processResult.rows[0];
  if (!processRecord) {
    throw new Error(`Process "${PROCESS_NAME}" was not found.`);
  }

  const scenario = await upsertScenario(processRecord);

  const resourceIdsByKey = new Map();
  const insertedResources = [];
  for (const resource of RESOURCE_DEFINITIONS) {
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
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [
        scenario.id,
        resource.name,
        resource.resource_type,
        resource.quantity,
        resource.cost_per_hour,
        resource.availability,
        JSON.stringify(resource.availability_windows || []),
      ]
    );

    resourceIdsByKey.set(resource.key, result.rows[0].id);
    insertedResources.push({
      ...result.rows[0],
      availability_windows: resource.availability_windows || [],
    });
  }

  const extractedTasks = extractTasksFromDiagram(processRecord.bpmn_xml);
  const taskCatalog = new Map(extractedTasks.map((task) => [task.task_id, task]));
  const insertedTasks = [];

  for (const baseline of TASK_BASELINE) {
    const task = taskCatalog.get(baseline.task_id);
    if (!task) {
      console.warn(`Skipping missing BPMN task: ${baseline.task_id}`);
      continue;
    }

    const result = await pool.query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        scenario.id,
        baseline.task_id,
        task.task_name,
        baseline.duration_min,
        baseline.duration_type,
        baseline.duration_std,
        resourceIdsByKey.get(baseline.resource_key) || null,
        baseline.cost,
        baseline.sla_target_min,
      ]
    );

    insertedTasks.push(result.rows[0]);
  }

  for (const flow of FLOW_PROBABILITIES) {
    await pool.query(
      `
        INSERT INTO simulation_flow_probabilities (
          scenario_id,
          flow_id,
          flow_name,
          from_element,
          to_element,
          probability
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        scenario.id,
        flow.flow_id,
        flow.flow_name,
        flow.from_element,
        flow.to_element,
        flow.probability,
      ]
    );
  }

  const runtimeScenario = {
    ...scenario,
    process_company_id: processRecord.company_id,
  };

  const baseResults = runSimulation({
    scenario: runtimeScenario,
    tasks: insertedTasks,
    resources: insertedResources,
  });
  const monteCarlo = runMonteCarloSimulation({
    scenario: runtimeScenario,
    tasks: insertedTasks,
    resources: insertedResources,
    iterations: Number(runtimeScenario.monte_carlo_runs) || 200,
  });
  const sensitivity = runSensitivityAnalysis({
    scenario: runtimeScenario,
    tasks: insertedTasks,
    resources: insertedResources,
  });
  const resourcePlanning = runResourcePlanning({
    scenario: runtimeScenario,
    tasks: insertedTasks,
    resources: insertedResources,
    targetCycleTimeMin: TARGET_CYCLE_TIME_MIN,
  });

  const results = {
    ...baseResults,
    monte_carlo: monteCarlo,
    sensitivity,
    resource_planning: resourcePlanning,
  };

  await pool.query(
    `
      UPDATE simulation_scenarios
      SET
        status = 'completed',
        results = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
    [JSON.stringify(results), scenario.id]
  );

  console.log(
    JSON.stringify(
      {
        scenario_id: scenario.id,
        scenario_name: SCENARIO_NAME,
        process_id: processRecord.id,
        process_name: processRecord.name,
        resources: insertedResources.length,
        tasks: insertedTasks.length,
        avg_duration_min: results.avg_duration_min,
        total_cost: results.total_cost,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
