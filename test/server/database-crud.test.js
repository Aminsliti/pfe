/** @jest-environment node */

import request from 'supertest';
import { createRequestUserMiddleware, createUser, makeResult, normalizeSql } from './testUtils.js';

jest.mock('../../server/db.js', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

const pool = require('../../server/db.js').default;
const { createApp } = require('../../server/app.js');

describe('database CRUD contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('issues insert/select/update/delete queries for user and process CRUD flows', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({
          companyId: 2,
          company: { id: 2, name: 'Operations Division' },
          activeRoles: ['Admin', 'Validator'],
        })
      ),
    });

    pool.query
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 31, username: 'crud-user', email: 'crud@pfe.com', full_name: 'Crud User', role: 'Viewer', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ name: 'Operations Division' }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 31, company_id: 2, role: 'Viewer' }]))
      .mockResolvedValueOnce(makeResult([{ id: 31, username: 'crud-user', email: 'updated@pfe.com', full_name: 'Crud User', role: 'Viewer', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ name: 'Operations Division' }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 31, company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 31 }]))
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2, assigned_validator_id: 1, section: 'metiers' }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 40, name: 'CRUD Process', category_id: 4, company_id: 2, created_by: 1, status: 'draft', version: 1, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z' }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 40, name: 'CRUD Process', description: '', bpmn_xml: '<bpmn:definitions />', category_id: 4, company_id: 2, created_by: 1, status: 'draft', version: 1 }]))
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2, assigned_validator_id: 1, section: 'metiers' }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 40, name: 'CRUD Process Updated', category_id: 4, company_id: 2, status: 'active', version: 1, updated_at: '2026-03-02T00:00:00.000Z', assigned_validator_id: 1 }]))
      .mockResolvedValueOnce(makeResult([{ id: 40, name: 'CRUD Process Updated', company_id: 2, created_by: 1, bpmn_xml: '<bpmn:definitions />' }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));

    await request(app).post('/api/users').send({
      username: 'crud-user',
      password: 'secret',
      email: 'crud@pfe.com',
      fullName: 'Crud User',
      role: 'Viewer',
      companyId: 2,
    });
    await request(app).put('/api/users/31').send({
      username: 'crud-user',
      email: 'updated@pfe.com',
      fullName: 'Crud User',
      role: 'Viewer',
      companyId: 2,
    });
    await request(app).delete('/api/users/31');

    await request(app).post('/api/processes').send({
      name: 'CRUD Process',
      category_id: 4,
      company_id: 2,
      status: 'draft',
    });
    await request(app).put('/api/processes/40').send({
      name: 'CRUD Process Updated',
      category_id: 4,
      company_id: 2,
      status: 'active',
    });
    await request(app).delete('/api/processes/40');

    const sqlCalls = pool.query.mock.calls.map(([sql]) => normalizeSql(sql));

    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO users'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE users'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('DELETE FROM users'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO processes'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE processes'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('DELETE FROM processes'))).toBe(true);
  });
});
