/** @jest-environment node */

import {
  buildHistogram,
  createDefaultTask,
  extractTasksFromBpmn,
  extractTasksFromDiagram,
  extractTasksFromLegacyJson,
  runMonteCarloSimulation,
  runResourcePlanning,
  runSensitivityAnalysis,
  runSimulation,
  runWhatIfAnalysis,
} from './simulationEngine.js';

describe('simulationEngine', () => {
  it('extracts tasks from legacy JSON diagrams', () => {
    const tasks = extractTasksFromLegacyJson({
      elements: [
        { id: 'Task_1', type: 'userTask', label: 'Review Request' },
        { id: 'Event_1', type: 'startEvent', label: 'Start' },
      ],
    });

    expect(tasks).toEqual([
      createDefaultTask('Task_1', 'Review Request'),
    ]);
  });

  it('extracts tasks from BPMN XML when JSON parsing is not available', () => {
    const tasks = extractTasksFromBpmn(`
      <bpmn:definitions>
        <bpmn:userTask id="Task_Approve" name="Approve Request" />
        <bpmn:serviceTask id="Task_Notify" name="Notify Customer" />
      </bpmn:definitions>
    `);

    expect(tasks).toEqual([
      createDefaultTask('Task_Approve', 'Approve Request'),
      createDefaultTask('Task_Notify', 'Notify Customer'),
    ]);
    expect(extractTasksFromDiagram('<bpmn:task id="Task_1" name="Review" />')).toEqual([
      createDefaultTask('Task_1', 'Review'),
    ]);
  });

  it('builds deterministic histogram bins', () => {
    expect(buildHistogram([10, 12, 14, 16], 2)).toEqual([
      { label: '10-13', count: 2 },
      { label: '13-16', count: 2 },
    ]);
  });

  it('runs simulation with fixed inputs and returns utilization and bottlenecks', () => {
    const results = runSimulation({
      scenario: {
        process_instances: 4,
        warmup_percent: 25,
        cooldown_percent: 25,
      },
      tasks: [
        { task_id: 'A', task_name: 'Review', duration_min: 10, duration_type: 'fixed', duration_std: 0, cost: 60, resource_id: 1 },
        { task_id: 'B', task_name: 'Approve', duration_min: 20, duration_type: 'fixed', duration_std: 0, cost: 30, resource_id: 2 },
      ],
      resources: [
        { id: 1, name: 'Analyst', quantity: 1, cost_per_hour: 0, availability: 100 },
        { id: 2, name: 'Manager', quantity: 1, cost_per_hour: 0, availability: 100 },
      ],
      random: () => 0.5,
    });

    expect(results.status).toBe('completed');
    expect(results.arrival_source).toBe('generated');
    expect(results.instances).toBe(4);
    expect(results.active_instances).toBe(2);
    expect(results.avg_duration_min).toBe(55.5);
    expect(results.min_duration_min).toBe(47);
    expect(results.max_duration_min).toBe(64);
    expect(results.p95_duration_min).toBe(64);
    expect(results.total_cost).toBe(40);
    expect(results.avg_cost_per_instance).toBe(20);
    expect(results.simulation_horizon_min).toBe(90);

    expect(results.resource_results).toEqual([
      expect.objectContaining({
        resource_name: 'Analyst',
        utilization_rate: 44.4,
      }),
      expect.objectContaining({
        resource_name: 'Manager',
        utilization_rate: 88.9,
      }),
    ]);

    expect(results.bottlenecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'resource',
          name: 'Manager',
        }),
        expect.objectContaining({
          type: 'task',
          name: 'Approve',
        }),
      ])
    );

    expect(results.task_results).toEqual([
      expect.objectContaining({
        task_id: 'A',
        avg_duration: 10,
        avg_wait_min: 10.5,
        resource_name: 'Analyst',
        total_cost: 40,
      }),
      expect.objectContaining({
        task_id: 'B',
        avg_duration: 20,
        avg_wait_min: 15,
        resource_name: 'Manager',
        total_cost: 40,
      }),
    ]);
  });

  it('uses imported arrival times when provided', () => {
    const results = runSimulation({
      scenario: {
        process_instances: 99,
        warmup_percent: 0,
        cooldown_percent: 0,
        infinite_resources: true,
      },
      tasks: [
        { task_id: 'Task_1', task_name: 'Review', duration_min: 5, duration_type: 'fixed', duration_std: 0, cost: 0 },
      ],
      arrivals: [
        { arrival_offset_min: 0 },
        { arrival_offset_min: 12.5 },
        { arrival_offset_min: 18 },
      ],
      random: () => 0.5,
    });

    expect(results.arrival_source).toBe('csv');
    expect(results.instances).toBe(3);
    expect(results.arrival_preview).toEqual([
      { index: 1, offset_min: 0 },
      { index: 2, offset_min: 12.5 },
      { index: 3, offset_min: 18 },
    ]);
    expect(results.avg_duration_min).toBe(5);
  });

  it('applies working calendars and reports SLA breaches', () => {
    const results = runSimulation({
      scenario: {
        process_instances: 1,
        warmup_percent: 0,
        cooldown_percent: 0,
        start_date: '2026-04-01',
        calendar_settings: {
          business_hours: { start: '09:00', end: '17:00' },
          weekend_days: [0, 6],
          holidays: [],
          shifts: [],
        },
      },
      tasks: [
        {
          task_id: 'Task_1',
          task_name: 'Morning Review',
          duration_min: 30,
          duration_type: 'fixed',
          duration_std: 0,
          cost: 0,
          sla_target_min: 60,
        },
      ],
      arrivals: [{ arrival_offset_min: 0 }],
      random: () => 0.5,
    });

    expect(results.avg_duration_min).toBe(570);
    expect(results.late_instances).toBe(1);
    expect(results.sla_summary).toEqual(
      expect.objectContaining({
        late_instances: 1,
        late_instance_rate: 100,
      })
    );
    expect(results.task_results[0]).toEqual(
      expect.objectContaining({
        avg_calendar_wait_min: 540,
        sla_breach_count: 1,
        sla_breach_rate: 100,
      })
    );
  });

  it('supports Monte Carlo, sensitivity, what-if, and resource planning analyses', () => {
    const scenario = {
      process_instances: 4,
      warmup_percent: 0,
      cooldown_percent: 0,
    };
    const tasks = [
      { task_id: 'A', task_name: 'Review', duration_min: 12, duration_type: 'fixed', duration_std: 0, cost: 0, resource_id: 1 },
      { task_id: 'B', task_name: 'Approve', duration_min: 18, duration_type: 'fixed', duration_std: 0, cost: 0, resource_id: 1, sla_target_min: 25 },
    ];
    const resources = [
      { id: 1, name: 'Analyst', quantity: 1, cost_per_hour: 30, availability: 100 },
    ];

    const monteCarlo = runMonteCarloSimulation({
      scenario,
      tasks,
      resources,
      iterations: 4,
    });
    expect(monteCarlo.iterations).toBe(4);
    expect(monteCarlo.duration).toEqual(
      expect.objectContaining({
        mean: expect.any(Number),
        ci_low: expect.any(Number),
        ci_high: expect.any(Number),
      })
    );

    const sensitivity = runSensitivityAnalysis({
      scenario,
      tasks,
      resources,
    });
    expect(sensitivity.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'task', id: 'A' }),
        expect.objectContaining({ type: 'resource', id: 1 }),
      ])
    );

    const whatIf = runWhatIfAnalysis({
      scenario,
      tasks,
      resources,
      overrides: {
        task_overrides: [{ task_id: 'A', duration_multiplier: 0.5 }],
      },
    });
    expect(whatIf.comparison.avg_duration_delta).toBeLessThan(0);

    const planning = runResourcePlanning({
      scenario,
      tasks,
      resources,
      targetCycleTimeMin: 40,
    });
    expect(planning).toEqual(
      expect.objectContaining({
        baseline: expect.any(Object),
        target_cycle_time_min: 40,
        recommendations: expect.any(Array),
      })
    );
  });
});
