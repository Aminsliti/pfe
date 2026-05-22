import pool from './server/db.js';

console.log('Testing database connection...');

try {
  const result = await pool.query('SELECT NOW()');
  console.log('Database connected successfully:', result.rows[0]);
  
  // Test forgot password endpoint directly
  console.log('Testing forgot password endpoint...');
  
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  
  await pool.query(
    'UPDATE users SET reset_code = $1, reset_code_expires = $2 WHERE email = $3',
    [resetCode, expiresAt, 'admin@example.com']
  );
  
  console.log(`Reset code for admin@example.com: ${resetCode}`);
  
  pool.end();
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
