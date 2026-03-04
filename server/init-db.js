import pool from './db.js';

const initDatabase = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
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

    // Create processes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        bpmn_xml TEXT,
        category_id INTEGER REFERENCES process_categories(id),
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
  // Check if roles already exist
  const rolesExist = await pool.query('SELECT COUNT(*) FROM roles');
  if (parseInt(rolesExist.rows[0].count) > 0) {
    console.log('Data already seeded, skipping...');
    return;
  }

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

  // Insert permissions
  const permissions = [
    { name: 'user_management', description: 'Create, modify, and delete user accounts' },
    { name: 'role_management', description: 'Assign roles and define permissions' },
    { name: 'view_dashboard', description: 'Access the main dashboard' },
    { name: 'view_reports', description: 'Access and view reports' },
    { name: 'manage_processes', description: 'Create and manage processes' },
    { name: 'manage_risks', description: 'Create and manage risk assessments' },
  ];

  for (const perm of permissions) {
    await pool.query(
      'INSERT INTO permissions (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
      [perm.name, perm.description]
    );
  }
  console.log('Permissions seeded');

  // Get role and permission IDs
  const adminRole = await pool.query("SELECT id FROM roles WHERE name = 'Administrator'");
  const analystRole = await pool.query("SELECT id FROM roles WHERE name = 'Business Analyst'");
  const ownerRole = await pool.query("SELECT id FROM roles WHERE name = 'Process Owner'");
  const riskRole = await pool.query("SELECT id FROM roles WHERE name = 'Risk Manager'");
  const viewerRole = await pool.query("SELECT id FROM roles WHERE name = 'Viewer'");

  const permUserMgmt = await pool.query("SELECT id FROM permissions WHERE name = 'user_management'");
  const permRoleMgmt = await pool.query("SELECT id FROM permissions WHERE name = 'role_management'");
  const permViewDashboard = await pool.query("SELECT id FROM permissions WHERE name = 'view_dashboard'");
  const permViewReports = await pool.query("SELECT id FROM permissions WHERE name = 'view_reports'");
  const permManageProcesses = await pool.query("SELECT id FROM permissions WHERE name = 'manage_processes'");
  const permManageRisks = await pool.query("SELECT id FROM permissions WHERE name = 'manage_risks'");

  // Assign permissions to Administrator (all permissions)
  const adminPerms = [permUserMgmt, permRoleMgmt, permViewDashboard, permViewReports, permManageProcesses, permManageRisks];
  for (const perm of adminPerms) {
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [adminRole.rows[0].id, perm.rows[0].id]
    );
  }

  // Assign permissions to Business Analyst
  const analystPerms = [permViewDashboard, permViewReports, permManageProcesses];
  for (const perm of analystPerms) {
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [analystRole.rows[0].id, perm.rows[0].id]
    );
  }

  // Assign permissions to Process Owner
  const ownerPerms = [permViewDashboard, permManageProcesses];
  for (const perm of ownerPerms) {
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [ownerRole.rows[0].id, perm.rows[0].id]
    );
  }

  // Assign permissions to Risk Manager
  const riskPerms = [permViewDashboard, permViewReports, permManageRisks];
  for (const perm of riskPerms) {
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [riskRole.rows[0].id, perm.rows[0].id]
    );
  }

  // Assign permissions to Viewer
  const viewerPerms = [permViewDashboard];
  for (const perm of viewerPerms) {
    await pool.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [viewerRole.rows[0].id, perm.rows[0].id]
    );
  }
  console.log('Role permissions seeded');

  // Insert demo users with hashed passwords
  const bcrypt = await import('bcryptjs');
  
  const hashedAdmin = await bcrypt.default.hash('admin123', 10);
  const hashedAnalyst = await bcrypt.default.hash('analyst123', 10);
  const hashedOwner = await bcrypt.default.hash('owner123', 10);
  const hashedRisk = await bcrypt.default.hash('risk123', 10);
  const hashedViewer = await bcrypt.default.hash('viewer123', 10);

  const users = [
    { username: 'admin', password: hashedAdmin, email: 'admin@pfe.com', fullName: 'System Administrator', role: 'Administrator' },
    { username: 'analyst', password: hashedAnalyst, email: 'analyst@pfe.com', fullName: 'Business Analyst', role: 'Business Analyst' },
    { username: 'owner', password: hashedOwner, email: 'owner@pfe.com', fullName: 'Process Owner', role: 'Process Owner' },
    { username: 'risk', password: hashedRisk, email: 'risk@pfe.com', fullName: 'Risk Manager', role: 'Risk Manager' },
    { username: 'viewer', password: hashedViewer, email: 'viewer@pfe.com', fullName: 'Viewer', role: 'Viewer' },
  ];

  for (const user of users) {
    await pool.query(
      'INSERT INTO users (username, password, email, full_name, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING',
      [user.username, user.password, user.email, user.fullName, user.role]
    );
  }
  console.log('Demo users seeded');
};

initDatabase();

