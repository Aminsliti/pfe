import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Modal, Row, Table } from 'react-bootstrap';

import { API_BASE } from '../utils/api';

const API = API_BASE;

const entityLabels = {
  user: 'User',
  process: 'Process',
  process_category: 'Category',
  role: 'Role',
  orgchart_node: 'Org chart',
  simulation: 'Simulation',
};

const AUDIT_LOG_POLL_MS = 5000;

function formatActionLabel(action) {
  const normalized = String(action || '')
    .replace(/_/g, ' ')
    .trim();

  if (!normalized) {
    return '-';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    entityType: '',
    action: '',
  });

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.action) params.set('action', filters.action);

      const response = await fetch(`${API}/audit-logs?${params.toString()}`);
      const payload = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : [];

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load the audit log.');
      }

      setLogs(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [filters.action, filters.entityType, filters.search]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadLogs().catch(() => {});
      }
    }, AUDIT_LOG_POLL_MS);

    const handleFocus = () => {
      loadLogs().catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadLogs().catch(() => {});
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    if (!filters.search) {
      return logs;
    }

    const search = filters.search.toLowerCase();
    return logs.filter((log) =>
      [
        log.summary,
        log.user_name,
        log.entity_type,
        log.entity_id,
        log.action,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [logs, filters.search]);

  const actions = Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort();

  return (
    <Container fluid className="py-4">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <h3 className="mb-1">Audit Log</h3>
              <div className="text-muted">Track changes across users, categories, processes, the org chart, and simulations.</div>
            </div>
            <Badge bg="dark">{filteredLogs.length} entr{filteredLogs.length === 1 ? 'y' : 'ies'}</Badge>
          </div>
        </Col>
      </Row>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm mb-3">
        <Card.Body>
          <Row className="g-3">
            <Col md={5}>
              <Form.Control
                placeholder="Search by summary, user, action, or entity..."
                value={filters.search}
                onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))}
              />
            </Col>
            <Col md={3}>
              <Form.Select
                value={filters.entityType}
                onChange={(event) => setFilters((previous) => ({ ...previous, entityType: event.target.value }))}
              >
                <option value="">All entity types</option>
                {Object.entries(entityLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={3}>
              <Form.Select
                value={filters.action}
                onChange={(event) => setFilters((previous) => ({ ...previous, action: event.target.value }))}
              >
                <option value="">All actions</option>
                {actions.map((action) => (
                  <option key={action} value={action}>{formatActionLabel(action)}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={1}>
              <button type="button" className="btn btn-outline-secondary w-100" onClick={loadLogs} title="Refresh audit log" aria-label="Refresh audit log">
                <i className="bi bi-arrow-repeat" />
              </button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card className="border-0 shadow-sm">
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-danger" role="status" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-5 text-muted">
              No audit entries match the current filters.
            </div>
          ) : (
            <Table hover responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Summary</th>
                  <th className="text-end">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {log.created_at ? new Date(log.created_at).toLocaleString() : '-'}
                    </td>
                    <td>
                      <strong>{log.user_name || 'System'}</strong>
                      {log.user_role && <div className="text-muted small">{log.user_role}</div>}
                    </td>
                    <td>
                      <Badge bg="secondary">{entityLabels[log.entity_type] || log.entity_type}</Badge>
                      {log.entity_id && <div className="text-muted small mt-1">#{log.entity_id}</div>}
                    </td>
                    <td><code>{formatActionLabel(log.action)}</code></td>
                    <td>
                      <div>{log.summary || '-'}</div>
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <div className="text-muted small mt-1">Additional structured details are available.</div>
                      ) : null}
                    </td>
                    <td className="text-end">
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => setSelectedLog(log)}
                      >
                        View details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={!!selectedLog} onHide={() => setSelectedLog(null)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Audit log details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!selectedLog ? null : (
            <div className="d-flex flex-column gap-3">
              <Row className="g-3">
                <Col md={6}>
                  <div className="small text-uppercase text-muted fw-semibold mb-1">Date</div>
                  <div>{selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString() : '-'}</div>
                </Col>
                <Col md={6}>
                  <div className="small text-uppercase text-muted fw-semibold mb-1">User</div>
                  <div>{selectedLog.user_name || 'System'}</div>
                  {selectedLog.user_role ? <div className="text-muted small">{selectedLog.user_role}</div> : null}
                </Col>
                <Col md={6}>
                  <div className="small text-uppercase text-muted fw-semibold mb-1">Entity</div>
                  <div>{entityLabels[selectedLog.entity_type] || selectedLog.entity_type}</div>
                  {selectedLog.entity_id ? <div className="text-muted small">#{selectedLog.entity_id}</div> : null}
                </Col>
                <Col md={6}>
                  <div className="small text-uppercase text-muted fw-semibold mb-1">Action</div>
                  <div>{formatActionLabel(selectedLog.action)}</div>
                </Col>
              </Row>

              <div>
                <div className="small text-uppercase text-muted fw-semibold mb-1">Summary</div>
                <div>{selectedLog.summary || '-'}</div>
              </div>

              <div>
                <div className="small text-uppercase text-muted fw-semibold mb-1">Structured details</div>
                <pre className="small mb-0 mt-2 p-3 bg-light rounded border" style={{ maxHeight: 360, overflow: 'auto' }}>
                  {JSON.stringify(selectedLog.details || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
}
