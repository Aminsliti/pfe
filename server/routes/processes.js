import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import {
  canonicalizeRoleName,
  PERMISSIONS,
  ensureAuthenticated,
  ensureCompanyAccess,
  ensurePermission,
  hasRole,
  isAdmin,
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
  buildProcedureManual,
  buildProcessReportDocx,
  buildProcessExplanation,
  buildProcessReportHtml,
  buildProcessReportPdf,
} from '../utils/processNarrative.js';

const router = express.Router();
const uploadDir = path.resolve(process.cwd(), 'server', 'uploads');
let processSchemaPromise = null;
const PROCESS_SECTION_VALUES = ['pilotage', 'metiers', 'support'];
const DEFAULT_PROCESS_SECTION = 'metiers';

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

<<<<<<< HEAD
function buildDownloadNameBase(name, fallbackValue = 'process') {
  const resolved = String(name || fallbackValue || 'process')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return resolved || fallbackValue || 'process';
}

=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
function normalizeInteger(value, fallbackValue = null) {
  if (value === undefined) return fallbackValue;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallbackValue;
}

function normalizeIntegerArray(value, fallbackValue = []) {
  if (value === undefined) {
    return normalizeIntegerArray(fallbackValue, []);
  }

  if (value === null || value === '') {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => normalizeInteger(entry, null)).filter(Number.isInteger))];
}

function normalizeManualData(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalizeText = (entry) => String(entry || '').trim();
  const normalizeTextList = (entry) => {
    if (Array.isArray(entry)) {
      return [...new Set(entry.map((item) => normalizeText(item)).filter(Boolean))];
    }
    if (typeof entry === 'string') {
      return [...new Set(entry.split(/[\r\n;,]+/u).map((item) => item.trim()).filter(Boolean))];
    }
    return [];
  };
<<<<<<< HEAD
  const normalizeRowList = (entry, fields = []) => {
    if (!Array.isArray(entry)) {
      return [];
    }

    return entry
      .map((row) => {
        const sourceRow = row && typeof row === 'object' ? row : {};
        const normalized = {};
        let hasValue = false;

        fields.forEach((field) => {
          const resolved = normalizeText(sourceRow[field]);
          normalized[field] = resolved;
          if (resolved) {
            hasValue = true;
          }
        });

        return hasValue ? normalized : null;
      })
      .filter(Boolean);
  };
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435

  return {
    code: normalizeText(source.code),
    objective: normalizeText(source.objective),
    owner: normalizeText(source.owner),
    scope: normalizeText(source.scope),
    trigger: normalizeText(source.trigger),
    expected_result: normalizeText(source.expected_result || source.expectedResult),
    frequency: normalizeText(source.frequency),
    context: normalizeText(source.context),
    kpis: normalizeTextList(source.kpis),
    controls: normalizeTextList(source.controls),
    support_systems: normalizeTextList(source.support_systems || source.supportSystems),
    support_documents: normalizeTextList(source.support_documents || source.supportDocuments),
    support_data: normalizeTextList(source.support_data || source.supportData),
<<<<<<< HEAD
    workflow_notes: normalizeTextList(source.workflow_notes || source.workflowNotes),
    raci_responsible: normalizeTextList(source.raci_responsible || source.raciResponsible),
    raci_accountable: normalizeTextList(source.raci_accountable || source.raciAccountable),
    raci_consulted: normalizeTextList(source.raci_consulted || source.raciConsulted),
    raci_informed: normalizeTextList(source.raci_informed || source.raciInformed),
    kpi_details: normalizeRowList(source.kpi_details || source.kpiDetails, ['name', 'target', 'source']),
    support_data_details: normalizeRowList(source.support_data_details || source.supportDataDetails, ['name', 'description', 'format', 'source', 'destination', 'criticality']),
    support_document_details: normalizeRowList(source.support_document_details || source.supportDocumentDetails, ['name', 'type', 'generated_by', 'output_of', 'version']),
    support_system_details: normalizeRowList(source.support_system_details || source.supportSystemDetails, ['name', 'role']),
    risk_details: normalizeRowList(source.risk_details || source.riskDetails, ['title', 'severity', 'status', 'category', 'element', 'description', 'mitigation']),
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
  };
}

function normalizeProcessSection(value, fallbackValue = DEFAULT_PROCESS_SECTION) {
  const normalized = String(value || '').trim().toLowerCase();
  return PROCESS_SECTION_VALUES.includes(normalized) ? normalized : fallbackValue;
}

function normalizeProcessNameBase(value, fallbackValue = 'Process') {
  const trimmed = String(value || '').trim();
  const withoutSuffix = trimmed.replace(/\s*\((\d+)\)\s*$/u, '').trim();
  return withoutSuffix || fallbackValue;
}

