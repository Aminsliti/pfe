import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { ensureCompanyAccess } from './access.js';
import { ensureOrgChartSchema } from '../routes/orgchart.js';

let collaborationSchemaPromise = null;

export const SUPPORTED_ENTITY_TYPES = new Set(['process', 'simulation', 'orgchart_node']);
export const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'server', 'uploads', 'attachments');

function normalizeEntityType(entityType) {
  const normalized = String(entityType || '').trim().toLowerCase();
  return SUPPORTED_ENTITY_TYPES.has(normalized) ? normalized : null;
}

export async function ensureCollaborationSchema() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!collaborationSchemaPromise) {
    collaborationSchemaPromise = (async () => {
      if (!fs.existsSync(ATTACHMENTS_DIR)) {
        fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
      }

      await ensureOrgChartSchema();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS entity_comments (
          id SERIAL PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          entity_id INTEGER NOT NULL,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          body TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_entity_comments_lookup
        ON entity_comments(entity_type, entity_id, created_at DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS entity_attachments (
          id SERIAL PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          entity_id INTEGER NOT NULL,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          original_name VARCHAR(255) NOT NULL,
          stored_name VARCHAR(255) NOT NULL,
          mime_type VARCHAR(255),
          size_bytes INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_entity_attachments_lookup
        ON entity_attachments(entity_type, entity_id, created_at DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          type VARCHAR(100) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          entity_type VARCHAR(50),
          entity_id VARCHAR(255),
          severity VARCHAR(20) NOT NULL DEFAULT 'info',
          read_at TIMESTAMP,
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_scope
        ON notifications(user_id, company_id, read_at, created_at DESC)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS process_templates (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          description TEXT,
          category_id INTEGER REFERENCES process_categories(id) ON DELETE SET NULL,
          company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          bpmn_xml TEXT NOT NULL,
          simulation_defaults JSONB DEFAULT '{}'::jsonb,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    })().catch((error) => {
      collaborationSchemaPromise = null;
      throw error;
    });
  }

  return collaborationSchemaPromise;
}

async function getProcessEntity(entityId) {
  const result = await pool.query(
    'SELECT id, name, company_id, description FROM processes WHERE id = $1',
    [entityId]
  );
  return result.rows[0] || null;
}

async function getSimulationEntity(entityId) {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.name,
        s.description,
        p.company_id
      FROM simulation_scenarios s
      LEFT JOIN processes p ON p.id = s.process_id
      WHERE s.id = $1
    `,
    [entityId]
  );
  return result.rows[0] || null;
}

async function getOrgChartEntity(entityId) {
  const result = await pool.query(
    'SELECT id, name, description, company_id FROM org_chart_nodes WHERE id = $1',
    [entityId]
  );
  return result.rows[0] || null;
}

export async function resolveEntityForAccess(req, res, entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  if (!normalizedType) {
    res.status(400).json({ error: 'Unsupported entity type.' });
    return null;
  }

  const parsedId = Number(entityId);
  if (!Number.isInteger(parsedId)) {
    res.status(400).json({ error: 'Invalid entity id.' });
    return null;
  }

  const entity =
    normalizedType === 'process'
      ? await getProcessEntity(parsedId)
      : normalizedType === 'simulation'
        ? await getSimulationEntity(parsedId)
        : await getOrgChartEntity(parsedId);

  if (!entity) {
    res.status(404).json({ error: 'Entity not found.' });
    return null;
  }

  if (!ensureCompanyAccess(req, res, entity.company_id)) {
    return null;
  }

  return {
    ...entity,
    entityType: normalizedType,
    companyId: entity.company_id ?? null,
  };
}

export async function createNotification({
  userId = null,
  companyId = null,
  type,
  title,
  message,
  entityType = null,
  entityId = null,
  severity = 'info',
  expiresAt = null,
}) {
  if (!type || !title || !message) {
    return;
  }

  try {
    await ensureCollaborationSchema();

    if (process.env.NODE_ENV === 'test') {
      return;
    }

    await pool.query(
      `
        INSERT INTO notifications (
          user_id,
          company_id,
          type,
          title,
          message,
          entity_type,
          entity_id,
          severity,
          expires_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        userId,
        null,
        type,
        title,
        message,
        entityType,
        entityId === null || entityId === undefined ? null : String(entityId),
        severity,
        expiresAt,
      ]
    );
  } catch (error) {
    console.error('createNotification error:', error);
  }
}

export async function listNotificationsForUser(user) {
  await ensureCollaborationSchema();

  const params = [];
  let query = `
    SELECT *
    FROM notifications
    WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `;
  let paramIndex = 1;

  query += ` AND (user_id = $${paramIndex} OR user_id IS NULL)`;
  params.push(user.id);
  paramIndex += 1;

  query += ' ORDER BY created_at DESC LIMIT 40';
  const result = await pool.query(query, params);

  const dynamicNotifications = [];
  try {
    const expiredDrafts = await pool.query(`
      SELECT 'process' AS entity_type, p.id, p.name, p.updated_at
      FROM processes p
      WHERE p.status = 'draft' AND p.updated_at < CURRENT_TIMESTAMP - INTERVAL '14 days'
      UNION ALL
      SELECT 'simulation' AS entity_type, s.id, s.name, s.updated_at
      FROM simulation_scenarios s
      WHERE s.status = 'draft' AND s.updated_at < CURRENT_TIMESTAMP - INTERVAL '14 days'
    `);

    expiredDrafts.rows.forEach((entry) => {
      dynamicNotifications.push({
        id: `draft-${entry.entity_type}-${entry.id}`,
        type: 'expired_draft',
        title: 'Draft overdue',
        message: `${entry.name} is still in draft after 14 days.`,
        entity_type: entry.entity_type,
        entity_id: String(entry.id),
        severity: 'warning',
        created_at: entry.updated_at,
        read_at: null,
        dynamic: true,
      });
    });
  } catch (error) {
    if (error?.code !== '42P01') {
      throw error;
    }
  }

  return [...dynamicNotifications, ...result.rows]
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 40);
}

export default ensureCollaborationSchema;
