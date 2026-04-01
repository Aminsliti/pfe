/** @jest-environment node */

import request from 'supertest';
import {
  createClientMock,
  createRequestUserMiddleware,
  createUser,
  makeResult,
} from './testUtils.js';

jest.mock('../../server/db.js', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const pool = require('../../server/db.js').default;
const { createApp } = require('../../server/app.js');

describe('simulation routes', () => {
  const manager = createUser({
    role: 'Business Analyst',
    companyId: 2,
    company: { id: 2, name: 'Operations Division' },
    permissions: ['manage_processes', 'view_dashboard'],
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists, creates, updates, and deletes scenarios', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query.mockResolvedValueOnce(makeResult([
      { id: 4, name: 'Scenario A', process_name: 'Order Fulfillment' },
    ]));
    const list = await request(app).get('/api/simulations');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 7, name: 'Order Fulfillment', company_id: 2, bpmn_xml: '<bpmn:definitions />' }]))
      .mockResolvedValueOnce(makeResult([{ id: 11, name: 'Scenario B', process_id: 7, status: 'draft' }]));
    const created = await request(app).post('/api/simulations').send({ name: 'Scenario B', process_id: 7 });
    expect(created.status).toBe(201);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 11,
        name: 'Scenario B',
        process_id: 7,
        process_company_id: 2,
        bpmn_xml: '<bpmn:definitions />',
      }]))
      .mockResolvedValueOnce(makeResult([{ id: 7, name: 'Order Fulfillment', company_id: 2, bpmn_xml: '<bpmn:definitions />' }]))
      .mockResolvedValueOnce(makeResult([{ id: 11, name: 'Scenario B Updated', process_id: 7, status: 'completed' }]));
    const updated = await request(app).put('/api/simulations/11').send({
      name: 'Scenario B Updated',
      process_id: 7,
      status: 'completed',
    });
    expect(updated.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 11,
        name: 'Scenario B Updated',
        process_id: 7,
        process_company_id: 2,
      }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));
    const deleted = await request(app).delete('/api/simulations/11');
    expect(deleted.status).toBe(200);
  });

  it('returns scenario details and supports resource, task, flow, and arrival endpoints', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Scenario A',
        process_id: 7,
        process_company_id: 2,
        bpmn_xml: '<bpmn:definitions />',
      }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, name: 'Analyst' }]))
      .mockResolvedValueOnce(makeResult([{ id: 2, task_id: 'Task_1', task_name: 'Review' }]))
      .mockResolvedValueOnce(makeResult([{ id: 3, flow_id: 'Flow_1', probability: 100 }]))
      .mockResolvedValueOnce(makeResult([{ id: 9, arrival_order: 1, raw_value: '08:00', arrival_offset_min: 0 }]));
    const detail = await request(app).get('/api/simulations/4');
    expect(detail.status).toBe(200);
    expect(detail.body.resources).toHaveLength(1);
    expect(detail.body.arrival_times).toHaveLength(1);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, name: 'Analyst' }]));
    const resources = await request(app).get('/api/simulations/4/resources');
    expect(resources.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 5, scenario_id: 4, name: 'Manager' }]));
    const createResource = await request(app).post('/api/simulations/4/resources').send({ name: 'Manager' });
    expect(createResource.status).toBe(201);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 5, scenario_id: 4, name: 'Manager', quantity: 2 }]));
    const updateResource = await request(app).put('/api/simulations/4/resources/5').send({
      name: 'Manager',
      resource_type: 'human',
      quantity: 2,
      cost_per_hour: 50,
      availability: 100,
    });
    expect(updateResource.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));
    const deleteResource = await request(app).delete('/api/simulations/4/resources/5');
    expect(deleteResource.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 10, task_id: 'Task_1', task_name: 'Review', resource_name: 'Analyst' }]));
    const tasks = await request(app).get('/api/simulations/4/tasks');
    expect(tasks.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 10, task_id: 'Task_1', task_name: 'Review' }]));
    const upsertTask = await request(app).put('/api/simulations/4/tasks/Task_1').send({
      task_name: 'Review',
      duration_min: 12,
      duration_type: 'fixed',
      duration_std: 0,
      cost: 20,
    });
    expect(upsertTask.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 15, flow_id: 'Flow_1', probability: 60 }]));
    const flows = await request(app).get('/api/simulations/4/flows');
    expect(flows.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 15, flow_id: 'Flow_1', probability: 60 }]));
    const upsertFlow = await request(app).put('/api/simulations/4/flows/Flow_1').send({
      flow_name: 'Approved',
      from_element: 'Gateway_1',
      to_element: 'Task_2',
      probability: 60,
    });
    expect(upsertFlow.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([
        { id: 31, arrival_order: 1, raw_value: '08:00', arrival_offset_min: 0 },
        { id: 32, arrival_order: 2, raw_value: '08:15', arrival_offset_min: 15 },
      ]));
    const arrivals = await request(app).get('/api/simulations/4/arrival-times');
    expect(arrivals.status).toBe(200);
    expect(arrivals.body.count).toBe(2);

    const client = createClientMock([
      { match: 'DELETE FROM simulation_arrival_times', result: makeResult([], { rowCount: 0 }) },
      { match: 'INSERT INTO simulation_arrival_times', result: makeResult([], { rowCount: 1 }) },
      { match: 'UPDATE simulation_scenarios', result: makeResult([], { rowCount: 1 }) },
    ]);
    pool.connect.mockResolvedValue(client);
    pool.query.mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]));
    const imported = await request(app)
      .post('/api/simulations/4/arrival-times/import')
      .send({ csvText: 'arrival_time\n08:00\n08:15\n08:45', fileName: 'arrivals.csv' });
    expect(imported.status).toBe(201);
    expect(imported.body.count).toBe(3);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, process_company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 3 }))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));
    const cleared = await request(app).delete('/api/simulations/4/arrival-times');
    expect(cleared.status).toBe(200);
  });

  it('exports simulation results as CSV', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query.mockResolvedValueOnce(makeResult([{
      id: 4,
      name: 'Scenario A',
      process_id: 7,
      process_company_id: 2,
      process_name: 'Order Fulfillment',
      status: 'completed',
      results: {
        simulated_at: '2026-03-31T09:00:00.000Z',
        instances: 3,
        active_instances: 3,
        arrival_source: 'csv',
        avg_duration_min: 27,
        total_cost: 75,
        task_results: [
          { task_id: 'Task_1', task_name: 'Review', avg_duration: 15, total_cost: 75 },
        ],
        resource_results: [
          { resource_id: 1, resource_name: 'Analyst', utilization_rate: 100 },
        ],
        bottlenecks: [
          { type: 'resource', name: 'Analyst', metric: 100, unit: '% utilisation', severity: 'high', details: 'Resource saturated' },
        ],
        arrival_preview: [
          { index: 1, offset_min: 0 },
        ],
      },
    }]));

    const response = await request(app).get('/api/simulations/4/export');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('scenario-a-results.csv');
    expect(response.text).toContain('sep=;');
    expect(response.text).toContain('Scenario Summary');
    expect(response.text).toContain('field;value');
    expect(response.text).toContain('Task Results');
    expect(response.text).toContain('Resource Results');
    expect(response.text).toContain('Review');
    expect(response.text).toContain('Analyst');
  });

  it('compares two completed scenarios side by side', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Scenario A',
        process_id: 7,
        process_name: 'Order Fulfillment',
        process_company_id: 2,
        results: {
          avg_duration_min: 27,
          p95_duration_min: 31,
          total_cost: 75,
          avg_cost_per_instance: 25,
          resource_results: [{ resource_name: 'Analyst', utilization_rate: 92, avg_wait_min: 8, tasks_handled: 10 }],
          bottlenecks: [{ type: 'resource', name: 'Analyst', metric: 92, unit: '% utilisation', severity: 'high', details: 'Busy' }],
          task_results: [{ task_id: 'Task_1', task_name: 'Review', avg_duration: 15, avg_wait_min: 8, total_cost: 75 }],
        },
      }]))
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Scenario B',
        process_id: 7,
        process_name: 'Order Fulfillment',
        process_company_id: 2,
        results: {
          avg_duration_min: 20,
          p95_duration_min: 26,
          total_cost: 63,
          avg_cost_per_instance: 21,
          resource_results: [{ resource_name: 'Analyst', utilization_rate: 75, avg_wait_min: 3, tasks_handled: 10 }],
          bottlenecks: [{ type: 'task', name: 'Review', metric: 3, unit: 'min wait', severity: 'low', details: 'Minor queue' }],
          task_results: [{ task_id: 'Task_1', task_name: 'Review', avg_duration: 11, avg_wait_min: 3, total_cost: 63 }],
        },
      }]));

    const response = await request(app).get('/api/simulations/4/compare/5');
    expect(response.status).toBe(200);
    expect(response.body.same_process).toBe(true);
    expect(response.body.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'avg_duration_min', delta: 7 }),
      ])
    );
    expect(response.body.resource_comparison[0]).toEqual(
      expect.objectContaining({ resource_name: 'Analyst', utilization_delta: 17 })
    );
  });

  it('runs a deterministic simulation and returns richer metrics', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Scenario A',
        process_id: 7,
        process_company_id: 2,
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
        process_instances: 3,
        warmup_percent: 0,
        cooldown_percent: 0,
        import_csv_arrivals: false,
      }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }))
      .mockResolvedValueOnce(makeResult([{ task_id: 'Task_1' }]))
      .mockResolvedValueOnce(makeResult([
        {
          id: 21,
          task_id: 'Task_1',
          task_name: 'Review',
          duration_min: 15,
          duration_type: 'fixed',
          duration_std: 0,
          cost: 40,
          resource_id: 1,
        },
      ]))
      .mockResolvedValueOnce(makeResult([
        { id: 1, name: 'Analyst', quantity: 1, cost_per_hour: 60, availability: 100 },
      ]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }))
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Scenario A',
        status: 'completed',
        process_id: 7,
        process_company_id: 2,
      }]));

    const response = await request(app).post('/api/simulations/4/run');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('completed');
    expect(response.body.results.avg_duration_min).toBe(27);
    expect(response.body.results.total_cost).toBe(75);
    expect(response.body.results.arrival_source).toBe('generated');
    expect(response.body.results.resource_results[0]).toEqual(
      expect.objectContaining({
        resource_name: 'Analyst',
        utilization_rate: 100,
      })
    );
    expect(response.body.results.bottlenecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'resource',
          name: 'Analyst',
        }),
      ])
    );
  });

  it('marks the scenario as failed when CSV arrivals are enabled without imported rows', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 8,
        name: 'CSV Scenario',
        process_id: 7,
        process_company_id: 2,
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
        process_instances: 3,
        warmup_percent: 0,
        cooldown_percent: 0,
        import_csv_arrivals: true,
      }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }))
      .mockResolvedValueOnce(makeResult([{ task_id: 'Task_1' }]))
      .mockResolvedValueOnce(makeResult([
        {
          id: 21,
          task_id: 'Task_1',
          task_name: 'Review',
          duration_min: 10,
          duration_type: 'fixed',
          duration_std: 0,
          cost: 0,
          resource_id: null,
        },
      ]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));

    const response = await request(app).post('/api/simulations/8/run');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/CSV arrivals/i);
  });
});
