// server/migrate-simulations.js
// Usage: node server/migrate-simulations.js
import pool from './db.js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = fs.readFileSync(
  path.join(__dirname, 'migrations/simulation_tables.sql'),
  'utf8'
);

try {
  await pool.query(sql);
  console.log('✅  Simulation tables created successfully.');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('❌  Migration failed:', err.message);
  await pool.end();
  process.exit(1);
}
