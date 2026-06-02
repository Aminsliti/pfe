import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import {
  ensureAuthenticated,
  ensurePermission,
  PERMISSIONS,
  isGlobalAdmin,
} from '../services/auth/access.js';
import {
  ATTACHMENTS_DIR,
  createNotification,
  ensureCollaborationSchema,
  listNotificationsForUser,
  resolveEntityForAccess,
} from '../services/collaboration/collaboration.js';
import { logAuditEvent } from '../services/audit/auditLog.js';
import { extractTasksFromDiagram } from '../services/simulation/simulationEngine.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(ATTACHMENTS_DIR)) {
      fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    }
    cb(null, ATTACHMENTS_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = String(file.originalname || 'file').replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage });
let seededTemplates = false;

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTemplateXml(name, steps = []) {
  const safeName = escapeXml(name);
  const taskMarkup = steps
    .map(
      (step, index) => `
    <bpmn:userTask id="Task_${index + 1}" name="${escapeXml(step)}" />`
    )
    .join('');
  const flowMarkup = steps
    .map((step, index) => {
      const sourceRef = index === 0 ? 'StartEvent_1' : `Task_${index}`;
      const targetRef = `Task_${index + 1}`;
      return `
    <bpmn:sequenceFlow id="Flow_${index + 1}" sourceRef="${sourceRef}" targetRef="${targetRef}" />`;
    })
    .join('');
  const lastSourceRef = steps.length ? `Task_${steps.length}` : 'StartEvent_1';

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" name="${safeName}" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start" />${taskMarkup}
    <bpmn:endEvent id="EndEvent_1" name="End" />${flowMarkup}
    <bpmn:sequenceFlow id="Flow_End" sourceRef="${lastSourceRef}" targetRef="EndEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1"><dc:Bounds x="140" y="162" width="36" height="36" /></bpmndi:BPMNShape>
      ${steps
        .map(
          (step, index) => `<bpmndi:BPMNShape id="Task_${index + 1}_di" bpmnElement="Task_${index + 1}"><dc:Bounds x="${250 + index * 170}" y="140" width="120" height="80" /></bpmndi:BPMNShape>`
        )
        .join('')}
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1"><dc:Bounds x="${280 + steps.length * 170}" y="162" width="36" height="36" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

function loadBundledTemplateXml(relativePath, fallbackXml) {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
  } catch {
    return fallbackXml;
  }
}

