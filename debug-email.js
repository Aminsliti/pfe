import pool from './server/db.js';

try {
  console.log('Testing email lookup...');
  
  // First, let's see all users with their exact emails
  const allUsers = await pool.query('SELECT username, email FROM users');
  console.log('All users:');
  allUsers.rows.forEach(user => {
    console.log(`- "${user.username}" -> "${user.email}"`);
  });
  
  console.log('\nTesting specific email lookup...');
  
  // Test the exact query we're using
  const testEmail = 'admin@pfe.com';
  console.log(`Looking for: "${testEmail}"`);
  
  const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [testEmail]);
  console.log(`Found ${result.rows.length} users`);
  
  if (result.rows.length > 0) {
    result.rows.forEach(user => {
      console.log(`Found user: "${user.username}" email: "${user.email}"`);
    });
  }
  
  pool.end();
} catch (err) {
  console.error('Error:', err.message);
}
