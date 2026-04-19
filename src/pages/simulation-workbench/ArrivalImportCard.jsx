import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form } from 'react-bootstrap';
import { useSnackbar } from '../../components/SnackbarProvider';
import { API, fmt, readApiPayload } from './utils';

export default function ArrivalImportCard({ scenario, onScenarioUpdated }) {
  const { showSnackbar } = useSnackbar();
  const [csvText, setCsvText] = useState('');
  const [arrivals, setArrivals] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!scenario?.id) {
        return;
      }

      try {
        const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times`);
        const payload = await readApiPayload(response, 'Failed to load arrival times.');
        setArrivals(payload.arrivals || []);
      } catch (loadError) {
        setError(loadError.message || 'Failed to load arrival times.');
      }
    };

    load();
  }, [scenario?.id]);

  const importCsv = async () => {
    if (!csvText.trim()) {
      setError('Paste or upload CSV content first.');
      showSnackbar('Paste or upload CSV content first.', 'danger');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText }),
      });
      const payload = await readApiPayload(response, 'Failed to import arrival times.');
      setArrivals(payload.arrivals || []);
      showSnackbar(`${payload.count} arrival time(s) imported.`);
      onScenarioUpdated((current) => ({
        ...current,
        import_csv_arrivals: true,
        process_instances: payload.count,
      }));
    } catch (importError) {
      setError(importError.message || 'Failed to import arrival times.');
      showSnackbar(importError.message || 'Failed to import arrival times.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const clearImport = async () => {
    setBusy(true);
    setError('');

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/arrival-times`, { method: 'DELETE' });
      await readApiPayload(response, 'Failed to clear arrival times.');
      setArrivals([]);
      showSnackbar('Imported arrival times cleared.');
      onScenarioUpdated((current) => ({
        ...current,
        import_csv_arrivals: false,
      }));
    } catch (clearError) {
      setError(clearError.message || 'Failed to clear arrival times.');
      showSnackbar(clearError.message || 'Failed to clear arrival times.', 'danger');
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
          <div>
            <strong>{arrivals.length}</strong> arrival(s)
          </div>
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
