import pool from '../db.js';
import { extractBearerToken, JwtVerificationError, verifyAccessToken } from './jwt.js';

export const ROLES = {
  ADMIN: 'Admin',
  DESIGNER: 'Designer',
  VALIDATOR: 'Validator',
};

export const ACTIVE_ROLES = Object.values(ROLES);

export const LEGACY_ROLE_MAP = {
  Administrator: ROLES.ADMIN,
  'Company Administrator': ROLES.ADMIN,
  'Business Analyst': ROLES.DESIGNER,
  'Process Owner': ROLES.DESIGNER,
  'Process Designer': ROLES.DESIGNER,
  'Risk Manager': ROLES.VALIDATOR,
  'Process Validator': ROLES.VALIDATOR,
  'Process Manager': ROLES.VALIDATOR,
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

const PUBLIC_READ_API_PREFIXES = [
  '/api/processes',
  '/api/process-categories',
  '/api/orgchart/nodes',
  '/api/orgchart/meta',
];

const FALLBACK_PERMISSIONS_BY_ROLE = {
  [ROLES.ADMIN]: [
    PERMISSIONS.USER_MANAGEMENT,
    PERMISSIONS.ROLE_MANAGEMENT,
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
    PERMISSIONS.MANAGE_RISKS,
  ],
  [ROLES.DESIGNER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
  ],
  [ROLES.VALIDATOR]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.MANAGE_PROCESSES,
  ],
};

let accessBootstrapPromise = null;
let userRoleAssignmentSchemaPromise = null;
const SESSION_TOUCH_THROTTLE_MS = 60 * 1000;
const PRESENCE_SESSION_TTL_MS = 2 * 60 * 1000;
const lastSeenTouchCache = new Map();

export function canonicalizeRoleName(role) {
  if (!role) {
    return null;
  }

  return LEGACY_ROLE_MAP[role] || role;
}

function dedupeRoles(roles = []) {
  return [...new Set((Array.isArray(roles) ? roles : [roles]).map(canonicalizeRoleName).filter(Boolean))];
}

export function getUserActiveRoles(user) {
  if (Array.isArray(user?.activeRoles) && user.activeRoles.length) {
    return dedupeRoles(user.activeRoles);
  }

  if (Array.isArray(user?.roles) && user.roles.length) {
    return dedupeRoles(user.roles);
  }

  return dedupeRoles(user?.role);
}

export function hasRole(user, role) {
  return getUserActiveRoles(user).includes(canonicalizeRoleName(role));
}

export function hasAnyRole(user, roles = []) {
  return roles.some((role) => hasRole(user, role));
}

export function isAdmin(user) {
  return hasRole(user, ROLES.ADMIN);
}

export function isGlobalAdmin(user) {
  return isAdmin(user);
}

export function isCompanyAdmin(user) {
  return false;
}

export function isCompanyScoped(user) {
  return false;
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
  return false;
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
  return true;
}

export function sanitizeUserPayloadForRole(actor, payload = {}) {
  return { ...payload };
}

async function loadPermissionsForRoles(roles) {
  const normalizedRoles = dedupeRoles(roles);

  if (!normalizedRoles.length) {
    return [];
  }

  try {
    const result = await pool.query(
      `
        SELECT DISTINCT p.name
        FROM roles r
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = ANY($1::text[])
        ORDER BY p.name
      `,
      [normalizedRoles]
    );

    if (result.rows.length > 0) {
      return result.rows.map((row) => row.name);
    }
  } catch (error) {
    console.error('loadPermissionsForRoles error:', error);
  }

  return dedupeRoles(normalizedRoles.flatMap((role) => FALLBACK_PERMISSIONS_BY_ROLE[role] || []));
}

