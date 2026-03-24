/** @jest-environment node */

import request from 'supertest';
import { createRequestUserMiddleware, createUser, makeResult } from './testUtils.js';

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

  it('returns scenario details and supports resource, task, and flow endpoints', async () => {
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
      .mockResolvedValueOnce(makeResult([{ id: 3, flow_id: 'Flow_1', probability: 100 }]));
    const detail = await request(app).get('/api/simulations/4');
    expect(detail.status).toBe(200);
    expect(detail.body.resources).toHaveLength(1);

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
  });

  it('runs a deterministic simulation and stores results', async () => {
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
      }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
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
      .mockResolvedValueOnce(makeResult([{ id: 1, name: 'Analyst' }]))
      .mockResolvedValueOnce(makeResult([]));

    const response = await request(app).post('/api/simulations/4/run');
    expect(response.status).toBe(200);
    expect(response.body.results.avg_duration_min).toBe(15);
    expect(response.body.results.total_cost).toBe(30);
    expect(response.body.results.task_results[0].resource_name).toBe('Analyst');
  });
});
