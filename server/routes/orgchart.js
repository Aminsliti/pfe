import express from 'express';
import pool from '../db.js';
import {
  ensureAuthenticated,
  isGlobalAdmin,
} from '../utils/access.js';
import { logAuditEvent } from '../utils/auditLog.js';

const router = express.Router();

const NODE_TYPES = new Set(['company', 'institute', 'structure', 'manager', 'function', 'org_unit']);
const TYPE_COLORS = {
  company: '#0f766e',
  institute: '#059669',
  structure: '#10b981',
  manager: '#0284c7',
  function: '#d97706',
  org_unit: '#14b8a6',
};

const BNA_ORG_CHART_TEMPLATE = {
  name: 'BNA Bank',
  title: 'Entite racine legale',
  node_type: 'company',
  description:
    'Organigramme BNA inspire de la structure de gouvernance et des poles visibles dans la reference partagee.',
  children: [
    {
      name: 'Conseil d Administration',
      title: 'Division ou branche',
      node_type: 'institute',
      description: 'Instance de gouvernance et de decision de la banque.',
      children: [
        {
          name: 'Secretariat du Conseil d Administration',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Support administratif et suivi des travaux du conseil.',
        },
        {
          name: 'Commission des Marches',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Commission de pilotage et de validation des marches.',
        },
        {
          name: 'Comite de Recours',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Traitement des recours et arbitrages associes.',
        },
        {
          name: 'Comite des Risques',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Comite de supervision et de suivi des risques.',
        },
        {
          name: 'Comite Permanent d Audit Interne',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Comite de suivi des missions et recommandations d audit interne.',
        },
        {
          name: 'Comite des Nominations & des Remunerations',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Comite en charge des nominations et des remunerations.',
        },
        {
          name: 'Comite Strategique Suivi & Evaluation du Contrat Programme',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Suivi strategique des engagements et objectifs du contrat programme.',
        },
        {
          name: 'Comite de Recouvrement',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Comite de supervision des activites de recouvrement.',
        },
        {
          name: 'Comite de Suivi de la Performance des Filiales',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Pilotage et suivi de la performance des filiales.',
        },
      ],
    },
    {
      name: 'Directeur General',
      title: 'Division ou branche',
      node_type: 'institute',
      description: 'Direction generale et coordination executive des poles BNA.',
      children: [
        {
          name: 'Direction Centrale du Controle Permanent & de la Conformite',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Controle permanent et conformite reglementaire.',
        },
        {
          name: 'Direction Centrale de l Audit et de l Inspection',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Audit interne et inspection des activites.',
        },
        {
          name: 'Direction Communication Interne',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Communication interne et accompagnement institutionnel.',
        },
        {
          name: 'Secretariat Permanent de la Commission des Marches',
          title: 'Unite operationnelle',
          node_type: 'structure',
          description: 'Coordination permanente de la commission des marches.',
        },
        {
          name: 'DGA Exploitation',
          title: 'Division ou branche',
          node_type: 'institute',
          description: 'Direction generale adjointe en charge de l exploitation.',
          children: [
            {
              name: 'Pole Commercial',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Animation et developpement commercial.',
            },
            {
              name: 'Pole Risques',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Analyse et pilotage des risques.',
            },
            {
              name: 'Pole Operations & Services Client',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Operations bancaires et qualite de service client.',
            },
          ],
        },
        {
          name: 'DGA Support & Transformation Digitale',
          title: 'Division ou branche',
          node_type: 'institute',
          description: 'Direction generale adjointe en charge du support et de la transformation.',
          children: [
            {
              name: 'Division PMO Transformation',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Pilotage du portefeuille de transformation.',
            },
            {
              name: 'Direction Centrale Strategie & Transformation',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Strategie, transformation et pilotage des evolutions.',
            },
            {
              name: 'Pole Finances comptabilite & Pilotage de la Performance',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Finances, comptabilite et pilotage de la performance.',
            },
            {
              name: 'Pole Organisation & Systeme d Informations',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Organisation, architecture et systemes d informations.',
            },
            {
              name: 'Pole Ressources & Support',
              title: 'Unite operationnelle',
              node_type: 'structure',
              description: 'Ressources humaines, moyens generaux et support transversal.',
            },
          ],
        },
      ],
    },
  ],
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

function normalizeColor(value, fallbackValue = null) {
  const normalized = String(value || '').trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.test(normalized) ? normalized : fallbackValue;
}

function normalizeNodeType(value) {
  if (NODE_TYPES.has(value)) {
    return value;
  }

  return {
    division: 'institute',
    department: 'structure',
    team: 'org_unit',
    position: 'function',
  }[value] || 'function';
}

function defaultColorForType(nodeType) {
  return TYPE_COLORS[nodeType] || TYPE_COLORS.function;
}

function normalizePlacementMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['nested', 'inside', 'internal', 'interne', 'expand'].includes(normalized)) {
    return 'nested';
  }
  return 'direct';
}

