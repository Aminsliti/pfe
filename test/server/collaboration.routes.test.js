/** @jest-environment node */

import request from 'supertest';
import {
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

describe('collaboration routes', () => {
  const manager = createUser({
    role: 'Business Analyst',
    companyId: 2,
    company: { id: 2, name: 'Operations Division' },
    permissions: ['manage_processes', 'view_dashboard'],
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('supports comments, notifications, and template listing', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 7, name: 'Order Fulfillment', description: '', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 15, entity_type: 'process', entity_id: 7, body: 'Looks good', author_id: 1 }]));
    const comment = await request(app)
      .post('/api/entities/process/7/comments')
      .send({ body: 'Looks good' });
    expect(comment.status).toBe(201);
    expect(comment.body.body).toBe('Looks good');

    pool.query
      .mockResolvedValueOnce(
        makeResult([{ id: 22, title: 'Simulation failed', message: 'Scenario A failed.', is_read: false, created_at: '2026-04-01T09:00:00.000Z' }])
      )
      .mockResolvedValueOnce(makeResult([]));
    const notifications = await request(app).get('/api/notifications');
    expect(notifications.status).toBe(200);
    expect(notifications.body).toHaveLength(1);

    pool.query.mockResolvedValueOnce(
      makeResult([{ id: 3, name: 'Customer Service Intake', company_id: null }])
    );
    const templates = await request(app).get('/api/process-templates');
    expect(templates.status).toBe(200);
    expect(templates.body[0].name).toBe('Customer Service Intake');
  });

  it('applies a process template and creates a starter simulation', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(
        makeResult([
          {
            id: 9,
            name: 'Starter Template',
            description: 'Reusable starter',
            category_id: 4,
            company_id: 2,
            bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
            simulation_defaults: {},
          },
        ])
      )
      .mockResolvedValueOnce(
        makeResult([
          {
            id: 40,
            name: 'Starter Process',
            description: 'Reusable starter',
            category_id: 4,
            company_id: 2,
            status: 'draft',
          },
        ])
      )
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 81, process_id: 40, name: 'Starter Process - Baseline' }]))
      .mockResolvedValueOnce(makeResult([]));

    const response = await request(app)
      .post('/api/process-templates/9/apply')
      .send({ name: 'Starter Process' });

    expect(response.status).toBe(201);
    expect(response.body.process).toEqual(
      expect.objectContaining({
        id: 40,
        name: 'Starter Process',
      })
    );
    expect(response.body.scenario).toEqual(
      expect.objectContaining({
        id: 81,
      })
    );
    expect(response.body.template).toEqual(
      expect.objectContaining({
        id: 9,
        name: 'Starter Template',
      })
    );
  });
});
