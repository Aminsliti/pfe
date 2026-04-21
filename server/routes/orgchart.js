import express from 'express';
import pool from '../db.js';
import {
  ensureAuthenticated,
  isGlobalAdmin,
} from '../utils/access.js';
import { logAuditEvent } from '../utils/auditLog.js';

const router = express.Router();

const NODE_TYPES = new Set(['company', 'division', 'department', 'team', 'position']);
const TYPE_COLORS = {
  company: '#dc2626',
  division: '#2563eb',
  department: '#7c3aed',
  team: '#0891b2',
  position: '#475569',
};

let schemaPromise = null;

export function resetOrgChartSchemaCache() {
  schemaPromise = null;
}

function canEditOrgChart(user) {
  return isGlobalAdmin(user);
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeNodeType(value) {
  return NODE_TYPES.has(value) ? value : 'position';
}

function defaultColorForType(nodeType) {
  return TYPE_COLORS[nodeType] || TYPE_COLORS.position;
}

function serializeNode(row) {
  return {
    id: row.id,
    parentId: row.parent_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userRole: row.user_role,
    name: row.name,
    title: row.title,
    nodeType: row.node_type,
    description: row.description,
    color: row.color,
    sortOrder: row.sort_order,
    isVacant: row.is_vacant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureOrgChartSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS org_chart_nodes (
          id SERIAL PRIMARY KEY,
          parent_id INTEGER REFERENCES org_chart_nodes(id) ON DELETE SET NULL,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          name VARCHAR(255) NOT NULL,
          title VARCHAR(255),
          node_type VARCHAR(40) NOT NULL DEFAULT 'position',
          description TEXT,
          color VARCHAR(20) NOT NULL DEFAULT '#475569',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_vacant BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS title VARCHAR(255)
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS node_type VARCHAR(40) NOT NULL DEFAULT 'position'
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS description TEXT
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS color VARCHAR(20) NOT NULL DEFAULT '#475569'
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS is_vacant BOOLEAN NOT NULL DEFAULT FALSE
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await seedDefaultOrgChart();
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function seedDefaultOrgChart() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT COUNT(*)::int AS count FROM org_chart_nodes');
    if (existing.rows[0].count > 0) {
      await client.query('COMMIT');
      return;
    }

    const usersResult = await client.query(`
      SELECT id, full_name, role
      FROM users
      ORDER BY id
    `);
    const users = usersResult.rows;

    if (users.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const rootResult = await client.query(
      `
        INSERT INTO org_chart_nodes (
          parent_id,
          company_id,
          user_id,
          name,
          title,
          node_type,
          description,
          color,
          sort_order,
          is_vacant
        )
        VALUES (NULL, NULL, NULL, $1, $2, 'company', $3, $4, 0, FALSE)
        RETURNING id
      `,
      [
        'Organisation',
        'Organisation',
        'Workspace-wide organigram',
        defaultColorForType('company'),
      ]
    );

    const rootId = rootResult.rows[0].id;
    const roleBuckets = {
      Admin: { key: 'leadership', label: 'Leadership', type: 'division', color: '#dc2626' },
      Designer: { key: 'process', label: 'Process Design', type: 'department', color: '#2563eb' },
      Validator: { key: 'validation', label: 'Validation', type: 'department', color: '#7c3aed' },
    };
    const departments = new Map();

    for (const user of users) {
      const bucket = roleBuckets[user.role] || {
        key: 'general',
        label: 'General Administration',
        type: 'department',
        color: '#475569',
      };
      const departmentKey = `${rootId}:${bucket.key}`;

      let departmentId = departments.get(departmentKey);
      if (!departmentId) {
        const insertDepartment = await client.query(
          `
            INSERT INTO org_chart_nodes (
              parent_id,
              company_id,
              user_id,
              name,
              title,
              node_type,
              description,
              color,
              sort_order,
              is_vacant
            )
            VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, FALSE)
            RETURNING id
          `,
          [
            rootId,
            bucket.label,
            'Department',
            bucket.type,
            `Auto-generated from ${bucket.label} roles`,
            bucket.color,
            departments.size,
          ]
        );

        departmentId = insertDepartment.rows[0].id;
        departments.set(departmentKey, departmentId);
      }

      await client.query(
        `
          INSERT INTO org_chart_nodes (
            parent_id,
            company_id,
            user_id,
            name,
            title,
            node_type,
            description,
            color,
            sort_order,
            is_vacant
          )
          VALUES ($1, NULL, $2, $3, $4, 'position', $5, $6, $7, FALSE)
        `,
        [
          departmentId,
          user.id,
          user.full_name,
          user.role,
          `Auto-generated position for ${user.full_name}`,
          defaultColorForType('position'),
          user.id,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getNodes(client = pool) {
  const result = await client.query(`
    SELECT
      n.id,
      n.parent_id,
      n.user_id,
      n.name,
      n.title,
      n.node_type,
      n.description,
      n.color,
      n.sort_order,
      n.is_vacant,
      n.created_at,
      n.updated_at,
      u.full_name AS user_name,
      u.email AS user_email,
      u.role AS user_role
    FROM org_chart_nodes n
    LEFT JOIN users u ON u.id = n.user_id
    ORDER BY n.parent_id NULLS FIRST, n.sort_order, n.name
  `);

  return result.rows.map(serializeNode);
}

async function getNodeById(client, id) {
  const result = await client.query(
    `
      SELECT
        n.id,
        n.parent_id,
        n.user_id,
        n.name,
        n.title,
        n.node_type,
        n.description,
        n.color,
        n.sort_order,
        n.is_vacant,
        n.created_at,
        n.updated_at,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM org_chart_nodes n
      LEFT JOIN users u ON u.id = n.user_id
      WHERE n.id = $1
    `,
    [id]
  );

  return result.rows[0] ? serializeNode(result.rows[0]) : null;
}

async function getNextSortOrder(client, parentId) {
  const result = parentId === null
    ? await client.query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id IS NULL'
      )
    : await client.query(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort FROM org_chart_nodes WHERE parent_id = $1',
        [parentId]
      );

  return Number(result.rows[0].next_sort) || 0;
}

async function ensureValidParent(client, nodeId, parentId) {
  if (parentId === null) {
    return true;
  }

  if (nodeId !== null && nodeId === parentId) {
    return false;
  }

  const allNodesResult = await client.query('SELECT id, parent_id FROM org_chart_nodes');
  const parentMap = new Map(
    allNodesResult.rows.map((row) => [Number(row.id), row.parent_id === null ? null : Number(row.parent_id)])
  );

  let current = parentId;
  while (current !== null) {
    if (current === nodeId) {
      return false;
    }
    current = parentMap.get(current) ?? null;
  }

  return true;
}

async function getAssignableUser(client, userId) {
  if (userId === null) {
    return null;
  }

  const result = await client.query(
    'SELECT id, full_name, role FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0] || null;
}

router.get('/orgchart/meta', async (req, res) => {
  try {
    await ensureOrgChartSchema();

    if (!req.user) {
      return res.json({
        users: [],
        nodeTypes: Array.from(NODE_TYPES),
      });
    }

    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const usersResult = await pool.query(`
      SELECT
        u.id,
        u.full_name,
        u.email,
        u.role
      FROM users u
      ORDER BY u.full_name
    `);

    res.json({
      users: usersResult.rows.map((user) => ({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      })),
      nodeTypes: Array.from(NODE_TYPES),
    });
  } catch (error) {
    console.error('orgchart/meta error:', error);
    res.status(500).json({ error: 'Failed to load organigram metadata.' });
  }
});

router.get('/orgchart/nodes', async (req, res) => {
  try {
    await ensureOrgChartSchema();
    const nodes = await getNodes(pool);
    res.json(nodes);
  } catch (error) {
    console.error('orgchart/nodes error:', error);
    res.status(500).json({ error: 'Failed to load organigram nodes.' });
  }
});

router.post('/orgchart/nodes', async (req, res) => {
  await ensureOrgChartSchema();
  const client = await pool.connect();

  try {
    if (!canEditOrgChart(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit the organigram.' });
    }

    const parentId = normalizeInteger(req.body.parentId);
    const userId = normalizeInteger(req.body.userId);
    const nodeType = normalizeNodeType(req.body.nodeType);
    const name = normalizeText(req.body.name);
    const title = normalizeText(req.body.title);
    const description = normalizeText(req.body.description);
    const color = normalizeText(req.body.color) || defaultColorForType(nodeType);
    const isVacant = Boolean(req.body.isVacant);

    if (!name) {
      return res.status(400).json({ error: 'Node name is required.' });
    }

    await client.query('BEGIN');

    if (parentId !== null) {
      const parentNode = await getNodeById(client, parentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Parent node not found.' });
      }
    }

    const assignedUser = await getAssignableUser(client, isVacant ? null : userId);
    if (userId !== null && !assignedUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assigned user not found.' });
    }

    const sortOrder = await getNextSortOrder(client, parentId);

    const insertResult = await client.query(
      `
        INSERT INTO org_chart_nodes (
          parent_id,
          company_id,
          user_id,
          name,
          title,
          node_type,
          description,
          color,
          sort_order,
          is_vacant
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `,
      [
        parentId,
        null,
        isVacant ? null : userId,
        name,
        title,
        nodeType,
        description,
        color,
        sortOrder,
        isVacant,
      ]
    );

    const createdNode = await getNodeById(client, insertResult.rows[0].id);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: createdNode.id,
      companyId: null,
      action: 'create',
      summary: `Created organigram node "${createdNode.name}"`,
      details: {
        parentId: createdNode.parentId,
        nodeType: createdNode.nodeType,
        userId: createdNode.userId,
      },
    });

    res.status(201).json(createdNode);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('orgchart create error:', error);
    res.status(500).json({ error: 'Failed to create organigram node.' });
  } finally {
    client.release();
  }
});

router.put('/orgchart/nodes/:id', async (req, res) => {
  await ensureOrgChartSchema();
  const client = await pool.connect();

  try {
    if (!canEditOrgChart(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    const parentId = req.body.parentId === undefined
      ? undefined
      : normalizeInteger(req.body.parentId);
    const requestedUserId = req.body.userId === undefined
      ? undefined
      : normalizeInteger(req.body.userId);

    await client.query('BEGIN');

    const existing = await getNodeById(client, nodeId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }

    const nextParentId = parentId === undefined ? existing.parentId : parentId;
    const isParentValid = await ensureValidParent(client, nodeId, nextParentId);
    if (!isParentValid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A node cannot be moved inside its own subtree.' });
    }

    if (nextParentId !== null) {
      const parentNode = await getNodeById(client, nextParentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Selected parent node does not exist.' });
      }
    }

    const nextType = req.body.nodeType === undefined
      ? existing.nodeType
      : normalizeNodeType(req.body.nodeType);
    const nextColor = req.body.color === undefined
      ? existing.color
      : normalizeText(req.body.color) || defaultColorForType(nextType);
    const nextVacant = req.body.isVacant === undefined
      ? existing.isVacant
      : Boolean(req.body.isVacant);
    const nextUserId = nextVacant
      ? null
      : (requestedUserId === undefined ? existing.userId : requestedUserId);
    const assignedUser = await getAssignableUser(client, nextUserId);
    if (nextUserId !== null && !assignedUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assigned user not found.' });
    }
    const nextSortOrder = nextParentId !== existing.parentId
      ? await getNextSortOrder(client, nextParentId)
      : existing.sortOrder;

    await client.query(
      `
        UPDATE org_chart_nodes
        SET
          parent_id = $1,
          company_id = NULL,
          user_id = $2,
          name = $3,
          title = $4,
          node_type = $5,
          description = $6,
          color = $7,
          is_vacant = $8,
          sort_order = $9,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
      `,
      [
        nextParentId,
        nextUserId,
        normalizeText(req.body.name) || existing.name,
        req.body.title === undefined ? existing.title : normalizeText(req.body.title),
        nextType,
        req.body.description === undefined ? existing.description : normalizeText(req.body.description),
        nextColor,
        nextVacant,
        nextSortOrder,
        nodeId,
      ]
    );

    const updatedNode = await getNodeById(client, nodeId);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: updatedNode.id,
      companyId: null,
      action: 'update',
      summary: `Updated organigram node "${updatedNode.name}"`,
      details: {
        parentId: updatedNode.parentId,
        nodeType: updatedNode.nodeType,
        userId: updatedNode.userId,
      },
    });

    res.json(updatedNode);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('orgchart update error:', error);
    res.status(500).json({ error: 'Failed to update organigram node.' });
  } finally {
    client.release();
  }
});

router.patch('/orgchart/nodes/:id/move', async (req, res) => {
  await ensureOrgChartSchema();
  const client = await pool.connect();

  try {
    if (!canEditOrgChart(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    const parentId = normalizeInteger(req.body.parentId);

    await client.query('BEGIN');

    const node = await getNodeById(client, nodeId);
    if (!node) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }

    const isParentValid = await ensureValidParent(client, nodeId, parentId);
    if (!isParentValid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A node cannot be moved inside its own subtree.' });
    }

    if (parentId !== null) {
      const parentNode = await getNodeById(client, parentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Target parent not found.' });
      }
    }

    const sortOrder = await getNextSortOrder(client, parentId);
    await client.query(
      `
        UPDATE org_chart_nodes
        SET parent_id = $1,
            company_id = NULL,
            sort_order = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [parentId, sortOrder, nodeId]
    );

    const movedNode = await getNodeById(client, nodeId);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: movedNode.id,
      companyId: null,
      action: 'move',
      summary: `Moved organigram node "${movedNode.name}"`,
      details: {
        parentId: movedNode.parentId,
      },
    });

    res.json(movedNode);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('orgchart move error:', error);
    res.status(500).json({ error: 'Failed to move organigram node.' });
  } finally {
    client.release();
  }
});

router.delete('/orgchart/nodes/:id', async (req, res) => {
  await ensureOrgChartSchema();
  const client = await pool.connect();

  try {
    if (!canEditOrgChart(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    await client.query('BEGIN');

    const node = await getNodeById(client, nodeId);
    if (!node) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }

    const nextSortOrder = await getNextSortOrder(client, node.parentId);

    await client.query(
      `
        UPDATE org_chart_nodes
        SET parent_id = $1,
            company_id = NULL,
            sort_order = sort_order + $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE parent_id = $2
      `,
      [node.parentId, nodeId, nextSortOrder]
    );

    await client.query('DELETE FROM org_chart_nodes WHERE id = $1', [nodeId]);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: nodeId,
      companyId: null,
      action: 'delete',
      summary: `Deleted organigram node "${node.name}"`,
      details: {
        parentId: node.parentId,
      },
    });

    res.json({ message: 'Organigram node deleted successfully.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('orgchart delete error:', error);
    res.status(500).json({ error: 'Failed to delete organigram node.' });
  } finally {
    client.release();
  }
});

export default router;