export async function ensureUserRoleAssignmentsTable() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!userRoleAssignmentSchemaPromise) {
    userRoleAssignmentSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_role_assignments (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_name VARCHAR(50) NOT NULL REFERENCES roles(name) ON UPDATE CASCADE ON DELETE CASCADE,
          starts_on DATE,
          expires_on DATE,
          assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, role_name)
        )
      `);

      await pool.query(`
        ALTER TABLE user_role_assignments
        ADD COLUMN IF NOT EXISTS role_name VARCHAR(50),
        ADD COLUMN IF NOT EXISTS starts_on DATE,
        ADD COLUMN IF NOT EXISTS expires_on DATE,
        ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);

      const columnResult = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'user_role_assignments'
      `);
      const columns = new Set(columnResult.rows.map((row) => row.column_name));

      if (columns.has('role_id')) {
        await pool.query(`
          UPDATE user_role_assignments AS ura
          SET role_name = r.name
          FROM roles AS r
          WHERE ura.role_name IS NULL
            AND ura.role_id = r.id
        `);
      }

      if (columns.has('expires_at')) {
        await pool.query(`
          UPDATE user_role_assignments
          SET expires_on = expires_at::date
          WHERE expires_on IS NULL
            AND expires_at IS NOT NULL
        `);
      }

      await pool.query(`
        UPDATE user_role_assignments
        SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
        WHERE updated_at IS NULL
      `);

      await pool.query(`
        UPDATE user_role_assignments
        SET starts_on = COALESCE(starts_on, created_at::date, CURRENT_DATE)
        WHERE starts_on IS NULL
      `);
    })().catch((error) => {
      userRoleAssignmentSchemaPromise = null;
      throw error;
    });
  }

  return userRoleAssignmentSchemaPromise;
}

async function migrateLegacyRoles() {
  const canonicalRoleDescriptions = {
    [ROLES.ADMIN]: 'Can administer the workspace and manage governance actions',
    [ROLES.DESIGNER]: 'Can design and update draft processes',
    [ROLES.VALIDATOR]: 'Can review, approve, and reopen governed processes',
  };

  const legacyPairs = [
    ['Administrator', ROLES.ADMIN],
    ['Company Administrator', ROLES.ADMIN],
    ['Business Analyst', ROLES.DESIGNER],
    ['Process Owner', ROLES.DESIGNER],
    ['Process Designer', ROLES.DESIGNER],
    ['Risk Manager', ROLES.VALIDATOR],
    ['Process Validator', ROLES.VALIDATOR],
    ['Process Manager', ROLES.VALIDATOR],
  ];

  for (const [, canonicalName] of legacyPairs) {
    await pool.query(
      'INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [canonicalName, canonicalRoleDescriptions[canonicalName]]
    );
  }

  for (const [legacyName, canonicalName] of legacyPairs) {
    if (legacyName === canonicalName) {
      continue;
    }

    const [legacyRoleResult, canonicalRoleResult] = await Promise.all([
      pool.query('SELECT id FROM roles WHERE name = $1', [legacyName]),
      pool.query('SELECT id FROM roles WHERE name = $1', [canonicalName]),
    ]);

    const legacyRoleId = legacyRoleResult.rows[0]?.id;
    const canonicalRoleId = canonicalRoleResult.rows[0]?.id;

    await pool.query('UPDATE users SET role = $1 WHERE role = $2', [canonicalName, legacyName]);
    await pool.query('UPDATE user_role_assignments SET role_name = $1 WHERE role_name = $2', [canonicalName, legacyName]);

    if (!legacyRoleId || !canonicalRoleId || legacyRoleId === canonicalRoleId) {
      continue;
    }

    await pool.query(
      `
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT $1, permission_id
        FROM role_permissions
        WHERE role_id = $2
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [canonicalRoleId, legacyRoleId]
    );
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [legacyRoleId]);
    await pool.query('DELETE FROM roles WHERE id = $1', [legacyRoleId]);
  }
}

