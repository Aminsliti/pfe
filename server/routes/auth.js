import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

const router = express.Router();

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

    // Simple permissions - hardcoded for admin
    const permissions = user.role === 'Administrator' 
      ? ['view_dashboard', 'manage_processes', 'user_management', 'role_management', 'view_reports']
      : ['view_dashboard'];

    // Return user without password and with camelCase field names
    const { password: _, ...userWithoutPassword } = user;
    const userData = {
      id: userWithoutPassword.id,
      username: userWithoutPassword.username,
      email: userWithoutPassword.email,
      fullName: userWithoutPassword.full_name,
      role: userWithoutPassword.role,
      company: null,
      createdAt: userWithoutPassword.created_at,
      updatedAt: userWithoutPassword.updated_at
    };
    
    res.json({ 
      user: userData,
      permissions
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, full_name, role, created_at, updated_at FROM users ORDER BY id'
    );
    
    const users = result.rows.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }));
    
    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user
router.post('/users', async (req, res) => {
  try {
    const { username, password, email, fullName, role } = req.body;
    
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
      'INSERT INTO users (username, password, email, full_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, full_name, role',
      [username, hashedPassword, email, fullName, role]
    );
    
    const user = result.rows[0];
    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, email, fullName, role } = req.body;
    
    let query = 'UPDATE users SET username = $1, email = $2, full_name = $3, role = $4, updated_at = CURRENT_TIMESTAMP';
    let params = [username, email, fullName, role, id];
    
    // If password is provided, hash and update it
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = 'UPDATE users SET username = $1, password = $2, email = $3, full_name = $4, role = $5, updated_at = CURRENT_TIMESTAMP';
      params = [username, hashedPassword, email, fullName, role, id];
    }
    
    query += ' RETURNING id, username, email, full_name, role';
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = result.rows[0];
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all roles
router.get('/roles', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roles ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all permissions
router.get('/permissions', async (req, res) => {
  try {
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
    const rolesResult = await pool.query('SELECT * FROM roles ORDER BY id');
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
    
    res.json({ message: 'Role permissions updated successfully' });
  } catch (error) {
    console.error('Update role permissions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create role
router.post('/roles', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await pool.query(
      'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id, name, description',
      [name, description]
    );
    
    const role = result.rows[0];
    res.status(201).json(role);
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
    const { id } = req.params;
    const { name, description } = req.body;
    
    const result = await pool.query(
      'UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING id, name, description',
      [name, description, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
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
    const { id } = req.params;
    
    // Check if role is being used by users
    const usersWithRole = await pool.query('SELECT COUNT(*) FROM users WHERE role = (SELECT name FROM roles WHERE id = $1)', [id]);
    
    if (parseInt(usersWithRole.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete role that is assigned to users' });
    }
    
    const result = await pool.query('DELETE FROM roles WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
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

