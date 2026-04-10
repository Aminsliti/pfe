import pool from './server/db.js';

try {
  const result = await pool.query('SELECT username, email, full_name FROM users');
  console.log('Users in database:');
  result.rows.forEach(user => {
    console.log(`- ${user.username} (${user.email}) - ${user.full_name}`);
  });
  pool.end();
} catch (err) {
  console.error('Error:', err.message);
}
