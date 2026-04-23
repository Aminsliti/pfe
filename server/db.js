import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'maintest',
  user: process.env.DB_USER || 'vitalis',
  password: process.env.DB_PASSWORD || 'vitalis',
});

export default pool;

