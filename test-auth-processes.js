// Test login first
fetch('http://localhost:3001/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'admin',
    password: 'admin123'
  })
})
.then(response => response.json())
.then(data => {
  console.log('Login successful:', data);
  
  // Now test processes API
  return fetch('http://localhost:3001/api/processes')
    .then(response => response.json())
    .then(processes => console.log('Processes:', processes));
})
.catch(error => console.error('Error:', error));
