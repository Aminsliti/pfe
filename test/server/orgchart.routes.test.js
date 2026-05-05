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
      requestUserMiddleware: createRequestUserMiddleware(createUser()),
    });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'UPDATE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
        { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
        {
          match: 'FROM users u ORDER BY u.full_name',
          result: makeResult([{ id: 9, full_name: 'Ops Lead', email: 'lead@pfe.com', role: 'Admin' }]),
        },
        {
          match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id',
          result: makeResult([{
            id: 1,
            parent_id: null,
            user_id: null,
            name: 'Organisation',
            title: 'Organisation',
            node_type: 'company',
            description: 'Workspace-wide organigram',
            color: '#dc2626',
            sort_order: 0,
            is_vacant: false,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            user_name: null,
            user_email: null,
            user_role: null,
          }]),
        },
      ])
    );
    pool.connect.mockResolvedValue(
      createClientMock([
        { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
      ])
    );

    const meta = await request(app).get('/api/orgchart/meta');
    expect(meta.status).toBe(200);
    expect(meta.body.users[0].fullName).toBe('Ops Lead');
    expect(meta.body).not.toHaveProperty('companies');

    const nodes = await request(app).get('/api/orgchart/nodes');
    expect(nodes.status).toBe(200);
    expect(nodes.body[0].name).toBe('Organisation');
    expect(nodes.body[0]).not.toHaveProperty('companyName');
  });

  it('creates an organigram node', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(createUser()),
    });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'UPDATE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
        { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
      ])
    );

    const seedClient = createClientMock([
      { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
    ]);

<<<<<<< HEAD
    const createdNode = {
      id: 22,
      parent_id: 1,
      user_id: 9,
      name: 'Operations Lead',
      title: 'Head of Ops',
      node_type: 'division',
      description: 'Lead role',
      color: '#2563eb',
      placement_mode: 'nested',
      sort_order: 0,
      is_vacant: false,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      user_name: 'Ops Lead',
      user_email: 'lead@pfe.com',
      user_role: 'Admin',
    };

    const client = createClientMock([
      { match: 'SELECT id, full_name, role FROM users WHERE id = $1', result: makeResult([{ id: 9, full_name: 'Ops Lead', role: 'Admin' }]) },
      {
        match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1',
        result: makeResult([{ next_sort: 0 }]),
      },
      {
        match: 'INSERT INTO org_chart_nodes',
        result: ({ params }) => {
          // params[7] is placement_mode in the insert values array
          expect(params[7]).toBe('nested');
          return makeResult([{ id: 22 }]);
        },
      },
      {
        match: /WITH RECURSIVE descendants AS/,
        result: ({ params }) => {
          // params = [parentId, placementMode]
          expect(params[1]).toBe('nested');
          return makeResult([]);
        },
      },
      { match: 'UPDATE org_chart_nodes SET color = $1, updated_at = CURRENT_TIMESTAMP WHERE node_type = $2', result: makeResult([]) },
      {
        match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: ({ params }) => {
          // First call = parentNode check, second call = created node fetch
          if (params[0] === 1) {
            return makeResult([{
              id: 1,
              parent_id: null,
              user_id: null,
              name: 'Organisation',
              title: 'Organisation',
              node_type: 'company',
              description: null,
              color: '#dc2626',
              placement_mode: 'direct',
              sort_order: 0,
              is_vacant: false,
              created_at: '2026-03-01T00:00:00.000Z',
              updated_at: '2026-03-01T00:00:00.000Z',
              user_name: null,
              user_email: null,
              user_role: null,
            }]);
          }
          return makeResult([createdNode]);
        },
=======
    const client = createClientMock([
      { match: 'SELECT id, full_name, role FROM users WHERE id = $1', result: makeResult([{ id: 9, full_name: 'Ops Lead', role: 'Admin' }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id IS NULL', result: makeResult([{ next_sort: 0 }]) },
      { match: 'INSERT INTO org_chart_nodes', result: makeResult([{ id: 22 }]) },
      { match: 'UPDATE org_chart_nodes SET color = $1, updated_at = CURRENT_TIMESTAMP WHERE node_type = $2', result: makeResult([]) },
      {
        match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: makeResult([{
          id: 22,
          parent_id: null,
          user_id: 9,
          name: 'Operations Lead',
          title: 'Head of Ops',
          node_type: 'division',
          description: 'Lead role',
          color: '#2563eb',
          placement_mode: 'nested',
          sort_order: 0,
          is_vacant: false,
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          user_name: 'Ops Lead',
          user_email: 'lead@pfe.com',
          user_role: 'Admin',
        }]),
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      },
    ]);

    pool.connect
      .mockResolvedValueOnce(seedClient)
      .mockResolvedValueOnce(client);

    const response = await request(app).post('/api/orgchart/nodes').send({
      name: 'Operations Lead',
      title: 'Head of Ops',
      nodeType: 'division',
      userId: 9,
      placementMode: 'interne',
<<<<<<< HEAD
      parentId: 1,
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
    });

    expect(response.status).toBe(201);
    expect(response.body.name).toBe('Operations Lead');
    expect(response.body.placementMode).toBe('nested');
    expect(response.body).not.toHaveProperty('companyId');
  });

  it('updates and moves an organigram node', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(createUser()),
    });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'UPDATE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
        { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
      ])
    );

    const seedClient = createClientMock([
      { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
    ]);

    const baseNode = {
      id: 5,
      parent_id: null,
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
      user_name: null,
      user_email: null,
      user_role: null,
    };
    const parentNode = {
      ...baseNode,
      id: 8,
      name: 'Operations Team',
      node_type: 'team',
    };
    const updatedNode = {
      ...baseNode,
      parent_id: 8,
      name: 'Operations Lead Updated',
      updated_at: '2026-03-02T00:00:00.000Z',
    };

    let updateNodeReadCount = 0;
    const updateClient = createClientMock([
      {
        match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: ({ params }) => {
          if (params[0] === 8) return makeResult([parentNode]);
          updateNodeReadCount += 1;
          return makeResult([updateNodeReadCount === 1 ? baseNode : updatedNode]);
        },
      },
      { match: 'SELECT id, parent_id FROM org_chart_nodes', result: makeResult([{ id: 5, parent_id: null }, { id: 8, parent_id: null }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET', result: makeResult([]) },
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
    expect(updated.body.parentId).toBe(8);

    let moveNodeReadCount = 0;
    const movedNode = {
      ...baseNode,
      parent_id: 8,
      updated_at: '2026-03-02T00:00:00.000Z',
    };
    const moveClient = createClientMock([
      {
        match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: ({ params }) => {
          if (params[0] === 8) return makeResult([parentNode]);
          moveNodeReadCount += 1;
          return makeResult([moveNodeReadCount === 1 ? baseNode : movedNode]);
        },
      },
      { match: 'SELECT id, parent_id FROM org_chart_nodes', result: makeResult([{ id: 5, parent_id: null }, { id: 8, parent_id: null }]) },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET parent_id = $1, company_id = NULL, sort_order = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', result: makeResult([]) },
    ]);
    pool.connect.mockResolvedValueOnce(moveClient);

    const moved = await request(app).patch('/api/orgchart/nodes/5/move').send({ parentId: 8 });
    expect(moved.status).toBe(200);
    expect(moved.body.parentId).toBe(8);
  });

  it('deletes an organigram node', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockImplementation(
      createQueryMock([
        { match: 'CREATE TABLE IF NOT EXISTS org_chart_nodes', result: makeResult([]) },
        { match: 'ALTER TABLE org_chart_nodes', result: makeResult([]) },
        { match: 'UPDATE org_chart_nodes', result: makeResult([]) },
        { match: 'SELECT COUNT(*)::int AS count FROM org_chart_nodes', result: makeResult([{ count: 1 }]) },
        { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
      ])
    );

    const seedClient = createClientMock([
      { match: 'SELECT id, name, node_type FROM org_chart_nodes ORDER BY id', result: makeResult([{ id: 1, name: 'Organisation', node_type: 'company' }]) },
    ]);

    const client = createClientMock([
      {
        match: 'FROM org_chart_nodes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1',
        result: makeResult([{
          id: 5,
          parent_id: null,
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
          user_name: null,
          user_email: null,
          user_role: null,
        }]),
      },
      { match: 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id IS NULL', result: makeResult([{ next_sort: 1 }]) },
      { match: 'UPDATE org_chart_nodes SET parent_id = $1, company_id = NULL, sort_order = sort_order + $3, updated_at = CURRENT_TIMESTAMP WHERE parent_id = $2', result: makeResult([]) },
      { match: 'DELETE FROM org_chart_nodes WHERE id = $1', result: makeResult([]) },
    ]);

    pool.connect
      .mockResolvedValueOnce(seedClient)
      .mockResolvedValueOnce(client);

    const response = await request(app).delete('/api/orgchart/nodes/5');
    expect(response.status).toBe(200);
  });
});
