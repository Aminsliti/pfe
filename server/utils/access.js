import pool from '../db.js';

export const ROLES = {
  ADMINISTRATOR: 'Administrator',
  COMPANY_ADMINISTRATOR: 'Company Administrator',
  BUSINESS_ANALYST: 'Business Analyst',
  PROCESS_OWNER: 'Process Owner',
  RISK_MANAGER: 'Risk Manager',
  VIEWER: 'Viewer',
};

export const PERMISSIONS = {
  USER_MANAGEMENT: 'user_management',
  ROLE_MANAGEMENT: 'role_management',
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',
  MANAGE_PROCESSES: 'manage_processes',
  MANAGE_RISKS: 'manage_risks',
};

const PUBLIC_API_PREFIXES = [
  '/api/login',
  '/api/forgot-password',
  '/api/verify-reset-code',
  '/api/reset-password',
];

const FALLBACK_PERMISSIONS_BY_ROLE = {
  [ROLES.ADMINISTRATOR]: [
    PERMISSIONS.USER_MANAGEMENT,
    PERMISSIONS.ROLE_MANAGEMENT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
    PERMISSIONS.MANAGE_RISKS,
  ],
  [ROLES.COMPANY_ADMINISTRATOR]: [
    PERMISSIONS.USER_MANAGEMENT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
  ],
  [ROLES.BUSINESS_ANALYST]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
  ],
  [ROLES.PROCESS_OWNER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
  ],
  [ROLES.RISK_MANAGER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_RISKS,
  ],
  [ROLES.VIEWER]: [PERMISSIONS.VIEW_DASHBOARD],
};

let accessBootstrapPromise = null;

export function isGlobalAdmin(user) {
  return user?.role === ROLES.ADMINISTRATOR;
}

export function isCompanyAdmin(user) {
  return user?.role === ROLES.COMPANY_ADMINISTRATOR;
}

export function isCompanyScoped(user) {
  return Boolean(user?.companyId) && !isGlobalAdmin(user);
}

export function hasPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

export function canManageUsers(user) {
  return hasPermission(user, PERMISSIONS.USER_MANAGEMENT);
}

export function canManageRoles(user) {
  return hasPermission(user, PERMISSIONS.ROLE_MANAGEMENT);
}

export function canManageProcesses(user) {
  return hasPermission(user, PERMISSIONS.MANAGE_PROCESSES);
}

export function canManageCompanies(user) {
  return isGlobalAdmin(user) || isCompanyAdmin(user);
}

export function getAccessibleCompanyId(user, requestedCompanyId = null) {
  if (isGlobalAdmin(user)) {
    return requestedCompanyId ?? null;
  }

  return user?.companyId ?? null;
}

export function ensureAuthenticated(req, res) {
  if (req.user) {
    return true;
  }

  res.status(401).json({ error: 'Authentication required.' });
  return false;
}

export function ensurePermission(req, res, permission) {
  if (!ensureAuthenticated(req, res)) {
    return false;
  }

  if (hasPermission(req.user, permission)) {
    return true;
  }

  res.status(403).json({ error: 'You do not have permission to perform this action.' });
  return false;
}

export function ensureCompanyAccess(req, res, companyId) {
  if (!ensureAuthenticated(req, res)) {
    return false;
  }

  if (companyId === null || companyId === undefined) {
    if (isGlobalAdmin(req.user)) {
      return true;
    }

    res.status(403).json({ error: 'This record is not assigned to your company.' });
    return false;
  }

  if (isGlobalAdmin(req.user) || req.user.companyId === Number(companyId)) {
    return true;
  }

  res.status(403).json({ error: 'You cannot access data from another company.' });
  return false;
}

export function sanitizeUserPayloadForRole(actor, payload = {}) {
  const nextPayload = { ...payload };

  if (!isGlobalAdmin(actor)) {
    nextPayload.companyId = actor.companyId;

    if (nextPayload.role === ROLES.ADMINISTRATOR) {
      nextPayload.role = ROLES.VIEWER;
    }
  }

  return nextPayload;
}

