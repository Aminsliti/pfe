import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Table } from 'react-bootstrap';
import { useSnackbar } from '../../components/SnackbarProvider';
import { API, fmt, readApiPayload } from './utils';

export default function ResourcesTab({ scenario, onScenarioReload }) {
  const { showSnackbar, confirmAction } = useSnackbar();
  const [resources, setResources] = useState([]);
  const [form, setForm] = useState({
    name: '',
    resource_type: 'human',
    quantity: 1,
    cost_per_hour: 0,
    availability: 100,
  });
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${API}/simulations/${scenario.id}/resources`);
        const payload = await readApiPayload(response, 'Failed to load resources.');
        setResources(payload || []);
      } catch (loadError) {
        setError(loadError.message || 'Failed to load resources.');
      }
    };

    load();
  }, [scenario.id]);

  const load = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resources`);
      const payload = await readApiPayload(response, 'Failed to load resources.');
      setResources(payload || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load resources.');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      resource_type: 'human',
      quantity: 1,
      cost_per_hour: 0,
      availability: 100,
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const response = await fetch(
        `${API}/simulations/${scenario.id}/resources${editingId ? `/${editingId}` : ''}`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      );
      await readApiPayload(response, 'Failed to save resource.');
      showSnackbar('Resource saved.');
      resetForm();
      load();
      onScenarioReload?.();
    } catch (submitError) {
      setError(submitError.message || 'Failed to save resource.');
      showSnackbar(submitError.message || 'Failed to save resource.', 'danger');
    }
  };

  const edit = (resource) => {
    setEditingId(resource.id);
    setForm({
      name: resource.name,
      resource_type: resource.resource_type || 'human',
      quantity: Number(resource.quantity) || 1,
      cost_per_hour: Number(resource.cost_per_hour) || 0,
      availability: Number(resource.availability) || 100,
    });
  };

  const remove = async (resourceId) => {
    const confirmed = await confirmAction({
      title: 'Delete resource',
      message: 'Delete this resource?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resources/${resourceId}`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to delete resource.');
      showSnackbar('Resource deleted.');
      load();
      onScenarioReload?.();
    } catch (removeError) {
      setError(removeError.message || 'Failed to delete resource.');
      showSnackbar(removeError.message || 'Failed to delete resource.', 'danger');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <h6 className="mb-2">{editingId ? 'Edit resource' : 'Add resource'}</h6>
          <div className="text-muted small mb-3">
            Availability acts as a scalar in the model: `effective duration = nominal duration / availability ratio`.
          </div>
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col lg={4}>
                <Form.Group>
                  <Form.Label>Name</Form.Label>
                  <Form.Control value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </Form.Group>
              </Col>
              <Col lg={2}>
                <Form.Group>
                  <Form.Label>Type</Form.Label>
                  <Form.Select value={form.resource_type} onChange={(event) => setForm((current) => ({ ...current, resource_type: event.target.value }))}>
                    <option value="human">Human</option>
                    <option value="machine">Machine</option>
                    <option value="system">System</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col lg={2}>
                <Form.Group>
                  <Form.Label>Quantity</Form.Label>
                  <Form.Control type="number" min={1} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} />
                </Form.Group>
              </Col>
              <Col lg={2}>
                <Form.Group>
                  <Form.Label>Cost / hour</Form.Label>
                  <Form.Control type="number" min={0} value={form.cost_per_hour} onChange={(event) => setForm((current) => ({ ...current, cost_per_hour: Number(event.target.value) }))} />
                </Form.Group>
              </Col>
              <Col lg={2}>
                <Form.Group>
                  <Form.Label>Availability %</Form.Label>
                  <Form.Control type="number" min={1} max={100} value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: Number(event.target.value) }))} />
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex justify-content-end gap-2 mt-3">
              {editingId && (
                <Button variant="outline-secondary" onClick={resetForm}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="danger">
                {editingId ? 'Update resource' : 'Add resource'}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <Table hover className="sim-table mb-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Cost/h</th>
                <th>Availability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">
                    No resources defined yet.
                  </td>
                </tr>
              ) : (
                resources.map((resource) => (
                  <tr key={resource.id}>
                    <td>
                      <strong>{resource.name}</strong>
                    </td>
                    <td>{resource.resource_type}</td>
                    <td>{resource.quantity}</td>
                    <td>{fmt(resource.cost_per_hour, 2)}</td>
                    <td>{fmt(resource.availability, 0)}%</td>
                    <td>
                      <div className="d-flex gap-2">
                        <Button size="sm" variant="outline-secondary" onClick={() => edit(resource)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="outline-danger" onClick={() => remove(resource.id)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
