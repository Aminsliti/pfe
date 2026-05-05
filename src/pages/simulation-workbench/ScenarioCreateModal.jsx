import { useEffect, useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { API, readApiPayload } from './utils';

export default function ScenarioCreateModal({ show, onHide, processes, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    process_id: '',
    process_instances: 100,
    warmup_percent: 5,
    cooldown_percent: 10,
    start_date: new Date().toISOString().slice(0, 10),
    status: 'draft',
    infinite_resources: false,
    simulate_all_levels: false,
    notifications_enabled: true,
    monte_carlo_runs: 1,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (show) {
      setError('');
    }
  }, [show]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API}/simulations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await readApiPayload(response, 'Failed to create scenario.');
      onCreated(payload);
    } catch (submitError) {
      setError(submitError.message || 'Failed to create scenario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Create simulation scenario</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <Form onSubmit={submit}>
          <Row className="g-3">
            <Col md={8}>
              <Form.Group>
                <Form.Label>Name</Form.Label>
                <Form.Control value={form.name} onChange={(event) => update('name', event.target.value)} />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Process</Form.Label>
                <Form.Select value={form.process_id} onChange={(event) => update('process_id', Number(event.target.value))}>
                  <option value="">Select a process</option>
                  {processes.map((process) => (
                    <option key={process.id} value={process.id}>
                      {process.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group>
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Instances</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  value={form.process_instances}
                  onChange={(event) => update('process_instances', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Warmup (%)</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={50}
                  value={form.warmup_percent}
                  onChange={(event) => update('warmup_percent', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Cooldown (%)</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={50}
                  value={form.cooldown_percent}
                  onChange={(event) => update('cooldown_percent', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Monte Carlo runs</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={200}
                  value={form.monte_carlo_runs}
                  onChange={(event) => update('monte_carlo_runs', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex justify-content-end gap-2 mt-4">
            <Button variant="secondary" onClick={onHide}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? 'Creating...' : 'Create scenario'}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
