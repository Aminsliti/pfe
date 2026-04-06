import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  InputGroup,
  Modal,
  ProgressBar,
  Row,
  Table,
} from 'react-bootstrap';
import BpmnHeatmapViewer from '../components/BpmnEditor/BpmnHeatmapViewer';
import EntityCollaborationPanel from '../components/EntityCollaborationPanel';
import './SimulationScenarios.css';

const API = 'http://localhost:3001/api';
const DAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

function statusVariant(status) {
  return (
    {
      draft: 'secondary',
      running: 'warning',
      completed: 'success',
      failed: 'danger',
    }[status] || 'secondary'
  );
}

function statusLabel(status) {
  return (
    {
      draft: 'Draft',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
    }[status] || status
  );
}

function fmt(value, decimals = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—';
  }

  return `${Number(value).toFixed(decimals)}${suffix}`;
}

async function readApiPayload(response, fallbackError = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      contentType.includes('application/json') ? payload?.error || fallbackError : payload || fallbackError
    );
  }

  return payload;
}

function parseWindowsText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [timeRange, daysRaw] = line.split('|').map((part) => part.trim());
      const [start, end] = String(timeRange || '').split('-').map((part) => part.trim());
      const days = daysRaw
        ? daysRaw.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isInteger(entry))
        : undefined;
      if (!start || !end) return null;
      return days?.length ? { start, end, days } : { start, end };
    })
    .filter(Boolean);
}

function windowsToText(windows = []) {
  return (Array.isArray(windows) ? windows : [])
    .map((window) => `${window.start}-${window.end}${window.days?.length ? ` | ${window.days.join(',')}` : ''}`)
    .join('\n');
}

function parseHolidayText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeCalendarState(settings = {}) {
  return {
    business_hours: {
      start: settings?.business_hours?.start || '09:00',
      end: settings?.business_hours?.end || '17:00',
    },
    weekend_days: Array.isArray(settings?.weekend_days) ? settings.weekend_days : [0, 6],
    holidays: Array.isArray(settings?.holidays) ? settings.holidays : [],
    shifts: Array.isArray(settings?.shifts) ? settings.shifts : [],
  };
}

function parseBpmnGraph(source) {
  if (!source) {
    return { tasks: [], flows: [] };
  }

  try {
    const legacy = JSON.parse(source);
    return {
      tasks: (legacy.elements || [])
        .filter((element) => String(element.type || '').toLowerCase().includes('task') || element.type === 'subProcess')
        .map((element) => ({ task_id: element.id, task_name: element.label || element.name || element.id })),
      flows: (legacy.connections || []).map((flow) => ({
        flow_id: flow.id,
        flow_name: flow.label || flow.id,
        from_element: flow.from,
        to_element: flow.to,
      })),
    };
  } catch {
    const parser = new DOMParser();
    const xml = parser.parseFromString(source, 'text/xml');
    const tasks = [];
    xml.querySelectorAll('[id]').forEach((element) => {
      const tag = element.tagName.toLowerCase();
      if (!tag.includes('task') && !tag.includes('subprocess') && !tag.includes('callactivity')) {
        return;
      }
      tasks.push({
        task_id: element.getAttribute('id'),
        task_name: element.getAttribute('name') || element.getAttribute('id'),
      });
    });

    const flows = Array.from(xml.querySelectorAll('sequenceFlow,[*|sequenceFlow]')).map((flow) => ({
      flow_id: flow.getAttribute('id'),
      flow_name: flow.getAttribute('name') || flow.getAttribute('id'),
      from_element: flow.getAttribute('sourceRef'),
      to_element: flow.getAttribute('targetRef'),
    }));

    return { tasks, flows };
  }
}

function Histogram({ data }) {
  if (!data?.length) {
    return <div className="text-muted small">No cycle-time histogram available.</div>;
  }

  const max = Math.max(...data.map((entry) => entry.count), 1);
  return (
    <div className="sim-histogram">
      {data.map((bin, index) => (
        <div key={`${bin.label}-${index}`} className="sim-histogram-bar">
          <div
            className="sim-histogram-fill"
            style={{ height: `${(bin.count / max) * 100}%` }}
            title={`${bin.count} instance(s)`}
          />
          <span className="sim-histogram-lbl">{bin.label}</span>
        </div>
      ))}
    </div>
  );
}