async function buildNextAvailableProcessName(name, { categoryId, excludeId = null } = {}) {
  const baseName = normalizeProcessNameBase(name);
  const params = [categoryId];
  let query = `
    SELECT name
    FROM processes
    WHERE category_id = $1
  `;

  if (excludeId !== null) {
    params.push(excludeId);
    query += ` AND id <> $${params.length}`;
  }

  const result = await pool.query(query, params);
  const normalizedBase = baseName.toLocaleLowerCase('fr');
  const matchingNames = result.rows
    .map((row) => String(row.name || '').trim())
    .filter((existingName) => normalizeProcessNameBase(existingName).toLocaleLowerCase('fr') === normalizedBase);

  if (!matchingNames.length) {
    return baseName;
  }

  const usedNumbers = new Set(
    matchingNames
      .map((existingName) => {
        const match = existingName.match(/\((\d+)\)\s*$/u);
        return match ? Number(match[1]) : 1;
      })
      .filter(Number.isFinite)
  );

  let nextNumber = 2;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return `${baseName} (${nextNumber})`;
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
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS assigned_designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS assigned_validator_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS assigned_designer_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
      `);

      await pool.query(`
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS assigned_validator_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
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
        ALTER TABLE processes
        ADD COLUMN IF NOT EXISTS manual_data JSONB NOT NULL DEFAULT '{}'::jsonb
      `);

      await pool.query(`
        ALTER TABLE process_versions
        ADD COLUMN IF NOT EXISTS manual_data JSONB NOT NULL DEFAULT '{}'::jsonb
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
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS assigned_designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS assigned_validator_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS assigned_designer_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS assigned_validator_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
      `);

      await pool.query(`
        ALTER TABLE process_categories
        ADD COLUMN IF NOT EXISTS section VARCHAR(50)
      `);

      await pool.query(`
        UPDATE process_categories
        SET section = '${DEFAULT_PROCESS_SECTION}'
        WHERE section IS NULL
      `);

      await pool.query(`
        UPDATE processes
        SET assigned_designer_ids = CASE
          WHEN COALESCE(array_length(assigned_designer_ids, 1), 0) = 0 AND assigned_designer_id IS NOT NULL
            THEN ARRAY[assigned_designer_id]
          WHEN assigned_designer_ids IS NULL
            THEN ARRAY[]::INTEGER[]
          ELSE assigned_designer_ids
        END
      `);

      await pool.query(`
        UPDATE processes
        SET assigned_validator_ids = CASE
          WHEN COALESCE(array_length(assigned_validator_ids, 1), 0) = 0 AND COALESCE(assigned_validator_id, created_by) IS NOT NULL
            THEN ARRAY[COALESCE(assigned_validator_id, created_by)]
          WHEN assigned_validator_ids IS NULL
            THEN ARRAY[]::INTEGER[]
          ELSE assigned_validator_ids
        END
      `);

      await pool.query(`
        UPDATE processes
        SET
          assigned_designer_id = COALESCE(assigned_designer_ids[1], assigned_designer_id),
          assigned_validator_id = COALESCE(assigned_validator_ids[1], assigned_validator_id, created_by)
      `);

      await pool.query(`
        UPDATE process_categories
        SET assigned_designer_ids = CASE
          WHEN COALESCE(array_length(assigned_designer_ids, 1), 0) = 0 AND assigned_designer_id IS NOT NULL
            THEN ARRAY[assigned_designer_id]
          WHEN assigned_designer_ids IS NULL
            THEN ARRAY[]::INTEGER[]
          ELSE assigned_designer_ids
        END
      `);

      await pool.query(`
        UPDATE process_categories
        SET assigned_validator_ids = CASE
          WHEN COALESCE(array_length(assigned_validator_ids, 1), 0) = 0 AND COALESCE(assigned_validator_id, created_by) IS NOT NULL
            THEN ARRAY[COALESCE(assigned_validator_id, created_by)]
          WHEN assigned_validator_ids IS NULL
            THEN ARRAY[]::INTEGER[]
          ELSE assigned_validator_ids
        END
      `);

      await pool.query(`
        UPDATE process_categories
        SET
          assigned_designer_id = COALESCE(assigned_designer_ids[1], assigned_designer_id),
          assigned_validator_id = COALESCE(assigned_validator_ids[1], assigned_validator_id, created_by)
      `);

      await pool.query(`
        ALTER TABLE process_categories
        DROP CONSTRAINT IF EXISTS process_categories_name_key
      `);

      await pool.query(`
        DROP INDEX IF EXISTS process_categories_name_key
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_process_categories_scope_name
        ON process_categories (
          COALESCE(company_id, 0),
          COALESCE(parent_id, 0),
          LOWER(name),
          COALESCE(section, '${DEFAULT_PROCESS_SECTION}')
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_process_categories_parent
        ON process_categories(parent_id, name)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_process_categories_company
        ON process_categories(company_id, name)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_processes_assigned_validator
        ON processes(assigned_validator_id, company_id, status)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_processes_assigned_designer
        ON processes(assigned_designer_id, company_id, status)
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
        assigned_designer.full_name AS assigned_designer_name,
        assigned_validator.full_name AS assigned_validator_name,
        c.name AS company_name
      FROM processes p
      LEFT JOIN process_categories pc ON pc.id = p.category_id
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users approver ON approver.id = p.approved_by
      LEFT JOIN users assigned_designer ON assigned_designer.id = p.assigned_designer_id
      LEFT JOIN users assigned_validator ON assigned_validator.id = p.assigned_validator_id
      LEFT JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1
    `,
    [id]
  );

  return serializeProcessRecord(result.rows[0] || null);
}

async function loadUserNamesByIds(userIds = []) {
  const normalizedIds = normalizeIntegerArray(userIds);
  if (!normalizedIds.length) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT id, full_name
      FROM users
      WHERE id = ANY($1::int[])
    `,
    [normalizedIds]
  );

  const namesById = new Map(
    result.rows.map((row) => [Number(row.id), row.full_name || `User ${row.id}`])
  );

  return normalizedIds
    .map((userId) => namesById.get(Number(userId)))
    .filter(Boolean);
}