export async function loadAdditionalRoleAssignments(userId, { includeExpired = true } = {}) {
  try {
    const params = [userId];
    let query = `
      SELECT
        role_name,
        starts_on,
        expires_on,
        assigned_by,
        created_at,
        updated_at
      FROM user_role_assignments
      WHERE user_id = $1
    `;

    if (!includeExpired) {
      query += ' AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)';
    }

    query += ' ORDER BY role_name';

    const result = await pool.query(query, params);
    const today = new Date().toISOString().slice(0, 10);

    return result.rows.map((row) => ({
      role: canonicalizeRoleName(row.role_name),
      startsOn: row.starts_on,
      expiresOn: row.expires_on,
      assignedBy: row.assigned_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      active: (!row.starts_on || row.starts_on <= today) && (!row.expires_on || row.expires_on >= today),
    }));
  } catch (error) {
    if (error?.code === '42P01') {
      return [];
    }

    console.error('loadAdditionalRoleAssignments error:', error);
    return [];
  }
}

export async function ensureAccessBootstrap() {
  if (!accessBootstrapPromise) {
    accessBootstrapPromise = (async () => {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
      `);

      await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_presence_sessions (
          session_id VARCHAR(128) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        ALTER TABLE user_presence_sessions
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      `);

      await pool.query(`
        UPDATE user_presence_sessions
        SET expires_at = COALESCE(expires_at, CURRENT_TIMESTAMP)
        WHERE expires_at IS NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_presence_sessions_user_id
        ON user_presence_sessions(user_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_user_presence_sessions_expires_at
        ON user_presence_sessions(expires_at)
      `);

      await ensureUserRoleAssignmentsTable();
      await migrateLegacyRoles();

      const roles = [
        { name: ROLES.ADMIN, description: 'Can administer the workspace and manage governance actions' },
        { name: ROLES.DESIGNER, description: 'Can design and update draft processes' },
        { name: ROLES.VALIDATOR, description: 'Can review, approve, and reopen governed processes' },
      ];

      for (const role of roles) {
        await pool.query(
          'INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description',
          [role.name, role.description]
        );
      }

      const permissions = [
        { name: PERMISSIONS.USER_MANAGEMENT, description: 'Create, modify, and delete user accounts' },
        { name: PERMISSIONS.ROLE_MANAGEMENT, description: 'Assign roles and define permissions' },
        { name: PERMISSIONS.VIEW_DASHBOARD, description: 'Access the process workspace' },
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
          role: ROLES.ADMIN,
          permissions: [
            PERMISSIONS.USER_MANAGEMENT,
            PERMISSIONS.ROLE_MANAGEMENT,
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_REPORTS,
            PERMISSIONS.MANAGE_PROCESSES,
            PERMISSIONS.MANAGE_RISKS,
          ],
        },
        {
          role: ROLES.DESIGNER,
          permissions: [
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_REPORTS,
            PERMISSIONS.MANAGE_PROCESSES,
          ],
        },
        {
          role: ROLES.VALIDATOR,
          permissions: [
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

        const roleId = roleResult.rows[0].id;
        await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

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
            [roleId, permResult.rows[0].id]
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
        u.is_active,
        u.last_seen_at,
        EXISTS(
          SELECT 1
          FROM user_presence_sessions ups
          WHERE ups.user_id = u.id
            AND ups.expires_at > CURRENT_TIMESTAMP
        ) AS online,
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
  const primaryRole = canonicalizeRoleName(row.role);
  const additionalRoles = await loadAdditionalRoleAssignments(row.id, { includeExpired: true });
  const activeRoles = dedupeRoles([
    primaryRole,
    ...additionalRoles.filter((assignment) => assignment.active).map((assignment) => assignment.role),
  ]);
  const permissions = await loadPermissionsForRoles(activeRoles);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: primaryRole,
    primaryRole,
    activeRoles,
    additionalRoles,
    isActive: row.is_active !== false,
    lastSeenAt: row.last_seen_at,
    online: row.is_active !== false && row.online === true,
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

export function isUserCurrentlyOnline(lastSeenAt) {
  return lastSeenAt === true;
}

export function normalizePresenceSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    return null;
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

async function clearExpiredPresenceSessions() {
  await pool.query(`
    DELETE FROM user_presence_sessions
    WHERE expires_at <= CURRENT_TIMESTAMP
  `);
}

export async function markUserPresenceSession(userId, sessionId) {
  const normalizedUserId = Number(userId);
  const normalizedSessionId = normalizePresenceSessionId(sessionId);

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedSessionId) {
    return;
  }

  const cacheKey = `${normalizedUserId}:${normalizedSessionId}`;
  const lastTouchedAt = lastSeenTouchCache.get(cacheKey) || 0;
  const now = Date.now();

  if (now - lastTouchedAt < SESSION_TOUCH_THROTTLE_MS) {
    return;
  }

  lastSeenTouchCache.set(cacheKey, now);
  const expiresAt = new Date(now + PRESENCE_SESSION_TTL_MS);

  await pool.query(
    `
      INSERT INTO user_presence_sessions (
        session_id,
        user_id,
        last_seen_at,
        expires_at,
        updated_at
      )
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (session_id) DO UPDATE
      SET
        user_id = EXCLUDED.user_id,
        last_seen_at = CURRENT_TIMESTAMP,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `,
    [normalizedSessionId, normalizedUserId, expiresAt]
  );
}

export async function clearUserPresenceSession(userId, sessionId = null) {
  const normalizedUserId = Number(userId);
  const normalizedSessionId = normalizePresenceSessionId(sessionId);

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return;
  }

  if (normalizedSessionId) {
    lastSeenTouchCache.delete(`${normalizedUserId}:${normalizedSessionId}`);
    await pool.query(
      `
        DELETE FROM user_presence_sessions
        WHERE user_id = $1
          AND session_id = $2
      `,
      [normalizedUserId, normalizedSessionId]
    );
    return;
  }

  for (const cacheKey of lastSeenTouchCache.keys()) {
    if (cacheKey.startsWith(`${normalizedUserId}:`)) {
      lastSeenTouchCache.delete(cacheKey);
    }
  }

  await pool.query('DELETE FROM user_presence_sessions WHERE user_id = $1', [normalizedUserId]);
}

async function touchUserSession(userId, sessionId = null) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return;
  }

  await clearExpiredPresenceSessions();

  await pool.query(
    `
      UPDATE users
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [normalizedUserId]
  );

  await markUserPresenceSession(normalizedUserId, sessionId);
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

    let accessToken = null;
    try {
      accessToken = extractBearerToken(req.header('authorization'));
    } catch (error) {
      if (error instanceof JwtVerificationError) {
        return res.status(401).json({ error: 'Invalid authorization header. Please log in again.' });
      }

      throw error;
    }

    if (
      req.method === 'GET' &&
      PUBLIC_READ_API_PREFIXES.some((prefix) => req.path.startsWith(prefix)) &&
      !accessToken
    ) {
      return next();
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'Missing authentication token. Please log in again.' });
    }

    let tokenPayload;
    try {
      tokenPayload = verifyAccessToken(accessToken);
    } catch (error) {
      if (error instanceof JwtVerificationError) {
        return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
      }

      throw error;
    }

    const userId = tokenPayload.userId;
    const tokenSessionId = normalizePresenceSessionId(tokenPayload.sid);
    const headerSessionId = normalizePresenceSessionId(req.header('x-session-id'));
    const presenceSessionId = tokenSessionId || headerSessionId;

    const requestUser = await buildRequestUser(userId);
    if (!requestUser) {
      return res.status(401).json({ error: 'User not found. Please log in again.' });
    }

    if (requestUser.isActive === false) {
      await clearUserPresenceSession(userId, presenceSessionId);
      return res.status(401).json({ error: 'This account is inactive. Please contact an administrator.' });
    }

    await touchUserSession(requestUser.id, presenceSessionId);

    req.user = requestUser;
    req.presenceSessionId = presenceSessionId;
    req.auth = tokenPayload;
    next();
  } catch (error) {
    console.error('attachRequestUser error:', error);
    res.status(500).json({ error: 'Failed to resolve the current user context.' });
  }
}