function ScenarioCreateModal({ show, onHide, processes, onCreated }) {
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
    import_csv_arrivals: false,
    notifications_enabled: true,
    monte_carlo_runs: 1,
    calendar_settings: {
      business_hours: { start: '09:00', end: '17:00' },
      weekend_days: [0, 6],
      holidays: [],
      shifts: [],
    },
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
                    <option key={process.id} value={process.id}>{process.name}</option>
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
                <Form.Control type="number" min={1} value={form.process_instances} onChange={(event) => update('process_instances', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Warmup (%)</Form.Label>
                <Form.Control type="number" min={0} max={50} value={form.warmup_percent} onChange={(event) => update('warmup_percent', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Cooldown (%)</Form.Label>
                <Form.Control type="number" min={0} max={50} value={form.cooldown_percent} onChange={(event) => update('cooldown_percent', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Monte Carlo runs</Form.Label>
                <Form.Control type="number" min={1} max={200} value={form.monte_carlo_runs} onChange={(event) => update('monte_carlo_runs', Number(event.target.value))} />
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex justify-content-end gap-2 mt-4">
            <Button variant="secondary" onClick={onHide}>Cancel</Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? 'Creating...' : 'Create scenario'}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}

function ArrivalImportCard({ scenario, onScenarioUpdated }) {
  const [csvText, setCsvText] = useState('');
  const [arrivals, setArrivals] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!scenario?.id) return;
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times`);
      const payload = await readApiPayload(response, 'Failed to load arrival times.');
      setArrivals(payload.arrivals || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load arrival times.');
    }
  };

  useEffect(() => {
    load();
  }, [scenario?.id]);

  const importCsv = async () => {
    if (!csvText.trim()) {
      setError('Paste or upload CSV content first.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const payload = await readApiPayload(response, 'Failed to import arrival times.');
      setArrivals(payload.arrivals || []);
      setMessage(`${payload.count} arrival time(s) imported.`);
      onScenarioUpdated((current) => ({
        ...current,
        import_csv_arrivals: true,
        process_instances: payload.count,
      }));
    } catch (importError) {
      setError(importError.message || 'Failed to import arrival times.');
    } finally {
      setBusy(false);
    }
  };

  const clearImport = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to clear arrival times.');
      setArrivals([]);
      setMessage('Imported arrival times cleared.');
      onScenarioUpdated((current) => ({
        ...current,
        import_csv_arrivals: false,
      }));
    } catch (clearError) {
      setError(clearError.message || 'Failed to clear arrival times.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <h6 className="mb-1">Exact arrivals (CSV)</h6>
            <div className="text-muted small">Import exact instance arrivals with minute offsets, HH:MM, or ISO datetimes.</div>
          </div>
          <Badge bg={scenario.import_csv_arrivals ? 'success' : 'secondary'}>
            {scenario.import_csv_arrivals ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}

        <Form.Group className="mb-3">
          <Form.Label>CSV content</Form.Label>
          <Form.Control
            as="textarea"
            rows={5}
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            placeholder={'arrival_time\n08:00\n08:15\n08:45'}
          />
        </Form.Group>

        <div className="d-flex justify-content-end gap-2 mb-3">
          <Button variant="outline-secondary" onClick={clearImport} disabled={busy || !arrivals.length}>
            Clear
          </Button>
          <Button variant="danger" onClick={importCsv} disabled={busy}>
            {busy ? 'Importing...' : 'Import arrivals'}
          </Button>
        </div>

        <div className="sim-arrivals-summary">
          <div><strong>{arrivals.length}</strong> arrival(s)</div>
          <div>
            {arrivals.length
              ? `First arrival at ${fmt(arrivals[0].arrival_offset_min, 2)} min`
              : 'No imported arrivals'}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

function OverviewTab({ scenario, processes, onScenarioChange, onReload }) {
  const [form, setForm] = useState(scenario);
  const [holidayText, setHolidayText] = useState('');
  const [shiftText, setShiftText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(scenario);
    const calendar = normalizeCalendarState(scenario.calendar_settings || {});
    setHolidayText(calendar.holidays.join('\n'));
    setShiftText(windowsToText(calendar.shifts));
  }, [scenario]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const calendar = normalizeCalendarState(form.calendar_settings || {});

  const toggleWeekend = (dayValue) => {
    const current = new Set(calendar.weekend_days || []);
    if (current.has(dayValue)) current.delete(dayValue);
    else current.add(dayValue);
    update('calendar_settings', { ...calendar, weekend_days: Array.from(current) });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        ...form,
        calendar_settings: {
          ...calendar,
          holidays: parseHolidayText(holidayText),
          shifts: parseWindowsText(shiftText),
        },
      };
      const response = await fetch(`${API}/simulations/${scenario.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const saved = await readApiPayload(response, 'Failed to update scenario.');
      onScenarioChange((current) => ({ ...current, ...saved }));
      setMessage('Scenario updated.');
      onReload?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to update scenario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
            <div>
              <h6 className="mb-1">Scenario settings</h6>
              <div className="text-muted small">Manage baseline parameters, status, and advanced run options.</div>
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
                    <option key={process.id} value={process.id}>{process.name}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Instances</Form.Label>
                <Form.Control type="number" min={1} value={form.process_instances || 0} onChange={(event) => update('process_instances', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Warmup %</Form.Label>
                <Form.Control type="number" min={0} max={50} value={form.warmup_percent || 0} onChange={(event) => update('warmup_percent', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Cooldown %</Form.Label>
                <Form.Control type="number" min={0} max={50} value={form.cooldown_percent || 0} onChange={(event) => update('cooldown_percent', Number(event.target.value))} />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Monte Carlo</Form.Label>
                <Form.Control type="number" min={1} max={200} value={form.monte_carlo_runs || 1} onChange={(event) => update('monte_carlo_runs', Number(event.target.value))} />
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
          <h6 className="mb-3">Working calendar</h6>
          <Row className="g-3">
            <Col md={3}>
              <Form.Group>
                <Form.Label>Business start</Form.Label>
                <Form.Control
                  type="time"
                  value={calendar.business_hours.start}
                  onChange={(event) =>
                    update('calendar_settings', {
                      ...calendar,
                      business_hours: { ...calendar.business_hours, start: event.target.value },
                    })
                  }
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Business end</Form.Label>
                <Form.Control
                  type="time"
                  value={calendar.business_hours.end}
                  onChange={(event) =>
                    update('calendar_settings', {
                      ...calendar,
                      business_hours: { ...calendar.business_hours, end: event.target.value },
                    })
                  }
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Label>Weekend days</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {DAY_OPTIONS.map((day) => (
                  <Button
                    key={day.value}
                    size="sm"
                    variant={calendar.weekend_days.includes(day.value) ? 'dark' : 'outline-secondary'}
                    onClick={() => toggleWeekend(day.value)}
                  >
                    {day.label}
                  </Button>
                ))}
              </div>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Holidays</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={holidayText}
                  onChange={(event) => setHolidayText(event.target.value)}
                  placeholder={'2026-12-25\n2026-12-31'}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>Shift windows</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={4}
                  value={shiftText}
                  onChange={(event) => setShiftText(event.target.value)}
                  placeholder={'09:00-12:30 | 1,2,3,4,5\n13:30-17:00 | 1,2,3,4,5'}
                />
                <Form.Text>One shift per line. Add optional days after a pipe.</Form.Text>
              </Form.Group>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <ArrivalImportCard scenario={scenario} onScenarioUpdated={onScenarioChange} />

      <EntityCollaborationPanel entityType="simulation" entityId={scenario.id} title="Scenario discussion and files" />
    </div>
  );
}

function ResourcesTab({ scenario, onScenarioReload }) {
  const [resources, setResources] = useState([]);
  const [form, setForm] = useState({
    name: '',
    resource_type: 'human',
    quantity: 1,
    cost_per_hour: 0,
    availability: 100,
    availabilityText: '',
  });
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resources`);
      const payload = await readApiPayload(response, 'Failed to load resources.');
      setResources(payload || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load resources.');
    }
  };

  useEffect(() => {
    load();
  }, [scenario.id]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      name: '',
      resource_type: 'human',
      quantity: 1,
      cost_per_hour: 0,
      availability: 100,
      availabilityText: '',
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const payload = {
        ...form,
        availability_windows: parseWindowsText(form.availabilityText),
      };
      const response = await fetch(
        `${API}/simulations/${scenario.id}/resources${editingId ? `/${editingId}` : ''}`,
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      await readApiPayload(response, 'Failed to save resource.');
      setMessage('Resource saved.');
      resetForm();
      load();
      onScenarioReload?.();
    } catch (submitError) {
      setError(submitError.message || 'Failed to save resource.');
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
      availabilityText: windowsToText(resource.availability_windows || []),
    });
  };

  const remove = async (resourceId) => {
    if (!window.confirm('Delete this resource?')) return;
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resources/${resourceId}`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to delete resource.');
      setMessage('Resource deleted.');
      load();
      onScenarioReload?.();
    } catch (removeError) {
      setError(removeError.message || 'Failed to delete resource.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <h6 className="mb-3">{editingId ? 'Edit resource' : 'Add resource'}</h6>
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col lg={4}><Form.Group><Form.Label>Name</Form.Label><Form.Control value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Form.Group></Col>
              <Col lg={2}><Form.Group><Form.Label>Type</Form.Label><Form.Select value={form.resource_type} onChange={(event) => setForm((current) => ({ ...current, resource_type: event.target.value }))}><option value="human">Human</option><option value="machine">Machine</option><option value="system">System</option></Form.Select></Form.Group></Col>
              <Col lg={2}><Form.Group><Form.Label>Quantity</Form.Label><Form.Control type="number" min={1} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /></Form.Group></Col>
              <Col lg={2}><Form.Group><Form.Label>Cost / hour</Form.Label><Form.Control type="number" min={0} value={form.cost_per_hour} onChange={(event) => setForm((current) => ({ ...current, cost_per_hour: Number(event.target.value) }))} /></Form.Group></Col>
              <Col lg={2}><Form.Group><Form.Label>Availability %</Form.Label><Form.Control type="number" min={1} max={100} value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: Number(event.target.value) }))} /></Form.Group></Col>
              <Col lg={12}>
                <Form.Group>
                  <Form.Label>Availability windows</Form.Label>
                  <Form.Control as="textarea" rows={3} value={form.availabilityText} onChange={(event) => setForm((current) => ({ ...current, availabilityText: event.target.value }))} placeholder={'08:00-12:00 | 1,2,3,4,5\n13:00-17:00 | 1,2,3,4,5'} />
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex justify-content-end gap-2 mt-3">
              {editingId && <Button variant="outline-secondary" onClick={resetForm}>Cancel</Button>}
              <Button type="submit" variant="danger">{editingId ? 'Update resource' : 'Add resource'}</Button>
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
                <th>Windows</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resources.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-muted py-4">No resources defined yet.</td></tr>
              ) : (
                resources.map((resource) => (
                  <tr key={resource.id}>
                    <td><strong>{resource.name}</strong></td>
                    <td>{resource.resource_type}</td>
                    <td>{resource.quantity}</td>
                    <td>{fmt(resource.cost_per_hour, 2)}</td>
                    <td>{fmt(resource.availability, 0)}%</td>
                    <td className="text-muted small">{windowsToText(resource.availability_windows || []) || 'Default calendar'}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <Button size="sm" variant="outline-secondary" onClick={() => edit(resource)}>Edit</Button>
                        <Button size="sm" variant="outline-danger" onClick={() => remove(resource.id)}>Delete</Button>
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

function TasksTab({ scenario, graph, resources, onScenarioReload }) {
  const [taskRows, setTaskRows] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const mergedTasks = useMemo(() => {
    const byId = new Map((scenario.task_data || []).map((task) => [task.task_id, task]));
    return graph.tasks.map((task) => ({
      task_id: task.task_id,
      task_name: task.task_name,
      ...(byId.get(task.task_id) || {
        duration_min: 30,
        duration_type: 'fixed',
        duration_std: 0,
        resource_id: '',
        cost: 0,
        sla_target_min: '',
      }),
    }));
  }, [graph.tasks, scenario.task_data]);

  useEffect(() => {
    setTaskRows(mergedTasks);
  }, [mergedTasks]);

  const saveTask = async (task) => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/tasks/${task.task_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...task,
          resource_id: task.resource_id || null,
          sla_target_min: task.sla_target_min || null,
        }),
      });
      await readApiPayload(response, 'Failed to save task.');
      setMessage(`Task "${task.task_name}" saved.`);
      onScenarioReload?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save task.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <Table hover className="sim-table mb-0">
            <thead>
              <tr>
                <th>Task</th>
                <th>Duration (min)</th>
                <th>Distribution</th>
                <th>Std dev</th>
                <th>Resource</th>
                <th>Cost</th>
                <th>SLA target</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {taskRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-muted py-4">No BPMN tasks found in the linked process.</td></tr>
              ) : taskRows.map((task, index) => (
                <tr key={task.task_id}>
                  <td><strong>{task.task_name}</strong><div className="text-muted small">{task.task_id}</div></td>
                  <td><Form.Control size="sm" type="number" min={0} value={task.duration_min || 0} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, duration_min: Number(event.target.value) } : entry))} /></td>
                  <td><Form.Select size="sm" value={task.duration_type || 'fixed'} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, duration_type: event.target.value } : entry))}><option value="fixed">Fixed</option><option value="normal">Normal</option><option value="uniform">Uniform</option><option value="exponential">Exponential</option></Form.Select></td>
                  <td><Form.Control size="sm" type="number" min={0} value={task.duration_std || 0} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, duration_std: Number(event.target.value) } : entry))} /></td>
                  <td><Form.Select size="sm" value={task.resource_id || ''} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, resource_id: event.target.value ? Number(event.target.value) : '' } : entry))}><option value="">None</option>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</Form.Select></td>
                  <td><Form.Control size="sm" type="number" min={0} value={task.cost || 0} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, cost: Number(event.target.value) } : entry))} /></td>
                  <td><Form.Control size="sm" type="number" min={0} value={task.sla_target_min || ''} onChange={(event) => setTaskRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, sla_target_min: event.target.value } : entry))} /></td>
                  <td><Button size="sm" variant="outline-danger" onClick={() => saveTask(task)}>Save</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}

