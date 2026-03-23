// server/routes/orgchart.js
// Add to server/index.js:
//   import orgchartRoutes from './routes/orgchart.js';
//   app.use('/api', orgchartRoutes);

import express from 'express';
import pool from '../db.js';

const router = express.Router();

// Middleware: verify JWT (copy from your auth routes)
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = await import('jsonwebtoken');
    const token = authHeader.slice(7);
    const payload = jwt.default.verify(token, process.env.JWT_SECRET);
    req.userId = payload.id || payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── GET /api/orgchart/users
// Returns all users with their company name
router.get('/orgchart/users', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.email,
        u.role,
        u.company_id,
        u.created_at,
        c.name AS company_name
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      WHERE u.role IS NOT NULL
      ORDER BY
        CASE u.role
          WHEN 'Administrator'    THEN 1
          WHEN 'Business Analyst' THEN 2
          WHEN 'Process Owner'    THEN 3
          WHEN 'Risk Manager'     THEN 4
          WHEN 'Viewer'           THEN 5
          ELSE 6
        END,
        u.full_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('orgchart/users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ── GET /api/orgchart/user/:id/processes
// Returns all processes created by a specific user, with category and parent name
router.get('/orgchart/user/:id/processes', authenticate, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.version,
        p.created_at,
        p.updated_at,
        pc.name  AS category_name,
        par.name AS parent_name
      FROM processes p
      LEFT JOIN process_categories pc ON pc.id = p.category_id
      LEFT JOIN processes par         ON par.id = p.parent_id
      WHERE p.created_by = $1
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
    `, [userId]);

    res.json(rows);
  } catch (err) {
    console.error('orgchart/user processes error:', err);
    res.status(500).json({ error: 'Failed to load processes' });
  }
});

// ── GET /api/orgchart/stats
// Returns a summary count per user (useful for the chart badges)
router.get('/orgchart/stats', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.full_name,
        u.role,
        COUNT(p.id)::int AS process_count,
        COUNT(p.id) FILTER (WHERE p.status = 'published')::int AS published_count,
        COUNT(p.id) FILTER (WHERE p.status = 'draft')::int AS draft_count
      FROM users u
      LEFT JOIN processes p ON p.created_by = u.id
      GROUP BY u.id, u.full_name, u.role
      ORDER BY process_count DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('orgchart/stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
