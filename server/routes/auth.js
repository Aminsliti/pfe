import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import {
  ACTIVE_ROLES,
  buildRequestUser,
  canManageRoles,
  canonicalizeRoleName,
  ensurePermission,
  ensureUserRoleAssignmentsTable,
  isGlobalAdmin,
  sanitizeUserPayloadForRole,
  PERMISSIONS,
  ROLES,
} from '../utils/access.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { createNotification } from '../utils/collaboration.js';

const router = express.Router();

function normalizeExpiresOn(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function normalizeStartsOn(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function normalizeAdditionalRoles(rawRoles, primaryRole, actor) {
  if (!Array.isArray(rawRoles)) {
    return [];
  }

  const allowedRoles = new Set(ACTIVE_ROLES);
  const seen = new Set();
  const normalized = [];

  for (const item of rawRoles) {
    const roleName = canonicalizeRoleName(item?.role);

    if (!allowedRoles.has(roleName) || roleName === primaryRole || seen.has(roleName)) {
      continue;
    }

    if (!isGlobalAdmin(actor) && roleName === ROLES.ADMIN) {
      continue;
    }

    const startsOn = normalizeStartsOn(item?.startsOn);
    if (item?.startsOn && !startsOn) {
      throw new Error(`Invalid start date for additional role "${roleName}".`);
    }

    const expiresOn = normalizeExpiresOn(item?.expiresOn);
    if (item?.expiresOn && !expiresOn) {
      throw new Error(`Invalid expiration date for additional role "${roleName}".`);
    }

    if (startsOn && expiresOn && startsOn > expiresOn) {
      throw new Error(`The start date must be before the end date for additional role "${roleName}".`);
    }

    seen.add(roleName);
    normalized.push({ role: roleName, startsOn, expiresOn });
  }

  return normalized;
}

function mapRoleAssignmentRow(row) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    role: canonicalizeRoleName(row.role_name),
    startsOn: row.starts_on,
    expiresOn: row.expires_on,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: (!row.starts_on || row.starts_on <= today) && (!row.expires_on || row.expires_on >= today),
  };
}

async function loadAdditionalRolesForUsers(userIds) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Number.isInteger))];
  if (!normalizedIds.length) {
    return new Map();
  }

  try {
    const result = await pool.query(
      `
        SELECT
          user_id,
          role_name,
          starts_on,
          expires_on,
          assigned_by,
          created_at,
          updated_at
        FROM user_role_assignments
        WHERE user_id = ANY($1::int[])
        ORDER BY user_id, role_name
      `,
      [normalizedIds]
    );

    const assignments = new Map();
    for (const row of result.rows) {
      const mapped = mapRoleAssignmentRow(row);
      const bucket = assignments.get(row.user_id) || [];
      bucket.push(mapped);
      assignments.set(row.user_id, bucket);
    }

    return assignments;
  } catch (error) {
    if (error?.code === '42P01') {
      return new Map();
    }

    throw error;
  }
}

