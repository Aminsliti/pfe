import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { ensureCompanyAccess, ROLES } from './access.js';
import { ensureOrgChartSchema } from '../routes/orgchart.js';
import { sendPlatformEmail } from './mailer.js';

let collaborationSchemaPromise = null;

export const SUPPORTED_ENTITY_TYPES = new Set(['process', 'simulation', 'orgchart_node']);
export const ATTACHMENTS_DIR = path.resolve(process.cwd(), 'server', 'uploads', 'attachments');

function normalizeEntityType(entityType) {
  const normalized = String(entityType || '').trim().toLowerCase();
  return SUPPORTED_ENTITY_TYPES.has(normalized) ? normalized : null;
}

function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildNotificationUrl(entityType, entityId) {
  const appBaseUrl = trimTrailingSlash(process.env.APP_BASE_URL || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '');
  if (!appBaseUrl) {
    return null;
  }

  const normalizedEntityId = entityId === null || entityId === undefined ? null : String(entityId);
  if (!normalizedEntityId) {
    return appBaseUrl;
  }

  switch (entityType) {
    case 'process':
      return `${appBaseUrl}/processes?processId=${normalizedEntityId}`;
    case 'simulation':
      return `${appBaseUrl}/simulations`;
    case 'orgchart_node':
      return `${appBaseUrl}/orgchart`;
    case 'user':
      return `${appBaseUrl}/users`;
    default:
      return appBaseUrl;
  }
}

async function getNotificationRecipient(userId) {
  const parsedUserId = Number(userId);
  if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT id, email, full_name, is_active
      FROM users
      WHERE id = $1
    `,
    [parsedUserId]
  );

  const recipient = result.rows[0] || null;
  if (!recipient?.email || recipient.is_active === false) {
    return null;
  }

  return recipient;
}

async function getAdminNotificationRecipients() {
  try {
    const result = await pool.query(
      `
        SELECT DISTINCT u.id, u.email, u.full_name, u.is_active
        FROM users u
        LEFT JOIN user_role_assignments ura
          ON ura.user_id = u.id
          AND ura.role_name = $1
          AND (ura.starts_on IS NULL OR ura.starts_on <= CURRENT_DATE)
          AND (ura.expires_on IS NULL OR ura.expires_on >= CURRENT_DATE)
        WHERE u.is_active = TRUE
          AND u.email IS NOT NULL
          AND (
            u.role = $1
            OR ura.id IS NOT NULL
          )
      `,
      [ROLES.ADMIN]
    );

    return result.rows;
  } catch (error) {
    if (error?.code === '42P01') {
      const fallbackResult = await pool.query(
        `
          SELECT id, email, full_name, is_active
          FROM users
          WHERE is_active = TRUE
            AND email IS NOT NULL
            AND role = $1
        `,
        [ROLES.ADMIN]
      );

      return fallbackResult.rows;
    }

    throw error;
  }
}

async function deliverNotificationEmail({
  userId,
  type,
  title,
  message,
  entityType = null,
  entityId = null,
  severity = 'info',
}) {
  const directRecipient = userId ? await getNotificationRecipient(userId) : null;
  const adminRecipients = await getAdminNotificationRecipients();
  const recipients = new Map();

  if (directRecipient?.email) {
    recipients.set(String(directRecipient.email).toLowerCase(), directRecipient);
  }

  adminRecipients.forEach((adminRecipient) => {
    if (adminRecipient?.email) {
      recipients.set(String(adminRecipient.email).toLowerCase(), adminRecipient);
    }
  });

  const resolvedRecipients = [...recipients.values()];
  if (!resolvedRecipients.length) {
    return;
  }

  const destinationUrl = buildNotificationUrl(entityType, entityId);
  const subjectPrefix = severity === 'warning'
    ? '[vBPM Warning]'
    : severity === 'danger'
      ? '[vBPM Action Needed]'
      : '[vBPM Alert]';
  const subject = `${subjectPrefix} ${title}`;
  const textParts = [
    title,
    '',
    message,
  ];

  if (destinationUrl) {
    textParts.push('', `Open in platform: ${destinationUrl}`);
  }

  textParts.push('', `Notification type: ${type}`);

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <h2 style="margin:0 0 12px">${title}</h2>
      <p style="margin:0 0 12px">Bonjour,</p>
      <p style="margin:0 0 16px">${message}</p>
      ${destinationUrl ? `<p style="margin:0 0 16px"><a href="${destinationUrl}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#dc2626;color:#fff;text-decoration:none;font-weight:700">Open alert in the platform</a></p>` : ''}
      <p style="margin:0;color:#64748b;font-size:13px">Notification type: ${type}</p>
    </div>
  `;

  await sendPlatformEmail({
    to: resolvedRecipients.map((recipient) => recipient.email),
    subject,
    text: textParts.join('\n'),
    html,
  });
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

    await deliverNotificationEmail({
      userId,
      type,
      title,
      message,
      entityType,
      entityId,
      severity,
    });
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

  const isAdmin = Array.isArray(user?.activeRoles)
    ? user.activeRoles.includes(ROLES.ADMIN)
    : user?.role === ROLES.ADMIN;

  if (!isAdmin) {
    query += ` AND user_id = $${paramIndex}`;
    params.push(user.id);
    paramIndex += 1;
  }

  query += ' ORDER BY created_at DESC LIMIT 40';
  const result = await pool.query(query, params);

  const dynamicNotifications = [];
  if (isAdmin) {
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
  }

  return [...dynamicNotifications, ...result.rows]
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
    .slice(0, 40);
}

export default ensureCollaborationSchema;
