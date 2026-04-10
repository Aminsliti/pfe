/** @jest-environment node */

import request from 'supertest';
import {
  createClientMock,
  createQueryMock,
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
const { resetOrgChartSchemaCache } = require('../../server/routes/orgchart.js');

describe('org chart routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOrgChartSchemaCache();
  });

  it('loads org chart metadata and visible nodes', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({
          role: 'Company Administrator',
          companyId: 2,
          company: { id: 2, name: 'Operations Division' },
        })
      ),
    });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
        { match: 'SELECT id, name, description FROM companies', result: makeResult([{ id: 2, name: 'Operations Division', description: 'Ops' }]) },
        {
          match: 'FROM users u LEFT JOIN companies c ON c.id = u.company_id',
          result: makeResult([{ id: 9, full_name: 'Ops Lead', email: 'lead@pfe.com', role: 'Company Administrator', company_id: 2, company_name: 'Operations Division' }]),
        },
        {
          match: 'FROM org_chart_nodes n LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = n.user_id',
          result: makeResult([{
            id: 1,
            parent_id: null,
            company_id: 2,
            user_id: null,
            name: 'Operations Division',
            title: 'Organisation',
            node_type: 'company',
            description: 'Ops',
            color: '#dc2626',
            sort_order: 0,
            is_vacant: false,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            company_name: 'Operations Division',
            user_name: null,
            user_email: null,
            user_role: null,
          }]),
        },
      ])
    );
    pool.connect.mockResolvedValue(
      createClientMock([
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
      ])
    );

    const meta = await request(app).get('/api/orgchart/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.companies[0].name).toBe('Operations Division');

    const nodes = await request(app).get('/api/orgchart/nodes');
    expect(nodes.status).toBe(200);
    expect(nodes.body[0].companyName).toBe('Operations Division');
  });

  it('creates an organigram node', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({
          role: 'Company Administrator',
          companyId: 2,
          company: { id: 2, name: 'Operations Division' },
        })
      ),
    });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
      ])
    );
    const seedClient = createClientMock([
      { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
    ]);

    const client = createClientMock([
      { match: 'SELECT id, company_id, full_name, role FROM users WHERE id = $1', result: makeResult([{ id: 9, company_id: 2, full_name: 'Ops Lead', role: 'Company Administrator' }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id IS NULL', result: makeResult([{ next_sort: 0 }]) },
      { match: 'INSERT INTO org_chart_nodes', result: makeResult([{ id: 22 }]) },
      {
        match: 'FROM org_chart_nodes n LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: makeResult([{
          id: 22,
          parent_id: null,
          company_id: 2,
          user_id: 9,
          name: 'Operations Lead',
          title: 'Head of Ops',
          node_type: 'division',
          description: 'Lead role',
          color: '#2563eb',
          sort_order: 0,
          is_vacant: false,
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          company_name: 'Operations Division',
          user_name: 'Ops Lead',
          user_email: 'lead@pfe.com',
          user_role: 'Company Administrator',
        }]),
      },
    ]);
    pool.connect
      .mockResolvedValueOnce(seedClient)
      .mockResolvedValueOnce(client);

    const response = await request(app).post('/api/orgchart/nodes').send({
      name: 'Operations Lead',
      title: 'Head of Ops',
      nodeType: 'division',
      companyId: 2,
      userId: 9,
    });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Operations Lead');
  });

  it('updates and moves an organigram node', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(createUser())
    });

    const schemaHandlers = [
      { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
      { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
      { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
    ];
    pool.query.mockImplementation(createQueryMock(schemaHandlers));
    const seedClient = createClientMock([
      { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
    ]);

    const baseNode = {
      id: 5,
      parent_id: null,
      company_id: 2,
      user_id: null,
      name: 'Operations Lead',
      title: 'Head of Ops',
      node_type: 'division',
      description: 'Lead role',
      color: '#2563eb',
      sort_order: 0,
      is_vacant: false,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      company_name: 'Operations Division',
      user_name: null,
      user_email: null,
      user_role: null,
    };

    const updateClient = createClientMock([
      { match: 'FROM org_chart_nodes n LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1', result: ({ params }) => {
          if (params[0] === 5) return makeResult([baseNode]);
          return makeResult([{ ...baseNode, id: 8, name: 'Operations Team', node_type: 'team', parent_id: null }]);
        } },
      { match: 'SELECT id, parent_id FROM org_chart_nodes', result: makeResult([{ id: 5, parent_id: null }, { id: 8, parent_id: null }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET parent_id = $1, company_id = $2, user_id = $3, name = $4', result: makeResult([]) },
    ]);
    pool.connect
      .mockResolvedValueOnce(seedClient)
      .mockResolvedValueOnce(updateClient);

    const updated = await request(app).put('/api/orgchart/nodes/5').send({
      name: 'Operations Lead Updated',
      parentId: 8,
      nodeType: 'division',
      title: 'Head of Ops',
    });
    expect(updated.status).toBe(200);

    const moveClient = createClientMock([
      { match: 'BEGIN', result: makeResult([]) },
      { match: 'FROM org_chart_nodes n LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1', result: ({ params }) => {
          if (params[0] === 5) return makeResult([baseNode]);
          return makeResult([{ ...baseNode, id: 8, name: 'Operations Team', node_type: 'team', company_id: 2 }]);
        } },
      { match: 'SELECT id, parent_id FROM org_chart_nodes', result: makeResult([{ id: 5, parent_id: null }, { id: 8, parent_id: null }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET parent_id = $1, company_id = $2, sort_order = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4', result: makeResult([]) },
      { match: 'COMMIT', result: makeResult([]) },
    ]);
    pool.connect.mockResolvedValueOnce(moveClient);

    const moved = await request(app).patch('/api/orgchart/nodes/5/move').send({ parentId: 8 });
    expect(moved.status).toBe(200);
  });

  it('deletes an organigram node', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
      ])
    );
    const seedClient = createClientMock([
      { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
    ]);

    const client = createClientMock([
      { match: 'FROM org_chart_nodes n LEFT JOIN companies c ON c.id = n.company_id LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1', result: makeResult([{
          id: 5,
          parent_id: null,
          company_id: 2,
          user_id: null,
          name: 'Operations Lead',
          title: 'Head of Ops',
          node_type: 'division',
          description: null,
          color: '#2563eb',
          sort_order: 0,
          is_vacant: false,
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          company_name: 'Operations Division',
          user_name: null,
          user_email: null,
          user_role: null,
        }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id IS NULL', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET parent_id = $1, company_id = $2, sort_order = sort_order + $4', result: makeResult([]) },
      { match: 'DELETE FROM org_chart_nodes WHERE id = $1', result: makeResult([]) },
    ]);
    pool.connect
      .mockResolvedValueOnce(seedClient)
      .mockResolvedValueOnce(client);

    const response = await request(app).delete('/api/orgchart/nodes/5');
    expect(response.status).toBe(200);
  });
});
