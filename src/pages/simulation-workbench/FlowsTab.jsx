import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Table } from 'react-bootstrap';
import { API, readApiPayload } from './utils';

export default function FlowsTab({ scenario, graph, onScenarioReload }) {
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
                <tr>
                  <td colSpan={5} className="text-center text-muted py-4">
                    No BPMN sequence flows found.
                  </td>
                </tr>
              ) : (
                rows.map((flow, index) => (
                  <tr key={flow.flow_id}>
                    <td>
                      <strong>{flow.flow_name || flow.flow_id}</strong>
                      <div className="text-muted small">{flow.flow_id}</div>
                    </td>
                    <td>{flow.from_element || '-'}</td>
                    <td>{flow.to_element || '-'}</td>
                    <td>
                      <Form.Control
                        size="sm"
                        type="number"
                        min={0}
                        max={100}
                        value={flow.probability || 0}
                        onChange={(event) =>
                          setRows((current) =>
                            current.map((entry, rowIndex) =>
                              rowIndex === index ? { ...entry, probability: Number(event.target.value) } : entry,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Button size="sm" variant="outline-danger" onClick={() => saveFlow(flow)}>
                        Save
                      </Button>
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
