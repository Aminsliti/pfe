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
    pool.query.mockReset();
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

  it('hides archived processes from the main list by default', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockResolvedValueOnce(makeResult([]));

    const response = await request(app).get('/api/processes');
    expect(response.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toContain("COALESCE(p.status, 'draft') <> $1");
    expect(pool.query.mock.calls[0][1]).toEqual(['archived']);
  });

  it('lets an admin create a process without validator role or company scope', async () => {
    const admin = createUser({
      role: 'Admin',
      activeRoles: ['Admin'],
      companyId: null,
      company: null,
      permissions: ['manage_processes', 'view_dashboard'],
    });
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(admin) });

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: null, assigned_validator_id: 1, section: 'metiers' }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: null }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 21,
        name: 'Admin Created',
        description: null,
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
        category_id: 4,
        company_id: null,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-04-08T00:00:00.000Z',
        updated_at: '2026-04-08T00:00:00.000Z',
        manual_data: {},
        assigned_designer_id: null,
        assigned_validator_id: 1,
      }]))
      .mockResolvedValueOnce(makeResult([]));

    const created = await request(app).post('/api/processes').send({
      name: 'Admin Created',
      category_id: 4,
      assigned_validator_id: 1,
    });

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Admin Created');
    expect(created.body.company_id).toBeNull();
  });

  it('supports assigning multiple designers and process managers to a process', async () => {
    const manager = createUser({
      role: 'Validator',
      activeRoles: ['Validator'],
      companyId: 2,
      company: { id: 2, name: 'Operations Division' },
      permissions: ['manage_processes', 'view_dashboard'],
    });
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(manager) });

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2, assigned_validator_ids: [1], section: 'metiers' }]))
      .mockResolvedValueOnce(makeResult([
        { id: 2, username: 'designer-1', full_name: 'Designer One', role: 'Designer', company_id: 2 },
        { id: 3, username: 'designer-2', full_name: 'Designer Two', role: 'Designer', company_id: 2 },
        { id: 1, username: 'manager-1', full_name: 'Manager One', role: 'Validator', company_id: 2 },
        { id: 5, username: 'manager-2', full_name: 'Manager Two', role: 'Validator', company_id: 2 },
      ]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 41,
        name: 'Multi Governance',
        description: null,
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
        category_id: 4,
        company_id: 2,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-04-08T00:00:00.000Z',
        updated_at: '2026-04-08T00:00:00.000Z',
        manual_data: {},
        assigned_designer_id: 2,
        assigned_validator_id: 1,
        assigned_designer_ids: [2, 3],
        assigned_validator_ids: [1, 5],
      }]))
      .mockResolvedValueOnce(makeResult([]));

    const created = await request(app).post('/api/processes').send({
      name: 'Multi Governance',
      category_id: 4,
      company_id: 2,
      assigned_designer_ids: [2, 3],
      assigned_validator_ids: [1, 5],
    });

    expect(created.status).toBe(201);
    expect(created.body.assigned_designer_ids).toEqual([2, 3]);
    expect(created.body.assigned_validator_ids).toEqual([1, 5]);
  });

  it('creates, updates, deletes, imports, and exports processes', async () => {
    const admin = createUser({
      companyId: 2,
      company: { id: 2, name: 'Operations Division' },
      activeRoles: ['Admin', 'Validator'],
      permissions: ['manage_processes', 'user_management', 'role_management', 'view_dashboard'],
    });
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(admin) });

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake',
        description: 'Claims process',
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
        category_id: 4,
        company_id: 2,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-20T00:00:00.000Z',
        manual_data: {},
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
        created_by: 1,
        status: 'draft',
        version: 1,
      }]))
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake Updated',
        description: 'Updated',
        category_id: 4,
        company_id: 2,
        status: 'active',
        version: 1,
        updated_at: '2026-03-21T00:00:00.000Z',
        assigned_validator_id: 1,
      }]));

    const updated = await request(app).put('/api/processes/5').send({
      name: 'Claims Intake Updated',
      description: 'Updated',
      status: 'active',
      company_id: 2,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(1);

    pool.query
      .mockResolvedValueOnce(makeResult([{
        id: 5,
        name: 'Claims Intake Updated',
        company_id: 2,
        created_by: 1,
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
      }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));
    const deleted = await request(app).delete('/api/processes/5');
    expect(deleted.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 4, name: 'Operations', company_id: 2, assigned_validator_id: 1, section: 'metiers' }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, username: 'admin', full_name: 'System Administrator', role: 'Admin', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{
        id: 8,
        name: 'Imported Process',
        description: 'Imported',
        bpmn_xml: '<bpmn:definitions></bpmn:definitions>',
        category_id: 4,
        company_id: 2,
        created_by: 1,
        status: 'draft',
        version: 1,
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-20T00:00:00.000Z',
        manual_data: {},
      }]))
      .mockResolvedValueOnce(makeResult([]));
    const imported = await request(app)
      .post('/api/processes/import')
      .field('name', 'Imported Process')
      .field('category_id', '4')
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
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({ companyId: 2, company: { id: 2, name: 'Operations Division' }, activeRoles: ['Admin', 'Validator'] })
      ),
    });

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

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 7, name: 'Operations', description: 'Operations category', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 10, name: 'Claims', description: 'Claims category', parent_id: 7, company_id: 2 }]));

    const createdCategory = await request(app).post('/api/process-categories').send({
      name: 'Claims',
      description: 'Claims category',
      parent_id: 7,
      company_id: 2,
    });
    expect(createdCategory.status).toBe(201);
    expect(createdCategory.body.parent_id).toBe(7);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 10, name: 'Claims', description: 'Claims category', parent_id: 7, company_id: 2, assigned_validator_id: 1 }]))
      .mockResolvedValueOnce(makeResult([{ id: 7, name: 'Operations', description: 'Operations category', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 10 }]))
      .mockResolvedValueOnce(makeResult([{ id: 10, name: 'Card Claims', description: 'Updated category', parent_id: 7, company_id: 2, assigned_validator_id: 1 }]));

    const updatedCategory = await request(app).put('/api/process-categories/10').send({
      name: 'Card Claims',
      description: 'Updated category',
      company_id: 2,
    });
    expect(updatedCategory.status).toBe(200);
    expect(updatedCategory.body.name).toBe('Card Claims');

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 10, name: 'Card Claims', description: 'Updated category', parent_id: 7, company_id: 2, assigned_validator_id: 1 }]))
      .mockResolvedValueOnce(makeResult([{ count: 0 }]))
      .mockResolvedValueOnce(makeResult([{ count: 0 }]))
      .mockResolvedValueOnce(makeResult([], { rowCount: 1 }));

    const deletedCategory = await request(app).delete('/api/process-categories/10');
    expect(deletedCategory.status).toBe(200);
  });

  it('returns a process explanation and exports the reduced procedure manual in every format', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser({ companyId: 2 })) });
    const processRow = {
      id: 9,
      name: 'Card Dispute Handling',
      description: 'Card dispute resolution process',
      company_id: 2,
      company_name: 'Bank Demo',
      category_name: 'Operations',
      status: 'approved',
      version: 3,
      manual_data: {
        support_data: ['Claim amount', 'Claim date'],
        support_documents: ['Claim form', 'Proof of payment'],
        support_systems: ['Card dispute portal'],
        trigger: 'Start',
        objective: 'Resolve the customer dispute',
        expected_result: 'Dispute closed',
      },
      bpmn_xml: `
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <bpmn:collaboration id="Collab_1">
            <bpmn:participant id="Participant_1" name="Client" processRef="Process_1" />
            <bpmn:participant id="Participant_2" name="Bank" processRef="Process_2" />
            <bpmn:messageFlow id="MessageFlow_1" sourceRef="Task_1" targetRef="Task_2" />
          </bpmn:collaboration>
          <bpmn:process id="Process_2">
            <bpmn:laneSet id="LaneSet_1">
              <bpmn:lane id="Lane_1" name="Front Office" />
              <bpmn:lane id="Lane_2" name="Back Office" />
            </bpmn:laneSet>
            <bpmn:startEvent id="StartEvent_1" name="Start" />
            <bpmn:userTask id="Task_1" name="Receive claim" />
            <bpmn:subProcess id="Task_2" name="Investigate dispute" />
            <bpmn:endEvent id="EndEvent_1" name="End" />
            <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
            <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Task_2" />
            <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_2" targetRef="EndEvent_1" />
          </bpmn:process>
        </bpmn:definitions>
      `,
      submitted_at: '2026-04-04T08:00:00.000Z',
      approved_at: '2026-04-04T09:00:00.000Z',
      approved_by: 1,
      approved_by_name: 'System Administrator',
      archived_at: null,
    };

    pool.query
      .mockResolvedValueOnce(makeResult([processRow]))
      .mockResolvedValueOnce(makeResult([{ id: 1, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' }]));

    const explanation = await request(app).get('/api/processes/9/explanation');
    expect(explanation.status).toBe(200);
    expect(explanation.body.explanation.summary).toContain('Card Dispute Handling');
    expect(explanation.body.explanation.metrics.participants).toBe(2);

    pool.query
      .mockResolvedValueOnce(makeResult([processRow]))
      .mockResolvedValueOnce(makeResult([{ id: 1, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' }]));

    const manualJson = await request(app).get('/api/processes/9/manual?format=json');
    expect(manualJson.status).toBe(200);
    expect(Object.keys(manualJson.body.manual.matrices).sort()).toEqual([
      'activities',
      'identity',
      'kpis',
      'risks',
      'supportObjects',
      'whatWhoWhenWhy',
    ]);
    expect(manualJson.body.manual.diagramDescription).toContain('Card Dispute Handling est represente par un diagramme BPMN approved');
    expect(manualJson.body.manual.matrices.activities[1].description).toContain('Sous-processus inclus dans le manuel');
    expect(manualJson.body.manual.matrices.whatWhoWhenWhy.columns.map((column) => column.label)).toEqual([
      'Activite',
      'What',
      'Who',
      'When',
      'Why',
    ]);
    expect(manualJson.body.manual.matrices.whatWhoWhenWhy.rows[0].activity).toBe('Receive claim');
    expect(manualJson.body.manual.matrices.whatWhoWhenWhy.rows[0].when).toContain('Start');
    expect(manualJson.body.manual.matrices.whatWhoWhenWhy.rows[1].when).toContain('Apres Receive claim');
    expect(manualJson.body.manual.matrices.whatWhoWhenWhy.rows[0].why).toContain('Resolve the customer dispute');
    expect(manualJson.body.manual.matrices.supportObjects.sections[0].title).toBe('4.1 Donnees');
    expect(manualJson.body.manual.matrices.supportObjects.sections[0].rows[0].name).toBe('Claim amount');
    expect(manualJson.body.manual.matrices.supportObjects.sections[1].rows[0].name).toBe('Claim form');
    expect(manualJson.body.manual.matrices.supportObjects.sections[2].rows[0].name).toBe('Card dispute portal');

    pool.query
      .mockResolvedValueOnce(makeResult([processRow]))
      .mockResolvedValueOnce(makeResult([{ id: 1, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' }]));

    const htmlReport = await request(app).get('/api/processes/9/manual?format=html');
    expect(htmlReport.status).toBe(200);
    expect(htmlReport.headers['content-type']).toContain('text/html');
    expect(htmlReport.text).toContain('2. Matrice what who when why');
    expect(htmlReport.text.indexOf('2. Matrice what who when why')).toBeLessThan(htmlReport.text.indexOf('3. Matrice des activites'));
    expect(htmlReport.text).toContain('Card Dispute Handling est represente par un diagramme BPMN approved');
    expect(htmlReport.text).toContain('4. NIVEAU OBJETS SUPPORTS');
    expect(htmlReport.text).toContain('4.1 Donnees');
    expect(htmlReport.text).toContain('Claim amount');

    pool.query
      .mockResolvedValueOnce(makeResult([processRow]))
      .mockResolvedValueOnce(makeResult([{ id: 1, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' }]));

    const report = await request(app).get('/api/processes/9/report?format=pdf');
    expect(report.status).toBe(200);
    expect(report.headers['content-type']).toContain('application/pdf');
    expect(report.headers['content-disposition']).toContain('card-dispute-handling-manuel-de-procedure.pdf');
    expect(report.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(report.body.toString('binary')).toContain('Card Dispute Handling');

    pool.query
      .mockResolvedValueOnce(makeResult([processRow]))
      .mockResolvedValueOnce(makeResult([{ id: 1, action: 'approve', comment: 'Approved', created_by_name: 'System Administrator' }]));

    const wordReport = await request(app).get('/api/processes/9/manual?format=docx');
    expect(wordReport.status).toBe(200);
    expect(wordReport.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(wordReport.headers['content-disposition']).toContain('card-dispute-handling-manuel-de-procedure.docx');
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

  it('returns 404 for retired company endpoints', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    const companyList = await request(app).get('/api/companies');
    expect(companyList.status).toBe(404);
    expect(companyList.body.error).toMatch(/removed from this workspace/i);

    const companyUpdate = await request(app).put('/api/companies/2').send({
      name: 'Operations Division',
      description: 'Updated',
    });
    expect(companyUpdate.status).toBe(404);

    const createdCompany = await request(app).post('/api/companies').send({ name: 'New Company', description: 'New' });
    expect(createdCompany.status).toBe(404);

    const deletedCompany = await request(app).delete('/api/companies/12');
    expect(deletedCompany.status).toBe(404);
  });
});
