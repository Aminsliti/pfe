fetch('http://localhost:3001/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    username: 'admin@pfe.com',
    password: 'admin123'
  })
})
.then(response => {
  console.log('Response status:', response.status);
  return response.json();
})
.then(data => console.log('Response data:', data))
.catch(error => console.error('Error:', error));