async function ensureDefaultTemplates() {
  if (seededTemplates || process.env.NODE_ENV === 'test') {
    return;
  }

  const templates = [
    {
      name: 'Customer Service Intake',
      description: 'Starter process for intake, categorisation, and resolution.',
      bpmn_xml: buildTemplateXml('Customer Service Intake', ['Receive Request', 'Categorise Request', 'Resolve Request']),
      simulation_defaults: {
        calendar_settings: {
          business_hours: { start: '08:30', end: '17:30' },
          weekend_days: [0, 6],
          holidays: [],
          shifts: [
            { start: '08:30', end: '12:30' },
            { start: '13:30', end: '17:30' },
          ],
        },
        resources: [
          { name: 'Service Agent', resource_type: 'human', quantity: 3, cost_per_hour: 28, availability: 100 },
        ],
      },
    },
    {
      name: 'Procurement Approval',
      description: 'Starter process with review, approval, and ordering.',
      bpmn_xml: buildTemplateXml('Procurement Approval', ['Create Request', 'Manager Review', 'Approve Order']),
      simulation_defaults: {
        calendar_settings: {
          business_hours: { start: '09:00', end: '18:00' },
          weekend_days: [0, 6],
          holidays: [],
          shifts: [{ start: '09:00', end: '18:00' }],
        },
        resources: [
          { name: 'Buyer', resource_type: 'human', quantity: 2, cost_per_hour: 35, availability: 100 },
        ],
      },
    },
    {
      name: 'Purchase Request Control Demo',
      description: 'Rich demo with pools, actors, risks, approvals, message flows, and control checkpoints.',
      bpmn_xml: loadBundledTemplateXml(
        path.join('public', 'samples', 'purchase-request-control-demo.bpmn'),
        buildTemplateXml('Purchase Request Control Demo', ['Prepare Request', 'Manager Review', 'Control Check', 'Create Purchase Order'])
      ),
      simulation_defaults: {
        process_instances: 18,
        warmup_percent: 5,
        cooldown_percent: 10,
        infinite_resources: false,
        simulate_all_levels: false,
        monte_carlo_runs: 1,
        notifications_enabled: true,
        import_csv_arrivals: false,
        calendar_settings: {
          business_hours: { start: '08:30', end: '17:30' },
          weekend_days: [0, 6],
          holidays: [],
          shifts: [
            { start: '08:30', end: '12:30' },
            { start: '13:30', end: '17:30' },
          ],
        },
        resources: [
          { key: 'requester', name: 'Requester', resource_type: 'human', quantity: 5, cost_per_hour: 20, availability: 100 },
          { key: 'department_manager', name: 'Department Manager', resource_type: 'human', quantity: 2, cost_per_hour: 42, availability: 100 },
          { key: 'buyer', name: 'Buyer', resource_type: 'human', quantity: 3, cost_per_hour: 35, availability: 100 },
          { key: 'control_officer', name: 'Control Officer', resource_type: 'human', quantity: 2, cost_per_hour: 38, availability: 100 },
        ],
        task_data: [
          { task_id: 'Task_PrepareRequest', duration_min: 18, duration_type: 'normal', duration_std: 4, resource_key: 'requester', cost: 0, sla_target_min: null },
          { task_id: 'Task_ManagerReview', duration_min: 8, duration_type: 'normal', duration_std: 2, resource_key: 'department_manager', cost: 0, sla_target_min: null },
          { task_id: 'Task_SendApprovedRequest', duration_min: 3, duration_type: 'fixed', duration_std: 0, resource_key: 'requester', cost: 0, sla_target_min: null },
          { task_id: 'Task_ReceiveApprovedRequest', duration_min: 5, duration_type: 'fixed', duration_std: 0, resource_key: 'buyer', cost: 0, sla_target_min: null },
          { task_id: 'Task_ComplianceCheck', duration_min: 16, duration_type: 'normal', duration_std: 4, resource_key: 'control_officer', cost: 0, sla_target_min: null },
          { task_id: 'Task_EscalateControlDelay', duration_min: 0, duration_type: 'fixed', duration_std: 0, resource_key: null, cost: 0, sla_target_min: null },
          { task_id: 'Task_CreatePurchaseOrder', duration_min: 12, duration_type: 'normal', duration_std: 3, resource_key: 'buyer', cost: 0, sla_target_min: null },
          { task_id: 'Task_RequestClarification', duration_min: 0, duration_type: 'fixed', duration_std: 0, resource_key: null, cost: 0, sla_target_min: null },
        ],
        flow_probabilities: [
          { flow_id: 'Flow_Request_3', flow_name: 'No', from_element: 'Gateway_ManagerApprovalRequired', to_element: 'Task_SendApprovedRequest', probability: 30 },
          { flow_id: 'Flow_Request_4', flow_name: 'Yes', from_element: 'Gateway_ManagerApprovalRequired', to_element: 'Task_ManagerReview', probability: 70 },
          { flow_id: 'Flow_Proc_4', flow_name: 'Yes', from_element: 'Gateway_ControlsPassed', to_element: 'Task_CreatePurchaseOrder', probability: 85 },
          { flow_id: 'Flow_Proc_6', flow_name: 'No', from_element: 'Gateway_ControlsPassed', to_element: 'Task_RequestClarification', probability: 15 },
        ],
      },
    },
    {
      name: 'Incident Resolution',
      description: 'Starter process for IT incident triage and resolution.',
      bpmn_xml: buildTemplateXml('Incident Resolution', ['Log Incident', 'Diagnose Issue', 'Resolve Incident']),
      simulation_defaults: {
        calendar_settings: {
          business_hours: { start: '00:00', end: '23:59' },
          weekend_days: [],
          holidays: [],
          shifts: [{ start: '00:00', end: '23:59' }],
        },
        resources: [
          { name: 'Support Engineer', resource_type: 'human', quantity: 4, cost_per_hour: 42, availability: 100 },
        ],
      },
    },
  ];

  for (const template of templates) {
    await pool.query(
      `
        INSERT INTO process_templates (name, description, bpmn_xml, simulation_defaults)
        VALUES ($1,$2,$3,$4::jsonb)
        ON CONFLICT (name) DO NOTHING
      `,
      [template.name, template.description, template.bpmn_xml, JSON.stringify(template.simulation_defaults)]
    );
  }

  seededTemplates = true;
}

