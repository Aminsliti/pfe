/** @jest-environment node */

import {
  buildHistogram,
  createDefaultTask,
  extractTasksFromBpmn,
  extractTasksFromDiagram,
  extractTasksFromLegacyJson,
  runSimulation,
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

  it('runs simulation with known fixed inputs and outputs', () => {
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
        { id: 1, name: 'Analyst' },
        { id: 2, name: 'Manager' },
      ],
      random: () => 0.5,
    });

    expect(results.instances).toBe(4);
    expect(results.active_instances).toBe(2);
    expect(results.avg_duration_min).toBe(30);
    expect(results.min_duration_min).toBe(30);
    expect(results.max_duration_min).toBe(30);
    expect(results.total_cost).toBe(80);
    expect(results.task_results).toEqual([
      expect.objectContaining({
        task_id: 'A',
        avg_duration: 10,
        resource_name: 'Analyst',
        total_cost: 40,
      }),
      expect.objectContaining({
        task_id: 'B',
        avg_duration: 20,
        resource_name: 'Manager',
        total_cost: 40,
      }),
    ]);
  });
});
