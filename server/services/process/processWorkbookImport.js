import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { JSDOM } from 'jsdom';
import pool from '../../db.js';

export const DEFAULT_PROCESS_WORKBOOK_PATH = path.resolve(
  process.cwd(),
  'server',
  'data',
  'cartographie-de-process-standard.xlsx'
);

const SECTION_LABELS = {
  pilotage: 'Management Processes',
  metiers: 'Business Processes',
  support: 'Support Processes',
};

const LEGACY_ROLE_MAP = {
  Administrator: 'Admin',
  'Company Administrator': 'Admin',
  'Business Analyst': 'Designer',
  'Process Owner': 'Designer',
  'Process Designer': 'Designer',
  'Process Manager': 'Validator',
  'Process Validator': 'Validator',
  'Risk Manager': 'Validator',
};

function createXmlDocument(xml) {
  const dom = new JSDOM('<root/>', { contentType: 'text/xml' });
  const document = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    const parserError = normalizeText(document.getElementsByTagName('parsererror')[0]?.textContent || 'Invalid XML document.');
    throw new Error(parserError);
  }
  return document;
}

function normalizeText(value = '') {
  return String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRoleName(role = '') {
  const normalized = normalizeText(role);
  return LEGACY_ROLE_MAP[normalized] || normalized;
}

function slugifySection(value = '') {
  const normalized = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('pilotage')) {
    return 'pilotage';
  }

  if (normalized.includes('metier')) {
    return 'metiers';
  }

  if (normalized.includes('support')) {
    return 'support';
  }

  return 'metiers';
}

function getCategoryDescription(name, sectionKey, parentName = '') {
  const sectionLabel = SECTION_LABELS[sectionKey] || SECTION_LABELS.metiers;
  if (parentName) {
    return `Subcategory ${name} linked to domain ${parentName} in ${sectionLabel}.`;
  }

  return `Domain ${name} from the banking process reference library in ${sectionLabel}.`;
}

function getProcessDescription({ name, sectionKey, categoryName, subcategoryName = '', parentProcessName = '' }) {
  const sectionLabel = SECTION_LABELS[sectionKey] || SECTION_LABELS.metiers;

  if (parentProcessName) {
    return `Sub-process ${name} linked to process ${parentProcessName} in ${subcategoryName || categoryName} (${sectionLabel}).`;
  }

  if (subcategoryName) {
    return `Process ${name} from subdomain ${subcategoryName}, linked to ${categoryName} in ${sectionLabel}.`;
  }

  return `Process ${name} from domain ${categoryName} in ${sectionLabel}.`;
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

function ensureWorkbookExists(workbookPath) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }
}

function escapePowerShellLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function extractWorkbookArchive(workbookPath) {
  ensureWorkbookExists(workbookPath);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vbpm-process-import-'));
  const zipPath = path.join(tempDir, 'workbook.zip');
  const extractDir = path.join(tempDir, 'unzipped');

  fs.copyFileSync(workbookPath, zipPath);
  fs.mkdirSync(extractDir, { recursive: true });

  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${escapePowerShellLiteral(zipPath)}' -DestinationPath '${escapePowerShellLiteral(extractDir)}' -Force`,
    ],
    { stdio: 'ignore' }
  );

  return {
    tempDir,
    extractDir,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function parseSharedStrings(extractDir) {
  const sharedStringsPath = path.join(extractDir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(sharedStringsPath)) {
    return [];
  }

  const doc = createXmlDocument(fs.readFileSync(sharedStringsPath, 'utf8'));
  return Array.from(doc.getElementsByTagName('si')).map((item) =>
    normalizeText(
      Array.from(item.getElementsByTagName('t'))
        .map((node) => node.textContent || '')
        .join('')
    )
  );
}

function parseWorkbookSheets(extractDir) {
  const workbookDoc = createXmlDocument(fs.readFileSync(path.join(extractDir, 'xl', 'workbook.xml'), 'utf8'));
  const relsDoc = createXmlDocument(fs.readFileSync(path.join(extractDir, 'xl', '_rels', 'workbook.xml.rels'), 'utf8'));

  const relsById = new Map(
    Array.from(relsDoc.getElementsByTagName('Relationship')).map((node) => [
      node.getAttribute('Id'),
      node.getAttribute('Target'),
    ])
  );

  return Array.from(workbookDoc.getElementsByTagName('sheet')).map((sheet) => ({
    name: normalizeText(sheet.getAttribute('name')),
    target: relsById.get(sheet.getAttribute('r:id')) || relsById.get(sheet.getAttribute('id')) || '',
  }));
}

function getCellValue(cell, sharedStrings) {
  if (!cell) {
    return '';
  }

  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    return normalizeText(
      Array.from(cell.getElementsByTagName('t'))
        .map((node) => node.textContent || '')
        .join('')
    );
  }

  const valueNode = cell.getElementsByTagName('v')[0];
  if (!valueNode) {
    return '';
  }

  const rawValue = valueNode.textContent || '';
  if (type === 's') {
    return normalizeText(sharedStrings[Number(rawValue)] || '');
  }

  return normalizeText(rawValue);
}

