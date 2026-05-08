import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Container, Row, Col, Card, Button, Alert } from 'react-bootstrap';

export function ProcessManagement() {
  const { hasPermission } = useAuth();
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const canManageProcesses = hasPermission('manage_processes');

  useEffect(() => {
    if (canManageProcesses) {
      // Simple test load
      setLoading(false);
      setProcesses([]);
      setMessage('Process Management loaded successfully!');
    }
  }, [canManageProcesses]);

  if (!canManageProcesses) {
    return (
      <Container fluid className="py-4">
        <Alert variant="danger">
          You don't have permission to manage processes.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <h2>Process Management</h2>
          <p>Simple version - testing if component loads</p>
        </Col>
      </Row>

      {message && (
        <Row className="mb-4">
          <Col>
            <Alert variant="success">
              {message}
            </Alert>
          </Col>
        </Row>
      )}

      <Row>
        <Col>
          <Card>
            <Card.Body>
              <h3>Processes ({processes.length})</h3>
              {loading ? (
                <p>Loading...</p>
              ) : (
                <p>No processes found - but the component is working!</p>
              )}
              <Button variant="success">Test Button</Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default ProcessManagement;
