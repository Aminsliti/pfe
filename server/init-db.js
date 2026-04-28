import pool from './db.js';
import { replaceProcessCatalogFromWorkbook } from './utils/processWorkbookImport.js';

const initDatabase = async () => {
  try {
    console.log('Initializing database...');

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        company_id INTEGER REFERENCES companies(id),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_at TIMESTAMP,
        reset_code VARCHAR(6),
        reset_code_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table created successfully');

    // Create roles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Roles table created successfully');

    // Create permissions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Permissions table created successfully');

    // Create role_permissions junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
        permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )
    `);
    console.log('Role permissions table created successfully');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_role_assignments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_name VARCHAR(50) NOT NULL REFERENCES roles(name) ON UPDATE CASCADE ON DELETE CASCADE,
        expires_on DATE,
        assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, role_name)
      )
    `);
    console.log('User role assignments table created successfully');

    // Create process categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS process_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Process categories table created successfully');

    // Drop existing processes table to recreate with proper constraints
    await pool.query(`DROP TABLE IF EXISTS processes CASCADE`);
    console.log('Dropped existing processes table');

    // Drop process versions table as well
    await pool.query(`DROP TABLE IF EXISTS process_versions CASCADE`);
    console.log('Dropped existing process_versions table');

    // Create processes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        bpmn_xml TEXT,
        category_id INTEGER REFERENCES process_categories(id),
        company_id INTEGER REFERENCES companies(id),
        created_by INTEGER REFERENCES users(id),
        version INTEGER DEFAULT 1,
        status VARCHAR(50) DEFAULT 'draft',
        manual_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Processes table created successfully');

    // Create process versions table for version management
    await pool.query(`
      CREATE TABLE IF NOT EXISTS process_versions (
        id SERIAL PRIMARY KEY,
        process_id INTEGER REFERENCES processes(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        bpmn_xml TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        change_description TEXT,
        manual_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(process_id, version_number)
      )
    `);
    console.log('Process versions table created successfully');

    // Create processes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES process_categories(id),
        parent_id INTEGER REFERENCES processes(id),
        company_id INTEGER REFERENCES companies(id),
        created_by INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'draft',
        version INTEGER DEFAULT 1,
        manual_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Processes table created successfully');
    
    // Ensure parent_id column exists (in case table was created without it)
    await pool.query('ALTER TABLE processes ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES processes(id)');

    // Add missing columns for compatibility
    await pool.query('ALTER TABLE processes ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES process_categories(id)');
    await pool.query('ALTER TABLE processes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'draft\'');
    await pool.query('ALTER TABLE processes ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1');

    // Migrate data from old category column to new category_id if needed
    try {
      await pool.query(`
        UPDATE processes 
        SET category_id = CAST(TRIM(BOTH '0123456789' FROM category) AS INTEGER) 
        WHERE category IS NOT NULL 
        AND category_id IS NULL
        AND TRIM(BOTH '0123456789' FROM category) ~ '^[0-9]+$'
      `);
    } catch (error) {
      console.log('Category migration skipped or failed:', error.message);
    }

    // Create companies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        logo_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Companies table created successfully');

    // Seed initial data
    await seedData();

    console.log('Database initialization completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
};

