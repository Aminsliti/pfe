/** @jest-environment node */

import bcrypt from 'bcryptjs';
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

describe('auth routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs in successfully and returns aggregated permissions for active roles', async () => {
    const hashedPassword = await bcrypt.hash('secret', 10);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 3, username: 'analyst', password: hashedPassword }]))
      .mockResolvedValueOnce(makeResult([{
        id: 3,
        username: 'analyst',
        email: 'analyst@pfe.com',
        full_name: 'Business Analyst',
        role: 'Business Analyst',
        company_id: 2,
        company_name: 'Operations Division',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
      }]))
      .mockResolvedValueOnce(makeResult([{
        role_name: 'Risk Manager',
        expires_on: '2026-04-30',
        assigned_by: 1,
        created_at: '2026-03-10T00:00:00.000Z',
        updated_at: '2026-03-10T00:00:00.000Z',
      }]))
      .mockResolvedValueOnce(makeResult([
        { name: 'manage_processes' },
        { name: 'manage_risks' },
        { name: 'view_dashboard' },
      ]));

    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(null) });
    const response = await request(app).post('/api/login').send({ username: 'analyst', password: 'secret' });

    expect(response.status).toBe(200);
    expect(response.body.user.username).toBe('analyst');
    expect(response.body.user.activeRoles).toEqual(['Designer', 'Validator']);
    expect(response.body.permissions).toEqual(['manage_processes', 'manage_risks', 'view_dashboard']);
  });

  it('supports forgot, verify, and reset password public endpoints', async () => {
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(null) });

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 5, email: 'viewer@pfe.com' }]))
      .mockResolvedValueOnce(makeResult([]));

    const forgot = await request(app).post('/api/forgot-password').send({ email: 'viewer@pfe.com' });
    expect(forgot.status).toBe(200);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 5, email: 'viewer@pfe.com' }]));
    const verify = await request(app).post('/api/verify-reset-code').send({ email: 'viewer@pfe.com', code: '123456' });
    expect(verify.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 5, email: 'viewer@pfe.com' }]))
      .mockResolvedValueOnce(makeResult([]));
    const reset = await request(app).post('/api/reset-password').send({
      email: 'viewer@pfe.com',
      code: '123456',
      newPassword: 'new-secret',
    });
    expect(reset.status).toBe(200);
  });

  it('blocks viewers from accessing user management', async () => {
    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({ role: 'Viewer', permissions: ['view_dashboard'], companyId: 2 })
      ),
    });

    const response = await request(app).get('/api/users');
    expect(response.status).toBe(403);
  });

  it('lists users for a company administrator', async () => {
    pool.query
      .mockResolvedValueOnce(makeResult([
        {
          id: 7,
          username: 'anas',
          email: 'anas@example.com',
          full_name: 'Anas Ksiksi',
          role: 'Viewer',
          company_id: 2,
          company_name: 'Operations Division',
          created_at: '2026-03-03T00:00:00.000Z',
          updated_at: '2026-03-04T00:00:00.000Z',
        },
      ]))
      .mockResolvedValueOnce(makeResult([
        {
          user_id: 7,
          role_name: 'Risk Manager',
          expires_on: '2026-05-15',
          assigned_by: 1,
          created_at: '2026-03-04T00:00:00.000Z',
          updated_at: '2026-03-04T00:00:00.000Z',
        },
      ]));

    const app = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({
          role: 'Company Administrator',
          permissions: ['user_management', 'manage_processes'],
          companyId: 2,
          company: { id: 2, name: 'Operations Division' },
        })
      ),
    });

    const response = await request(app).get('/api/users');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        username: 'anas',
        companyId: 2,
        companyName: 'Operations Division',
        activeRoles: ['Process Observer', 'Validator'],
        additionalRoles: [
          expect.objectContaining({
            role: 'Validator',
            expiresOn: '2026-05-15',
            active: true,
          }),
        ],
      }),
    ]);
  });

  it('creates, updates, and deletes users within company scope', async () => {
    const actor = createUser({
      role: 'Company Administrator',
      permissions: ['user_management', 'manage_processes'],
      companyId: 2,
      company: { id: 2, name: 'Operations Division' },
    });
    const app = createApp({ requestUserMiddleware: createRequestUserMiddleware(actor) });

    pool.query
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ id: 11, username: 'newuser', email: 'new@pfe.com', full_name: 'New User', role: 'Viewer', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ name: 'Operations Division' }]))
      .mockResolvedValueOnce(makeResult([
        {
          user_id: 11,
          role_name: 'Risk Manager',
          expires_on: '2026-05-20',
          assigned_by: 1,
          created_at: '2026-03-03T00:00:00.000Z',
          updated_at: '2026-03-03T00:00:00.000Z',
        },
      ]));

    const created = await request(app).post('/api/users').send({
      username: 'newuser',
      password: 'secret',
      email: 'new@pfe.com',
      fullName: 'New User',
      role: 'Viewer',
      companyId: 999,
      additionalRoles: [{ role: 'Risk Manager', expiresOn: '2026-05-20' }],
    });
    expect(created.status).toBe(201);
    expect(created.body.companyId).toBe(2);
    expect(created.body.activeRoles).toEqual(['Process Observer', 'Validator']);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 11, company_id: 2, role: 'Viewer' }]))
      .mockResolvedValueOnce(makeResult([{ id: 11, username: 'newuser', email: 'updated@pfe.com', full_name: 'Updated User', role: 'Viewer', company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([{ name: 'Operations Division' }]))
      .mockResolvedValueOnce(makeResult([
        {
          user_id: 11,
          role_name: 'Process Owner',
          expires_on: '2026-06-01',
          assigned_by: 1,
          created_at: '2026-03-05T00:00:00.000Z',
          updated_at: '2026-03-05T00:00:00.000Z',
        },
      ]));

    const updated = await request(app).put('/api/users/11').send({
      username: 'newuser',
      email: 'updated@pfe.com',
      fullName: 'Updated User',
      role: 'Viewer',
      additionalRoles: [{ role: 'Process Owner', expiresOn: '2026-06-01' }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.email).toBe('updated@pfe.com');
    expect(updated.body.additionalRoles).toEqual([
      expect.objectContaining({
        role: 'Designer',
        expiresOn: '2026-06-01',
        active: true,
      }),
    ]);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 11, company_id: 2 }]))
      .mockResolvedValueOnce(makeResult([{ id: 11 }]));
    const deleted = await request(app).delete('/api/users/11');
    expect(deleted.status).toBe(200);
  });

  it('enforces global-admin-only role management and supports role CRUD endpoints', async () => {
    const companyAdminApp = createApp({
      requestUserMiddleware: createRequestUserMiddleware(
        createUser({
          role: 'Company Administrator',
          permissions: ['user_management'],
          companyId: 2,
        })
      ),
    });
    const forbidden = await request(companyAdminApp).get('/api/roles');
    expect(forbidden.status).toBe(403);

    const adminApp = createApp({ requestUserMiddleware: createRequestUserMiddleware(createUser()) });

    pool.query.mockResolvedValueOnce(makeResult([{ id: 1, name: 'Administrator' }]));
    const roles = await request(adminApp).get('/api/roles');
    expect(roles.status).toBe(200);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 1, name: 'view_dashboard' }]));
    const permissions = await request(adminApp).get('/api/permissions');
    expect(permissions.status).toBe(200);

    pool.query.mockResolvedValueOnce(makeResult([{ id: 4, name: 'manage_processes' }]));
    const rolePermissions = await request(adminApp).get('/api/roles/1/permissions');
    expect(rolePermissions.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 1, name: 'Administrator', description: 'Admin' }]))
      .mockResolvedValueOnce(makeResult([{ id: 1, name: 'view_dashboard' }]));
    const rolesWithPermissions = await request(adminApp).get('/api/roles-with-permissions');
    expect(rolesWithPermissions.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]));
    const updatedPermissions = await request(adminApp)
      .put('/api/roles/1/permissions')
      .send({ permissionIds: [1, 2] });
    expect(updatedPermissions.status).toBe(200);

    const created = await request(adminApp).post('/api/roles').send({ name: 'Auditor', description: 'Read-only auditor' });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/role catalog is fixed/i);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 8, name: 'Auditor' }]))
      .mockResolvedValueOnce(makeResult([{ id: 8, name: 'Auditor', description: 'Updated' }]));
    const updatedRole = await request(adminApp).put('/api/roles/8').send({ name: 'Auditor', description: 'Updated' });
    expect(updatedRole.status).toBe(200);

    pool.query
      .mockResolvedValueOnce(makeResult([{ id: 8, name: 'Auditor' }]))
      .mockResolvedValueOnce(makeResult([{ count: '0' }]))
      .mockResolvedValueOnce(makeResult([{ id: 8 }]));
    const deletedRole = await request(adminApp).delete('/api/roles/8');
    expect(deletedRole.status).toBe(200);
  });
});
