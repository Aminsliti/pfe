fetch('http://localhost:3001/api/processes')
  .then(response => response.json())
  .then(data => console.log('Processes API response:', data))
  .catch(error => console.error('Processes API error:', error));