async function getCategoryById(id) {
  const result = await pool.query(
    `
      SELECT
        pc.*,
        parent.name AS parent_name,
        assigned_designer.full_name AS assigned_designer_name,
        assigned_validator.full_name AS assigned_validator_name,
        c.name AS company_name
      FROM process_categories pc
      LEFT JOIN process_categories parent ON parent.id = pc.parent_id
      LEFT JOIN users assigned_designer ON assigned_designer.id = pc.assigned_designer_id
      LEFT JOIN users assigned_validator ON assigned_validator.id = pc.assigned_validator_id
      LEFT JOIN companies c ON c.id = pc.company_id
      WHERE pc.id = $1
    `,
    [id]
  );

  return serializeCategoryRecord(result.rows[0] || null);
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

function resolveProcessCompanyId(_req, requestedCompanyId, fallbackCompanyId = null) {
  return normalizeInteger(requestedCompanyId, fallbackCompanyId);
}

function resolveCategoryCompanyId(_req, requestedCompanyId, fallbackCompanyId = null) {
  return normalizeInteger(requestedCompanyId, fallbackCompanyId);
}

function ensureAssignedCompany(_req = null, _res = null, _companyId = null) {
  return true;
}

function ensureProcessWorkspaceAccess(req, res, _companyId = null) {
  return ensureAuthenticated(req, res);
}

function ensureProcessReadAccess(req, res, companyId = null) {
  if (!req.user) {
    return true;
  }

  return ensureProcessWorkspaceAccess(req, res, companyId);
}

function getAssignedDesignerIds(record) {
  return normalizeIntegerArray(
    record?.assigned_designer_ids,
    normalizeInteger(record?.assigned_designer_id, null) !== null ? [record.assigned_designer_id] : []
  );
}

function getAssignedDesignerId(record) {
  return getAssignedDesignerIds(record)[0] ?? null;
}

function getAssignedValidatorIds(record) {
  const fallbackValidatorId = normalizeInteger(record?.assigned_validator_id, normalizeInteger(record?.created_by, null));
  return normalizeIntegerArray(
    record?.assigned_validator_ids,
    fallbackValidatorId !== null ? [fallbackValidatorId] : []
  );
}

function getAssignedValidatorId(record) {
  return getAssignedValidatorIds(record)[0] ?? null;
}

function isAssignedDesigner(user, record) {
  return Boolean(user?.id) && getAssignedDesignerIds(record).some((assignedId) => Number(assignedId) === Number(user.id));
}

function isAssignedValidator(user, record) {
  return Boolean(user?.id) && getAssignedValidatorIds(record).some((assignedId) => Number(assignedId) === Number(user.id));
}

function canCreateProcessDefinition(user) {
  return isAdmin(user) || hasRole(user, ROLES.VALIDATOR);
}

function canEditProcessDefinition(user, process) {
  if (!process) {
    return false;
  }

  if (isAdmin(user) || isAssignedValidator(user, process)) {
    return true;
  }

  return isAssignedDesigner(user, process) && normalizeProcessStatus(process.status, 'draft') === 'draft';
}

function canDeleteProcessDefinition(user, process) {
  if (!process) {
    return false;
  }

  if (isAdmin(user) || isAssignedValidator(user, process)) {
    return true;
  }

  return isAssignedDesigner(user, process) && normalizeProcessStatus(process.status, 'draft') === 'draft';
}

function canEditCategoryDefinition(user, category) {
  if (!category) {
    return false;
  }

  return isAdmin(user) || hasRole(user, ROLES.VALIDATOR);
}

function canDeleteCategoryDefinition(user, category) {
  if (!category) {
    return false;
  }

  return isAdmin(user) || hasRole(user, ROLES.VALIDATOR);
}

function canSubmitProcessForReview(user, process) {
  return isAdmin(user) || isAssignedValidator(user, process) || isAssignedDesigner(user, process);
}

function canApproveProcess(user, process) {
  return isAdmin(user) || isAssignedValidator(user, process);
}

function canRequestProcessChange(user, process) {
  return isAdmin(user) || isAssignedDesigner(user, process);
}

async function loadGovernanceProfiles(userIds = []) {
  const normalizedIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Number.isInteger))];
  if (!normalizedIds.length) {
    return new Map();
  }

  const usersResult = await pool.query(
    `
      SELECT id, username, full_name, role, company_id
      FROM users
      WHERE id = ANY($1::int[])
    `,
    [normalizedIds]
  );

  const assignmentsResult = await pool.query(
    `
      SELECT user_id, role_name
      FROM user_role_assignments
      WHERE user_id = ANY($1::int[])
        AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
    `,
    [normalizedIds]
  );

  const extraRolesByUserId = new Map();
  assignmentsResult.rows.forEach((row) => {
    const activeRoles = extraRolesByUserId.get(row.user_id) || [];
    activeRoles.push(canonicalizeRoleName(row.role_name));
    extraRolesByUserId.set(row.user_id, activeRoles);
  });

  return new Map(
    usersResult.rows.map((row) => {
      const primaryRole = canonicalizeRoleName(row.role);
      const activeRoles = [
        primaryRole,
        ...(extraRolesByUserId.get(row.id) || []),
      ].filter(Boolean);

      return [
        row.id,
        {
          id: row.id,
          username: row.username,
          full_name: row.full_name,
          company_id: row.company_id,
          role: primaryRole,
          activeRoles: [...new Set(activeRoles)],
        },
      ];
    })
  );
}

async function listGovernanceCandidates() {
  const result = await pool.query(
    `
      SELECT id
      FROM users
      ORDER BY COALESCE(full_name, username), username
    `
  );

  const profiles = await loadGovernanceProfiles(result.rows.map((row) => row.id));
  const allProfiles = [...profiles.values()].map((profile) => ({
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    activeRoles: profile.activeRoles,
  }));

  return {
    designers: allProfiles.filter((profile) => profile.activeRoles.includes(ROLES.DESIGNER) || profile.activeRoles.includes(ROLES.ADMIN)),
    validators: allProfiles.filter((profile) => profile.activeRoles.includes(ROLES.VALIDATOR) || profile.activeRoles.includes(ROLES.ADMIN)),
  };
}

async function resolveGovernanceAssignments({
  actor,
  companyId: _companyId,
  assignedDesignerIds,
  assignedValidatorIds,
  assignedDesignerId,
  assignedValidatorId,
  fallbackDesignerIds = [],
  fallbackValidatorIds = [],
  fallbackDesignerId = null,
  fallbackValidatorId = null,
}) {
  const defaultValidatorId = normalizeInteger(
    fallbackValidatorId,
    hasRole(actor, ROLES.VALIDATOR) || isAdmin(actor) ? actor.id : null
  );
  const normalizedFallbackDesignerIds = (() => {
    const candidateIds = normalizeIntegerArray(fallbackDesignerIds);
    if (candidateIds.length > 0) {
      return candidateIds;
    }

    const fallbackId = normalizeInteger(fallbackDesignerId, null);
    return fallbackId !== null ? [fallbackId] : [];
  })();
  const normalizedFallbackValidatorIds = (() => {
    const candidateIds = normalizeIntegerArray(fallbackValidatorIds);
    if (candidateIds.length > 0) {
      return candidateIds;
    }

    return defaultValidatorId !== null ? [defaultValidatorId] : [];
  })();
  const nextDesignerIds = normalizeIntegerArray(
    assignedDesignerIds !== undefined ? assignedDesignerIds : assignedDesignerId,
    normalizedFallbackDesignerIds
  );
  const nextValidatorIds = normalizeIntegerArray(
    assignedValidatorIds !== undefined ? assignedValidatorIds : assignedValidatorId,
    normalizedFallbackValidatorIds
  );
  const profileIds = [...new Set([...nextDesignerIds, ...nextValidatorIds])];
  const profiles = await loadGovernanceProfiles(profileIds);

  const ensureProfile = (profile, label) => {
    if (!profile) {
      throw new Error(`${label} not found.`);
    }
  };

  nextDesignerIds.forEach((designerId) => {
    const designerProfile = profiles.get(designerId);
    ensureProfile(designerProfile, 'Assigned process designer');
    if (!designerProfile.activeRoles.includes(ROLES.DESIGNER) && !designerProfile.activeRoles.includes(ROLES.ADMIN)) {
      throw new Error('Assigned process designer must have the process designer role.');
    }
  });

  if (!nextValidatorIds.length) {
    throw new Error('At least one assigned process manager is required.');
  }

  nextValidatorIds.forEach((validatorId) => {
    const validatorProfile = profiles.get(validatorId);
    ensureProfile(validatorProfile, 'Assigned process manager');
    if (!validatorProfile.activeRoles.includes(ROLES.VALIDATOR) && !validatorProfile.activeRoles.includes(ROLES.ADMIN)) {
      throw new Error('Assigned process manager must have the process manager role.');
    }
  });

  return {
    assignedDesignerIds: nextDesignerIds,
    assignedValidatorIds: nextValidatorIds,
    assignedDesignerId: nextDesignerIds[0] ?? null,
    assignedValidatorId: nextValidatorIds[0] ?? null,
  };
}