router.use(async (req, res, next) => {
  try {
    await ensureCollaborationSchema();
    await ensureDefaultTemplates();
    next();
  } catch (error) {
    console.error('collaboration schema error:', error);
    res.status(500).json({ error: 'Failed to prepare collaboration storage.' });
  }
});

router.get('/entities/:entityType/:entityId/comments', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const entity = await resolveEntityForAccess(req, res, req.params.entityType, req.params.entityId);
    if (!entity) {
      return;
    }

    const result = await pool.query(
      `
        SELECT
          ec.*,
          u.full_name AS author_name
        FROM entity_comments ec
        LEFT JOIN users u ON u.id = ec.author_id
        WHERE ec.entity_type = $1 AND ec.entity_id = $2
        ORDER BY ec.created_at DESC
      `,
      [entity.entityType, entity.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('comments list error:', error);
    res.status(500).json({ error: 'Failed to load comments.' });
  }
});

router.post('/entities/:entityType/:entityId/comments', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const entity = await resolveEntityForAccess(req, res, req.params.entityType, req.params.entityId);
    if (!entity) {
      return;
    }

    const body = String(req.body?.body || '').trim();
    if (!body) {
      return res.status(400).json({ error: 'Comment body is required.' });
    }

    const result = await pool.query(
      `
        INSERT INTO entity_comments (entity_type, entity_id, company_id, author_id, body)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
      `,
      [entity.entityType, entity.id, entity.companyId, req.user.id, body]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: entity.entityType,
      entityId: entity.id,
      companyId: entity.companyId,
      action: 'comment_add',
      summary: `Added comment to ${entity.entityType} "${entity.name}"`,
      details: { body },
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('comment create error:', error);
    res.status(500).json({ error: 'Failed to create comment.' });
  }
});

router.get('/entities/:entityType/:entityId/attachments', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const entity = await resolveEntityForAccess(req, res, req.params.entityType, req.params.entityId);
    if (!entity) {
      return;
    }

    const result = await pool.query(
      `
        SELECT
          ea.*,
          u.full_name AS uploaded_by_name
        FROM entity_attachments ea
        LEFT JOIN users u ON u.id = ea.uploaded_by
        WHERE ea.entity_type = $1 AND ea.entity_id = $2
        ORDER BY ea.created_at DESC
      `,
      [entity.entityType, entity.id]
    );

    res.json(
      result.rows.map((attachment) => ({
        ...attachment,
        download_url: `/uploads/attachments/${attachment.stored_name}`,
      }))
    );
  } catch (error) {
    console.error('attachments list error:', error);
    res.status(500).json({ error: 'Failed to load attachments.' });
  }
});

