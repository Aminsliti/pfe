import { Suspense, lazy, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { useSnackbar } from '../../components/SnackbarProvider';
import { API, readApiPayload } from './utils';

const EntityCollaborationPanel = lazy(() => import('../../components/EntityCollaborationPanel'));

function CollaborationFallback() {
  return <div className="text-muted small">Loading collaboration tools...</div>;
}

export default function OverviewTab({ scenario, processes, onScenarioChange, onReload }) {
  const { showSnackbar } = useSnackbar();
  const [form, setForm] = useState(scenario);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(scenario);
  }, [scenario]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      const payload = {
        name: form.name,
        description: form.description,
        process_id: form.process_id,
        status: form.status,
        start_date: form.start_date,
        process_instances: form.process_instances,
        warmup_percent: form.warmup_percent,
        cooldown_percent: form.cooldown_percent,
        infinite_resources: form.infinite_resources,
        simulate_all_levels: form.simulate_all_levels,
        monte_carlo_runs: form.monte_carlo_runs,
        notifications_enabled: form.notifications_enabled,
      };
      const response = await fetch(`${API}/simulations/${scenario.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const saved = await readApiPayload(response, 'Failed to update scenario.');
      onScenarioChange((current) => ({ ...current, ...saved }));
      showSnackbar('Scenario updated.');
      onReload?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to update scenario.');
      showSnackbar(saveError.message || 'Failed to update scenario.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div>
              <h6 className="mb-1">Scenario settings</h6>
              <div className="text-muted small">Manage baseline parameters and mathematical run options.</div>
            </div>
            <Button variant="danger" size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <Row className="g-3">
            <Col lg={8}>
              <Form.Group>
                <Form.Label>Name</Form.Label>
                <Form.Control value={form.name || ''} onChange={(event) => update('name', event.target.value)} />
              </Form.Group>
            </Col>
            <Col lg={4}>
              <Form.Group>
                <Form.Label>Status</Form.Label>
                <Form.Select value={form.status || 'draft'} onChange={(event) => update('status', event.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col lg={12}>
              <Form.Group>
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={form.description || ''}
                  onChange={(event) => update('description', event.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Process</Form.Label>
                <Form.Select value={form.process_id || ''} onChange={(event) => update('process_id', Number(event.target.value))}>
                  <option value="">Select a process</option>
                  {processes.map((process) => (
                    <option key={process.id} value={process.id}>
                      {process.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Instances</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  value={form.process_instances || 0}
                  onChange={(event) => update('process_instances', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Warmup %</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={50}
                  value={form.warmup_percent || 0}
                  onChange={(event) => update('warmup_percent', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Cooldown %</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={50}
                  value={form.cooldown_percent || 0}
                  onChange={(event) => update('cooldown_percent', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Monte Carlo</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={200}
                  value={form.monte_carlo_runs || 1}
                  onChange={(event) => update('monte_carlo_runs', Number(event.target.value))}
                />
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex flex-wrap gap-3 mt-3">
            <Form.Check
              type="switch"
              id="sim-inf"
              label="Infinite resources"
              checked={!!form.infinite_resources}
              onChange={(event) => update('infinite_resources', event.target.checked)}
            />
            <Form.Check
              type="switch"
              id="sim-all-levels"
              label="Simulate all process levels"
              checked={!!form.simulate_all_levels}
              onChange={(event) => update('simulate_all_levels', event.target.checked)}
            />
            <Form.Check
              type="switch"
              id="sim-notif"
              label="Enable notifications"
              checked={form.notifications_enabled !== false}
              onChange={(event) => update('notifications_enabled', event.target.checked)}
            />
          </div>
        </Card.Body>
      </Card>

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <h6 className="mb-3">Mathematical model</h6>
          <div className="d-flex flex-column gap-2 text-muted small">
            <div>Each simulation run treats process execution as a queueing system with task durations, waits, and resource capacity.</div>
            <div>Cycle time is measured as `finish time - instance offset`, and task wait is measured as `service start - ready time`.</div>
            <div>Resource utilisation is computed from `busy time / theoretical capacity`, and Monte Carlo runs estimate the distribution of those outputs.</div>
          </div>
        </Card.Body>
      </Card>

      <Suspense fallback={<CollaborationFallback />}>
        <EntityCollaborationPanel entityType="simulation" entityId={scenario.id} title="Scenario discussion and files" />
      </Suspense>
    </div>
  );
}
