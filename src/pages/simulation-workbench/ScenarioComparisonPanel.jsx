import { useState } from 'react';
import { Alert, Button, Card, Form, Table } from 'react-bootstrap';
import { API, fmt, readApiPayload } from './utils';

export default function ScenarioComparisonPanel({ scenario, scenarios }) {
  const [compareId, setCompareId] = useState('');
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadComparison = async () => {
    if (!compareId) {
      return;
    }

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
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
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
                    <div className="fw-bold mt-1">
                      {fmt(metric.primary, 2)} {metric.unit}
                    </div>
                    <div className="text-muted small">
                      Other: {fmt(metric.secondary, 2)} {metric.unit}
                    </div>
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