router.post('/entities/:entityType/:entityId/attachments', upload.single('file'), async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return;
    }

    const entity = await resolveEntityForAccess(req, res, req.params.entityType, req.params.entityId);
    if (!entity) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return;
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A file is required.' });
    }

    const result = await pool.query(
      `
        INSERT INTO entity_attachments (
          entity_type,
          entity_id,
          company_id,
          uploaded_by,
          original_name,
          stored_name,
          mime_type,
          size_bytes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,
      [
        entity.entityType,
        entity.id,
        entity.companyId,
        req.user.id,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype || null,
        req.file.size || 0,
      ]
    );

    await logAuditEvent({
      actor: req.user,
      entityType: entity.entityType,
      entityId: entity.id,
      companyId: entity.companyId,
      action: 'attachment_add',
      summary: `Uploaded attachment "${req.file.originalname}" to ${entity.entityType} "${entity.name}"`,
      details: {
        file: req.file.originalname,
        size_bytes: req.file.size || 0,
      },
    });

    res.status(201).json({
      ...result.rows[0],
      download_url: `/uploads/attachments/${result.rows[0].stored_name}`,
    });
  } catch (error) {
    console.error('attachment create error:', error);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to upload attachment.' });
  }
});

router.delete('/entities/:entityType/:entityId/attachments/:attachmentId', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const entity = await resolveEntityForAccess(req, res, req.params.entityType, req.params.entityId);
    if (!entity) {
      return;
    }

    const result = await pool.query(
      `
        DELETE FROM entity_attachments
        WHERE id = $1 AND entity_type = $2 AND entity_id = $3
        RETURNING *
      `,
      [req.params.attachmentId, entity.entityType, entity.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const attachment = result.rows[0];
    const filePath = path.join(ATTACHMENTS_DIR, attachment.stored_name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ message: 'Attachment deleted.' });
  } catch (error) {
    console.error('attachment delete error:', error);
    res.status(500).json({ error: 'Failed to delete attachment.' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const notifications = await listNotificationsForUser(req.user);
    res.json(notifications);
  } catch (error) {
    console.error('notifications list error:', error);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId)) {
      return res.json({ message: 'Dynamic notification acknowledged.' });
    }

    if (isGlobalAdmin(req.user)) {
      await pool.query(
        `
          UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [notificationId]
      );
    } else {
      await pool.query(
        `
          UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND user_id = $2
        `,
        [notificationId, req.user.id]
      );
    }

    res.json({ message: 'Notification marked as read.' });
  } catch (error) {
    console.error('notification read error:', error);
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    if (isGlobalAdmin(req.user)) {
      await pool.query(
        `
          UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
          WHERE read_at IS NULL
        `
      );
    } else {
      await pool.query(
        `
          UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
          WHERE read_at IS NULL AND user_id = $1
        `,
        [req.user.id]
      );
    }

    res.json({ message: 'Notifications marked as read.' });
  } catch (error) {
    console.error('notification read-all error:', error);
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

router.get('/process-templates', async (req, res) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const result = await pool.query(`
      SELECT *
      FROM process_templates
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('template list error:', error);
    res.status(500).json({ error: 'Failed to load process templates.' });
  }
});

router.post('/process-templates', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description, category_id, bpmn_xml, simulation_defaults = {} } = req.body;
    if (!name || !bpmn_xml) {
      return res.status(400).json({ error: 'Template name and BPMN XML are required.' });
    }

    const scopedCompanyId = null;
    const result = await pool.query(
      `
        INSERT INTO process_templates (
          name,
          description,
          category_id,
          company_id,
          bpmn_xml,
          simulation_defaults,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
        RETURNING *
      `,
      [name, description || null, category_id || null, scopedCompanyId, bpmn_xml, JSON.stringify(simulation_defaults), req.user.id]
    );

    await createNotification({
      companyId: scopedCompanyId,
      type: 'template_created',
      title: 'Process template created',
      message: `${name} is now available as a reusable starter template.`,
      entityType: 'process',
      severity: 'info',
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('template create error:', error);
    res.status(500).json({ error: 'Failed to create template.' });
  }
});

router.put('/process-templates/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const { name, description, category_id, bpmn_xml, simulation_defaults = {} } = req.body;
    const scopedCompanyId = null;
    const result = await pool.query(
      `
        UPDATE process_templates
        SET
          name = $1,
          description = $2,
          category_id = $3,
          company_id = $4,
          bpmn_xml = $5,
          simulation_defaults = $6::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
      `,
      [name, description || null, category_id || null, scopedCompanyId, bpmn_xml, JSON.stringify(simulation_defaults), req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('template update error:', error);
    res.status(500).json({ error: 'Failed to update template.' });
  }
});

router.delete('/process-templates/:id', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const result = await pool.query(
      'DELETE FROM process_templates WHERE id = $1 RETURNING id',
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    res.json({ message: 'Template deleted.' });
  } catch (error) {
    console.error('template delete error:', error);
    res.status(500).json({ error: 'Failed to delete template.' });
  }
});

router.post('/process-templates/:id/apply', async (req, res) => {
  try {
    if (!ensurePermission(req, res, PERMISSIONS.MANAGE_PROCESSES)) {
      return;
    }

    const templateResult = await pool.query(
      'SELECT * FROM process_templates WHERE id = $1',
      [req.params.id]
    );

    if (!templateResult.rows.length) {
      return res.status(404).json({ error: 'Template not found.' });
    }

    const template = templateResult.rows[0];
    const scopedCompanyId = null;

    const name = String(req.body?.name || template.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Process name is required.' });
    }

    const categoryId = req.body?.category_id || template.category_id || null;
    if (!categoryId) {
      return res.status(400).json({ error: 'A category is required for every process.' });
    }
    const description = req.body?.description ?? template.description ?? null;
    const initialStatus = String(req.body?.status || 'draft');
    const simulationDefaults =
      typeof template.simulation_defaults === 'string'
        ? JSON.parse(template.simulation_defaults || '{}')
        : (template.simulation_defaults || {});

    const processResult = await pool.query(
      `
        INSERT INTO processes (
          name,
          description,
          bpmn_xml,
          category_id,
          company_id,
          created_by,
          status,
          version
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,1)
        RETURNING *
      `,
      [
        name,
        description,
        template.bpmn_xml,
        categoryId || null,
        scopedCompanyId,
        req.user.id,
        initialStatus,
      ]
    );

    const process = processResult.rows[0];

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
        VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        process.id,
        template.bpmn_xml,
        req.user.id,
        `Created from template "${template.name}"`,
        process.name,
        process.description,
        process.category_id,
        process.company_id,
        process.status,
      ]
    );

    let scenario = null;
    const shouldCreateScenario = req.body?.create_simulation !== false;

    if (shouldCreateScenario) {
      const scenarioResult = await pool.query(
        `
          INSERT INTO simulation_scenarios (
            name,
            description,
            process_id,
            status,
            process_instances,
            warmup_percent,
            cooldown_percent,
            infinite_resources,
            simulate_all_levels,
            import_csv_arrivals,
            calendar_settings,
            monte_carlo_runs,
            notifications_enabled,
            created_by
          )
          VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
          RETURNING *
        `,
        [
          req.body?.simulation_name || `${name} - Baseline`,
          `Starter simulation from template "${template.name}"`,
          process.id,
          Number(simulationDefaults.process_instances) || 100,
          Number(simulationDefaults.warmup_percent) || 5,
          Number(simulationDefaults.cooldown_percent) || 10,
          Boolean(simulationDefaults.infinite_resources),
          Boolean(simulationDefaults.simulate_all_levels),
          Boolean(simulationDefaults.import_csv_arrivals),
          JSON.stringify(simulationDefaults.calendar_settings || {}),
          Math.max(1, Number(simulationDefaults.monte_carlo_runs) || 1),
          simulationDefaults.notifications_enabled !== false,
          req.user.id,
        ]
      );

      scenario = scenarioResult.rows[0];
      const resourceIdsByKey = new Map();
      const resourceIdsByName = new Map();

      for (const resource of simulationDefaults.resources || []) {
        const resourceResult = await pool.query(
          `
            INSERT INTO simulation_resources (
              scenario_id,
              name,
              resource_type,
              quantity,
              cost_per_hour,
              availability,
              availability_windows
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
            RETURNING *
          `,
          [
            scenario.id,
            resource.name,
            resource.resource_type || 'human',
            Number(resource.quantity) || 1,
            Number(resource.cost_per_hour) || 0,
            Number(resource.availability) || 100,
            JSON.stringify(resource.availability_windows || []),
          ]
        );

        const insertedResource = resourceResult.rows[0];
        if (resource.key) {
          resourceIdsByKey.set(String(resource.key), insertedResource.id);
        }
        if (resource.name) {
          resourceIdsByName.set(String(resource.name), insertedResource.id);
        }
      }

      const templateTasks = extractTasksFromDiagram(template.bpmn_xml);
      for (const task of templateTasks) {
        const taskDefaults =
          (simulationDefaults.task_data || []).find(
            (entry) => entry.task_id === task.task_id || entry.task_name === task.task_name
          ) || {};
        const taskResourceId =
          taskDefaults.resource_id !== undefined && taskDefaults.resource_id !== null
            ? Number(taskDefaults.resource_id) || null
            : taskDefaults.resource_key && resourceIdsByKey.has(String(taskDefaults.resource_key))
              ? resourceIdsByKey.get(String(taskDefaults.resource_key))
              : taskDefaults.resource_name && resourceIdsByName.has(String(taskDefaults.resource_name))
                ? resourceIdsByName.get(String(taskDefaults.resource_name))
                : null;

        await pool.query(
          `
            INSERT INTO simulation_task_data (
              scenario_id,
              task_id,
              task_name,
              duration_min,
              duration_type,
              duration_std,
              resource_id,
              cost,
              sla_target_min
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            scenario.id,
            task.task_id,
            task.task_name,
            Number(taskDefaults.duration_min ?? task.duration_min ?? 30) || 30,
            taskDefaults.duration_type || task.duration_type || 'fixed',
            Number(taskDefaults.duration_std ?? task.duration_std ?? 0) || 0,
            taskResourceId,
            Number(taskDefaults.cost ?? task.cost ?? 0) || 0,
            taskDefaults.sla_target_min !== undefined && taskDefaults.sla_target_min !== null && taskDefaults.sla_target_min !== ''
              ? Number(taskDefaults.sla_target_min)
              : null,
          ]
        );
      }

      for (const flow of simulationDefaults.flow_probabilities || []) {
        await pool.query(
          `
            INSERT INTO simulation_flow_probabilities (
              scenario_id,
              flow_id,
              flow_name,
              from_element,
              to_element,
              probability
            )
            VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [
            scenario.id,
            flow.flow_id,
            flow.flow_name || '',
            flow.from_element || '',
            flow.to_element || '',
            Number(flow.probability) || 100,
          ]
        );
      }
    }

    await logAuditEvent({
      actor: req.user,
      entityType: 'process',
      entityId: process.id,
      companyId: process.company_id,
      action: 'template_apply',
      summary: `Created process "${process.name}" from template "${template.name}"`,
      details: {
        template_id: template.id,
        scenario_id: scenario?.id || null,
      },
    });

    await createNotification({
      companyId: process.company_id,
      type: 'template_applied',
      title: 'Process created from template',
      message: `${process.name} was created from the "${template.name}" template.`,
      entityType: 'process',
      entityId: process.id,
      severity: 'info',
    });

    res.status(201).json({
      process,
      scenario,
      template: {
        id: template.id,
        name: template.name,
      },
    });
  } catch (error) {
    console.error('template apply error:', error);
    res.status(500).json({ error: 'Failed to apply template.' });
  }
});

export default router;