function looksLikeLegacyDemoOrgChart(rows = []) {
  const names = rows.map((row) => String(row.name || '').trim().toLowerCase());
  const legacyMarkers = [
    'company',
    'governance institute',
    'operations institute',
    'control institute',
    'shared institute',
    'hopex aquila',
    'gouvernance et direction generale',
    'pole finances, comptabilite et pilotage de la performance',
    'pole ressources et support',
    'pole organisation et systeme d information',
    'pole commercial',
    'pole operations et services clients',
  ];

  return legacyMarkers.some((marker) => names.includes(marker));
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
    placementMode: row.placement_mode || 'direct',
    posX: row.pos_x,
    posY: row.pos_y,
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
          node_type VARCHAR(40) NOT NULL DEFAULT 'function',
          description TEXT,
          color VARCHAR(20) NOT NULL DEFAULT '#475569',
          placement_mode VARCHAR(20) NOT NULL DEFAULT 'direct',
          pos_x INTEGER,
          pos_y INTEGER,
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
        ADD COLUMN IF NOT EXISTS node_type VARCHAR(40) NOT NULL DEFAULT 'function'
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
        ADD COLUMN IF NOT EXISTS placement_mode VARCHAR(20) NOT NULL DEFAULT 'direct'
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS pos_x INTEGER
      `);
      await pool.query(`
        ALTER TABLE org_chart_nodes
        ADD COLUMN IF NOT EXISTS pos_y INTEGER
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

      await pool.query(`
        UPDATE org_chart_nodes
        SET node_type = CASE node_type
          WHEN 'division' THEN 'institute'
          WHEN 'department' THEN 'structure'
          WHEN 'team' THEN 'org_unit'
          WHEN 'position' THEN 'function'
          ELSE node_type
        END
        WHERE node_type IN ('division', 'department', 'team', 'position')
      `);

      await pool.query(`
        UPDATE org_chart_nodes
        SET color = CASE node_type
          WHEN 'company' THEN '${TYPE_COLORS.company}'
          WHEN 'institute' THEN '${TYPE_COLORS.institute}'
          WHEN 'structure' THEN '${TYPE_COLORS.structure}'
          WHEN 'manager' THEN '${TYPE_COLORS.manager}'
          WHEN 'function' THEN '${TYPE_COLORS.function}'
          WHEN 'org_unit' THEN '${TYPE_COLORS.org_unit}'
          ELSE color
        END
      `);

      await pool.query(`
        UPDATE org_chart_nodes
        SET
          name = CASE
            WHEN node_type = 'company' AND LOWER(name) = 'organisation' THEN 'Company'
            ELSE name
          END,
          title = CASE
            WHEN node_type = 'company' AND (title IS NULL OR LOWER(title) = 'organisation') THEN 'Entite racine legale'
            WHEN node_type = 'institute' AND (title IS NULL OR title = 'Department') THEN 'Division ou branche'
            WHEN node_type = 'structure' AND (title IS NULL OR title = 'Department') THEN 'Unite operationnelle'
            WHEN node_type = 'manager' AND title IS NULL THEN 'Responsable humain'
            WHEN node_type = 'function' AND title IS NULL THEN 'Role ou poste metier'
            WHEN node_type = 'org_unit' AND title IS NULL THEN 'Unite organisationnelle'
            ELSE title
          END
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

    const existingNodes = await client.query('SELECT id, name, node_type FROM org_chart_nodes ORDER BY id');
    if (existingNodes.rows.length > 0 && !looksLikeLegacyDemoOrgChart(existingNodes.rows)) {
      await client.query('COMMIT');
      return;
    }

    if (existingNodes.rows.length > 0) {
      await client.query('TRUNCATE TABLE org_chart_nodes RESTART IDENTITY CASCADE');
    }

    const insertNodeTree = async (node, parentId = null, sortOrder = 0) => {
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
            placement_mode,
            pos_x,
            pos_y,
            sort_order,
            is_vacant
          )
          VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, 'direct', NULL, NULL, $7, $8)
          RETURNING id
        `,
        [
          parentId,
          node.name,
          node.title || null,
          normalizeNodeType(node.node_type),
          node.description || null,
          defaultColorForType(normalizeNodeType(node.node_type)),
          sortOrder,
          Boolean(node.is_vacant),
        ]
      );

      const insertedId = insertResult.rows[0].id;
      for (let index = 0; index < (node.children || []).length; index += 1) {
        await insertNodeTree(node.children[index], insertedId, index);
      }
    };

    await insertNodeTree(BNA_ORG_CHART_TEMPLATE, null, 0);

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
      n.placement_mode,
      n.pos_x,
      n.pos_y,
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
        n.placement_mode,
        n.pos_x,
        n.pos_y,
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
    const nodeType = normalizeNodeType(req.body.nodeType);
    const name = normalizeText(req.body.name);
    const title = normalizeText(req.body.title);
    const description = normalizeText(req.body.description);
    const color = normalizeColor(req.body.color, defaultColorForType(nodeType));
    const placementMode = parentId === null ? 'direct' : normalizePlacementMode(req.body.placementMode);
    const posX = normalizeInteger(req.body.posX);
    const posY = normalizeInteger(req.body.posY);

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
          placement_mode,
          pos_x,
          pos_y,
          sort_order,
          is_vacant
        )
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
        RETURNING id
      `,
      [
        parentId,
        null,
        name,
        title,
        nodeType,
        description,
        color,
        placementMode,
        posX,
        posY,
        sortOrder,
      ]
    );

    // Enforce "sticky" inside/outside behavior:
    // when creating children under a parent, all descendants of that parent follow the chosen placement_mode.
    // (We exclude the parent itself so it can remain visible depending on its own mode.)
    if (parentId !== null) {
      await client.query(
        `
          WITH RECURSIVE descendants AS (
            SELECT id FROM org_chart_nodes WHERE id = $1
            UNION ALL
            SELECT n.id
            FROM org_chart_nodes n
            INNER JOIN descendants d ON n.parent_id = d.id
          )
          UPDATE org_chart_nodes
          SET placement_mode = $2,
              updated_at = CURRENT_TIMESTAMP
          WHERE id IN (SELECT id FROM descendants WHERE id <> $1)
        `,
        [parentId, placementMode]
      );
    }

    await client.query(
      'UPDATE org_chart_nodes SET color = $1, updated_at = CURRENT_TIMESTAMP WHERE node_type = $2',
      [color, nodeType]
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
        posX: createdNode.posX,
        posY: createdNode.posY,
        placementMode: createdNode.placementMode,
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
    const nextColor = normalizeColor(req.body.color, existing.color || defaultColorForType(nextType));
    const nextPlacementMode = nextParentId === null
      ? 'direct'
      : req.body.placementMode === undefined
        ? existing.placementMode || 'direct'
        : normalizePlacementMode(req.body.placementMode);
    const nextPosX = req.body.posX === undefined ? existing.posX : normalizeInteger(req.body.posX);
    const nextPosY = req.body.posY === undefined ? existing.posY : normalizeInteger(req.body.posY);
    const nextSortOrder = nextParentId !== existing.parentId
      ? await getNextSortOrder(client, nextParentId)
      : existing.sortOrder;

    await client.query(
      `
        UPDATE org_chart_nodes
        SET
          parent_id = $1,
          company_id = NULL,
          user_id = NULL,
          name = $2,
          title = $3,
          node_type = $4,
          description = $5,
          color = $6,
          placement_mode = $7,
          pos_x = $8,
          pos_y = $9,
          is_vacant = FALSE,
          sort_order = $10,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $11
      `,
      [
        nextParentId,
        normalizeText(req.body.name) || existing.name,
        req.body.title === undefined ? existing.title : normalizeText(req.body.title),
        nextType,
        req.body.description === undefined ? existing.description : normalizeText(req.body.description),
        nextColor,
        nextPlacementMode,
        nextPosX,
        nextPosY,
        nextSortOrder,
        nodeId,
      ]
    );

    await client.query(
      'UPDATE org_chart_nodes SET color = $1, updated_at = CURRENT_TIMESTAMP WHERE node_type = $2',
      [nextColor, nextType]
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
        posX: updatedNode.posX,
        posY: updatedNode.posY,
        placementMode: updatedNode.placementMode,
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

router.patch('/orgchart/nodes/:id/position', async (req, res) => {
  await ensureOrgChartSchema();
  const client = await pool.connect();

  try {
    if (!canEditOrgChart(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit the organigram.' });
    }

    const nodeId = normalizeInteger(req.params.id);
    const posX = normalizeInteger(req.body.posX);
    const posY = normalizeInteger(req.body.posY);

    await client.query('BEGIN');

    const existing = await getNodeById(client, nodeId);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Node not found.' });
    }

    await client.query(
      `
        UPDATE org_chart_nodes
        SET pos_x = $1,
            pos_y = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `,
      [posX, posY, nodeId]
    );

    const updatedNode = await getNodeById(client, nodeId);
    await client.query('COMMIT');
    res.json(updatedNode);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('orgchart position error:', error);
    res.status(500).json({ error: 'Failed to update organigram position.' });
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