async function loadPermissionsForRole(role) {
  try {
    const result = await pool.query(
      `
        SELECT p.name
        FROM roles r
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = $1
        ORDER BY p.name
      `,
      [role]
    );

    if (result.rows.length > 0) {
      return result.rows.map((row) => row.name);
    }
  } catch (error) {
    console.error('loadPermissionsForRole error:', error);
  }

  return FALLBACK_PERMISSIONS_BY_ROLE[role] || [];
}

export async function ensureAccessBootstrap() {
  if (!accessBootstrapPromise) {
    accessBootstrapPromise = (async () => {
      const roles = [
        { name: ROLES.COMPANY_ADMINISTRATOR, description: 'Can manage users and data inside their own company' },
      ];

      for (const role of roles) {
        await pool.query(
          'INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [role.name, role.description]
        );
      }

      const permissions = [
        { name: PERMISSIONS.USER_MANAGEMENT, description: 'Create, modify, and delete user accounts' },
        { name: PERMISSIONS.ROLE_MANAGEMENT, description: 'Assign roles and define permissions' },
        { name: PERMISSIONS.VIEW_DASHBOARD, description: 'Access main dashboard' },
        { name: PERMISSIONS.VIEW_REPORTS, description: 'Access and view reports' },
        { name: PERMISSIONS.MANAGE_PROCESSES, description: 'Create and manage processes' },
        { name: PERMISSIONS.MANAGE_RISKS, description: 'Create and manage risk assessments' },
      ];

      for (const permission of permissions) {
        await pool.query(
          'INSERT INTO permissions (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [permission.name, permission.description]
        );
      }

      const rolePermissions = [
        {
          role: ROLES.COMPANY_ADMINISTRATOR,
          permissions: [
            PERMISSIONS.USER_MANAGEMENT,
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_REPORTS,
            PERMISSIONS.MANAGE_PROCESSES,
          ],
        },
      ];

      for (const { role, permissions: rolePerms } of rolePermissions) {
        const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role]);
        if (!roleResult.rows.length) {
          continue;
        }

        for (const permission of rolePerms) {
          const permResult = await pool.query('SELECT id FROM permissions WHERE name = $1', [permission]);
          if (!permResult.rows.length) {
            continue;
          }

          await pool.query(
            `
              INSERT INTO role_permissions (role_id, permission_id)
              VALUES ($1, $2)
              ON CONFLICT (role_id, permission_id) DO NOTHING
            `,
            [roleResult.rows[0].id, permResult.rows[0].id]
          );
        }
      }
    })().catch((error) => {
      accessBootstrapPromise = null;
      throw error;
    });
  }

  return accessBootstrapPromise;
}

export async function buildRequestUser(userId) {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.username,
        u.email,
        u.full_name,
        u.role,
        u.company_id,
        u.created_at,
        u.updated_at,
        c.name AS company_name
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1
    `,
    [userId]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  const permissions = await loadPermissionsForRole(row.role);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    companyId: row.company_id,
    company: row.company_id
      ? {
          id: row.company_id,
          name: row.company_name,
        }
      : null,
    permissions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function attachRequestUser(req, res, next) {
  try {
    await ensureAccessBootstrap();

    if (!req.path.startsWith('/api/')) {
      return next();
    }

    if (PUBLIC_API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }

    const rawUserId = req.header('x-user-id');
    if (!rawUserId) {
      return res.status(401).json({ error: 'Missing user context. Please log in again.' });
    }

    const userId = Number(rawUserId);
    if (!Number.isInteger(userId)) {
      return res.status(401).json({ error: 'Invalid user context.' });
    }

    const requestUser = await buildRequestUser(userId);
    if (!requestUser) {
      return res.status(401).json({ error: 'User not found. Please log in again.' });
    }

    req.user = requestUser;
    next();
  } catch (error) {
    console.error('attachRequestUser error:', error);
    res.status(500).json({ error: 'Failed to resolve the current user context.' });
  }
}
