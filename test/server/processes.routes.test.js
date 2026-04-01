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

describe('process routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists processes and returns categories', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockResolvedValueOnce(makeResult([
      { id: 1, name: 'Order Fulfillment', company_id: 2, status: 'active' },
    ]));
    const list = await request(app).get('/api/processes');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 3, name: 'Operations', description: 'Ops' }]));
    const categories = await request(app).get('/api/process-categories');
    expect(categories.status).toBe(200);
  });

  it('creates, updates, deletes, imports, and exports processes', async () => {
    const admin = createUser({
      companyId: null,
      permissions: ['manage_processes', 'user_management', 'role_management', 'view_dashboard'],
    });
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(admin) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake',
        description: 'Claims process',
        category_id: 4,
        company_id: 2,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-20T00:00:00.000Z',
      }]))
      .mockResolvedValueOnce(makeResult([]));

    const created = await request(app).post('/api/processes').send({
      name: 'Claims Intake',
      description: 'Claims process',
      category_id: 4,
      company_id: 2,
      status: 'draft',
    });
    expect(created.status).toBe(201);
    expect(created.body.company_id).toBe(2);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake',
        description: 'Claims process',
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
        category_id: 4,
        company_id: 2,
        status: 'draft',
        version: 1,
      }]))
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake Updated',
        description: 'Updated',
        category_id: 4,
        company_id: 2,
        status: 'active',
        version: 2,
        updated_at: '2026-03-21T00:00:00.000Z',
      }]))
      .mockResolvedValueOnce(makeResult([]));

    const updated = await request(app).put('/api/processes/5').send({
      name: 'Claims Intake Updated',
      description: 'Updated',
      status: 'active',
      company_id: 2,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake Updated',
        company_id: 2,
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
      }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));
    const deleted = await request(app).delete('/api/processes/5');
    expect(deleted.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 8,
        name: 'Imported Process',
        description: 'Imported',
        category_id: 4,
        company_id: 2,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-20T00:00:00.000Z',
      }]))
      .mockResolvedValueOnce(makeResult([]));
    const imported = await request(app)
      .post('/api/processes/import')
      .field('name', 'Imported Process')
      .field('company_id', '2')
      .attach('bpmnFile', Buffer.from('<bpmn:definitions></bpmn:definitions>'), 'imported.bpmn');
    expect(imported.status).toBe(201);

    pool.query.mockResolvedValueOnce(makeResult([{
      id: 8,
      name: 'Imported Process',
      company_id: 2,
      bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
    }]));
    const exported = await request(app).get('/api/processes/8/export');
    expect(exported.status).toBe(200);
    expect(exported.text).toContain('bpmn:definitions');
  });

  it('gets process details and manages categories', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser({ companyId: 2 })) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        category_name: 'Operations',
        company_id: 2,
        created_by_name: 'System Administrator',
      }]))
      .mockResolvedValueOnce(makeResult([{ id: 19, version_number: 1, created_by_name: 'System Administrator' }]));

    const detail = await request(app).get('/api/processes/4');
    expect(detail.status).toBe(200);
    expect(detail.body.versions).toHaveLength(1);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 10, name: 'Claims', description: 'Claims category' }]));
    const createdCategory = await request(app).post('/api/process-categories').send({ name: 'Claims', description: 'Claims category' });
    expect(createdCategory.status).toBe(201);
  });

  it('returns workflow history, applies workflow actions, and compares versions', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser({ companyId: 2 })) });

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        company_id: 2,
        status: 'review',
        submitted_at: '2026-04-01T08:00:00.000Z',
        approved_at: null,
        approved_by: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(makeResult([
        { id: 71, action: 'submit_review', comment: 'Ready for approval', created_by_name: 'System Administrator' },
      ]));

    const workflow = await request(app).get('/api/processes/4/workflow');
    expect(workflow.status).toBe(200);
    expect(workflow.body.status).toBe('review');
    expect(workflow.body.comments).toHaveLength(1);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        company_id: 2,
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
        status: 'review',
        version: 1,
        submitted_at: '2026-04-01T08:00:00.000Z',
        approved_at: null,
        approved_by: null,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        company_id: 2,
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
        status: 'approved',
        version: 2,
        submitted_at: '2026-04-01T08:00:00.000Z',
        approved_at: '2026-04-01T09:00:00.000Z',
        approved_by: 1,
        archived_at: null,
      }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        company_id: 2,
        status: 'approved',
        approved_by: 1,
        approved_by_name: 'System Administrator',
        submitted_at: '2026-04-01T08:00:00.000Z',
        approved_at: '2026-04-01T09:00:00.000Z',
        archived_at: null,
      }]))
      .mockResolvedValueOnce(makeResult([
        { id: 72, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' },
      ]));

    const action = await request(app).post('/api/processes/4/workflow').send({
      action: 'approve',
      comment: 'Approved',
    });
    expect(action.status).toBe(200);
    expect(action.body.workflow.status).toBe('approved');

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 4,
        name: 'Order Process',
        company_id: 2,
      }]))
      .mockResolvedValueOnce(makeResult([{
        process_id: 4,
        version_number: 1,
        name: 'Order Process',
        description: 'Initial',
        category_id: 1,
        company_id: 2,
        status: 'draft',
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review" /></bpmn:definitions>',
      }]))
      .mockResolvedValueOnce(makeResult([{
        process_id: 4,
        version_number: 2,
        name: 'Order Process',
        description: 'Updated',
        category_id: 1,
        company_id: 2,
        status: 'approved',
        bpmn_xml: '<bpmn:definitions><bpmn:userTask id="Task_1" name="Review request" /><bpmn:serviceTask id="Task_2" name="Validate" /></bpmn:definitions>',
      }]));

    const diff = await request(app).get('/api/processes/4/diff?fromVersion=1&toVersion=2');
    expect(diff.status).toBe(200);
    expect(diff.body.metadata_changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'description' }),
        expect.objectContaining({ field: 'status' }),
      ])
    );
    expect(diff.body.task_changes.added).toHaveLength(1);
  });

  it('manages companies with correct scoping rules', async () => {
    const companyAdmin = createUser({
      role: 'Company Administrator',
      companyId: 2,
      company: { id: 2, name: 'Operations Division' },
      permissions: ['user_management', 'manage_processes'],
    });

    const companyAdminApp = createApp({ requestUserMiddleware: createRequestUserMiddleware(companyAdmin) });

    pool.query.mockResolvedValueOnce(makeResult([{ id: 2, name: 'Operations Division', description: 'Ops' }]));
    const companyList = await request(companyAdminApp).get('/api/companies');
    expect(companyList.status).toBe(200);
    expect(companyList.body).toHaveLength(1);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 2, name: 'Operations Division', description: 'Updated', logo_url: null }]));
    const companyUpdate = await request(companyAdminApp).put('/api/companies/2').send({
      name: 'Operations Division',
      description: 'Updated',
      logo_url: '',
    });
    expect(companyUpdate.status).toBe(200);

    const adminApp = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });
    pool.query.mockResolvedValueOnce(makeResult([{ id: 12, name: 'New Company', description: 'New', logo_url: null }]));
    const createdCompany = await request(adminApp).post('/api/companies').send({ name: 'New Company', description: 'New' });
    expect(createdCompany.status).toBe(201);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 12, name: 'New Company' }]))
      .mockResolvedValueOnce(makeResult([{ id: 12 }], { rowCount: 1 }));
    const deletedCompany = await request(adminApp).delete('/api/companies/12');
    expect(deletedCompany.status).toBe(200);
  });
});
