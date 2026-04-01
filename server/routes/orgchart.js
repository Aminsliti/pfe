import express from 'express';
import pool from '../db.js';
import {
  ensureAuthenticated,
  ensureCompanyAccess,
  isCompanyAdmin,
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
  return isGlobalAdmin(user) || isCompanyAdmin(user);
}

function isNodeAccessibleToUser(node, user) {
  if (isGlobalAdmin(user)) {
    return true;
  }

  return Boolean(user?.companyId) && node?.companyId === user.companyId;
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
    companyId: row.company_id,
    companyName: row.company_name,
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

async function ensureOrgChartSchema() {
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

    const companiesResult = await client.query(`
      SELECT id, name, description
      FROM companies
      ORDER BY name
    `);
    const usersResult = await client.query(`
      SELECT id, full_name, role, company_id
      FROM users
      ORDER BY company_id NULLS LAST, id
    `);

    const companies = companiesResult.rows;
    const users = usersResult.rows;

    if (companies.length === 0 && users.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const roots = new Map();

    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      const insertRoot = await client.query(
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
          VALUES (NULL, $1, NULL, $2, $3, 'company', $4, $5, $6, FALSE)
          RETURNING id
        `,
        [
          company.id,
          company.name,
          'Organisation',
          company.description,
          defaultColorForType('company'),
          index,
        ]
      );

      roots.set(company.id, insertRoot.rows[0].id);
    }

    const roleBuckets = {
      Administrator: { key: 'leadership', label: 'Leadership', type: 'division', color: '#dc2626' },
      'Business Analyst': { key: 'process', label: 'Process Excellence', type: 'department', color: '#2563eb' },
      'Process Owner': { key: 'process', label: 'Process Excellence', type: 'department', color: '#2563eb' },
      'Risk Manager': { key: 'risk', label: 'Risk & Compliance', type: 'department', color: '#7c3aed' },
      Viewer: { key: 'support', label: 'Operations Support', type: 'team', color: '#0891b2' },
    };

    const departments = new Map();

    for (const user of users) {
      const companyId = user.company_id || null;
      let rootId = roots.get(companyId);

      if (!rootId) {
        const insertSharedRoot = await client.query(
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
            VALUES (NULL, NULL, NULL, $1, $2, 'company', $3, $4, $5, FALSE)
            RETURNING id
          `,
          [
            'Shared Services',
            'Organisation',
            'Automatically generated for unassigned users',
            defaultColorForType('company'),
            roots.size,
          ]
        );

        rootId = insertSharedRoot.rows[0].id;
        roots.set(null, rootId);
      }

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
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, FALSE)
            RETURNING id
          `,
          [
            rootId,
            companyId,
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
          VALUES ($1, $2, $3, $4, $5, 'position', $6, $7, $8, FALSE)
        `,
        [
          departmentId,
          companyId,
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

async function getNodes(client = pool, companyId = null) {
  const params = [];
  let whereClause = '';

  if (companyId !== null) {
    whereClause = 'WHERE n.company_id = $1';
    params.push(companyId);
  }

  const result = await client.query(`
    SELECT
      n.id,
      n.parent_id,
      n.company_id,
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
      c.name AS company_name,
      u.full_name AS user_name,
      u.email AS user_email,
      u.role AS user_role
    FROM org_chart_nodes n
    LEFT JOIN companies c ON c.id = n.company_id
    LEFT JOIN users u ON u.id = n.user_id
    ${whereClause}
    ORDER BY n.parent_id NULLS FIRST, n.sort_order, n.name
  `, params);

  return result.rows.map(serializeNode);
}

async function getNodeById(client, id) {
  const result = await client.query(
    `
      SELECT
        n.id,
        n.parent_id,
        n.company_id,
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
        c.name AS company_name,
        u.full_name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM org_chart_nodes n
      LEFT JOIN companies c ON c.id = n.company_id
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

async function updateSubtreeCompany(client, nodeId, companyId) {
  await client.query(
    `
      WITH RECURSIVE subtree AS (
        SELECT id
        FROM org_chart_nodes
        WHERE id = $1

        UNION ALL

        SELECT n.id
        FROM org_chart_nodes n
        JOIN subtree s ON n.parent_id = s.id
      )
      UPDATE org_chart_nodes
      SET company_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id IN (SELECT id FROM subtree)
    `,
    [nodeId, companyId]
  );
}

async function getAssignableUser(client, userId) {
  if (userId === null) {
    return null;
  }

  const result = await client.query(
    'SELECT id, company_id, full_name, role FROM users WHERE id = $1',
    [userId]
  );

  return result.rows[0] || null;
}

router.get('/orgchart/meta', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    await ensureOrgChartSchema();

    const companyFilter = isGlobalAdmin(req.user) ? null : req.user.companyId;
    if (!isGlobalAdmin(req.user) && !companyFilter) {
      return res.json({ companies: [], users: [], nodeTypes: Array.from(NODE_TYPES) });
    }

    const companyParams = [];
    const userParams = [];
    let companyWhere = '';
    let userWhere = '';

    if (companyFilter) {
      companyWhere = 'WHERE id = $1';
      userWhere = 'WHERE u.company_id = $1';
      companyParams.push(companyFilter);
      userParams.push(companyFilter);
    }

    const [companiesResult, usersResult] = await Promise.all([
      pool.query(`
        SELECT id, name, description
        FROM companies
        ${companyWhere}
        ORDER BY name
      `, companyParams),
      pool.query(`
        SELECT
          u.id,
          u.full_name,
          u.email,
          u.role,
          u.company_id,
          c.name AS company_name
        FROM users u
        LEFT JOIN companies c ON c.id = u.company_id
        ${userWhere}
        ORDER BY u.full_name
      `, userParams),
    ]);

    res.json({
      companies: companiesResult.rows.map((company) => ({
        id: company.id,
        name: company.name,
        description: company.description,
      })),
      users: usersResult.rows.map((user) => ({
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        companyName: user.company_name,
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    await ensureOrgChartSchema();
    if (!isGlobalAdmin(req.user) && !req.user.companyId) {
      return res.json([]);
    }

    const nodes = await getNodes(pool, isGlobalAdmin(req.user) ? null : req.user.companyId);
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
      return res.status(403).json({ error: 'Only global or company administrators can edit the organigram.' });
    }

    const parentId = normalizeInteger(req.body.parentId);
    const requestedCompanyId = normalizeInteger(req.body.companyId);
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

    let companyId = requestedCompanyId;
    if (parentId !== null) {
      const parentNode = await getNodeById(client, parentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Parent node not found.' });
      }
      if (!isNodeAccessibleToUser(parentNode, req.user)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You cannot create nodes under another company.' });
      }
      companyId = companyId ?? parentNode.companyId;
    }

    if (!isGlobalAdmin(req.user)) {
      companyId = req.user.companyId;
    }

    if (companyId !== null && !ensureCompanyAccess(req, res, companyId)) {
      await client.query('ROLLBACK');
      return;
    }

    if (!isGlobalAdmin(req.user) && !companyId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Company administrators must belong to a company.' });
    }

    const assignedUser = await getAssignableUser(client, isVacant ? null : userId);
    if (userId !== null && !assignedUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assigned user not found.' });
    }

    if (assignedUser && assignedUser.company_id !== companyId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Assigned user must belong to the same company.' });
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
        companyId,
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
      companyId: createdNode.companyId,
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
      return res.status(403).json({ error: 'Only global or company administrators can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    const parentId = req.body.parentId === undefined
      ? undefined
      : normalizeInteger(req.body.parentId);
    const requestedCompanyId = req.body.companyId === undefined
      ? undefined
      : normalizeInteger(req.body.companyId);
    const requestedUserId = req.body.userId === undefined
      ? undefined
      : normalizeInteger(req.body.userId);

    await client.query('BEGIN');

    const existing = await getNodeById(client, nodeId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }
    if (!isNodeAccessibleToUser(existing, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot edit nodes from another company.' });
    }

    const nextParentId = parentId === undefined ? existing.parentId : parentId;
    const isParentValid = await ensureValidParent(client, nodeId, nextParentId);
    if (!isParentValid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A node cannot be moved inside its own subtree.' });
    }

    let nextCompanyId = requestedCompanyId === undefined ? existing.companyId : requestedCompanyId;
    if (nextParentId !== null) {
      const parentNode = await getNodeById(client, nextParentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Selected parent node does not exist.' });
      }
      if (!isNodeAccessibleToUser(parentNode, req.user)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You cannot move nodes under another company.' });
      }
      nextCompanyId = parentNode.companyId;
    }

    if (!isGlobalAdmin(req.user)) {
      nextCompanyId = req.user.companyId;
    }

    if (nextCompanyId !== null && !ensureCompanyAccess(req, res, nextCompanyId)) {
      await client.query('ROLLBACK');
      return;
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
    if (assignedUser && assignedUser.company_id !== nextCompanyId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Assigned user must belong to the same company.' });
    }
    const nextSortOrder = nextParentId !== existing.parentId
      ? await getNextSortOrder(client, nextParentId)
      : existing.sortOrder;

    await client.query(
      `
        UPDATE org_chart_nodes
        SET
          parent_id = $1,
          company_id = $2,
          user_id = $3,
          name = $4,
          title = $5,
          node_type = $6,
          description = $7,
          color = $8,
          is_vacant = $9,
          sort_order = $10,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
      `,
      [
        nextParentId,
        nextCompanyId,
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

    if (nextCompanyId !== existing.companyId) {
      await updateSubtreeCompany(client, nodeId, nextCompanyId);
    }

    const updatedNode = await getNodeById(client, nodeId);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: updatedNode.id,
      companyId: updatedNode.companyId,
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
      return res.status(403).json({ error: 'Only global or company administrators can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    const parentId = normalizeInteger(req.body.parentId);

    await client.query('BEGIN');

    const node = await getNodeById(client, nodeId);
    if (!node) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }
    if (!isNodeAccessibleToUser(node, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot move nodes from another company.' });
    }

    const isParentValid = await ensureValidParent(client, nodeId, parentId);
    if (!isParentValid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A node cannot be moved inside its own subtree.' });
    }

    let nextCompanyId = node.companyId;
    if (parentId !== null) {
      const parentNode = await getNodeById(client, parentId);
      if (!parentNode) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Target parent not found.' });
      }
      if (!isNodeAccessibleToUser(parentNode, req.user)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'You cannot move nodes under another company.' });
      }
      nextCompanyId = parentNode.companyId;
    }

    if (!isGlobalAdmin(req.user)) {
      nextCompanyId = req.user.companyId;
    }

    const sortOrder = await getNextSortOrder(client, parentId);
    await client.query(
      `
        UPDATE org_chart_nodes
        SET parent_id = $1,
            company_id = $2,
            sort_order = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [parentId, nextCompanyId, sortOrder, nodeId]
    );

    if (nextCompanyId !== node.companyId) {
      await updateSubtreeCompany(client, nodeId, nextCompanyId);
    }

    const movedNode = await getNodeById(client, nodeId);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: movedNode.id,
      companyId: movedNode.companyId,
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
      return res.status(403).json({ error: 'Only global or company administrators can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    await client.query('BEGIN');

    const node = await getNodeById(client, nodeId);
    if (!node) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organigram node not found.' });
    }
    if (!isNodeAccessibleToUser(node, req.user)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You cannot delete nodes from another company.' });
    }

    const nextSortOrder = await getNextSortOrder(client, node.parentId);

    await client.query(
      `
        UPDATE org_chart_nodes
        SET parent_id = $1,
            company_id = $2,
            sort_order = sort_order + $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE parent_id = $3
      `,
      [node.parentId, node.companyId, nodeId, nextSortOrder]
    );

    await client.query('DELETE FROM org_chart_nodes WHERE id = $1', [nodeId]);
    await client.query('COMMIT');

    await logAuditEvent({
      actor: req.user,
      entityType: 'orgchart_node',
      entityId: nodeId,
      companyId: node.companyId,
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
