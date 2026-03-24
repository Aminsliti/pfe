import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import {
  PERMISSIONS,
  ensureAuthenticated,
  ensureCompanyAccess,
  ensurePermission,
  isCompanyAdmin,
  isGlobalAdmin,
} from '../utils/access.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
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
        c.name AS company_name
      FROM processes p
      LEFT JOIN process_categories pc ON pc.id = p.category_id
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

function resolveProcessCompanyId(req, requestedCompanyId, fallbackCompanyId = null) {
  if (isGlobalAdmin(req.user)) {
    return normalizeInteger(requestedCompanyId, fallbackCompanyId);
  }

  return req.user.companyId ?? null;
}

function ensureAssignedCompany(req, res, companyId) {
  if (companyId) {
    return true;
  }

  res.status(400).json({ error: 'A company must be assigned to this record.' });
  return false;
}

function cleanupUploadedFile(file) {
  if (file?.path && fs.existsSync(file.path)) {
    fs.unlinkSync(file.path);
  }
}

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
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    const categoryId = normalizeInteger(category, null);
    if (categoryId) {
      query += ` AND p.category_id = $${paramIndex}`;
      params.push(categoryId);
      paramIndex += 1;
    }

    if (companyFilter) {
      query += ` AND p.company_id = $${paramIndex}`;
      params.push(companyFilter);
      paramIndex += 1;
    }

    query += ' ORDER BY p.parent_id NULLS FIRST, p.name';

    const result = await pool.query(query, params);
    const processes = hierarchical === 'true' ? buildProcessTree(result.rows) : result.rows;
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
      ...process,
      versions: versionsResult.rows,
    });
  } catch (error) {
    console.error('Get process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
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
    const result = await pool.query(
      `
        INSERT INTO processes (name, description, bpmn_xml, category_id, company_id, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, description, category_id, company_id, created_by, status, version, created_at, updated_at
      `,
      [name, description || null, bpmnXml, normalizeInteger(category_id, null), processCompanyId, createdBy, status]
    );

    const process = result.rows[0];

    await pool.query(
      `
        INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [process.id, 1, bpmnXml, createdBy, 'Initial version']
    );

    res.status(201).json(process);
  } catch (error) {
    console.error('Create process error:', error);
    res.status(500).json({ error: `Server error: ${error.message}` });
  }
});

router.put('/processes/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const currentProcess = await getProcessById(req.params.id);
    if (!currentProcess) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, currentProcess.company_id)) {
      return;
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

    const nextStatus = status || currentProcess.status;
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

    await pool.query(
      `
        INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [req.params.id, newVersion, nextBpmnXml, req.user.id, change_description || 'Updated process']
    );

    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Update process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/processes/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const process = await getProcessById(req.params.id);
    if (!process) {
      return res.status(404).json({ error: 'Process not found' });
    }

    if (!ensureCompanyAccess(req, res, process.company_id)) {
      return;
    }

    await pool.query('DELETE FROM processes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Process deleted successfully' });
  } catch (error) {
    console.error('Delete process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/processes/import', upload.single('bpmnFile'), async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
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
        status || 'draft',
      ]
    );

    await pool.query(
      `
        INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [result.rows[0].id, 1, bpmnXml, req.user.id, 'Imported from BPMN file']
    );

    cleanupUploadedFile(req.file);
    res.status(201).json(result.rows[0]);
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

router.get('/process-categories', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const result = await pool.query('SELECT * FROM process_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/process-categories', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = await pool.query(
      'INSERT INTO process_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );

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

    const result = await pool.query('DELETE FROM companies WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