async function getGovernanceRecipientIds(_companyId, roles = []) {
  const normalizedRoles = [...new Set(roles.filter(Boolean))];
  if (!normalizedRoles.length) {
    return [];
  }

  const result = await pool.query(
    `
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN user_role_assignments ura
      ON ura.user_id = u.id
      AND (ura.expires_on IS NULL OR ura.expires_on >= CURRENT_DATE)
    WHERE (u.role = ANY($1::text[]) OR ura.role_name = ANY($1::text[]))
    `,
    [normalizedRoles]
  );
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

async function notifySpecificRecipients({
  actor,
  companyId,
  userIds,
  type,
  title,
  message,
  entityId,
  severity = 'info',
}) {
  const recipients = [...new Set((userIds || []).map((id) => Number(id)).filter(Number.isInteger))];

  await Promise.all(
    recipients
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

function mergeRecipientIds(...groups) {
  return [...new Set(groups.flat().map((id) => Number(id)).filter(Number.isInteger))];
}

function buildWorkflowNotificationMessage(baseMessage, comment) {
  return comment ? `${baseMessage} Comment: ${comment}` : baseMessage;
}

<<<<<<< HEAD
async function notifyAssignedProcessManagers({
  actor,
  process,
  userIds = [],
  type,
  title,
  message,
  severity = 'info',
}) {
  if (!process?.id) {
    return;
  }

  const recipientIds = [...new Set((userIds || []).map((id) => Number(id)).filter(Number.isInteger))];
  if (!recipientIds.length) {
    return;
  }

  await notifySpecificRecipients({
    actor,
    companyId: process.company_id,
    userIds: recipientIds,
    type,
    title,
    message,
    entityId: process.id,
    severity,
  });
}
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
function cleanupUploadedFile(file) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

function serializeProcessRecord(process) {
  if (!process) {
    return process;
  }

  const assignedDesignerIds = getAssignedDesignerIds(process);
  const assignedValidatorIds = getAssignedValidatorIds(process);

  return {
    ...process,
    manual_data: normalizeManualData(process.manual_data),
    assigned_designer_id: assignedDesignerIds[0] ?? null,
    assigned_validator_id: assignedValidatorIds[0] ?? null,
    assigned_designer_ids: assignedDesignerIds,
    assigned_validator_ids: assignedValidatorIds,
    status: normalizeProcessStatus(process.status, 'draft'),
  };
}

function serializeCategoryRecord(category) {
  if (!category) {
    return category;
  }

  const assignedDesignerIds = getAssignedDesignerIds(category);
  const assignedValidatorIds = getAssignedValidatorIds(category);

  return {
    ...category,
    assigned_designer_id: assignedDesignerIds[0] ?? null,
    assigned_validator_id: assignedValidatorIds[0] ?? null,
    assigned_designer_ids: assignedDesignerIds,
    assigned_validator_ids: assignedValidatorIds,
    section: normalizeProcessSection(category.section, DEFAULT_PROCESS_SECTION),
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
    normalizeManualData(snapshot.manual_data),
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
        status,
        manual_data
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `,
    buildVersionInsertValues(process, createdBy, changeDescription)
  );
}

function shouldCreateVersionSnapshotForWorkflowAction(action) {
  return action === 'approve';
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

async function resolvePendingReopenDesignerIds(process) {
  const comments = await getWorkflowComments(process.id);
  const latestRequestChange = comments.find((entry) => entry.action === 'request_change') || null;
  const latestReturnDraft = comments.find((entry) => entry.action === 'return_draft') || null;
  const currentDesignerIds = getAssignedDesignerIds(process);

  if (!latestRequestChange) {
    return currentDesignerIds;
  }

  if (latestReturnDraft && new Date(latestReturnDraft.created_at || 0) > new Date(latestRequestChange.created_at || 0)) {
    return currentDesignerIds;
  }

  const requesterId = normalizeInteger(latestRequestChange.created_by, null);
  if (!requesterId) {
    return currentDesignerIds;
  }

  const profiles = await loadGovernanceProfiles([requesterId]);
  const requesterProfile = profiles.get(requesterId);
  if (!requesterProfile?.activeRoles?.includes(ROLES.DESIGNER) && !requesterProfile?.activeRoles?.includes(ROLES.ADMIN)) {
    return currentDesignerIds;
  }

  return [requesterId, ...currentDesignerIds.filter((designerId) => Number(designerId) !== Number(requesterId))];
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
      return { nextStatus: 'review', changeDescription: 'Submitted for review' };
    case 'approve':
      return { nextStatus: 'approved', changeDescription: 'Approved process' };
    case 'request_change':
      return { nextStatus: normalized, changeDescription: 'Requested change to approved process' };
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
    const { search, category, status, hierarchical = 'false' } = req.query;

    let query = `
      SELECT
        p.*,
        u.full_name AS created_by_name,
        assigned_designer.full_name AS assigned_designer_name,
        assigned_validator.full_name AS assigned_validator_name,
        c.name AS company_name
      FROM processes p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users assigned_designer ON assigned_designer.id = p.assigned_designer_id
      LEFT JOIN users assigned_validator ON assigned_validator.id = p.assigned_validator_id
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
    } else {
      query += ` AND COALESCE(p.status, 'draft') <> $${paramIndex}`;
      params.push('archived');
      paramIndex += 1;
    }

    const categoryId = normalizeInteger(category, null);
    if (categoryId) {
      const categoryIds = await getDescendantCategoryIds(categoryId);
      query += ` AND p.category_id = ANY($${paramIndex}::int[])`;
      params.push(categoryIds.length ? categoryIds : [categoryId]);
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

router.get('/process-governance-options', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    res.json(await listGovernanceCandidates());
  } catch (error) {
    console.error('Get governance options error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/processes/:id', async (req, res) => {
  try {
    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureProcessReadAccess(req, res, process.company_id)) {
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
      return res.status(403).json({ error: 'Only process managers or admins can create processes.' });
    }

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const {
      name,
      description,
      bpmn_xml,
      category_id,
      company_id,
      status = 'draft',
      manual_data,
      assigned_designer_ids,
      assigned_validator_ids,
      assigned_designer_id,
      assigned_validator_id,
    } = req.body;
    const createdBy = req.user.id;

    if (!name) {
      return res.status(400).json({ error: 'Process name is required' });
    }

    const processCompanyId = resolveProcessCompanyId(req, company_id);
    if (!ensureAssignedCompany(req, res, processCompanyId)) {
      return;
    }

    const categoryId = normalizeInteger(category_id, null);
    if (!categoryId) {
      return res.status(400).json({ error: 'A category is required for every process.' });
    }
    let category = null;
    if (categoryId) {
      category = await getCategoryById(categoryId);
      if (!category) {
        return res.status(400).json({ error: 'Category not found.' });
      }

      if (!ensureProcessWorkspaceAccess(req, res, category.company_id)) {
        return;
      }
    }

    let governanceAssignments;
    try {
      governanceAssignments = await resolveGovernanceAssignments({
        actor: req.user,
        companyId: processCompanyId,
        assignedDesignerIds: assigned_designer_ids,
        assignedValidatorIds: assigned_validator_ids,
        assignedDesignerId: assigned_designer_id,
        assignedValidatorId: assigned_validator_id,
        fallbackDesignerIds: [],
        fallbackValidatorIds: [req.user.id],
        fallbackDesignerId: null,
        fallbackValidatorId: req.user.id,
      });
    } catch (assignmentError) {
      return res.status(400).json({ error: assignmentError.message });
    }

    const resolvedName = await buildNextAvailableProcessName(name, { categoryId });
    const bpmnXml = bpmn_xml || buildDefaultBpmnXml(resolvedName);
    const initialStatus = normalizeProcessStatus(status, 'draft');
    const manualData = normalizeManualData(manual_data);
    const result = await pool.query(
      `
        INSERT INTO processes (
          name,
          description,
          bpmn_xml,
          category_id,
          company_id,
          created_by,
          status,
          manual_data,
          assigned_designer_id,
          assigned_validator_id,
          assigned_designer_ids,
          assigned_validator_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, name, description, bpmn_xml, category_id, company_id, created_by, status, version, created_at, updated_at, manual_data, assigned_designer_id, assigned_validator_id, assigned_designer_ids, assigned_validator_ids
      `,
      [
        resolvedName,
        description || null,
        bpmnXml,
        categoryId,
        processCompanyId,
        createdBy,
        initialStatus,
        manualData,
        governanceAssignments.assignedDesignerId,
        governanceAssignments.assignedValidatorId,
        governanceAssignments.assignedDesignerIds,
        governanceAssignments.assignedValidatorIds,
      ]
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

<<<<<<< HEAD
    await notifyAssignedProcessManagers({
      actor: req.user,
      process,
      userIds: governanceAssignments.assignedValidatorIds,
      type: 'process_manager_assignment',
      title: 'New process assigned',
      message: `${process.name} has been assigned to you in process management.`,
      severity: 'info',
    });
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
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

    if (!ensureProcessWorkspaceAccess(req, res, currentProcess.company_id)) {
      return;
    }

    if (!canEditProcessDefinition(req.user, currentProcess)) {
      return res.status(403).json({ error: 'This process can only be edited by an admin or by its assigned process designer while it is still in draft.' });
    }

    const {
      name,
      description,
      bpmn_xml,
      category_id,
      company_id,
      status,
      change_description,
      manual_data,
      assigned_designer_ids,
      assigned_validator_ids,
      assigned_designer_id,
      assigned_validator_id,
    } = req.body;

    const nextName = name || currentProcess.name;
    const nextDescription = description !== undefined ? description : currentProcess.description;
    const nextManualData = manual_data !== undefined
      ? normalizeManualData(manual_data)
      : normalizeManualData(currentProcess.manual_data);
    const nextCategoryId = normalizeInteger(category_id, currentProcess.category_id);
    if (!nextCategoryId) {
      return res.status(400).json({ error: 'A category is required for every process.' });
    }
    const nextCompanyId = resolveProcessCompanyId(req, company_id, currentProcess.company_id);
    if (!ensureAssignedCompany(req, res, nextCompanyId)) {
      return;
    }

    let category = null;
    if (nextCategoryId) {
      category = await getCategoryById(nextCategoryId);
      if (!category) {
        return res.status(400).json({ error: 'Category not found.' });
      }

      if (!ensureProcessWorkspaceAccess(req, res, category.company_id)) {
        return;
      }
    }

    let governanceAssignments;
    try {
      governanceAssignments = await resolveGovernanceAssignments({
        actor: req.user,
        companyId: nextCompanyId,
        assignedDesignerIds: assigned_designer_ids,
        assignedValidatorIds: assigned_validator_ids,
        assignedDesignerId: assigned_designer_id,
        assignedValidatorId: assigned_validator_id,
        fallbackDesignerIds: currentProcess.assigned_designer_ids ?? [],
        fallbackValidatorIds: currentProcess.assigned_validator_ids ?? [currentProcess.created_by].filter(Boolean),
        fallbackDesignerId: currentProcess.assigned_designer_id ?? null,
        fallbackValidatorId: currentProcess.assigned_validator_id ?? currentProcess.created_by ?? null,
      });
    } catch (assignmentError) {
      return res.status(400).json({ error: assignmentError.message });
    }

    const previousSnapshot = serializeProcessRecord(currentProcess);
    const nextStatus = normalizeProcessStatus(status, normalizeProcessStatus(currentProcess.status, 'draft'));
    const nextBpmnXml =
      typeof bpmn_xml === 'string' && bpmn_xml.trim() !== ''
        ? bpmn_xml
        : (currentProcess.bpmn_xml || buildDefaultBpmnXml(nextName));
    const nextVersion = normalizeInteger(currentProcess.version, 1) || 1;
<<<<<<< HEAD
    const previousValidatorIds = getAssignedValidatorIds(currentProcess);
    const nextValidatorIds = governanceAssignments.assignedValidatorIds;
    const newlyAssignedValidatorIds = nextValidatorIds.filter((id) => !previousValidatorIds.includes(id));
    const unchangedValidatorIds = nextValidatorIds.filter((id) => previousValidatorIds.includes(id));
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435

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
          manual_data = $8,
          assigned_designer_id = $9,
          assigned_validator_id = $10,
          assigned_designer_ids = $11,
          assigned_validator_ids = $12,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $13
        RETURNING id, name, description, bpmn_xml, category_id, company_id, status, version, updated_at, manual_data, assigned_designer_id, assigned_validator_id, assigned_designer_ids, assigned_validator_ids
      `,
      [
        nextName,
        nextDescription,
        nextBpmnXml,
        nextCategoryId,
        nextCompanyId,
        nextStatus,
        nextVersion,
        nextManualData,
        governanceAssignments.assignedDesignerId,
        governanceAssignments.assignedValidatorId,
        governanceAssignments.assignedDesignerIds,
        governanceAssignments.assignedValidatorIds,
        req.params.id,
      ]
    );

    const updatedProcess = {
      ...updateResult.rows[0],
      bpmn_xml: nextBpmnXml,
    };

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
          version: previousSnapshot.version,
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

<<<<<<< HEAD
    if (newlyAssignedValidatorIds.length) {
      await notifyAssignedProcessManagers({
        actor: req.user,
        process: updatedProcess,
        userIds: newlyAssignedValidatorIds,
        type: 'process_manager_assignment',
        title: 'Process manager assignment updated',
        message: `${updatedProcess.name} has been assigned to you in process management.`,
        severity: 'info',
      });
    }

    await notifyAssignedProcessManagers({
      actor: req.user,
      process: updatedProcess,
      userIds: newlyAssignedValidatorIds.length ? unchangedValidatorIds : nextValidatorIds,
      type: 'process_updated',
      title: 'Process updated',
      message: buildWorkflowNotificationMessage(`${updatedProcess.name} was updated in process management.`, change_description),
      severity: 'info',
    });
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
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

    if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
      return;
    }

    if (!canDeleteProcessDefinition(req.user, process)) {
      return res.status(403).json({ error: 'Only the assigned process manager, the assigned draft process designer, or an admin can delete this process.' });
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
      return res.status(403).json({ error: 'Only process managers or admins can import BPMN processes.' });
    }

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      cleanupUploadedFile(req.file);
      return;
    }

    const {
      name,
      description,
      category_id,
      company_id,
      status = 'draft',
      assigned_designer_ids,
      assigned_validator_ids,
      assigned_designer_id,
      assigned_validator_id,
    } = req.body;
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

    const categoryId = normalizeInteger(category_id, null);
    if (!categoryId) {
      cleanupUploadedFile(req.file);
      return res.status(400).json({ error: 'A category is required for every process.' });
    }
    let category = null;
    if (categoryId) {
      category = await getCategoryById(categoryId);
      if (!category) {
        cleanupUploadedFile(req.file);
        return res.status(400).json({ error: 'Category not found.' });
      }

      if (!ensureProcessWorkspaceAccess(req, res, category.company_id)) {
        cleanupUploadedFile(req.file);
        return;
      }
    }

    let governanceAssignments;
    try {
      governanceAssignments = await resolveGovernanceAssignments({
        actor: req.user,
        companyId: processCompanyId,
        assignedDesignerIds: assigned_designer_ids,
        assignedValidatorIds: assigned_validator_ids,
        assignedDesignerId: assigned_designer_id,
        assignedValidatorId: assigned_validator_id,
        fallbackDesignerIds: [],
        fallbackValidatorIds: [req.user.id],
        fallbackDesignerId: null,
        fallbackValidatorId: req.user.id,
      });
    } catch (assignmentError) {
      cleanupUploadedFile(req.file);
      return res.status(400).json({ error: assignmentError.message });
    }

    const bpmnXml = fs.readFileSync(req.file.path, 'utf8');
    if (!bpmnXml.includes('bpmn:definitions') && !bpmnXml.includes('<definitions')) {
      cleanupUploadedFile(req.file);
      return res.status(400).json({ error: 'Invalid BPMN file format' });
    }

    const resolvedName = await buildNextAvailableProcessName(name, { categoryId });
    const initialStatus = isAdmin(req.user)
      ? normalizeProcessStatus(status, 'draft')
      : 'draft';

    const result = await pool.query(
      `
        INSERT INTO processes (
          name,
          description,
          bpmn_xml,
          category_id,
          company_id,
          created_by,
          status,
          manual_data,
          assigned_designer_id,
          assigned_validator_id,
          assigned_designer_ids,
          assigned_validator_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, name, description, bpmn_xml, category_id, company_id, created_by, status, version, created_at, updated_at, manual_data, assigned_designer_id, assigned_validator_id, assigned_designer_ids, assigned_validator_ids
      `,
      [
        resolvedName,
        description || null,
        bpmnXml,
        categoryId,
        processCompanyId,
        req.user.id,
        initialStatus,
        normalizeManualData(req.body?.manual_data),
        governanceAssignments.assignedDesignerId,
        governanceAssignments.assignedValidatorId,
        governanceAssignments.assignedDesignerIds,
        governanceAssignments.assignedValidatorIds,
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

<<<<<<< HEAD
    await notifyAssignedProcessManagers({
      actor: req.user,
      process: importedProcess,
      userIds: governanceAssignments.assignedValidatorIds,
      type: 'process_manager_assignment',
      title: 'Imported process assigned',
      message: `${importedProcess.name} has been assigned to you in process management.`,
      severity: 'info',
    });
=======
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
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
      if (!ensureProcessWorkspaceAccess(req, res, row.company_id)) {
        return;
      }

<<<<<<< HEAD
      const filenameBase = buildDownloadNameBase(row.name, `process-${req.params.id}`);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase} v${row.version_number}.bpmn"`);
=======
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${row.name}_v${row.version_number}.bpmn"`);
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
      return res.send(row.bpmn_xml);
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
      return;
    }

<<<<<<< HEAD
    const filenameBase = buildDownloadNameBase(process.name, `process-${process.id}`);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.bpmn"`);
=======
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${process.name}.bpmn"`);
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
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

    if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
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

  if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
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
  const reportProcess = {
    ...process,
    assigned_designer_names: await loadUserNamesByIds(process.assigned_designer_ids),
    assigned_validator_names: await loadUserNamesByIds(process.assigned_validator_ids),
  };
  const explanation = buildProcessExplanation(reportProcess, workflow);
  const manual = buildProcedureManual(reportProcess, workflow, explanation);
<<<<<<< HEAD
  const filenameBase = buildDownloadNameBase(process.name, `process-${process.id}`);
=======
  const filenameBase =
    String(process.name || `process-${process.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `process-${process.id}`;
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435

  if (format === 'json') {
    res.json({
      process: serializeProcessRecord(process),
      manual,
    });
    return;
  }

  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
<<<<<<< HEAD
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase} - manuel de procedure.pdf"`);
=======
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-manuel-de-procedure.pdf"`);
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
    res.send(buildProcessReportPdf(reportProcess, explanation, { diagramImageDataUrl, workflow }));
    return;
  }

  if (format === 'docx' || format === 'word') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
<<<<<<< HEAD
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase} - manuel de procedure.docx"`);
=======
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-manuel-de-procedure.docx"`);
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
    res.send(await buildProcessReportDocx(reportProcess, explanation, { diagramImageDataUrl, workflow }));
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
<<<<<<< HEAD
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase} - manuel de procedure.html"`);
=======
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}-manuel-de-procedure.html"`);
>>>>>>> 7935281cd37df18e8a4e1f81ec5268af2dc5a435
  res.send(buildProcessReportHtml(reportProcess, explanation, { diagramImageDataUrl, workflow }));
}

router.get('/processes/:id/manual', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    await sendProcessReport(req, res, {
      format: String(req.query.format || 'json').toLowerCase(),
    });
  } catch (error) {
    console.error('Get process manual error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes/:id/manual', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    await sendProcessReport(req, res, {
      format: String(req.body?.format || 'pdf').toLowerCase(),
      diagramImageDataUrl: typeof req.body?.diagramImageDataUrl === 'string' ? req.body.diagramImageDataUrl : null,
    });
  } catch (error) {
    console.error('Create process manual error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureProcessReadAccess(req, res, process.company_id)) {
      return;
    }

    const comments = await getWorkflowComments(process.id);
    res.json({
      process_id: process.id,
      status: normalizeProcessStatus(process.status, 'draft'),
      submitted_at: process.submitted_at,
      approved_at: process.approved_at,
      approved_by: process.approved_by,
      approved_by_name: process.approved_by_name || null,
      archived_at: process.archived_at,
      comments,
    });
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

    if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
      return;
    }

    const action = String(req.body?.action || '');
    const comment = String(req.body?.comment || '').trim() || null;
    const currentStatus = normalizeProcessStatus(process.status, 'draft');
    const { nextStatus, changeDescription } = resolveWorkflowTransition(action, currentStatus);

    if (!['submit_review', 'approve', 'request_change', 'return_draft', 'archive', 'restore'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported workflow action.' });
    }

    if (action === 'submit_review' && !(currentStatus === 'draft' && canSubmitProcessForReview(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process designer, the assigned process manager, or an admin can submit a draft for review.' });
    }

    if (action === 'approve' && !(currentStatus === 'review' && canApproveProcess(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process manager or an admin can approve a process in review.' });
    }

    if (action === 'request_change' && !(currentStatus === 'approved' && canRequestProcessChange(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process designer or an admin can request a reopen on an approved process.' });
    }

    if (action === 'return_draft' && !(['review', 'approved'].includes(currentStatus) && canApproveProcess(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process manager or an admin can reopen this process as a draft.' });
    }

    if (action === 'archive' && !(currentStatus === 'approved' && canApproveProcess(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process manager or an admin can archive an approved process.' });
    }

    if (action === 'restore' && !(currentStatus === 'archived' && canApproveProcess(req.user, process))) {
      return res.status(403).json({ error: 'Only the assigned process manager or an admin can restore an archived process.' });
    }

    if (['request_change', 'return_draft'].includes(action) && !comment) {
      return res.status(400).json({ error: 'A workflow comment is required for this action.' });
    }

    const shouldCreateVersionSnapshot = shouldCreateVersionSnapshotForWorkflowAction(action);
    const nextVersion = shouldCreateVersionSnapshot
      ? (normalizeInteger(process.version, 0) || 0) + 1
      : (normalizeInteger(process.version, 1) || 1);
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
    const reassignedDesignerIds = action === 'return_draft' && currentStatus === 'approved'
      ? await resolvePendingReopenDesignerIds(process)
      : getAssignedDesignerIds(process);
    const reassignedDesignerId = reassignedDesignerIds[0] ?? null;

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
          assigned_designer_id = $7,
          assigned_designer_ids = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
      `,
      [
        nextStatus,
        nextVersion,
        submittedAt,
        approvedAt,
        approvedBy,
        archivedAt,
        reassignedDesignerId,
        reassignedDesignerIds,
        process.id,
      ]
    );

    const updatedProcess = {
      ...updateResult.rows[0],
      bpmn_xml: process.bpmn_xml,
    };

    if (shouldCreateVersionSnapshot) {
      await insertProcessVersion(updatedProcess, req.user.id, changeDescription);
    }

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
        version: nextVersion,
      },
    });

    if (action === 'submit_review') {
      const fallbackRecipients = await getGovernanceRecipientIds(process.company_id, [ROLES.ADMIN]);
      await notifySpecificRecipients({
        actor: req.user,
        companyId: process.company_id,
        userIds: mergeRecipientIds(getAssignedValidatorIds(process), fallbackRecipients),
        type: 'process_approval_waiting',
        title: 'Process awaiting approval',
        message: `${process.name} has been submitted for review.`,
        entityId: process.id,
        severity: 'warning',
      });
      await createNotification({
        companyId: process.company_id,
        type: 'process_approval_waiting',
        title: 'Process awaiting approval',
        message: `${process.name} has been submitted for review.`,
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
      const fallbackRecipients = await getGovernanceRecipientIds(process.company_id, [ROLES.ADMIN]);
      await notifySpecificRecipients({
        actor: req.user,
        companyId: process.company_id,
        userIds: mergeRecipientIds(getAssignedValidatorIds(process), fallbackRecipients),
        type: 'process_change_requested',
        title: 'Approved process needs to be reopened',
        message: buildWorkflowNotificationMessage(`${process.name} has a reopen request waiting for validation.`, comment),
        entityId: process.id,
        severity: 'warning',
      });
    }

    if (action === 'return_draft') {
      await notifySpecificRecipients({
        actor: req.user,
        companyId: process.company_id,
        userIds: mergeRecipientIds(getAssignedDesignerIds(hydratedProcess), [normalizeInteger(process.created_by, null)]),
        type: 'process_reopened',
        title: 'Process reopened to draft',
        message: buildWorkflowNotificationMessage(`${process.name} was reopened to draft and is ready for editing.`, comment),
        entityId: process.id,
        severity: 'info',
      });
    }

    res.json({
      process: serializeProcessRecord(hydratedProcess),
      workflow: {
        process_id: process.id,
        status: nextStatus,
        submitted_at: hydratedProcess?.submitted_at || null,
        approved_at: hydratedProcess?.approved_at || null,
        approved_by: hydratedProcess?.approved_by || null,
        approved_by_name: hydratedProcess?.approved_by_name || null,
        archived_at: hydratedProcess?.archived_at || null,
        comments: await getWorkflowComments(process.id),
      },
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

    if (!ensureProcessWorkspaceAccess(req, res, process.company_id)) {
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
    let query = `
      SELECT
        pc.*,
        parent.name AS parent_name,
        assigned_designer.full_name AS assigned_designer_name,
        assigned_validator.full_name AS assigned_validator_name,
        c.name AS company_name
      FROM process_categories pc
      LEFT JOIN process_categories parent ON parent.id = pc.parent_id
      LEFT JOIN users assigned_designer ON assigned_designer.id = pc.assigned_designer_id
      LEFT JOIN users assigned_validator ON assigned_validator.id = pc.assigned_validator_id
      LEFT JOIN companies c ON c.id = pc.company_id
    `;

    query += ' ORDER BY COALESCE(parent.name, pc.name), pc.parent_id NULLS FIRST, pc.name';

    const result = await pool.query(query);
    res.json(result.rows.map(serializeCategoryRecord));
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
      return res.status(403).json({ error: 'Only process managers or admins can create categories.' });
    }

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description, parent_id, company_id, section } = req.body;
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

      if (!ensureProcessWorkspaceAccess(req, res, parentCategory.company_id)) {
        return;
      }

    }

    const nextSection = parentCategory
      ? normalizeProcessSection(parentCategory.section, DEFAULT_PROCESS_SECTION)
      : normalizeProcessSection(section, null);

    if (!nextSection) {
      return res.status(400).json({ error: 'A process section is required for a category.' });
    }

    const result = await pool.query(
      `
        INSERT INTO process_categories (
          name,
          description,
          parent_id,
          company_id,
          section,
          created_by,
          assigned_designer_id,
          assigned_validator_id,
          assigned_designer_ids,
          assigned_validator_ids
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        name,
        description || null,
        parentId,
        categoryCompanyId,
        nextSection,
        req.user.id,
        null,
        null,
        [],
        [],
      ]
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

    res.status(201).json(serializeCategoryRecord(result.rows[0]));
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

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const existingCategory = await getCategoryById(req.params.id);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (!ensureProcessWorkspaceAccess(req, res, existingCategory.company_id)) {
      return;
    }

    if (!canEditCategoryDefinition(req.user, existingCategory)) {
      return res.status(403).json({ error: 'Only a process manager or an admin can update this category.' });
    }

    const { name, description, parent_id, company_id, section } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const nextParentId = normalizeInteger(parent_id, existingCategory.parent_id);
    const nextCompanyId = resolveCategoryCompanyId(req, company_id, existingCategory.company_id);

    if (nextParentId && Number(nextParentId) === Number(req.params.id)) {
      return res.status(400).json({ error: 'A category cannot be its own parent.' });
    }

    let parentCategory = null;
    if (nextParentId) {
      parentCategory = await getCategoryById(nextParentId);
      if (!parentCategory) {
        return res.status(400).json({ error: 'Parent category not found.' });
      }

      if (!ensureProcessWorkspaceAccess(req, res, parentCategory.company_id)) {
        return;
      }

      const descendants = await getDescendantCategoryIds(req.params.id);
      if (descendants.includes(nextParentId)) {
        return res.status(400).json({ error: 'A category cannot be moved under one of its descendants.' });
      }
    }

    const nextSection = parentCategory
      ? normalizeProcessSection(parentCategory.section, DEFAULT_PROCESS_SECTION)
      : normalizeProcessSection(section, normalizeProcessSection(existingCategory.section, DEFAULT_PROCESS_SECTION));

    if (!nextSection) {
      return res.status(400).json({ error: 'A process section is required for a category.' });
    }

    const result = await pool.query(
      `
        UPDATE process_categories
        SET
          name = $1,
          description = $2,
          parent_id = $3,
          company_id = $4,
          section = $5,
          assigned_designer_id = $6,
          assigned_validator_id = $7,
          assigned_designer_ids = $8,
          assigned_validator_ids = $9
        WHERE id = $10
        RETURNING *
      `,
      [
        name,
        description || null,
        nextParentId,
        nextCompanyId,
        nextSection,
        null,
        null,
        [],
        [],
        req.params.id,
      ]
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

    res.json(serializeCategoryRecord(result.rows[0]));
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

    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const category = await getCategoryById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (!ensureProcessWorkspaceAccess(req, res, category.company_id)) {
      return;
    }

    if (!canDeleteCategoryDefinition(req.user, category)) {
      return res.status(403).json({ error: 'Only a process manager or an admin can delete this category.' });
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

const respondCompanyFeatureRemoved = (_req, res) => {
  res.status(404).json({ error: 'Company management has been removed from this workspace.' });
};

router.get('/companies', respondCompanyFeatureRemoved);
router.post('/companies', respondCompanyFeatureRemoved);
router.put('/companies/:id', respondCompanyFeatureRemoved);
router.delete('/companies/:id', respondCompanyFeatureRemoved);

export default router;
