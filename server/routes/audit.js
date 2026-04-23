import express from 'express';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensurePermission,
} from '../utils/access.js';
import { ensureAuditSchema } from '../utils/auditLog.js';

const router = express.Router();

router.use(async (req, res, next) => {
  try {
    await ensureAuditSchema();
    next();
  } catch (error) {
    console.error('audit schema error:', error);
    res.status(500).json({ error: 'Failed to prepare audit log storage.' });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.USER_MANAGEMENT)) {
      return;
    }

    const { entityType, action, search } = req.query;
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));

    const params = [];
    let paramIndex = 1;
    let query = `
      SELECT
        al.*
      FROM audit_logs al
      WHERE 1=1
    `;

    if (entityType) {
      query += ` AND al.entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex += 1;
    }

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action);
      paramIndex += 1;
    }

    if (search) {
      query += ` AND (al.summary ILIKE $${paramIndex} OR al.user_name ILIKE $${paramIndex} OR al.entity_id ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('audit log list error:', error);
    res.status(500).json({ error: 'Failed to load audit logs.' });
  }
});

export default router;
