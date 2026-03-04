import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
// import { Moddle } from 'bpmn-moddle'; // Temporarily disabled for demo

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Get all processes with search and filtering
router.get('/processes', async (req, res) => {
  try {
    const { search, category, status } = req.query;
    let query = `
      SELECT p.*, pc.name as category_name, u.full_name as created_by_name
      FROM processes p
      LEFT JOIN process_categories pc ON p.category_id = pc.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      query += ` AND p.category_id = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.updated_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Get processes error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single process with versions
router.get('/processes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get process details
    const processResult = await pool.query(`
      SELECT p.*, pc.name as category_name, u.full_name as created_by_name
      FROM processes p
      LEFT JOIN process_categories pc ON p.category_id = pc.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.id = $1
    `, [id]);

    if (processResult.rows.length === 0) {
      return res.status(404).json({ error: 'Process not found' });
    }

    // Get process versions
    const versionsResult = await pool.query(`
      SELECT pv.*, u.full_name as created_by_name
      FROM process_versions pv
      LEFT JOIN users u ON pv.created_by = u.id
      WHERE pv.process_id = $1
      ORDER BY pv.version_number DESC
    `, [id]);

    const process = processResult.rows[0];
    process.versions = versionsResult.rows;

    res.json(process);
  } catch (error) {
    console.error('Get process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new process
router.post('/processes', async (req, res) => {
  try {
    const { name, description, bpmn_xml, category_id, status = 'draft' } = req.body;
    const created_by = 1; // Default to admin user for now

    if (!name) {
      return res.status(400).json({ error: 'Process name is required' });
    }

    const result = await pool.query(
      `INSERT INTO processes (name, description, bpmn_xml, category_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, category_id, created_by, status, version, created_at, updated_at`,
      [name, description, bpmn_xml, category_id || null, created_by, status]
    );

    const process = result.rows[0];

    // Create initial version
    await pool.query(
      `INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
       VALUES ($1, $2, $3, $4, $5)`,
      [process.id, 1, bpmn_xml, created_by, 'Initial version']
    );

    res.status(201).json(process);
  } catch (error) {
    console.error('Create process error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Update process
router.put('/processes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, bpmn_xml, category_id, status, change_description } = req.body;
    const updated_by = req.user?.id || 1;

    // Get current process
    const currentResult = await pool.query('SELECT * FROM processes WHERE id = $1', [id]);
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Process not found' });
    }

    const currentProcess = currentResult.rows[0];
    const newVersion = currentProcess.version + 1;

    // Update process
    const updateResult = await pool.query(
      `UPDATE processes 
       SET name = $1, description = $2, bpmn_xml = $3, category_id = $4, status = $5, 
           version = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, name, description, category_id, status, version, updated_at`,
      [name, description, bpmn_xml, category_id, status, newVersion, id]
    );

    // Create new version
    await pool.query(
      `INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, newVersion, bpmn_xml, updated_by, change_description || 'Updated process']
    );

    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Update process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete process
router.delete('/processes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM processes WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Process not found' });
    }

    res.json({ message: 'Process deleted successfully' });
  } catch (error) {
    console.error('Delete process error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Import BPMN file
router.post('/processes/import', upload.single('bpmnFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { name, description, category_id } = req.body;
    const created_by = req.user?.id || 1;

    // Read BPMN file
    const bpmn_xml = fs.readFileSync(req.file.path, 'utf8');

    // Basic BPMN validation - check if it contains BPMN elements
    if (!bpmn_xml.includes('bpmn:definitions') && !bpmn_xml.includes('definitions')) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
      return res.status(400).json({ error: 'Invalid BPMN file format' });
    }

    // Create process
    const result = await pool.query(
      `INSERT INTO processes (name, description, bpmn_xml, category_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING id, name, description, category_id, status, version, created_at`,
      [name, description, bpmn_xml, category_id, created_by]
    );

    const process = result.rows[0];

    // Create initial version
    await pool.query(
      `INSERT INTO process_versions (process_id, version_number, bpmn_xml, created_by, change_description)
       VALUES ($1, $2, $3, $4, $5)`,
      [process.id, 1, bpmn_xml, created_by, 'Imported from BPMN file']
    );

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.status(201).json(process);
  } catch (error) {
    console.error('Import BPMN error:', error);
    if (req.file) {
      fs.unlinkSync(req.file.path); // Clean up uploaded file
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Export BPMN file
router.get('/processes/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const { version } = req.query;

    let bpmn_xml;
    let filename;

    if (version) {
      // Export specific version
      const versionResult = await pool.query(
        'SELECT pv.*, p.name FROM process_versions pv JOIN processes p ON pv.process_id = p.id WHERE pv.process_id = $1 AND pv.version_number = $2',
        [id, version]
      );
      
      if (versionResult.rows.length === 0) {
        return res.status(404).json({ error: 'Process version not found' });
      }
      
      bpmn_xml = versionResult.rows[0].bpmn_xml;
      filename = `${versionResult.rows[0].name}_v${version}.bpmn`;
    } else {
      // Export latest version
      const processResult = await pool.query('SELECT * FROM processes WHERE id = $1', [id]);
      
      if (processResult.rows.length === 0) {
        return res.status(404).json({ error: 'Process not found' });
      }
      
      bpmn_xml = processResult.rows[0].bpmn_xml;
      filename = `${processResult.rows[0].name}.bpmn`;
    }

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(bpmn_xml);
  } catch (error) {
    console.error('Export BPMN error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get process categories
router.get('/process-categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM process_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create process category
router.post('/process-categories', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const result = await pool.query(
      'INSERT INTO process_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
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

export default router;
