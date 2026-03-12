import pool from './db.js';

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

    // Create process categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS process_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(process_id, version_number)
      )
    `);
    console.log('Process versions table created successfully');

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
      console.log('Data already seeded, skipping...');
      return;
    }

    console.log('Seeding initial data...');

    // Insert roles
    const roles = [
      { name: 'Administrator', description: 'Full system access' },
      { name: 'Business Analyst', description: 'Can view reports and manage processes' },
      { name: 'Process Owner', description: 'Can manage processes' },
      { name: 'Risk Manager', description: 'Can manage risks and view reports' },
      { name: 'Viewer', description: 'Can only view dashboard' },
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

    // Insert process categories
    const categories = [
      { name: 'Finance', description: 'Financial processes and workflows' },
      { name: 'HR', description: 'Human resources processes' },
      { name: 'IT', description: 'Information technology processes' },
      { name: 'Operations', description: 'Operational processes' },
      { name: 'Customer Service', description: 'Customer service workflows' },
      { name: 'Compliance', description: 'Regulatory compliance processes' },
    ];

    for (const category of categories) {
      await pool.query(
        'INSERT INTO process_categories (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [category.name, category.description]
      );
    }
    console.log('Process categories seeded');

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
    const hashedAnalyst = await bcrypt.default.hash('analyst123', 10);
    const hashedOwner = await bcrypt.default.hash('owner123', 10);
    const hashedRisk = await bcrypt.default.hash('risk123', 10);
    const hashedViewer = await bcrypt.default.hash('viewer123', 10);

    const users = [
      { username: 'admin', password: hashedAdmin, email: 'admin@pfe.com', full_name: 'System Administrator', role: 'Administrator', company_id: 1 },
      { username: 'analyst', password: hashedAnalyst, email: 'analyst@pfe.com', full_name: 'Business Analyst', role: 'Business Analyst', company_id: 1 },
      { username: 'owner', password: hashedOwner, email: 'owner@pfe.com', full_name: 'Process Owner', role: 'Process Owner', company_id: 1 },
      { username: 'risk', password: hashedRisk, email: 'risk@pfe.com', full_name: 'Risk Manager', role: 'Risk Manager', company_id: 1 },
      { username: 'viewer', password: hashedViewer, email: 'viewer@pfe.com', full_name: 'Viewer', role: 'Viewer', company_id: 1 },
    ];

    for (const user of users) {
      await pool.query(
        'INSERT INTO users (username, password, email, full_name, role, company_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO NOTHING',
        [user.username, user.password, user.email, user.full_name, user.role, user.company_id]
      );
    }
    console.log('Demo users seeded');

    // Assign permissions to roles
    const rolePermissions = [
      { role: 'Administrator', permissions: ['user_management', 'role_management', 'view_dashboard', 'view_reports', 'manage_processes', 'manage_risks'] },
      { role: 'Business Analyst', permissions: ['view_dashboard', 'view_reports', 'manage_processes'] },
      { role: 'Process Owner', permissions: ['view_dashboard', 'view_reports', 'manage_processes'] },
      { role: 'Risk Manager', permissions: ['view_dashboard', 'view_reports', 'manage_risks'] },
      { role: 'Viewer', permissions: ['view_dashboard'] },
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
