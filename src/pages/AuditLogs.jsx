import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Col, Container, Form, Row, Table } from 'react-bootstrap';

const API = 'http://localhost:3001/api';

const entityLabels = {
  user: 'Utilisateur',
  process: 'Processus',
  role: 'Role',
  orgchart_node: 'Organigramme',
  simulation: 'Simulation',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    entityType: '',
    action: '',
  });

  const loadLogs = async () => {
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
        throw new Error(payload.error || 'Impossible de charger le journal d audit.');
      }

      setLogs(Array.isArray(payload) ? payload : []);
    } catch (loadError) {
      setError(loadError.message || 'Impossible de charger le journal d audit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [filters.entityType, filters.action]);

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
              <div className="text-muted">Trace des changements sur les utilisateurs, processus, roles, organigrammes et simulations.</div>
            </div>
            <Badge bg="dark">{filteredLogs.length} entree(s)</Badge>
          </div>
        </Col>
      </Row>

      {error && <Alert variant="danger">{error}</Alert>}

      <Card className="border-0 shadow-sm mb-3">
        <Card.Body>
          <Row className="g-3">
            <Col md={5}>
              <Form.Control
                placeholder="Rechercher par resume, utilisateur, action..."
                value={filters.search}
                onChange={(event) => setFilters((previous) => ({ ...previous, search: event.target.value }))}
              />
            </Col>
            <Col md={3}>
              <Form.Select
                value={filters.entityType}
                onChange={(event) => setFilters((previous) => ({ ...previous, entityType: event.target.value }))}
              >
                <option value="">Tous les types</option>
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
                <option value="">Toutes les actions</option>
                {actions.map((action) => (
                  <option key={action} value={action}>{action}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={1}>
              <button type="button" className="btn btn-outline-secondary w-100" onClick={loadLogs}>
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
              Aucune entree d audit pour les filtres actuels.
            </div>
          ) : (
            <Table hover responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Utilisateur</th>
                  <th>Type</th>
                  <th>Action</th>
                  <th>Resume</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {log.created_at ? new Date(log.created_at).toLocaleString('fr-FR') : '-'}
                    </td>
                    <td>
                      <strong>{log.user_name || 'Systeme'}</strong>
                      {log.user_role && <div className="text-muted small">{log.user_role}</div>}
                    </td>
                    <td>
                      <Badge bg="secondary">{entityLabels[log.entity_type] || log.entity_type}</Badge>
                      {log.entity_id && <div className="text-muted small mt-1">#{log.entity_id}</div>}
                    </td>
                    <td><code>{log.action}</code></td>
                    <td>
                      <div>{log.summary || '-'}</div>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <details className="mt-1">
                          <summary className="small text-muted" style={{ cursor: 'pointer' }}>Details</summary>
                          <pre className="small mb-0 mt-2 p-2 bg-light rounded">{JSON.stringify(log.details, null, 2)}</pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
