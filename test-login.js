import pool from './server/db.js';
import bcrypt from 'bcryptjs';

try {
  // Test the login query with email
  const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', ['admin@pfe.com']);
  console.log('Found user with email admin@pfe.com:', result.rows.length > 0 ? 'YES' : 'NO');
  
  if (result.rows.length > 0) {
    const user = result.rows[0];
    console.log('User found:', user.username, user.email);
    
    // Test password comparison
    const isValid = await bcrypt.compare('admin123', user.password);
    console.log('Password valid:', isValid);
  }
  
  pool.end();
} catch (err) {
  console.error('Error:', err.message);
}