function getColumnName(cellRef = '') {
  return String(cellRef).replace(/\d/g, '');
}

function getSheetRows(sheetPath, sharedStrings) {
  const sheetDoc = createXmlDocument(fs.readFileSync(sheetPath, 'utf8'));
  const rows = Array.from(sheetDoc.getElementsByTagName('row')).map((row) => {
    const values = {};
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const column = getColumnName(cell.getAttribute('r'));
      values[column] = getCellValue(cell, sharedStrings);
    });

    return {
      rowNumber: Number(row.getAttribute('r') || 0),
      values,
    };
  });

  const headerIndex = rows.findIndex(
    (row) =>
      row.values.A === 'Macro-processus' &&
      normalizeText(row.values.B).startsWith('Business Process')
  );

  return headerIndex >= 0 ? rows.slice(headerIndex + 1) : [];
}

function parseWorkbookEntries(workbookPath = DEFAULT_PROCESS_WORKBOOK_PATH) {
  const extraction = extractWorkbookArchive(workbookPath);

  try {
    const sharedStrings = parseSharedStrings(extraction.extractDir);
    const sheets = parseWorkbookSheets(extraction.extractDir);
    const entries = [];

    for (const sheet of sheets) {
      const sheetPath = path.join(extraction.extractDir, 'xl', sheet.target.replace(/\//g, path.sep));
      if (!fs.existsSync(sheetPath)) {
        continue;
      }

      const rows = getSheetRows(sheetPath, sharedStrings);
      let currentSection = '';
      let currentRoot = '';
      let currentGroup = '';
      let currentParentProcess = '';

      for (const row of rows) {
        const nextSection = normalizeText(row.values.A);
        const nextRoot = normalizeText(row.values.B);
        const nextGroup = normalizeText(row.values.C);
        const nextParentProcess = normalizeText(row.values.D);
        const nextChildProcess = normalizeText(row.values.E);

        if (nextSection) {
          currentSection = nextSection;
        }

        if (nextRoot) {
          currentRoot = nextRoot;
          currentGroup = '';
          currentParentProcess = '';
        }

        if (nextGroup) {
          currentGroup = nextGroup;
          currentParentProcess = '';
        }

        if (nextParentProcess) {
          currentParentProcess = nextParentProcess;
        }

        if (!currentRoot || !currentGroup) {
          continue;
        }

        entries.push({
          sheetName: sheet.name,
          sectionKey: slugifySection(currentSection || sheet.name),
          sectionLabel: normalizeText(currentSection || sheet.name),
          rootCategoryName: currentRoot,
          businessGroupName: currentGroup,
          processParentName: currentParentProcess,
          processLeafName: nextChildProcess,
        });
      }
    }

    return entries;
  } finally {
    extraction.cleanup();
  }
}

function buildWorkbookHierarchy(entries) {
  const categories = new Map();

  const ensureRootCategory = (sectionKey, name) => {
    const key = `${sectionKey}::${name}`;
    if (!categories.has(key)) {
      categories.set(key, {
        sectionKey,
        name,
        groups: new Map(),
      });
    }
    return categories.get(key);
  };

  entries.forEach((entry) => {
    const rootCategory = ensureRootCategory(entry.sectionKey, entry.rootCategoryName);
    if (!rootCategory.groups.has(entry.businessGroupName)) {
      rootCategory.groups.set(entry.businessGroupName, {
        name: entry.businessGroupName,
        parentProcesses: new Map(),
      });
    }

    if (!entry.processParentName) {
      return;
    }

    const group = rootCategory.groups.get(entry.businessGroupName);
    if (!group.parentProcesses.has(entry.processParentName)) {
      group.parentProcesses.set(entry.processParentName, {
        name: entry.processParentName,
        childProcesses: new Map(),
      });
    }

    if (entry.processLeafName) {
      group.parentProcesses
        .get(entry.processParentName)
        .childProcesses.set(entry.processLeafName, { name: entry.processLeafName });
    }
  });

  return Array.from(categories.values());
}

export function loadProcessCatalogFromWorkbook(workbookPath = DEFAULT_PROCESS_WORKBOOK_PATH) {
  const hierarchy = buildWorkbookHierarchy(parseWorkbookEntries(workbookPath));
  const categories = [];
  const processes = [];

  hierarchy.forEach((rootCategory) => {
    categories.push({
      key: `${rootCategory.sectionKey}::${rootCategory.name}`,
      parentKey: null,
      name: rootCategory.name,
      sectionKey: rootCategory.sectionKey,
      description: getCategoryDescription(rootCategory.name, rootCategory.sectionKey),
    });

    rootCategory.groups.forEach((group) => {
      const hasNestedProcesses = group.parentProcesses.size > 0;
      const categoryKey = `${rootCategory.sectionKey}::${rootCategory.name}`;
      const subcategoryKey = `${categoryKey}::${group.name}`;

      if (!hasNestedProcesses) {
        processes.push({
          key: `process::${categoryKey}::${group.name}`,
          parentKey: null,
          categoryKey,
          name: group.name,
          description: getProcessDescription({
            name: group.name,
            sectionKey: rootCategory.sectionKey,
            categoryName: rootCategory.name,
          }),
        });
        return;
      }

      categories.push({
        key: subcategoryKey,
        parentKey: categoryKey,
        name: group.name,
        sectionKey: rootCategory.sectionKey,
        description: getCategoryDescription(group.name, rootCategory.sectionKey, rootCategory.name),
      });

      group.parentProcesses.forEach((parentProcess) => {
        const parentProcessKey = `process::${subcategoryKey}::${parentProcess.name}`;

        processes.push({
          key: parentProcessKey,
          parentKey: null,
          categoryKey: subcategoryKey,
          name: parentProcess.name,
          description: getProcessDescription({
            name: parentProcess.name,
            sectionKey: rootCategory.sectionKey,
            categoryName: rootCategory.name,
            subcategoryName: group.name,
          }),
        });

        parentProcess.childProcesses.forEach((childProcess) => {
          processes.push({
            key: `process::${parentProcessKey}::${childProcess.name}`,
            parentKey: parentProcessKey,
            categoryKey: subcategoryKey,
            name: childProcess.name,
            description: getProcessDescription({
              name: childProcess.name,
              sectionKey: rootCategory.sectionKey,
              categoryName: rootCategory.name,
              subcategoryName: group.name,
              parentProcessName: parentProcess.name,
            }),
          });
        });
      });
    });
  });

  return {
    categories,
    processes,
  };
}

async function ensureImportSchema(client) {
  await client.query(`
    ALTER TABLE process_categories
    ALTER COLUMN name TYPE VARCHAR(255)
  `);

  await client.query(`
    ALTER TABLE process_categories
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES process_categories(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE process_categories
    ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
  `);

  await client.query(`
    ALTER TABLE process_categories
    ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE process_categories
    ADD COLUMN IF NOT EXISTS section VARCHAR(50)
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS bpmn_xml TEXT
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES processes(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS assigned_designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS assigned_validator_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS assigned_designer_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
  `);

  await client.query(`
    ALTER TABLE processes
    ADD COLUMN IF NOT EXISTS assigned_validator_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[]
  `);

  await client.query(`
    ALTER TABLE process_versions
    ADD COLUMN IF NOT EXISTS name VARCHAR(255)
  `);

  await client.query(`
    ALTER TABLE process_versions
    ADD COLUMN IF NOT EXISTS description TEXT
  `);

  await client.query(`
    ALTER TABLE process_versions
    ADD COLUMN IF NOT EXISTS category_id INTEGER
  `);

  await client.query(`
    ALTER TABLE process_versions
    ADD COLUMN IF NOT EXISTS company_id INTEGER
  `);

  await client.query(`
    ALTER TABLE process_versions
    ADD COLUMN IF NOT EXISTS status VARCHAR(50)
  `);

  await client.query(`
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

  await client.query(`
    ALTER TABLE process_categories
    DROP CONSTRAINT IF EXISTS process_categories_name_key
  `);

  await client.query(`
    DROP INDEX IF EXISTS process_categories_name_key
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_process_categories_scope_name
    ON process_categories (
      COALESCE(company_id, 0),
      COALESCE(parent_id, 0),
      LOWER(name),
      COALESCE(section, 'metiers')
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_process_categories_parent
    ON process_categories(parent_id, name)
  `);
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [tableName]);
  return Boolean(result.rows[0]?.exists);
}

async function safeDeleteAll(client, tableName, predicate = '') {
  if (!(await tableExists(client, tableName))) {
    return;
  }

  const sql = predicate ? `DELETE FROM ${tableName} WHERE ${predicate}` : `DELETE FROM ${tableName}`;
  await client.query(sql);
}

async function resolveImportActors(client) {
  const userResult = await client.query(`
    SELECT id, username, role, company_id
    FROM users
    ORDER BY id
  `);

  const users = userResult.rows.map((row) => ({
    ...row,
    canonical_role: normalizeRoleName(row.role),
  }));

  const adminUser =
    users.find((user) => user.username === 'admin') ||
    users.find((user) => user.canonical_role === 'Admin') ||
    users[0] ||
    null;

  if (!adminUser) {
    throw new Error('At least one user is required before importing process data.');
  }

  const designerIds = users
    .filter((user) => user.canonical_role === 'Designer')
    .map((user) => Number(user.id))
    .filter(Number.isInteger);

  const validatorIds = users
    .filter((user) => user.canonical_role === 'Validator' || user.canonical_role === 'Admin')
    .map((user) => Number(user.id))
    .filter(Number.isInteger);

  return {
    actorUserId: Number(adminUser.id),
    companyId: adminUser.company_id === null ? null : Number(adminUser.company_id),
    assignedDesignerIds: [...new Set(designerIds)],
    assignedValidatorIds: [...new Set(validatorIds.length ? validatorIds : [Number(adminUser.id)])],
  };
}

export async function replaceProcessCatalogFromWorkbook({
  workbookPath = DEFAULT_PROCESS_WORKBOOK_PATH,
} = {}) {
  const catalog = loadProcessCatalogFromWorkbook(workbookPath);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureImportSchema(client);

    const actors = await resolveImportActors(client);

    await safeDeleteAll(client, 'simulation_arrival_times');
    await safeDeleteAll(client, 'simulation_flow_probabilities');
    await safeDeleteAll(client, 'simulation_task_data');
    await safeDeleteAll(client, 'simulation_resources');
    await safeDeleteAll(client, 'simulation_scenarios');
    await safeDeleteAll(client, 'process_workflow_comments');
    await safeDeleteAll(client, 'process_versions');
    await safeDeleteAll(client, 'processes');
    await safeDeleteAll(client, 'process_templates');
    await safeDeleteAll(client, 'process_categories');
    await safeDeleteAll(client, 'entity_comments', `entity_type IN ('process', 'simulation')`);
    await safeDeleteAll(client, 'entity_attachments', `entity_type IN ('process', 'simulation')`);
    await safeDeleteAll(client, 'notifications', `entity_type IN ('process', 'simulation')`);
    await safeDeleteAll(client, 'audit_logs', `entity_type IN ('process', 'process_category', 'simulation')`);

    const categoryIdByKey = new Map();

    for (const category of catalog.categories) {
      const parentId = category.parentKey ? categoryIdByKey.get(category.parentKey) || null : null;
      const result = await client.query(
        `
          INSERT INTO process_categories (
            name,
            description,
            parent_id,
            company_id,
            created_by,
            section
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `,
        [
          category.name,
          category.description,
          parentId,
          actors.companyId,
          actors.actorUserId,
          category.sectionKey,
        ]
      );

      categoryIdByKey.set(category.key, Number(result.rows[0].id));
    }

    const processIdByKey = new Map();
    const importedAt = new Date();

    for (const process of catalog.processes) {
      const categoryId = categoryIdByKey.get(process.categoryKey) || null;
      const parentId = process.parentKey ? processIdByKey.get(process.parentKey) || null : null;
      const bpmnXml = buildDefaultBpmnXml(process.name);

      const result = await client.query(
        `
          INSERT INTO processes (
            name,
            description,
            bpmn_xml,
            category_id,
            parent_id,
            company_id,
            created_by,
            status,
            version,
            submitted_at,
            approved_at,
            approved_by,
            assigned_designer_id,
            assigned_validator_id,
            assigned_designer_ids,
            assigned_validator_ids
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', 1, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id
        `,
        [
          process.name,
          process.description,
          bpmnXml,
          categoryId,
          parentId,
          actors.companyId,
          actors.actorUserId,
          importedAt,
          importedAt,
          actors.assignedValidatorIds[0] || actors.actorUserId,
          actors.assignedDesignerIds[0] || null,
          actors.assignedValidatorIds[0] || actors.actorUserId,
          actors.assignedDesignerIds,
          actors.assignedValidatorIds,
        ]
      );

      const processId = Number(result.rows[0].id);
      processIdByKey.set(process.key, processId);

      await client.query(
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
          VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'approved')
        `,
        [
          processId,
          bpmnXml,
          actors.actorUserId,
          'Imported from bank process cartography workbook',
          process.name,
          process.description,
          categoryId,
          actors.companyId,
        ]
      );
    }

    await client.query('COMMIT');

    return {
      workbookPath,
      categoryCount: catalog.categories.length,
      processCount: catalog.processes.length,
      rootCategoryCount: catalog.categories.filter((category) => !category.parentKey).length,
      subcategoryCount: catalog.categories.filter((category) => Boolean(category.parentKey)).length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
