fetch('http://localhost:3001/api/processes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Test Process',
    description: 'A test BPMN process',
    bpmn_xml: '<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><bpmn:process id="test-process" name="Test Process"></bpmn:process></bpmn:definitions>',
    category_id: 1,
    status: 'draft'
  })
})
.then(response => response.json())
.then(data => console.log('Test process created:', data))
.catch(error => console.error('Error creating test process:', error));
