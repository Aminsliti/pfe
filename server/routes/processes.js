import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensureAuthenticated,
  ensureCompanyAccess,
  ensurePermission,
  hasRole,
  isAdmin,
  isCompanyAdmin,
  isGlobalAdmin,
  ROLES,
} from '../utils/access.js';
import { logAuditEvent } from '../utils/auditLog.js';
import {
  buildProcessVersionSnapshot,
  buildVersionDiff,
  normalizeProcessStatus,
} from '../utils/processDiff.js';
import { createNotification } from '../utils/collaboration.js';
import {
  buildProcessExplanation,
  buildProcessReportHtml,
  buildProcessReportPdf,
} from '../utils/processNarrative.js';

const router = express.Router();
const uploadDir = path.resolve(process.cwd(), 'server', 'uploads');
let processSchemaPromise = null;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

function normalizeInteger(value, fallbackValue = null) {
  if (value === undefined) return fallbackValue;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallbackValue;
}

async function ensureProcessEnhancements() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!processSchemaPromise) {
    processSchemaPromise = (async () => {
      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS name VARCHAR(255)
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS description TEXT
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS category_id INTEGER
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS company_id INTEGER
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS status VARCHAR(50)
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS process_workflow_comments (
          id SERIAL PRIMARY KEY,
          process_id INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          status_from VARCHAR(50),
          status_to VARCHAR(50),
          comment TEXT,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_process_workflow_comments_process
        ON process_workflow_comments(process_id, created_at DESC)
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES process_categories(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_process_categories_parent
        ON process_categories(parent_id, name)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_process_categories_company
        ON process_categories(company_id, name)
      `);
    })().catch((error) => {
      processSchemaPromise = null;
      throw error;
    });
  }

  return processSchemaPromise;
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildDefaultBpmnXml(processName = 'Process') {
  const safeName = escapeXml(processName);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${safeName}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
    <bpmn:endEvent id="EndEvent_1" name="End" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="312" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="120" />
        <di:waypoint x="312" y="120" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function buildProcessTree(processes) {
  const processMap = {};
  const rootProcesses = [];

  processes.forEach((process) => {
    processMap[process.id] = { ...process, children: [] };
  });

  processes.forEach((process) => {
    if (process.parent_id === null) {
      rootProcesses.push(processMap[process.id]);
    } else {
      const parent = processMap[process.parent_id];
      if (parent) {
        parent.children.push(processMap[process.id]);
      }
    }
  });

  return rootProcesses;
}

async function getProcessById(id) {
  const result = await pool.query(
    `
      SELECT
        p.*,
        pc.name AS category_name,
        u.full_name AS created_by_name,
        approver.full_name AS approved_by_name,
        c.name AS company_name
      FROM processes p
      LEFT JOIN process_categories pc ON pc.id = p.category_id
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users approver ON approver.id = p.approved_by
      LEFT JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function getCategoryById(id) {
  const result = await pool.query(
    `
      SELECT
        pc.*,
        parent.name AS parent_name,
        c.name AS company_name
      FROM process_categories pc
      LEFT JOIN process_categories parent ON parent.id = pc.parent_id
      LEFT JOIN companies c ON c.id = pc.company_id
      WHERE pc.id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function getDescendantCategoryIds(categoryId) {
  const normalizedCategoryId = normalizeInteger(categoryId, null);
  if (!normalizedCategoryId) {
    return [];
  }

  const result = await pool.query(
    `
      WITH RECURSIVE category_tree AS (
        SELECT id
        FROM process_categories
        WHERE id = $1
        UNION ALL
        SELECT child.id
        FROM process_categories child
        JOIN category_tree parent_tree ON parent_tree.id = child.parent_id
      )
      SELECT id FROM category_tree
    `,
    [normalizedCategoryId]
  );

  return result.rows.map((row) => row.id);
}

function resolveProcessCompanyId(req, requestedCompanyId, fallbackCompanyId = null) {
  if (isGlobalAdmin(req.user)) {
    return normalizeInteger(requestedCompanyId, fallbackCompanyId);
  }

  return req.user.companyId ?? null;
}

function resolveCategoryCompanyId(req, requestedCompanyId, fallbackCompanyId = null) {
  if (isGlobalAdmin(req.user)) {
    return normalizeInteger(requestedCompanyId, fallbackCompanyId);
  }

  return req.user.companyId ?? fallbackCompanyId ?? null;
}

function ensureAssignedCompany(req, res, companyId) {
  if (companyId) {
    return true;
  }

  res.status(400).json({ error: 'A company must be assigned to this record.' });
  return false;
}

function canCreateProcessDefinition(user) {
  return isAdmin(user) || hasRole(user, ROLES.DESIGNER);
}

function canEditProcessDefinition(user, process) {
  if (!process) {
    return false;
  }

  return isAdmin(user) || (hasRole(user, ROLES.DESIGNER) && normalizeProcessStatus(process.status, 'draft') === 'draft');
}

function canDeleteProcessDefinition(user, process) {
  if (!process) {
    return false;
  }

  return isAdmin(user) || (hasRole(user, ROLES.DESIGNER) && normalizeProcessStatus(process.status, 'draft') === 'draft');
}

function canSubmitProcessForReview(user) {
  return isAdmin(user) || hasRole(user, ROLES.DESIGNER);
}

function canApproveProcess(user) {
  return isAdmin(user) || hasRole(user, ROLES.VALIDATOR);
}

function canRequestProcessChange(user) {
  return isAdmin(user) || hasRole(user, ROLES.DESIGNER);
}

async function getGovernanceRecipientIds(companyId, roles = []) {
  const normalizedRoles = [...new Set(roles.filter(Boolean))];
  if (!normalizedRoles.length) {
    return [];
  }

  const params = [normalizedRoles];
  let query = `
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN user_role_assignments ura
      ON ura.user_id = u.id
      AND (ura.expires_on IS NULL OR ura.expires_on >= CURRENT_DATE)
    WHERE (u.role = ANY($1::text[]) OR ura.role_name = ANY($1::text[]))
  `;

  if (companyId) {
    query += ' AND u.company_id = $2';
    params.push(companyId);
  } else {
    query += ' AND u.company_id IS NULL';
  }

  const result = await pool.query(query, params);
  return result.rows.map((row) => row.id);
}

async function notifyRoleRecipients({
  actor,
  companyId,
  roles,
  type,
  title,
  message,
  entityId,
  severity = 'info',
}) {
  const recipientIds = await getGovernanceRecipientIds(companyId, roles);

  await Promise.all(
    recipientIds
      .filter((recipientId) => Number(recipientId) !== Number(actor?.id))
      .map((recipientId) =>
        createNotification({
          userId: recipientId,
          companyId,
          type,
          title,
          message,
          entityType: 'process',
          entityId,
          severity,
        })
      )
  );
}

function cleanupUploadedFile(file) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

function serializeProcessRecord(process) {
  if (!process) {
    return process;
  }

  return {
    ...process,
    status: normalizeProcessStatus(process.status, 'draft'),
  };
}

function buildVersionInsertValues(process, createdBy, changeDescription) {
  const snapshot = serializeProcessRecord(process);

  return [
    snapshot.id,
    snapshot.version,
    snapshot.bpmn_xml || '',
    createdBy,
    changeDescription || 'Updated process',
    snapshot.name || '',
    snapshot.description || null,
    normalizeInteger(snapshot.category_id, null),
    normalizeInteger(snapshot.company_id, null),
    snapshot.status || 'draft',
  ];
}

async function insertProcessVersion(process, createdBy, changeDescription) {
  await pool.query(
    `
      INSERT INTO process_versions (
        process_id,
        version_number,
        bpmn_xml,
        created_by,
        change_description,
        name,
        description,
        category_id,
        company_id,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    buildVersionInsertValues(process, createdBy, changeDescription)
  );
}

async function getWorkflowComments(processId) {
  const result = await pool.query(
    `
      SELECT
        pwc.*,
        u.full_name AS created_by_name
      FROM process_workflow_comments pwc
      LEFT JOIN users u ON u.id = pwc.created_by
      WHERE pwc.process_id = $1
      ORDER BY pwc.created_at DESC
    `,
    [processId]
  );

  return result.rows;
}

function buildWorkflowPayload(process, comments = []) {
  const normalizedStatus = normalizeProcessStatus(process.status, 'draft');
  const latestRequestChange = comments.find((entry) => entry.action === 'request_change') || null;
  const latestReturnDraft = comments.find((entry) => entry.action === 'return_draft') || null;
  const latestIgnoreChangeRequest = comments.find((entry) => entry.action === 'ignore_change_request') || null;
  const latestApprove = comments.find((entry) => entry.action === 'approve') || null;
  const pendingChangeRequest =
    normalizedStatus === 'approved' &&
    Boolean(latestRequestChange) &&
    new Date(latestRequestChange.created_at).getTime() >
      Math.max(
        new Date(latestReturnDraft?.created_at || 0).getTime(),
        new Date(latestIgnoreChangeRequest?.created_at || 0).getTime(),
        new Date(latestApprove?.created_at || 0).getTime()
      );

  return {
    process_id: process.id,
    status: normalizedStatus,
    submitted_at: process.submitted_at || null,
    approved_at: process.approved_at || null,
    approved_by: process.approved_by || null,
    approved_by_name: process.approved_by_name || null,
    archived_at: process.archived_at || null,
    pending_change_request: pendingChangeRequest,
    change_request: latestRequestChange
      ? {
          id: latestRequestChange.id,
          comment: latestRequestChange.comment || null,
          created_at: latestRequestChange.created_at,
          created_by_name: latestRequestChange.created_by_name || null,
        }
      : null,
    comments,
  };
}

async function getProcessVersion(processId, versionNumber) {
  const result = await pool.query(
    `
      SELECT
        pv.*,
        u.full_name AS created_by_name
      FROM process_versions pv
      LEFT JOIN users u ON u.id = pv.created_by
      WHERE pv.process_id = $1 AND pv.version_number = $2
    `,
    [processId, versionNumber]
  );

  return result.rows[0] ? buildProcessVersionSnapshot(result.rows[0]) : null;
}

function resolveWorkflowTransition(action, currentStatus) {
  const normalized = normalizeProcessStatus(currentStatus, 'draft');

  switch (action) {
    case 'submit_review':
      return { nextStatus: 'submitted', changeDescription: 'Submitted for approval' };
    case 'approve':
      return { nextStatus: 'approved', changeDescription: 'Approved process' };
    case 'request_change':
      return { nextStatus: normalized, changeDescription: 'Requested change to approved process' };
    case 'ignore_change_request':
      return { nextStatus: normalized, changeDescription: 'Ignored change request on approved process' };
    case 'return_draft':
      return { nextStatus: 'draft', changeDescription: 'Returned to draft' };
    case 'archive':
      return { nextStatus: 'archived', changeDescription: 'Archived process' };
    case 'restore':
      return { nextStatus: 'draft', changeDescription: 'Restored archived process' };
    default:
      return { nextStatus: normalized, changeDescription: 'Workflow updated' };
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureProcessEnhancements();
    next();
  } catch (error) {
    console.error('process schema error:', error);
    res.status(500).json({ error: 'Failed to prepare process storage.' });
  }
});

router.get('/processes', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { search, category, status, company, hierarchical = 'false' } = req.query;
    const requestedCompanyId = normalizeInteger(company, null);
    const companyFilter = isGlobalAdmin(req.user) ? requestedCompanyId : req.user.companyId;

    if (!isGlobalAdmin(req.user) && !companyFilter) {
      return res.json([]);
    }

    let query = `
      SELECT
        p.*,
        u.full_name AS created_by_name,
        c.name AS company_name
      FROM processes p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    if (status) {
      const normalizedStatus = normalizeProcessStatus(status, status);
      if (normalizedStatus === 'approved') {
        query += ` AND p.status IN ($${paramIndex}, $${paramIndex + 1})`;
        params.push('approved', 'active');
        paramIndex += 2;
      } else {
        query += ` AND p.status = $${paramIndex}`;
        params.push(normalizedStatus);
        paramIndex += 1;
      }
    }

    const categoryId = normalizeInteger(category, null);
    if (categoryId) {
      const categoryIds = await getDescendantCategoryIds(categoryId);
      query += ` AND p.category_id = ANY($${paramIndex}::int[])`;
      params.push(categoryIds.length ? categoryIds : [categoryId]);
      paramIndex += 1;
    }

    if (companyFilter) {
      query += ` AND p.company_id = $${paramIndex}`;
      params.push(companyFilter);
      paramIndex += 1;
    }

    query += ' ORDER BY p.parent_id NULLS FIRST, p.name';

    const result = await pool.query(query, params);
    const normalizedRows = result.rows.map(serializeProcessRecord);
    const processes = hierarchical === 'true' ? buildProcessTree(normalizedRows) : normalizedRows;
    res.json(processes);
  } catch (error) {
    console.error('Error fetching processes:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/processes/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    const versionsResult = await pool.query(
      `
        SELECT pv.*, u.full_name AS created_by_name
        FROM process_versions pv
        LEFT JOIN users u ON u.id = pv.created_by
        WHERE pv.process_id = $1
        ORDER BY pv.version_number DESC
      `,
      [req.params.id]
    );

    res.json({
      ...serializeProcessRecord(process),
      versions: versionsResult.rows.map(buildProcessVersionSnapshot),
    });
  } catch (error) {
    console.error('Get process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!canCreateProcessDefinition(req.user)) {
      return res.status(403).json({ error: 'Only admins and designers can create processes.' });
    }

    if (!hasRole(req.user, ROLES.ADMIN) && !ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description, bpmn_xml, category_id, company_id, status = 'draft' } = req.body;
    const createdBy = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'Process name is required' });
    }

    const processCompanyId = resolveProcessCompanyId(req, company_id);
    if (!ensureAssignedCompany(req, res, processCompanyId)) {
      return;
    }

    const bpmnXml = bpmn_xml || buildDefaultBpmnXml(name);
    const initialStatus = normalizeProcessStatus(status, 'draft');
    const result = await pool.query(
      `
        INSERT INTO processes (name, description, bpmn_xml, category_id, company_id, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, description, category_id, company_id, created_by, status, version, created_at, updated_at
      `,
      [name, description || null, bpmnXml, normalizeInteger(category_id, null), processCompanyId, createdBy, initialStatus]
    );

    const process = {
      ...result.rows[0],
      bpmn_xml: bpmnXml,
    };

    await insertProcessVersion(process, createdBy, 'Initial version');

    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: process.id,
      companyId: process.company_id,
      action: 'create',
      summary: `Created process "${process.name}"`,
      details: {
        status: process.status,
        version: process.version,
        category_id: process.category_id,
      },
    });

    res.status(201).json(serializeProcessRecord(process));
  } catch (error) {
    console.error('Create process error:', error);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

router.put('/processes/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const currentProcess = await getProcessById(req.params.id);
    if (!currentProcess) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, currentProcess.company_id)) {
      return;
    }

    if (!canEditProcessDefinition(req.user, currentProcess)) {
      return res.status(403).json({ error: 'This process can only be edited by an admin or by a designer while it is still in draft.' });
    }

    const {
      name,
      description,
      bpmn_xml,
      category_id,
      company_id,
      status,
      change_description,
    } = req.body;

    const nextName = name || currentProcess.name;
    const nextDescription = description !== undefined ? description : currentProcess.description;
    const nextCategoryId = normalizeInteger(category_id, currentProcess.category_id);
    const nextCompanyId = resolveProcessCompanyId(req, company_id, currentProcess.company_id);
    if (!ensureAssignedCompany(req, res, nextCompanyId)) {
      return;
    }

    const previousSnapshot = serializeProcessRecord(currentProcess);
    const nextStatus = normalizeProcessStatus(status, normalizeProcessStatus(currentProcess.status, 'draft'));
    const nextBpmnXml =
      typeof bpmn_xml === 'string' && bpmn_xml.trim() !== ''
        ? bpmn_xml
        : (currentProcess.bpmn_xml || buildDefaultBpmnXml(nextName));
    const newVersion = (currentProcess.version || 0) + 1;

    const updateResult = await pool.query(
      `
        UPDATE processes
        SET
          name = $1,
          description = $2,
          bpmn_xml = $3,
          category_id = $4,
          company_id = $5,
          status = $6,
          version = $7,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING id, name, description, category_id, company_id, status, version, updated_at
      `,
      [nextName, nextDescription, nextBpmnXml, nextCategoryId, nextCompanyId, nextStatus, newVersion, req.params.id]
    );

    const updatedProcess = {
      ...updateResult.rows[0],
      bpmn_xml: nextBpmnXml,
    };

    await insertProcessVersion(updatedProcess, req.user.id, change_description || 'Updated process');

    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: updatedProcess.id,
      companyId: updatedProcess.company_id,
      action: 'update',
      summary: `Updated process "${updatedProcess.name}"`,
      details: {
        before: {
          name: previousSnapshot.name,
          description: previousSnapshot.description,
          status: previousSnapshot.status,
          category_id: previousSnapshot.category_id,
          company_id: previousSnapshot.company_id,
          version: previousSnapshot.version_number,
        },
        after: {
          name: updatedProcess.name,
          description: updatedProcess.description,
          status: updatedProcess.status,
          category_id: updatedProcess.category_id,
          company_id: updatedProcess.company_id,
          version: updatedProcess.version,
        },
        change_description: change_description || 'Updated process',
      },
    });

    res.json(serializeProcessRecord(updatedProcess));
  } catch (error) {
    console.error('Update process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/processes/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    if (!canDeleteProcessDefinition(req.user, process)) {
      return res.status(403).json({ error: 'Only admins or designers working on a draft can delete this process.' });
    }

    await pool.query('DELETE FROM processes WHERE id = $1', [req.params.id]);
    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: process.id,
      companyId: process.company_id,
      action: 'delete',
      summary: `Deleted process "${process.name}"`,
      details: {
        status: normalizeProcessStatus(process.status, 'draft'),
        version: process.version,
      },
    });
    res.json({ message: 'Process deleted successfully' });
  } catch (error) {
    console.error('Delete process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes/import', upload.single('bpmnFile'), async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      cleanupUploadedFile(req.file);
      return;
    }

    if (!canCreateProcessDefinition(req.user)) {
      cleanupUploadedFile(req.file);
      return res.status(403).json({ error: 'Only admins and designers can import BPMN processes.' });
    }

    if (!hasRole(req.user, ROLES.ADMIN) && !ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      cleanupUploadedFile(req.file);
      return;
    }

    const { name, description, category_id, company_id, status = 'draft' } = req.body;
    if (!name) {
      cleanupUploadedFile(req.file);
      return res.status(400).json({ error: 'Process name is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'BPMN file is required' });
    }

    const processCompanyId = resolveProcessCompanyId(req, company_id);
    if (!ensureAssignedCompany(req, res, processCompanyId)) {
      cleanupUploadedFile(req.file);
      return;
    }

    const bpmnXml = fs.readFileSync(req.file.path, 'utf8');
    if (!bpmnXml.includes('bpmn:definitions') && !bpmnXml.includes('<definitions')) {
      cleanupUploadedFile(req.file);
      return res.status(400).json({ error: 'Invalid BPMN file format' });
    }

    const initialStatus = isAdmin(req.user)
      ? normalizeProcessStatus(status, 'draft')
      : 'draft';

    const result = await pool.query(
      `
        INSERT INTO processes (name, description, bpmn_xml, category_id, company_id, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, description, category_id, company_id, created_by, status, version, created_at, updated_at
      `,
      [
        name,
        description || null,
        bpmnXml,
        normalizeInteger(category_id, null),
        processCompanyId,
        req.user.id,
        initialStatus,
      ]
    );

    const importedProcess = {
      ...result.rows[0],
      bpmn_xml: bpmnXml,
    };

    await insertProcessVersion(importedProcess, req.user.id, 'Imported from BPMN file');

    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: importedProcess.id,
      companyId: importedProcess.company_id,
      action: 'import',
      summary: `Imported BPMN process "${importedProcess.name}"`,
      details: {
        status: importedProcess.status,
        version: importedProcess.version,
      },
    });

    cleanupUploadedFile(req.file);
    res.status(201).json(serializeProcessRecord(importedProcess));
  } catch (error) {
    console.error('Import BPMN error:', error);
    cleanupUploadedFile(req.file);
    res.status(500).json({ error: `Failed to import BPMN file: ${error.message}` });
  }
});

router.get('/processes/:id/export', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { version } = req.query;

    if (version) {
      const versionResult = await pool.query(
        `
          SELECT pv.bpmn_xml, pv.version_number, p.name, p.company_id
          FROM process_versions pv
          JOIN processes p ON p.id = pv.process_id
          WHERE pv.process_id = $1 AND pv.version_number = $2
        `,
        [req.params.id, version]
      );

      if (!versionResult.rows.length) {
        return res.status(404).json({ error: 'Process version not found' });
      }

      const row = versionResult.rows[0];
      if (!ensureCompanyAccess(req, res, row.company_id)) {
        return;
      }

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${row.name}_v${row.version_number}.bpmn"`);
      return res.send(row.bpmn_xml);
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${process.name}.bpmn"`);
    res.send(process.bpmn_xml);
  } catch (error) {
    console.error('Export BPMN error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/processes/:id/explanation', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    const workflowComments = await getWorkflowComments(process.id);
    const workflow = buildWorkflowPayload(process, workflowComments);

    res.json({
      process: serializeProcessRecord(process),
      explanation: buildProcessExplanation(process, workflow),
    });
  } catch (error) {
    console.error('Get process explanation error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

async function sendProcessReport(req, res, { format = 'html', diagramImageDataUrl = null } = {}) {
  const process = await getProcessById(req.params.id);
  if (!process) {
    res.status(404).json({ error: 'Process not found' });
    return;
  }

  if (!ensureCompanyAccess(req, res, process.company_id)) {
    return;
  }

  const workflow = {
    process_id: process.id,
    status: normalizeProcessStatus(process.status, 'draft'),
    submitted_at: process.submitted_at,
    approved_at: process.approved_at,
    approved_by: process.approved_by,
    approved_by_name: process.approved_by_name || null,
    archived_at: process.archived_at,
    comments: await getWorkflowComments(process.id),
  };
  const explanation = buildProcessExplanation(process, workflow);
  const filenameBase =
    String(process.name || `process-${process.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `process-${process.id}`;

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-explanation.pdf"`);
    res.send(buildProcessReportPdf(process, explanation, { diagramImageDataUrl }));
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-explanation.html"`);
  res.send(buildProcessReportHtml(process, explanation));
}

router.get('/processes/:id/report', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    await sendProcessReport(req, res, {
      format: String(req.query.format || 'html').toLowerCase(),
    });
  } catch (error) {
    console.error('Get process report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes/:id/report', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    await sendProcessReport(req, res, {
      format: String(req.body?.format || 'pdf').toLowerCase(),
      diagramImageDataUrl: typeof req.body?.diagramImageDataUrl === 'string' ? req.body.diagramImageDataUrl : null,
    });
  } catch (error) {
    console.error('Create process report error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/processes/:id/workflow', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    const comments = await getWorkflowComments(process.id);
    res.json(buildWorkflowPayload(process, comments));
  } catch (error) {
    console.error('Get process workflow error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes/:id/workflow', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES) && !isAdmin(req.user)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    const action = String(req.body?.action || '');
    const comment = String(req.body?.comment || '').trim() || null;
    const currentWorkflowComments = await getWorkflowComments(process.id);
    const currentWorkflow = buildWorkflowPayload(process, currentWorkflowComments);
    const currentStatus = normalizeProcessStatus(process.status, 'draft');
    const { nextStatus, changeDescription } = resolveWorkflowTransition(action, currentStatus);

    if (!['submit_review', 'approve', 'request_change', 'ignore_change_request', 'return_draft', 'archive', 'restore'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported workflow action.' });
    }

    if (action === 'submit_review' && !(currentStatus === 'draft' && canSubmitProcessForReview(req.user))) {
      return res.status(403).json({ error: 'Only admins or designers can submit a draft for approval.' });
    }

    if (action === 'approve' && !(currentStatus === 'submitted' && canApproveProcess(req.user))) {
      return res.status(403).json({ error: 'Only admins or validators can approve a submitted process.' });
    }

    if (action === 'request_change' && !(currentStatus === 'approved' && canRequestProcessChange(req.user))) {
      return res.status(403).json({ error: 'Only admins or designers can request a change on an approved process.' });
    }

    if (action === 'ignore_change_request' && !(currentStatus === 'approved' && currentWorkflow.pending_change_request && canApproveProcess(req.user))) {
      return res.status(403).json({ error: 'Only admins or validators can ignore a pending change request on an approved process.' });
    }

    if (action === 'return_draft' && !(['submitted', 'approved', 'change_requested'].includes(currentStatus) && canApproveProcess(req.user))) {
      return res.status(403).json({ error: 'Only admins or validators can reopen this process as a draft.' });
    }

    if (action === 'archive' && !(currentStatus === 'approved' && canApproveProcess(req.user))) {
      return res.status(403).json({ error: 'Only admins or validators can archive an approved process.' });
    }

    if (action === 'restore' && !(currentStatus === 'archived' && canApproveProcess(req.user))) {
      return res.status(403).json({ error: 'Only admins or validators can restore an archived process.' });
    }

    const newVersion = (process.version || 0) + 1;
    const submittedAt = action === 'submit_review'
      ? new Date().toISOString()
      : (process.submitted_at || null);
    const approvedAt = action === 'approve'
      ? new Date().toISOString()
      : (nextStatus === 'approved' ? process.approved_at : null);
    const approvedBy = action === 'approve'
      ? req.user.id
      : (nextStatus === 'approved' ? process.approved_by : null);
    const archivedAt = action === 'archive'
      ? new Date().toISOString()
      : (nextStatus === 'archived' ? process.archived_at : null);

    const updateResult = await pool.query(
      `
        UPDATE processes
        SET
          status = $1,
          version = $2,
          submitted_at = $3,
          approved_at = $4,
          approved_by = $5,
          archived_at = $6,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
      `,
      [
        nextStatus,
        newVersion,
        submittedAt,
        approvedAt,
        approvedBy,
        archivedAt,
        process.id,
      ]
    );

    const updatedProcess = {
      ...updateResult.rows[0],
      bpmn_xml: process.bpmn_xml,
    };

    await insertProcessVersion(updatedProcess, req.user.id, changeDescription);

    await pool.query(
      `
        INSERT INTO process_workflow_comments (
          process_id,
          action,
          status_from,
          status_to,
          comment,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [process.id, action, currentStatus, nextStatus, comment, req.user.id]
    );

    const hydratedProcess = await getProcessById(process.id);

    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: process.id,
      companyId: process.company_id,
      action: `workflow_${action}`,
      summary: `${req.user.fullName || req.user.username} moved process "${process.name}" to ${nextStatus}`,
      details: {
        status_from: currentStatus,
        status_to: nextStatus,
        comment,
        version: newVersion,
      },
    });

    if (action === 'submit_review') {
      await notifyRoleRecipients({
        actor: req.user,
        companyId: process.company_id,
        roles: [ROLES.VALIDATOR, ROLES.ADMIN],
        type: 'process_approval_waiting',
        title: 'Process awaiting approval',
        message: `${process.name} has been submitted for approval.`,
        entityId: process.id,
        severity: 'warning',
      });
      await createNotification({
        companyId: process.company_id,
        type: 'process_approval_waiting',
        title: 'Process awaiting approval',
        message: `${process.name} has been submitted for approval.`,
        entityType: 'process',
        entityId: process.id,
        severity: 'warning',
      });
    }

    if (action === 'approve') {
      await createNotification({
        companyId: process.company_id,
        type: 'process_approved',
        title: 'Process approved',
        message: `${process.name} was approved and is ready for use.`,
        entityType: 'process',
        entityId: process.id,
        severity: 'success',
      });
    }

    if (action === 'request_change') {
      await notifyRoleRecipients({
        actor: req.user,
        companyId: process.company_id,
        roles: [ROLES.VALIDATOR, ROLES.ADMIN],
        type: 'process_change_requested',
        title: 'Approved process needs a change',
        message: `${process.name} has a change request waiting for validation.`,
        entityId: process.id,
        severity: 'warning',
      });
    }

    if (action === 'ignore_change_request') {
      await createNotification({
        companyId: process.company_id,
        type: 'process_change_request_ignored',
        title: 'Change request ignored',
        message: `${process.name} remains approved and the pending change request was ignored.`,
        entityType: 'process',
        entityId: process.id,
        severity: 'info',
      });
    }

    const refreshedComments = await getWorkflowComments(process.id);
    res.json({
      process: serializeProcessRecord(hydratedProcess),
      workflow: buildWorkflowPayload(hydratedProcess, refreshedComments),
    });
  } catch (error) {
    console.error('Process workflow error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/processes/:id/diff', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    const fromVersion = normalizeInteger(req.query.fromVersion, null);
    const toVersion = normalizeInteger(req.query.toVersion, null);

    if (!fromVersion || !toVersion) {
      return res.status(400).json({ error: 'fromVersion and toVersion are required.' });
    }

    const [fromSnapshot, toSnapshot] = await Promise.all([
      getProcessVersion(process.id, fromVersion),
      getProcessVersion(process.id, toVersion),
    ]);

    if (!fromSnapshot || !toSnapshot) {
      return res.status(404).json({ error: 'One of the selected versions was not found.' });
    }

    res.json(buildVersionDiff(fromSnapshot, toSnapshot));
  } catch (error) {
    console.error('Process diff error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/process-categories', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const requestedCompanyId = normalizeInteger(req.query.company, null);
    const params = [];
    let query = `
      SELECT
        pc.*,
        parent.name AS parent_name,
        c.name AS company_name
      FROM process_categories pc
      LEFT JOIN process_categories parent ON parent.id = pc.parent_id
      LEFT JOIN companies c ON c.id = pc.company_id
      WHERE 1 = 1
    `;

    if (isGlobalAdmin(req.user)) {
      if (requestedCompanyId) {
        query += ' AND (pc.company_id = $1 OR pc.company_id IS NULL)';
        params.push(requestedCompanyId);
      }
    } else if (req.user.companyId) {
      query += ' AND (pc.company_id = $1 OR pc.company_id IS NULL)';
      params.push(req.user.companyId);
    } else {
      query += ' AND pc.company_id IS NULL';
    }

    query += ' ORDER BY COALESCE(parent.name, pc.name), pc.parent_id NULLS FIRST, pc.name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/process-categories', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!canCreateProcessDefinition(req.user)) {
      return res.status(403).json({ error: 'Only admins and designers can create categories.' });
    }

    if (!hasRole(req.user, ROLES.ADMIN) && !ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description, parent_id, company_id } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const parentId = normalizeInteger(parent_id, null);
    const categoryCompanyId = resolveCategoryCompanyId(req, company_id);
    let parentCategory = null;

    if (parentId) {
      parentCategory = await getCategoryById(parentId);
      if (!parentCategory) {
        return res.status(400).json({ error: 'Parent category not found.' });
      }

      if (!ensureCompanyAccess(req, res, parentCategory.company_id)) {
        return;
      }

      if (normalizeInteger(parentCategory.company_id, null) !== normalizeInteger(categoryCompanyId, null)) {
        return res.status(400).json({ error: 'A sub-category must belong to the same company scope as its parent category.' });
      }
    }

    const result = await pool.query(
      `
        INSERT INTO process_categories (name, description, parent_id, company_id, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [name, description || null, parentId, categoryCompanyId, req.user.id]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'process_category',
      entityId: result.rows[0].id,
      companyId: categoryCompanyId,
      action: 'create',
      summary: `Created process category "${result.rows[0].name}"`,
      details: {
        parent_id: result.rows[0].parent_id,
      },
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create category error:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Category name already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

router.put('/process-categories/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!canCreateProcessDefinition(req.user)) {
      return res.status(403).json({ error: 'Only admins and designers can update categories.' });
    }

    if (!hasRole(req.user, ROLES.ADMIN) && !ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const existingCategory = await getCategoryById(req.params.id);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (!ensureCompanyAccess(req, res, existingCategory.company_id)) {
      return;
    }

    const { name, description, parent_id, company_id } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const nextParentId = normalizeInteger(parent_id, existingCategory.parent_id);
    const nextCompanyId = resolveCategoryCompanyId(req, company_id, existingCategory.company_id);

    if (nextParentId && Number(nextParentId) === Number(req.params.id)) {
      return res.status(400).json({ error: 'A category cannot be its own parent.' });
    }

    if (nextParentId) {
      const parentCategory = await getCategoryById(nextParentId);
      if (!parentCategory) {
        return res.status(400).json({ error: 'Parent category not found.' });
      }

      if (!ensureCompanyAccess(req, res, parentCategory.company_id)) {
        return;
      }

      if (normalizeInteger(parentCategory.company_id, null) !== normalizeInteger(nextCompanyId, null)) {
        return res.status(400).json({ error: 'A sub-category must belong to the same company scope as its parent category.' });
      }

      const descendants = await getDescendantCategoryIds(req.params.id);
      if (descendants.includes(nextParentId)) {
        return res.status(400).json({ error: 'A category cannot be moved under one of its descendants.' });
      }
    }

    const result = await pool.query(
      `
        UPDATE process_categories
        SET
          name = $1,
          description = $2,
          parent_id = $3,
          company_id = $4
        WHERE id = $5
        RETURNING *
      `,
      [name, description || null, nextParentId, nextCompanyId, req.params.id]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'process_category',
      entityId: req.params.id,
      companyId: nextCompanyId,
      action: 'update',
      summary: `Updated process category "${result.rows[0].name}"`,
      details: {
        parent_id: result.rows[0].parent_id,
      },
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update category error:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Category name already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

router.delete('/process-categories/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!canCreateProcessDefinition(req.user)) {
      return res.status(403).json({ error: 'Only admins and designers can delete categories.' });
    }

    if (!hasRole(req.user, ROLES.ADMIN) && !ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const category = await getCategoryById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (!ensureCompanyAccess(req, res, category.company_id)) {
      return;
    }

    const [childCountResult, processCountResult] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM process_categories WHERE parent_id = $1', [req.params.id]),
      pool.query('SELECT COUNT(*)::int AS count FROM processes WHERE category_id = $1', [req.params.id]),
    ]);

    if ((childCountResult.rows[0]?.count || 0) > 0) {
      return res.status(400).json({ error: 'Delete or move sub-categories before deleting this category.' });
    }

    if ((processCountResult.rows[0]?.count || 0) > 0) {
      return res.status(400).json({ error: 'Move processes out of this category before deleting it.' });
    }

    await pool.query('DELETE FROM process_categories WHERE id = $1', [req.params.id]);

    await logAuditEvent({
      actor: req.user,
      entityType: 'process_category',
      entityId: req.params.id,
      companyId: category.company_id,
      action: 'delete',
      summary: `Deleted process category "${category.name}"`,
      details: {},
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/companies', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (isGlobalAdmin(req.user)) {
      const result = await pool.query('SELECT * FROM companies ORDER BY name');
      return res.json(result.rows);
    }

    if (!req.user.companyId) {
      return res.json([]);
    }

    const result = await pool.query('SELECT * FROM companies WHERE id = $1', [req.user.companyId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/companies', async (req, res) => {
  try {
    if (!isGlobalAdmin(req.user)) {
      return res.status(403).json({ error: 'Only global administrators can create companies.' });
    }

    const { name, description, logo_url } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const result = await pool.query(
      'INSERT INTO companies (name, description, logo_url) VALUES ($1, $2, $3) RETURNING *',
      [name, description || null, logo_url || null]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: 'company',
      entityId: result.rows[0].id,
      companyId: result.rows[0].id,
      action: 'create',
      summary: `Created company "${result.rows[0].name}"`,
      details: {
        description: result.rows[0].description,
      },
    });

    await createNotification({
      companyId: result.rows[0].id,
      type: 'admin_action',
      title: 'Company created',
      message: `${req.user.fullName || req.user.username} created the company ${result.rows[0].name}.`,
      entityType: 'company',
      entityId: result.rows[0].id,
      severity: 'info',
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create company error:', error);
    if (error.code === '23505') {
      res.status(400).json({ error: 'Company name already exists' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

router.put('/companies/:id', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (!isGlobalAdmin(req.user) && !isCompanyAdmin(req.user)) {
      return res.status(403).json({ error: 'You do not have permission to update companies.' });
    }

    const companyId = normalizeInteger(req.params.id, null);
    if (!ensureCompanyAccess(req, res, companyId)) {
      return;
    }

    const { name, description, logo_url } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const result = await pool.query(
      `
        UPDATE companies
        SET name = $1, description = $2, logo_url = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `,
      [name, description || null, logo_url || null, companyId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'company',
      entityId: result.rows[0].id,
      companyId: result.rows[0].id,
      action: 'update',
      summary: `Updated company "${result.rows[0].name}"`,
      details: {
        description: result.rows[0].description,
      },
    });

    await createNotification({
      companyId: result.rows[0].id,
      type: 'admin_action',
      title: 'Company updated',
      message: `${req.user.fullName || req.user.username} updated the company ${result.rows[0].name}.`,
      entityType: 'company',
      entityId: result.rows[0].id,
      severity: 'info',
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/companies/:id', async (req, res) => {
  try {
    if (!isGlobalAdmin(req.user)) {
      return res.status(403).json({ error: 'Only global administrators can delete companies.' });
    }

    const existingCompany = await pool.query('SELECT id, name FROM companies WHERE id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM companies WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'company',
      entityId: req.params.id,
      companyId: req.params.id,
      action: 'delete',
      summary: `Deleted company "${existingCompany.rows[0]?.name || req.params.id}"`,
      details: {},
    });

    await createNotification({
      companyId: req.params.id,
      type: 'admin_action',
      title: 'Company deleted',
      message: `${req.user.fullName || req.user.username} deleted company "${existingCompany.rows[0]?.name || req.params.id}".`,
      entityType: 'company',
      entityId: req.params.id,
      severity: 'warning',
    });

    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