function buildUserResponse(row, additionalRoles = []) {
  const primaryRole = canonicalizeRoleName(row.role);
  const activeRoles = [...new Set([primaryRole, ...additionalRoles.filter((item) => item.active).map((item) => item.role)])];

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: primaryRole,
    primaryRole,
    activeRoles,
    additionalRoles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function syncAdditionalRoles(userId, primaryRole, additionalRoles, assignedBy) {
  if (additionalRoles === undefined) {
    return;
  }

  await ensureUserRoleAssignmentsTable();
  await pool.query('DELETE FROM user_role_assignments WHERE user_id = $1', [userId]);

  for (const assignment of additionalRoles) {
    if (!assignment?.role || assignment.role === primaryRole) {
      continue;
    }

    await pool.query(
      `
        INSERT INTO user_role_assignments (user_id, role_name, starts_on, expires_on, assigned_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `,
      [userId, assignment.role, assignment.startsOn, assignment.expiresOn, assignedBy]
    );
  }
}

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const requestUser = await buildRequestUser(user.id);
    
    res.json({ 
      user: requestUser,
      permissions: requestUser.permissions || [],
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/session', async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const requestUser = await buildRequestUser(req.user.id);
    if (!requestUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
      user: requestUser,
      permissions: requestUser.permissions || [],
    });
  } catch (error) {
    console.error('Session refresh error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.USER_MANAGEMENT)) {
      return;
    }

    const params = [];
    let query = `
      SELECT
        u.id,
        u.username,
        u.email,
        u.full_name,
        u.role,
        u.created_at,
        u.updated_at
      FROM users u
    `;

    query += ' ORDER BY u.id';

    const result = await pool.query(
      query,
      params
    );

    const assignmentsByUser = await loadAdditionalRolesForUsers(result.rows.map((row) => row.id));
    const users = result.rows.map((userRow) => buildUserResponse(userRow, assignmentsByUser.get(userRow.id) || []));
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user
router.post('/users', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.USER_MANAGEMENT)) {
      return;
    }

    const scopedPayload = sanitizeUserPayloadForRole(req.user, req.body);
    const { username, password, email, fullName, role } = scopedPayload;
    const primaryRole = canonicalizeRoleName(role);
    if (!ACTIVE_ROLES.includes(primaryRole)) {
      return res.status(400).json({ error: 'Invalid role selection.' });
    }
    let additionalRoles;
    try {
      additionalRoles = normalizeAdditionalRoles(scopedPayload.additionalRoles, primaryRole, req.user);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    // Check if username already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      `
        INSERT INTO users (username, password, email, full_name, role, company_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, username, email, full_name, role, company_id
      `,
      [username, hashedPassword, email, fullName, primaryRole, null]
    );
    
    const user = result.rows[0];
    await syncAdditionalRoles(user.id, user.role, additionalRoles, req.user.id);
    const assignmentsByUser = await loadAdditionalRolesForUsers([user.id]);
    res.status(201).json(
      buildUserResponse(
        user,
        assignmentsByUser.get(user.id) || []
      )
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'user',
      entityId: user.id,
      companyId: user.company_id,
      action: 'create',
      summary: `Created user "${user.username}"`,
      details: {
        role: user.role,
        email: user.email,
        additionalRoles,
      },
    });

    await createNotification({
      companyId: user.company_id,
      type: 'admin_action',
      title: 'User created',
      message: `${req.user.fullName || req.user.username} created ${user.username}.`,
      entityType: 'user',
      entityId: user.id,
      severity: 'info',
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.USER_MANAGEMENT)) {
      return;
    }

    const { id } = req.params;
    const scopedPayload = sanitizeUserPayloadForRole(req.user, req.body);
    const { username, password, email, fullName, role } = scopedPayload;
    const primaryRole = canonicalizeRoleName(role);
    if (!ACTIVE_ROLES.includes(primaryRole)) {
      return res.status(400).json({ error: 'Invalid role selection.' });
    }
    let additionalRoles;
    try {
      additionalRoles = normalizeAdditionalRoles(scopedPayload.additionalRoles, primaryRole, req.user);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const existingUser = await pool.query(
      'SELECT id, company_id, role FROM users WHERE id = $1',
      [id]
    );

    if (!existingUser.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let query = `
      UPDATE users
      SET username = $1,
          email = $2,
          full_name = $3,
          role = $4,
          updated_at = CURRENT_TIMESTAMP
    `;
    let params = [username, email, fullName, primaryRole, id];
    
    // If password is provided, hash and update it
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = `
        UPDATE users
        SET username = $1,
            password = $2,
            email = $3,
            full_name = $4,
            role = $5,
            updated_at = CURRENT_TIMESTAMP
      `;
      params = [username, hashedPassword, email, fullName, primaryRole, id];
    }
    
    query += ' WHERE id = $' + params.length + ' RETURNING id, username, email, full_name, role, company_id';
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    await syncAdditionalRoles(user.id, user.role, additionalRoles, req.user.id);
    const assignmentsByUser = await loadAdditionalRolesForUsers([user.id]);
    res.json(
      buildUserResponse(
        user,
        assignmentsByUser.get(user.id) || []
      )
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'user',
      entityId: user.id,
      companyId: user.company_id,
      action: 'update',
      summary: `Updated user "${user.username}"`,
      details: {
        role: user.role,
        email: user.email,
        additionalRoles,
      },
    });

    await createNotification({
      companyId: user.company_id,
      type: 'admin_action',
      title: 'User updated',
      message: `${req.user.fullName || req.user.username} updated ${user.username}.`,
      entityType: 'user',
      entityId: user.id,
      severity: 'info',
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.USER_MANAGEMENT)) {
      return;
    }

    const { id } = req.params;

    const existingUser = await pool.query('SELECT id, company_id FROM users WHERE id = $1', [id]);
    if (!existingUser.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'user',
      entityId: id,
      companyId: existingUser.rows[0].company_id,
      action: 'delete',
      summary: `Deleted user #${id}`,
      details: {},
    });

    await createNotification({
      companyId: existingUser.rows[0].company_id,
      type: 'admin_action',
      title: 'User deleted',
      message: `${req.user.fullName || req.user.username} deleted user #${id}.`,
      entityType: 'user',
      entityId: id,
      severity: 'warning',
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all roles
router.get('/roles', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const result = await pool.query('SELECT * FROM roles WHERE name = ANY($1::text[]) ORDER BY id', [ACTIVE_ROLES]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all permissions
router.get('/permissions', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const result = await pool.query('SELECT * FROM permissions ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get role permissions
router.get('/roles/:roleId/permissions', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const { roleId } = req.params;
    const result = await pool.query(
      `SELECT p.* FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [roleId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all roles with their permissions
router.get('/roles-with-permissions', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const rolesResult = await pool.query('SELECT * FROM roles WHERE name = ANY($1::text[]) ORDER BY id', [ACTIVE_ROLES]);
    const roles = rolesResult.rows;

    const rolesWithPermissions = await Promise.all(
      roles.map(async (role) => {
        const permsResult = await pool.query(
          `SELECT p.* FROM permissions p
           JOIN role_permissions rp ON p.id = rp.permission_id
           WHERE rp.role_id = $1`,
          [role.id]
        );
        return {
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: permsResult.rows
        };
      })
    );

    res.json(rolesWithPermissions);
  } catch (error) {
    console.error('Get roles with permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update role permissions
router.put('/roles/:roleId/permissions', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const { roleId } = req.params;
    const { permissionIds } = req.body;
    
    // Remove existing permissions for this role
    await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    
    // Add new permissions
    for (const permissionId of permissionIds) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
        [roleId, permissionId]
      );
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'role',
      entityId: roleId,
      companyId: null,
      action: 'permissions_update',
      summary: `Updated permissions for role #${roleId}`,
      details: {
        permissionIds,
      },
    });

    await createNotification({
      type: 'admin_action',
      title: 'Role permissions updated',
      message: `${req.user.fullName || req.user.username} updated permissions for role #${roleId}.`,
      entityType: 'role',
      entityId: roleId,
      severity: 'info',
    });

    res.json({ message: 'Role permissions updated successfully' });
  } catch (error) {
    console.error('Update role permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create role
router.post('/roles', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    return res.status(400).json({ error: 'The role catalog is fixed. Update permissions on the existing roles instead.' });
  } catch (error) {
    console.error('Create role error:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Role name already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Update role
router.put('/roles/:id', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const { id } = req.params;
    const { name, description } = req.body;
    const existingRole = await pool.query('SELECT id, name FROM roles WHERE id = $1', [id]);
    if (!existingRole.rows.length) {
      return res.status(404).json({ error: 'Role not found' });
    }
    if (name && name !== existingRole.rows[0].name) {
      return res.status(400).json({ error: 'Role names are fixed and cannot be renamed.' });
    }
    
    const result = await pool.query(
      'UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING id, name, description',
      [existingRole.rows[0].name, description, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'role',
      entityId: id,
      companyId: null,
      action: 'update',
      summary: `Updated role "${result.rows[0].name}"`,
      details: {
        description: result.rows[0].description,
      },
    });

    await createNotification({
      type: 'admin_action',
      title: 'Role updated',
      message: `${req.user.fullName || req.user.username} updated the role ${result.rows[0].name}.`,
      entityType: 'role',
      entityId: id,
      severity: 'info',
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update role error:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Role name already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Delete role
router.delete('/roles/:id', async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({ error: 'Only admins can manage roles.' });
    }
    const { id } = req.params;
    const roleResult = await pool.query('SELECT id, name FROM roles WHERE id = $1', [id]);
    if (!roleResult.rows.length) {
      return res.status(404).json({ error: 'Role not found' });
    }
    if (ACTIVE_ROLES.includes(roleResult.rows[0].name)) {
      return res.status(400).json({ error: 'Core roles cannot be deleted.' });
    }
    
    // Check if role is being used by users
    await ensureUserRoleAssignmentsTable();
    const usersWithRole = await pool.query(
      `
        SELECT (
          (SELECT COUNT(*)::int FROM users WHERE role = (SELECT name FROM roles WHERE id = $1))
          +
          (SELECT COUNT(*)::int FROM user_role_assignments WHERE role_name = (SELECT name FROM roles WHERE id = $1))
        ) AS count
      `,
      [id]
    );
    
    if (parseInt(usersWithRole.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete role that is assigned to users' });
    }
    
    const result = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'role',
      entityId: id,
      companyId: null,
      action: 'delete',
      summary: `Deleted role #${id}`,
      details: {},
    });

    await createNotification({
      type: 'admin_action',
      title: 'Role deleted',
      message: `${req.user.fullName || req.user.username} deleted role #${id}.`,
      entityType: 'role',
      entityId: id,
      severity: 'warning',
    });

    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Delete role error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Forgot password - send verification code
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (userResult.rows.length === 0) {
      // For security, don't reveal if email exists or not
      return res.json({ message: 'If the email exists, a verification code has been sent' });
    }

    // Generate 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store reset code in database (you might want to create a separate table for this)
    await pool.query(
      'UPDATE users SET reset_code = $1, reset_code_expires = $2 WHERE email = $3',
      [resetCode, expiresAt, email]
    );

    // In a real application, you would send an email here
    // For demo purposes, we'll just log the code
    console.log(`Password reset code for ${email}: ${resetCode}`);
    
    // Simulate email sending delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify reset code
router.post('/verify-reset-code', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND reset_code = $2 AND reset_code_expires > NOW()',
      [email, code]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    res.json({ message: 'Code verified successfully' });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND reset_code = $2 AND reset_code_expires > NOW()',
      [email, code]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password and clear reset code
    await pool.query(
      'UPDATE users SET password = $1, reset_code = NULL, reset_code_expires = NULL WHERE email = $2',
      [hashedPassword, email]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