function FlowsTab({ scenario, graph, onScenarioReload }) {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const mergedFlows = useMemo(() => {
    const byId = new Map((scenario.flow_probs || []).map((flow) => [flow.flow_id, flow]));
    return graph.flows.map((flow) => ({
      ...flow,
      ...(byId.get(flow.flow_id) || { probability: 100 }),
    }));
  }, [graph.flows, scenario.flow_probs]);

  useEffect(() => {
    setRows(mergedFlows);
  }, [mergedFlows]);

  const saveFlow = async (flow) => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/flows/${flow.flow_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flow),
      });
      await readApiPayload(response, 'Failed to save flow probability.');
      setMessage(`Flow "${flow.flow_name || flow.flow_id}" saved.`);
      onScenarioReload?.();
    } catch (saveError) {
      setError(saveError.message || 'Failed to save flow probability.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}
      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          <Table hover className="sim-table mb-0">
            <thead>
              <tr>
                <th>Flow</th>
                <th>From</th>
                <th>To</th>
                <th>Probability %</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-4">No BPMN sequence flows found.</td></tr>
              ) : rows.map((flow, index) => (
                <tr key={flow.flow_id}>
                  <td><strong>{flow.flow_name || flow.flow_id}</strong><div className="text-muted small">{flow.flow_id}</div></td>
                  <td>{flow.from_element || '—'}</td>
                  <td>{flow.to_element || '—'}</td>
                  <td><Form.Control size="sm" type="number" min={0} max={100} value={flow.probability || 0} onChange={(event) => setRows((current) => current.map((entry, rowIndex) => rowIndex === index ? { ...entry, probability: Number(event.target.value) } : entry))} /></td>
                  <td><Button size="sm" variant="outline-danger" onClick={() => saveFlow(flow)}>Save</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}

function ScenarioComparisonPanel({ scenario, scenarios }) {
  const [compareId, setCompareId] = useState('');
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadComparison = async () => {
    if (!compareId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/compare/${compareId}`);
      const payload = await readApiPayload(response, 'Failed to compare scenarios.');
      setCompareData(payload);
    } catch (compareError) {
      setError(compareError.message || 'Failed to compare scenarios.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <h6 className="mb-1">Scenario comparison</h6>
            <div className="text-muted small">Compare duration, cost, utilisation, and bottlenecks side by side.</div>
          </div>
          <div className="d-flex gap-2">
            <Form.Select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
              <option value="">Select a scenario</option>
              {scenarios
                .filter((entry) => entry.id !== scenario.id && entry.status === 'completed')
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
            </Form.Select>
            <Button variant="outline-danger" onClick={loadComparison} disabled={!compareId || loading}>
              {loading ? 'Loading...' : 'Compare'}
            </Button>
          </div>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {compareData && (
          <>
            <div className="row g-3">
              {compareData.summary.map((metric) => (
                <div className="col-md-6 col-xl-4" key={metric.key}>
                  <div className="border rounded-3 p-3 h-100 bg-light">
                    <div className="text-muted small text-uppercase">{metric.label}</div>
                    <div className="fw-bold mt-1">{fmt(metric.primary, 2)} {metric.unit}</div>
                    <div className="text-muted small">Other: {fmt(metric.secondary, 2)} {metric.unit}</div>
                    <div className={`small mt-2 ${metric.delta <= 0 ? 'text-success' : 'text-danger'}`}>
                      Delta: {fmt(metric.delta, 2)} {metric.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {compareData.resource_comparison?.length > 0 && (
              <Table hover className="sim-table mt-3 mb-0">
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>This scenario</th>
                    <th>Other scenario</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {compareData.resource_comparison.slice(0, 8).map((resource) => (
                    <tr key={resource.resource_name}>
                      <td>{resource.resource_name}</td>
                      <td>{fmt(resource.primary_utilization)}%</td>
                      <td>{fmt(resource.secondary_utilization)}%</td>
                      <td>{fmt(resource.utilization_delta)}%</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
}

function ResultsTab({ scenario, scenarios, onScenarioChange, onScenarioReload }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [whatIf, setWhatIf] = useState({ mode: 'task', targetId: '', value: '' });
  const [whatIfResult, setWhatIfResult] = useState(null);
  const [sensitivity, setSensitivity] = useState(scenario.results?.sensitivity || null);
  const [planning, setPlanning] = useState(scenario.results?.resource_planning || null);
  const [planningTarget, setPlanningTarget] = useState('');

  const graph = useMemo(() => parseBpmnGraph(scenario.bpmn_xml), [scenario.bpmn_xml]);
  const results = scenario.results || null;
  const taskResults = Array.isArray(results?.task_results) ? results.task_results : [];
  const resourceResults = Array.isArray(results?.resource_results) ? results.resource_results : [];
  const bottlenecks = Array.isArray(results?.bottlenecks) ? results.bottlenecks : [];
  const monteCarlo = results?.monte_carlo || null;

  useEffect(() => {
    setSensitivity(scenario.results?.sensitivity || null);
    setPlanning(scenario.results?.resource_planning || null);

    const suggestedTarget =
      Math.max(
        0,
        ...(scenario.task_data || []).map((task) => Number(task.sla_target_min) || 0)
      ) || Number(scenario.results?.avg_duration_min) || 0;

    setPlanningTarget((current) => current || (suggestedTarget ? String(Math.round(suggestedTarget)) : ''));
  }, [scenario]);

  const runScenario = async () => {
    setRunning(true);
    setError('');
    try {
      onScenarioChange((current) => ({ ...current, status: 'running' }));
      const response = await fetch(`${API}/simulations/${scenario.id}/run`, { method: 'POST' });
      const payload = await readApiPayload(response, 'Simulation failed.');
      onScenarioChange((current) => ({
        ...current,
        ...(payload.scenario || {}),
        status: payload.status || 'completed',
        results: payload.results,
      }));
      setSensitivity(payload.results?.sensitivity || null);
      setPlanning(payload.results?.resource_planning || null);
      onScenarioReload?.();
    } catch (runError) {
      setError(runError.message || 'Simulation failed.');
      onScenarioChange((current) => ({ ...current, status: 'failed', last_error: runError.message }));
      onScenarioReload?.();
    } finally {
      setRunning(false);
    }
  };

  const download = async (endpoint, fallbackName) => {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error('Download failed.');
      }
      const blob = await response.blob();
      const header = response.headers.get('content-disposition') || '';
      const fileName = header.split('filename=')[1]?.replace(/"/g, '') || fallbackName;
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fileName });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (downloadError) {
      setError(downloadError.message || 'Download failed.');
    }
  };

  const exportReport = async (format) => {
    const extension = format === 'excel' ? 'xls' : format;
    await download(
      `${API}/simulations/${scenario.id}/report?format=${format}`,
      `simulation-${scenario.id}-report.${extension}`
    );
  };

  const runWhatIf = async () => {
    if (!whatIf.targetId || !whatIf.value) return;
    const body =
      whatIf.mode === 'task'
        ? { task_overrides: [{ task_id: whatIf.targetId, duration_multiplier: Number(whatIf.value) / 100 }] }
        : { resource_overrides: [{ resource_id: Number(whatIf.targetId), quantity: Number(whatIf.value) }] };

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/what-if`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setWhatIfResult(await readApiPayload(response, 'What-if analysis failed.'));
    } catch (analysisError) {
      setError(analysisError.message || 'What-if analysis failed.');
    }
  };

  const loadSensitivity = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/sensitivity`);
      setSensitivity(await readApiPayload(response, 'Failed to load sensitivity analysis.'));
    } catch (analysisError) {
      setError(analysisError.message || 'Failed to load sensitivity analysis.');
    }
  };

  const loadPlanning = async () => {
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/resource-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_cycle_time_min: Number(planningTarget) }),
      });
      setPlanning(await readApiPayload(response, 'Failed to build resource plan.'));
    } catch (analysisError) {
      setError(analysisError.message || 'Failed to build resource plan.');
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h6 className="mb-1">Run and export</h6>
              <div className="text-muted small">Launch the simulation and export polished reports.</div>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Badge bg={statusVariant(scenario.status)}>{statusLabel(scenario.status)}</Badge>
              <Button variant="danger" onClick={runScenario} disabled={running}>{running ? 'Running...' : 'Run simulation'}</Button>
              <Button variant="outline-secondary" onClick={() => download(`${API}/simulations/${scenario.id}/export`, `simulation-${scenario.id}.csv`)}>CSV</Button>
              <Button variant="outline-secondary" onClick={() => exportReport('excel')}>Excel</Button>
              <Button variant="outline-secondary" onClick={() => exportReport('pdf')}>PDF</Button>
            </div>
          </div>
          {scenario.last_error && <Alert variant="danger" className="mt-3 mb-0">{scenario.last_error}</Alert>}
        </Card.Body>
      </Card>

      {!results ? (
        <Card className="border-0 shadow-sm"><Card.Body className="text-center py-5 text-muted">Run the scenario to generate results.</Card.Body></Card>
      ) : (
        <>
          <Row className="g-3">
            {[
              ['Average cycle', `${fmt(results.avg_duration_min)} min`, 'primary'],
              ['P95', `${fmt(results.p95_duration_min)} min`, 'danger'],
              ['Total cost', `${fmt(results.total_cost, 2)} EUR`, 'success'],
              ['Late instances', `${results.late_instances ?? 0}`, 'warning'],
              ['Arrival source', results.arrival_source || '-', 'secondary'],
              ['Monte Carlo', `${scenario.monte_carlo_runs || 1} run(s)`, 'dark'],
            ].map(([label, value, color]) => (
              <Col sm={6} xl={2} key={label}>
                <Card className={`border-0 shadow-sm sim-kpi-card border-${color}`}>
                  <Card.Body className="py-3 text-center">
                    <div className={`sim-kpi-value text-${color}`}>{value}</div>
                    <div className="sim-kpi-label">{label}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {scenario.bpmn_xml && results.task_results?.length > 0 && (
            <Card className="border-0 shadow-sm"><Card.Body><BpmnHeatmapViewer bpmnXml={scenario.bpmn_xml} results={results} /></Card.Body></Card>
          )}

          <ScenarioComparisonPanel scenario={scenario} scenarios={scenarios} />

          <Card className="border-0 shadow-sm"><Card.Body><h6 className="mb-3">Cycle-time distribution</h6><Histogram data={results.histogram || []} /></Card.Body></Card>

          <Row className="g-4">
            <Col xl={7}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="mb-0">Task performance and SLA</h6>
                    <Badge bg={results.sla_summary?.late_instance_rate > 0 ? 'warning' : 'success'}>
                      {fmt(results.sla_summary?.late_instance_rate, 1)}% late
                    </Badge>
                  </div>
                  <div className="table-responsive">
                    <Table hover className="sim-table mb-0">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Avg duration</th>
                          <th>Queue wait</th>
                          <th>Calendar wait</th>
                          <th>SLA target</th>
                          <th>Breach rate</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskResults.length === 0 ? (
                          <tr><td colSpan={7} className="text-center text-muted py-4">No task results available.</td></tr>
                        ) : (
                          taskResults.map((task) => (
                            <tr key={task.task_id}>
                              <td>
                                <strong>{task.task_name || task.task_id}</strong>
                                <div className="text-muted small">{task.executions} execution(s)</div>
                              </td>
                              <td>{fmt(task.avg_duration)} min</td>
                              <td>{fmt(task.avg_queue_wait_min)} min</td>
                              <td>{fmt(task.avg_calendar_wait_min)} min</td>
                              <td>{task.sla_target_min ? `${fmt(task.sla_target_min)} min` : '-'}</td>
                              <td>
                                <Badge bg={(task.sla_breach_rate || 0) > 0 ? 'warning' : 'success'}>
                                  {fmt(task.sla_breach_rate, 1)}%
                                </Badge>
                              </td>
                              <td>{fmt(task.total_cost, 2)} EUR</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </Table>
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col xl={5}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h6 className="mb-0">Resource utilisation</h6>
                    <div className="text-muted small">Calendars and windows applied</div>
                  </div>
                  {resourceResults.length === 0 ? (
                    <div className="text-muted small">No resource data available.</div>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      {resourceResults.map((resource) => (
                        <div key={resource.resource_id} className="border rounded-3 p-3">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <div>
                              <strong>{resource.resource_name}</strong>
                              <div className="text-muted small">{resource.quantity} unit(s)</div>
                            </div>
                            <Badge bg={resource.utilization_rate >= 90 ? 'danger' : resource.utilization_rate >= 70 ? 'warning' : 'success'}>
                              {fmt(resource.utilization_rate, 1)}%
                            </Badge>
                          </div>
                          <div className="sim-resource-util mb-2">
                            <ProgressBar
                              now={Math.min(100, Number(resource.utilization_rate) || 0)}
                              variant={resource.utilization_rate >= 90 ? 'danger' : resource.utilization_rate >= 70 ? 'warning' : 'success'}
                            />
                            <span>{fmt(resource.utilization_rate, 1)}%</span>
                          </div>
                          <div className="row g-2 small text-muted">
                            <div className="col-6">Busy: {fmt(resource.total_busy_min)} min</div>
                            <div className="col-6">Capacity: {fmt(resource.capacity_window_min)} min</div>
                            <div className="col-6">Queue wait: {fmt(resource.avg_queue_wait_min)} min</div>
                            <div className="col-6">Calendar wait: {fmt(resource.avg_calendar_wait_min)} min</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Card className="border-0 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">Bottlenecks</h6>
                <div className="text-muted small">Slow steps, overloads, and SLA breaches</div>
              </div>
              {bottlenecks.length === 0 ? (
                <div className="text-muted small">No bottlenecks detected in this run.</div>
              ) : (
                <div className="sim-bottlenecks">
                  {bottlenecks.map((item, index) => (
                    <Card key={`${item.type}-${item.name}-${index}`} className={`border-0 shadow-sm sim-bottleneck-card severity-${item.severity || 'low'}`}>
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <Badge bg="light" text="dark">{item.type}</Badge>
                          <Badge bg={item.severity === 'high' ? 'danger' : item.severity === 'medium' ? 'warning' : 'secondary'}>
                            {item.severity || 'low'}
                          </Badge>
                        </div>
                        <div className="sim-bottleneck-metric">{fmt(item.metric, 1)} {item.unit || ''}</div>
                        <div className="fw-semibold">{item.name}</div>
                        <div className="text-muted small mt-1">{item.details}</div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>

          <Row className="g-4">
            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Monte Carlo confidence</h6>
                      <div className="text-muted small">Multiple runs with confidence ranges and bottleneck frequency.</div>
                    </div>
                    <Button variant="outline-secondary" size="sm" onClick={runScenario} disabled={running || (scenario.monte_carlo_runs || 1) <= 1}>
                      Refresh
                    </Button>
                  </div>

                  {!monteCarlo ? (
                    <Alert variant="light" className="mb-0">
                      Increase Monte Carlo runs above 1 in the scenario settings, then rerun the simulation to get confidence intervals.
                    </Alert>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      <Row className="g-3">
                        {[
                          ['Average cycle', monteCarlo.duration, 'min'],
                          ['P95 cycle', monteCarlo.p95_duration, 'min'],
                          ['Total cost', monteCarlo.total_cost, 'EUR'],
                          ['Late rate', monteCarlo.late_instance_rate, '%'],
                        ].map(([label, sample, unit]) => (
                          <Col sm={6} key={label}>
                            <div className="border rounded-3 p-3 h-100 bg-light">
                              <div className="text-muted small text-uppercase">{label}</div>
                              <div className="fw-bold mt-1">{fmt(sample.mean, 2)} {unit}</div>
                              <div className="small text-muted">
                                90% band {fmt(sample.ci_low, 2)} to {fmt(sample.ci_high, 2)} {unit}
                              </div>
                            </div>
                          </Col>
                        ))}
                      </Row>

                      <div>
                        <div className="fw-semibold mb-2">Most frequent bottlenecks</div>
                        <Table hover className="sim-table mb-0">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Name</th>
                              <th>Frequency</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(monteCarlo.bottleneck_frequency || []).map((entry) => (
                              <tr key={`${entry.type}-${entry.name}`}>
                                <td>{entry.type}</td>
                                <td>{entry.name}</td>
                                <td>{fmt(entry.rate, 1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">What-if analysis</h6>
                      <div className="text-muted small">Change one task duration or resource headcount and rerun instantly.</div>
                    </div>
                    <Button variant="outline-danger" size="sm" onClick={runWhatIf} disabled={!whatIf.targetId || !whatIf.value}>
                      Run what-if
                    </Button>
                  </div>

                  <Row className="g-3 mb-3">
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Mode</Form.Label>
                        <Form.Select value={whatIf.mode} onChange={(event) => setWhatIf({ mode: event.target.value, targetId: '', value: '' })}>
                          <option value="task">Task duration</option>
                          <option value="resource">Resource quantity</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={5}>
                      <Form.Group>
                        <Form.Label>Target</Form.Label>
                        <Form.Select value={whatIf.targetId} onChange={(event) => setWhatIf((current) => ({ ...current, targetId: event.target.value }))}>
                          <option value="">Select</option>
                          {(whatIf.mode === 'task' ? graph.tasks : scenario.resources || []).map((entry) => (
                            <option key={whatIf.mode === 'task' ? entry.task_id : entry.id} value={whatIf.mode === 'task' ? entry.task_id : entry.id}>
                              {whatIf.mode === 'task' ? entry.task_name : entry.name}
                            </option>
                          ))}
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group>
                        <Form.Label>{whatIf.mode === 'task' ? 'Duration %' : 'Units'}</Form.Label>
                        <Form.Control
                          type="number"
                          min={whatIf.mode === 'task' ? 10 : 1}
                          value={whatIf.value}
                          onChange={(event) => setWhatIf((current) => ({ ...current, value: event.target.value }))}
                          placeholder={whatIf.mode === 'task' ? '120' : '3'}
                        />
                      </Form.Group>
                    </Col>
                  </Row>

                  {!whatIfResult ? (
                    <Alert variant="light" className="mb-0">Run an analysis to compare baseline and candidate outcomes.</Alert>
                  ) : (
                    <Row className="g-3">
                      {[
                        ['Avg cycle delta', whatIfResult.comparison?.avg_duration_delta, 'min'],
                        ['P95 delta', whatIfResult.comparison?.p95_duration_delta, 'min'],
                        ['Cost delta', whatIfResult.comparison?.total_cost_delta, 'EUR'],
                        ['Late-rate delta', whatIfResult.comparison?.late_rate_delta, '%'],
                      ].map(([label, value, unit]) => (
                        <Col sm={6} key={label}>
                          <div className="border rounded-3 p-3 h-100 bg-light">
                            <div className="text-muted small">{label}</div>
                            <div className={`fw-bold mt-1 ${(Number(value) || 0) <= 0 ? 'text-success' : 'text-danger'}`}>
                              {fmt(value, 2)} {unit}
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-4">
            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Sensitivity analysis</h6>
                      <div className="text-muted small">See which task or resource most affects cycle time.</div>
                    </div>
                    <Button variant="outline-secondary" size="sm" onClick={loadSensitivity}>
                      Refresh
                    </Button>
                  </div>

                  {!sensitivity?.impacts?.length ? (
                    <Alert variant="light" className="mb-0">No sensitivity analysis is available yet.</Alert>
                  ) : (
                    <Table hover className="sim-table mb-0">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Name</th>
                          <th>Change</th>
                          <th>Cycle impact</th>
                          <th>Cost impact</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sensitivity.impacts.slice(0, 8).map((impact) => (
                          <tr key={`${impact.type}-${impact.id}`}>
                            <td>{impact.type}</td>
                            <td>{impact.name}</td>
                            <td>{impact.change}</td>
                            <td className={(impact.cycle_impact_min || 0) <= 0 ? 'text-success' : 'text-danger'}>
                              {fmt(impact.cycle_impact_min, 2)} min
                            </td>
                            <td>{fmt(impact.cost_impact, 2)} EUR</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>

            <Col xl={6}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h6 className="mb-1">Resource planning</h6>
                      <div className="text-muted small">Recommend extra capacity to hit a target SLA.</div>
                    </div>
                    <div className="d-flex gap-2">
                      <InputGroup size="sm" style={{ width: 190 }}>
                        <Form.Control
                          type="number"
                          min={1}
                          value={planningTarget}
                          onChange={(event) => setPlanningTarget(event.target.value)}
                          placeholder="Target cycle"
                        />
                        <InputGroup.Text>min</InputGroup.Text>
                      </InputGroup>
                      <Button variant="outline-danger" size="sm" onClick={loadPlanning} disabled={!planningTarget}>
                        Plan
                      </Button>
                    </div>
                  </div>

                  {!planning ? (
                    <Alert variant="light" className="mb-0">Enter a target cycle time to compute staffing recommendations.</Alert>
                  ) : (
                    <div className="d-flex flex-column gap-3">
                      <Alert variant={planning.meets_target ? 'success' : 'warning'} className="mb-0">
                        {planning.summary}
                      </Alert>
                      <div className="small text-muted">
                        Baseline average cycle: {fmt(planning.baseline?.avg_duration_min, 2)} min
                      </div>
                      <Table hover className="sim-table mb-0">
                        <thead>
                          <tr>
                            <th>Resource</th>
                            <th>Add units</th>
                            <th>Projected cycle</th>
                            <th>Improvement</th>
                            <th>Target met</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(planning.recommendations || []).length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-muted py-4">No recommendation found.</td></tr>
                          ) : (
                            planning.recommendations.map((entry) => (
                              <tr key={`${entry.resource_id}-${entry.add_units}`}>
                                <td>{entry.resource_name}</td>
                                <td>+{entry.add_units}</td>
                                <td>{fmt(entry.projected_avg_duration_min, 2)} min</td>
                                <td className="text-success">{fmt(entry.improvement_min, 2)} min</td>
                                <td>
                                  <Badge bg={entry.meets_target ? 'success' : 'secondary'}>
                                    {entry.meets_target ? 'Yes' : 'No'}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

export default function SimulationWorkbench() {
  const [scenarios, setScenarios] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadProcesses = async () => {
    const response = await fetch(`${API}/processes`);
    return readApiPayload(response, 'Failed to load processes.');
  };

  const loadScenarios = async () => {
    const response = await fetch(`${API}/simulations`);
    return readApiPayload(response, 'Failed to load scenarios.');
  };

  const bootstrap = async () => {
    setListLoading(true);
    setError('');
    try {
      const [nextProcesses, nextScenarios] = await Promise.all([loadProcesses(), loadScenarios()]);
      setProcesses(Array.isArray(nextProcesses) ? nextProcesses : []);
      setScenarios(Array.isArray(nextScenarios) ? nextScenarios : []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load simulations.');
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, []);

  const refreshScenarioList = async () => {
    try {
      setScenarios(await loadScenarios());
    } catch (loadError) {
      setError(loadError.message || 'Failed to refresh scenarios.');
    }
  };

  const openScenario = async (scenarioId) => {
    setDetailLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/simulations/${scenarioId}`);
      const payload = await readApiPayload(response, 'Failed to load scenario.');
      setActiveScenario(payload);
      setActiveTab('overview');
    } catch (loadError) {
      setError(loadError.message || 'Failed to load scenario.');
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadActiveScenario = async () => {
    if (!activeScenario?.id) {
      return;
    }

    await Promise.all([openScenario(activeScenario.id), refreshScenarioList()]);
  };

  const applyScenarioChange = (updater) => {
    setActiveScenario((current) => {
      if (!current) {
        return current;
      }

      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next?.id) {
        setScenarios((items) =>
          items.map((entry) =>
            entry.id === next.id
              ? {
                  ...entry,
                  ...next,
                  process_name: next.process_name || entry.process_name,
                }
              : entry
          )
        );
      }
      return next;
    });
  };

  const deleteScenario = async (scenarioId) => {
    if (!window.confirm('Delete this simulation scenario?')) {
      return;
    }

    try {
      const response = await fetch(`${API}/simulations/${scenarioId}`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to delete scenario.');
      setScenarios((items) => items.filter((entry) => entry.id !== scenarioId));
      if (activeScenario?.id === scenarioId) {
        setActiveScenario(null);
      }
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete scenario.');
    }
  };

  const filteredScenarios = scenarios.filter((scenario) => {
    const haystack = `${scenario.name} ${scenario.description || ''} ${scenario.process_name || ''}`.toLowerCase();
    const matchesSearch = !search || haystack.includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || scenario.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const scenarioStats = {
    total: scenarios.length,
    running: scenarios.filter((scenario) => scenario.status === 'running').length,
    completed: scenarios.filter((scenario) => scenario.status === 'completed').length,
    failed: scenarios.filter((scenario) => scenario.status === 'failed').length,
  };

  const linkedProcess = processes.find((process) => process.id === activeScenario?.process_id);
  const graph = useMemo(
    () => parseBpmnGraph(activeScenario?.bpmn_xml || linkedProcess?.bpmn_xml),
    [activeScenario?.bpmn_xml, linkedProcess?.bpmn_xml]
  );

  if (activeScenario) {
    return (
      <Container fluid className="py-4 px-4">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
          <div>
            <Button variant="link" className="px-0 text-muted text-decoration-none" onClick={() => setActiveScenario(null)}>
              <i className="bi bi-arrow-left me-1" />
              Back to simulations
            </Button>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h2 className="mb-0">{activeScenario.name}</h2>
              <Badge bg={statusVariant(activeScenario.status)}>{statusLabel(activeScenario.status)}</Badge>
              <Badge bg="light" text="dark">{activeScenario.process_name || linkedProcess?.name || 'No process linked'}</Badge>
            </div>
            <div className="text-muted mt-2">
              {activeScenario.description || 'Configure calendars, SLAs, arrivals, and advanced analysis for this scenario.'}
            </div>
          </div>

          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={reloadActiveScenario} disabled={detailLoading}>
              {detailLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button variant="outline-danger" onClick={() => deleteScenario(activeScenario.id)}>
              Delete
            </Button>
          </div>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        <Card className="border-0 shadow-sm">
          <Card.Body className="p-3">
            <div className="d-flex flex-wrap gap-2 mb-4">
              {[
                ['overview', 'Overview'],
                ['resources', 'Resources'],
                ['tasks', 'Task data'],
                ['flows', 'Flow probabilities'],
                ['results', 'Results'],
              ].map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={activeTab === key ? 'danger' : 'outline-secondary'}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                </Button>
              ))}
            </div>

            {detailLoading ? (
              <div className="text-center py-5 text-muted">Loading scenario...</div>
            ) : activeTab === 'overview' ? (
              <OverviewTab
                scenario={activeScenario}
                processes={processes}
                onScenarioChange={applyScenarioChange}
                onReload={reloadActiveScenario}
              />
            ) : activeTab === 'resources' ? (
              <ResourcesTab scenario={activeScenario} onScenarioReload={reloadActiveScenario} />
            ) : activeTab === 'tasks' ? (
              <TasksTab
                scenario={activeScenario}
                graph={graph}
                resources={activeScenario.resources || []}
                onScenarioReload={reloadActiveScenario}
              />
            ) : activeTab === 'flows' ? (
              <FlowsTab scenario={activeScenario} graph={graph} onScenarioReload={reloadActiveScenario} />
            ) : (
              <ResultsTab
                scenario={activeScenario}
                scenarios={scenarios}
                onScenarioChange={applyScenarioChange}
                onScenarioReload={reloadActiveScenario}
              />
            )}
          </Card.Body>
        </Card>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4 px-4">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
        <div>
          <h1 className="mb-2">Simulation Workbench</h1>
          <div className="text-muted">
            Build advanced scenarios with calendars, SLAs, Monte Carlo analysis, staffing plans, and polished reports.
          </div>
        </div>
        <Button variant="danger" onClick={() => setShowCreate(true)}>
          <i className="bi bi-plus-lg me-2" />
          New scenario
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <Row className="g-3 mb-4">
        {[
          ['Total scenarios', scenarioStats.total, 'dark'],
          ['Running', scenarioStats.running, 'warning'],
          ['Completed', scenarioStats.completed, 'success'],
          ['Failed', scenarioStats.failed, 'danger'],
        ].map(([label, value, variant]) => (
          <Col md={6} xl={3} key={label}>
            <Card className="border-0 shadow-sm h-100">
              <Card.Body>
                <div className="text-muted small text-uppercase">{label}</div>
                <div className={`display-6 fw-bold mt-2 text-${variant}`}>{value}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="border-0 shadow-sm mb-4">
        <Card.Body>
          <Row className="g-3">
            <Col lg={8}>
              <Form.Group>
                <Form.Label>Search scenarios</Form.Label>
                <Form.Control
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, description, or process"
                />
              </Form.Group>
            </Col>
            <Col lg={4}>
              <Form.Group>
                <Form.Label>Status</Form.Label>
                <Form.Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {listLoading ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5 text-muted">Loading scenarios...</Card.Body>
        </Card>
      ) : filteredScenarios.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <Card.Body className="text-center py-5 text-muted">No scenarios match the current filters.</Card.Body>
        </Card>
      ) : (
        <Row className="g-4">
          {filteredScenarios.map((scenario) => (
            <Col lg={6} xl={4} key={scenario.id}>
              <Card className="border-0 shadow-sm h-100">
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-2">
                    <div>
                      <h5 className="mb-1">{scenario.name}</h5>
                      <div className="text-muted small">{scenario.process_name || 'No linked process'}</div>
                    </div>
                    <Badge bg={statusVariant(scenario.status)}>{statusLabel(scenario.status)}</Badge>
                  </div>

                  <div className="text-muted small mb-3">
                    {scenario.description || 'No description provided.'}
                  </div>

                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Badge bg="light" text="dark">{scenario.process_instances || 0} instances</Badge>
                    <Badge bg="light" text="dark">{scenario.monte_carlo_runs || 1} Monte Carlo run(s)</Badge>
                    <Badge bg="light" text="dark">
                      {scenario.import_csv_arrivals ? 'CSV arrivals' : 'Generated arrivals'}
                    </Badge>
                  </div>

                  {scenario.results ? (
                    <div className="border rounded-3 p-3 bg-light mb-3">
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Avg cycle</span>
                        <strong>{fmt(scenario.results.avg_duration_min)} min</strong>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Total cost</span>
                        <strong>{fmt(scenario.results.total_cost, 2)} EUR</strong>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span className="text-muted small">Late rate</span>
                        <strong>{fmt(scenario.results.sla_summary?.late_instance_rate, 1)}%</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted small mb-3">
                      Run this scenario to generate KPIs, heatmaps, and advanced analysis.
                    </div>
                  )}

                  <div className="mt-auto d-flex justify-content-between align-items-center">
                    <Button variant="danger" size="sm" onClick={() => openScenario(scenario.id)}>
                      Open workbench
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => deleteScenario(scenario.id)}>
                      Delete
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <ScenarioCreateModal
        show={showCreate}
        onHide={() => setShowCreate(false)}
        processes={processes}
        onCreated={async (created) => {
          setShowCreate(false);
          await refreshScenarioList();
          await openScenario(created.id);
        }}
      />
    </Container>
  );
}
