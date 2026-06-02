import pool from '../../db.js';

let auditSchemaPromise = null;

function sanitizeDetails(value, depth = 0) {
  if (depth > 4) {
    return '[Max depth reached]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > 2000) {
      return `${value.slice(0, 2000)}…`;
    }

    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeDetails(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, entryValue]) => [key, sanitizeDetails(entryValue, depth + 1)])
  );
}

export async function ensureAuditSchema() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!auditSchemaPromise) {
    auditSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          user_name VARCHAR(255),
          user_role VARCHAR(255),
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          entity_type VARCHAR(100) NOT NULL,
          entity_id VARCHAR(255),
          action VARCHAR(100) NOT NULL,
          summary TEXT,
          details JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
        ON audit_logs(company_id, created_at DESC)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
        ON audit_logs(entity_type, entity_id, created_at DESC)
      `);
    })().catch((error) => {
      auditSchemaPromise = null;
      throw error;
    });
  }

  return auditSchemaPromise;
}

export async function logAuditEvent({
  actor,
  entityType,
  entityId = null,
  companyId = null,
  action,
  summary = '',
  details = {},
}) {
  if (!actor?.id || !entityType || !action) {
    return;
  }

  try {
    await ensureAuditSchema();

    if (process.env.NODE_ENV === 'test') {
      return;
    }

    await pool.query(
      `
        INSERT INTO audit_logs (
          user_id,
          user_name,
          user_role,
          company_id,
          entity_type,
          entity_id,
          action,
          summary,
          details
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
      `,
      [
        actor.id,
        actor.fullName || actor.username || null,
        actor.role || null,
        companyId ?? actor.companyId ?? null,
        entityType,
        entityId === null || entityId === undefined ? null : String(entityId),
        action,
        summary || null,
        JSON.stringify(sanitizeDetails(details || {})),
      ]
    );
  } catch (error) {
    console.error('logAuditEvent error:', error);
  }
}

export default logAuditEvent;