const seedData = async () => {
  try {
    // Check if data is already seeded
    const usersExist = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersExist.rows[0].count) > 0) {
      console.log('Data already seeded, but reseeding processes...');
    } else {
      console.log('No data found, seeding everything...');
    }

    console.log('Seeding initial data...');

    // Insert roles
    const roles = [
      { name: 'Admin', description: 'Full system access' },
      { name: 'Designer', description: 'Can create and edit draft processes' },
      { name: 'Validator', description: 'Can review and approve governed processes' },
    ];

    for (const role of roles) {
      await pool.query(
        'INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [role.name, role.description]
      );
    }
    console.log('Roles seeded');

    // Insert permissions
    const permissions = [
      { name: 'user_management', description: 'Create, modify, and delete user accounts' },
      { name: 'role_management', description: 'Assign roles and define permissions' },
      { name: 'view_dashboard', description: 'Access main dashboard' },
      { name: 'view_reports', description: 'Access and view reports' },
      { name: 'manage_processes', description: 'Create and manage processes' },
      { name: 'manage_risks', description: 'Create and manage risk assessments' },
    ];

    for (const permission of permissions) {
      await pool.query(
        'INSERT INTO permissions (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [permission.name, permission.description]
      );
    }
    console.log('Permissions seeded');

    // Insert sample companies
    const companies = [
      { name: 'Hopex Aquila', description: 'Main corporate entity for process management' },
      { name: 'Finance Department', description: 'Financial services and operations' },
      { name: 'IT Services', description: 'Information technology and support' },
      { name: 'Operations Division', description: 'Core business operations' },
      { name: 'HR Solutions', description: 'Human resources management' },
    ];

    for (const company of companies) {
      await pool.query(
        'INSERT INTO companies (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [company.name, company.description]
      );
    }
    console.log('Sample companies seeded');

    // Insert demo users with hashed passwords
    const bcrypt = await import('bcryptjs');

    const hashedAdmin = await bcrypt.default.hash('admin123', 10);
    const hashedDesigner = await bcrypt.default.hash('designer123', 10);
    const hashedDesignerA = await bcrypt.default.hash('designerA123', 10);
    const hashedDesignerB = await bcrypt.default.hash('designerB123', 10);
    const hashedValidator = await bcrypt.default.hash('validator123', 10);
    const hashedValidatorA = await bcrypt.default.hash('managerA123', 10);
    const hashedValidatorB = await bcrypt.default.hash('managerB123', 10);
    const users = [
      { username: 'admin', password: hashedAdmin, email: 'admin@pfe.com', full_name: 'System Administrator', role: 'Admin', company_id: 1 },
      { username: 'designer', password: hashedDesigner, email: 'designer@pfe.com', full_name: 'Process Designer', role: 'Designer', company_id: 1 },
      { username: 'designer_a', password: hashedDesignerA, email: 'designer.a@pfe.com', full_name: 'Process Designer A', role: 'Designer', company_id: 1 },
      { username: 'designer_b', password: hashedDesignerB, email: 'designer.b@pfe.com', full_name: 'Process Designer B', role: 'Designer', company_id: 1 },
      { username: 'validator', password: hashedValidator, email: 'validator@pfe.com', full_name: 'Process Validator', role: 'Validator', company_id: 1 },
      { username: 'manager_a', password: hashedValidatorA, email: 'manager.a@pfe.com', full_name: 'Process Manager A', role: 'Validator', company_id: 1 },
      { username: 'manager_b', password: hashedValidatorB, email: 'manager.b@pfe.com', full_name: 'Process Manager B', role: 'Validator', company_id: 1 },
    ];

    for (const user of users) {
      await pool.query(
        'INSERT INTO users (username, password, email, full_name, role, company_id, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (username) DO NOTHING',
        [user.username, user.password, user.email, user.full_name, user.role, user.company_id, true]
      );
    }
    console.log('Demo users seeded');

    const importSummary = await replaceProcessCatalogFromWorkbook();
    console.log(
      `Bank process workbook imported (${importSummary.rootCategoryCount} root categories, ${importSummary.subcategoryCount} subcategories, ${importSummary.processCount} processes)`
    );

    // Assign permissions to roles
    const rolePermissions = [
      { role: 'Admin', permissions: ['user_management', 'role_management', 'view_dashboard', 'view_reports', 'manage_processes', 'manage_risks'] },
      { role: 'Designer', permissions: ['view_dashboard', 'view_reports', 'manage_processes'] },
      { role: 'Validator', permissions: ['view_dashboard', 'view_reports', 'manage_processes'] },
    ];

    for (const rp of rolePermissions) {
      const role = await pool.query('SELECT id FROM roles WHERE name = $1', [rp.role]);
      if (role.rows.length > 0) {
        for (const permission of rp.permissions) {
          const perm = await pool.query('SELECT id FROM permissions WHERE name = $1', [permission]);
          if (perm.rows.length > 0) {
            await pool.query(
              'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING',
              [role.rows[0].id, perm.rows[0].id]
            );
          }
        }
      }
    }
    console.log('Role permissions assigned');
  } catch (error) {
    console.error('Error seeding data:', error);
  }
};

initDatabase();
