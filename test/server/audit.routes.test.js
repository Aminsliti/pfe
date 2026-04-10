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

describe('audit routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists audit log entries for an administrator', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockResolvedValueOnce(makeResult([
      {
        id: 1,
        user_name: 'System Administrator',
        entity_type: 'process',
        entity_id: '4',
        action: 'update',
        summary: 'Updated process "Order Fulfillment"',
        details: { version: 2 },
        created_at: '2026-04-01T09:00:00.000Z',
      },
    ]));

    const response = await request(app).get('/api/audit-logs');
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].entity_type).toBe('process');
  });
});
