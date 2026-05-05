import { useState, useEffect } from 'react';
import {
  Container, Row, Col, Card, Button, Modal, Form,
  Alert, Badge, Table, ProgressBar,
} from 'react-bootstrap';
import { useSnackbar } from '../components/SnackbarProvider';
import './SimulationScenarios.css';
import BpmnHeatmapViewer from '../components/BpmnEditor/BpmnHeatmapViewer';

import { API_BASE } from '../utils/api';

const API = API_BASE;

async function readApiPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return { error: text };
}

const statusVariant = s => ({ draft:'secondary', running:'warning', completed:'success', failed:'danger', error:'danger' }[s] || 'secondary');
const statusLabel   = s => ({ draft:'Brouillon', running:'En cours', completed:'Termine', failed:'Echec', error:'Echec' }[s] || s);
const fmt = (n, dec = 1) => n == null ? '—' : Number(n).toFixed(dec);

// --- Histogram ---------------------------------------------------------------
function Histogram({ data }) {
  if (!data?.length) return <p className="text-muted small">Aucune donnée.</p>;
  const max = Math.max(...data.map(d => d.count));
  return (
    <div className="sim-histogram">
      {data.map((bin, i) => (
        <div key={i} className="sim-histogram-bar">
          <div className="sim-histogram-fill"
            style={{ height: `${(bin.count / max) * 100}%` }}
            title={`${bin.count} instances`} />
          <span className="sim-histogram-lbl">{bin.label}</span>
        </div>
      ))}
    </div>
  );
}

// -- Modal création ------------------------------------------------------------
function ScenarioModal({ show, onHide, processes, onCreated }) {
  const [form, setForm] = useState({
    name: '', description: '', process_id: '', status: 'draft',
    start_date: new Date().toISOString().slice(0, 10),
    process_instances: 100, warmup_percent: 5, cooldown_percent: 10,
    infinite_resources: false, simulate_all_levels: false, import_csv_arrivals: false,
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.name)       { setErr('Le nom est obligatoire.');    return; }
    if (!form.process_id) { setErr('Sélectionnez un processus.'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch(`${API}/simulations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onCreated(await res.json());
      onHide();
    } catch (e2) { setErr(e2.message); }
    setSaving(false);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Nouveau scénario de simulation</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {err && <Alert variant="danger">{err}</Alert>}
        <Form onSubmit={handleSubmit}>
          <Row>
            <Col md={8}>
              <Form.Group className="mb-3">
                <Form.Label>Nom *</Form.Label>
                <Form.Control value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Scénario nominal" />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Statut</Form.Label>
                <Form.Select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="draft">Brouillon</option>
                  <option value="completed">Complété</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
          <Form.Group className="mb-3">
            <Form.Label>Processus *</Form.Label>
            <Form.Select value={form.process_id} onChange={e => set('process_id', e.target.value)}>
              <option value="">— Sélectionner un processus —</option>
              {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Description</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.description} onChange={e => set('description', e.target.value)} />
          </Form.Group>
          <hr />
          <h6 className="mb-3 text-muted">Paramètres</h6>
          <Row>
            <Col md={3}><Form.Group className="mb-3"><Form.Label>Instances *</Form.Label>
              <Form.Control type="number" min={1} value={form.process_instances} onChange={e => set('process_instances', +e.target.value)} /></Form.Group></Col>
            <Col md={3}><Form.Group className="mb-3"><Form.Label>Montée en charge (%)</Form.Label>
              <Form.Control type="number" min={0} max={50} value={form.warmup_percent} onChange={e => set('warmup_percent', +e.target.value)} /></Form.Group></Col>
            <Col md={3}><Form.Group className="mb-3"><Form.Label>Traîne à exclure (%)</Form.Label>
              <Form.Control type="number" min={0} max={50} value={form.cooldown_percent} onChange={e => set('cooldown_percent', +e.target.value)} /></Form.Group></Col>
            <Col md={3}><Form.Group className="mb-3"><Form.Label>Date de début</Form.Label>
              <Form.Control type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></Form.Group></Col>
          </Row>
          <Form.Check type="switch" id="inf-r" label="Ressources infinies"
            checked={form.infinite_resources} onChange={e => set('infinite_resources', e.target.checked)} />
          <Form.Check type="switch" id="sim-all" label="Simuler tous les niveaux"
            checked={form.simulate_all_levels} onChange={e => set('simulate_all_levels', e.target.checked)} className="mt-1" />
          <div className="d-flex justify-content-end gap-2 mt-4">
            <Button variant="secondary" onClick={onHide}>Annuler</Button>
            <Button type="submit" variant="primary" disabled={saving}>{saving ? '? Création…' : '+ Créer'}</Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}

// -- Onglet Caractéristiques ---------------------------------------------------
function TabCaracteristiques({ scenario, processes, onSaved }) {
  const [form, setForm]     = useState({ ...scenario });
  const [saving, setSaving] = useState(false);
  const [msg,    setMsg]    = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await fetch(`${API}/simulations/${scenario.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved(await res.json());
      setMsg('? Enregistré');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) { setMsg('? ' + e.message); }
    setSaving(false);
  };

  return (
    <div>
      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" size="sm" onClick={save} disabled={saving}>?? Mettre à jour</Button>
        {msg && <span className={`align-self-center small ${msg.startsWith('?') ? 'text-success' : 'text-danger'}`}>{msg}</span>}
      </div>

      <div className="sim-section">
        <div className="sim-section-title">Identification</div>
        <Row>
          <Col md={8}><Form.Group className="mb-3"><Form.Label>Nom</Form.Label>
            <Form.Control value={form.name || ''} onChange={e => set('name', e.target.value)} /></Form.Group></Col>
          <Col md={4}><Form.Group className="mb-3"><Form.Label>Statut</Form.Label>
            <Form.Select value={form.status || 'draft'} onChange={e => set('status', e.target.value)}>
              <option value="running">En cours</option>
              <option value="failed">Echec</option>
              <option value="draft">Brouillon</option><option value="completed">Complété</option>
            </Form.Select></Form.Group></Col>
          <Col md={12}><Form.Group className="mb-3"><Form.Label>Description</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.description || ''} onChange={e => set('description', e.target.value)} /></Form.Group></Col>
        </Row>
      </div>

      <div className="sim-section">
        <div className="sim-section-title">Paramètres du scénario</div>
        <Row className="mb-3">
          <Col md={6}>
            <Form.Label className="sim-field-label">Processus simulé</Form.Label>
            <Form.Select value={form.process_id || ''} onChange={e => set('process_id', +e.target.value)}>
              <option value="">— Sélectionner —</option>
              {processes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Form.Select>
          </Col>
        </Row>
        <Form.Check type="checkbox" id="csv-chk"
          label="Import du fichier CSV des heures exactes d'arrivée"
          checked={!!form.import_csv_arrivals} onChange={e => set('import_csv_arrivals', e.target.checked)} className="mb-3" />
        <div className="sim-info-box mb-3">
          <i className="bi bi-info-circle me-2" />
          Définissez la date de début et le nombre d'instances ; la montée en charge et la traîne peuvent être exclues des résultats.
        </div>
        <Row>
          <Col md={3}><Form.Group className="mb-3"><Form.Label className="sim-field-label">Instances *</Form.Label>
            <Form.Control type="number" min={1} value={form.process_instances || 100} onChange={e => set('process_instances', +e.target.value)} /></Form.Group></Col>
          <Col md={3}><Form.Group className="mb-3"><Form.Label className="sim-field-label">Montée en charge (%)</Form.Label>
            <Form.Control type="number" min={0} max={50} value={form.warmup_percent || 5} onChange={e => set('warmup_percent', +e.target.value)} /></Form.Group></Col>
          <Col md={3}><Form.Group className="mb-3"><Form.Label className="sim-field-label">Date de début</Form.Label>
            <Form.Control type="date" value={form.start_date?.slice(0,10) || ''} onChange={e => set('start_date', e.target.value)} /></Form.Group></Col>
          <Col md={3}><Form.Group className="mb-3"><Form.Label className="sim-field-label">Traîne à exclure (%)</Form.Label>
            <Form.Control type="number" min={0} max={50} value={form.cooldown_percent || 10} onChange={e => set('cooldown_percent', +e.target.value)} /></Form.Group></Col>
        </Row>
        <Form.Check type="switch" id="inf2" label="Ressources infinies"
          checked={!!form.infinite_resources} onChange={e => set('infinite_resources', e.target.checked)} />
        <Form.Check type="switch" id="all2" label="Simuler tous les niveaux de processus"
          checked={!!form.simulate_all_levels} onChange={e => set('simulate_all_levels', e.target.checked)} className="mt-1" />
      </div>
      <SimulationArrivalTimesCard
        scenarioId={scenario.id}
        enabled={!!form.import_csv_arrivals}
        onImported={({ count, arrivals }) => {
          setForm(f => ({ ...f, import_csv_arrivals: true, process_instances: count }));
          onSaved({ ...scenario, import_csv_arrivals: true, process_instances: count, arrival_times: arrivals });
          setMsg('Import CSV termine');
          setTimeout(() => setMsg(''), 2500);
        }}
        onCleared={() => {
          setForm(f => ({ ...f, import_csv_arrivals: false }));
          onSaved({ ...scenario, import_csv_arrivals: false, arrival_times: [] });
          setMsg('Import CSV supprime');
          setTimeout(() => setMsg(''), 2500);
        }}
      />
    </div>
  );
}

function ArrivalTimesCard({ scenarioId, enabled, onImported, onCleared }) {
  return (
    <SimulationArrivalTimesCard
      scenarioId={scenarioId}
      enabled={enabled}
      onImported={onImported}
      onCleared={onCleared}
    />
  );

  const [arrivals, setArrivals] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Impossible de charger les arrivees importe es.');
      setArrivals(Array.isArray(payload.arrivals) ? payload.arrivals : []);
    } catch (error) {
      setErr(error.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [scenarioId]);

  const importCsv = async () => {
    if (!file) return setErr('Choisissez un fichier CSV.');
    setUploading(true);
    setErr('');
    setMsg('');
    try {
      const csvText = await file.text();
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, fileName: file.name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Import CSV impossible.');
      setArrivals(payload.arrivals || []);
      setFile(null);
      setMsg(`${payload.count} arrivees importe es.`);
      onImported?.(payload);
    } catch (error) {
      setErr(error.message);
    }
    setUploading(false);
  };

  const clearImport = async () => {
    setErr('');
    setMsg('');
    try {
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Suppression impossible.');
      setArrivals([]);
      setMsg('Import CSV vide.');
      onCleared?.();
    } catch (error) {
      setErr(error.message);
    }
  };

  return (
    <div className="sim-section">
      <div className="sim-section-title">Arrivees exactes (CSV)</div>
      <div className="sim-info-box mb-3">
        <i className="bi bi-upload me-2" />
        Importez un CSV contenant une colonne d arrivee. Valeurs supportees: minutes, heure HH:MM, ou date ISO.
      </div>
      {!enabled && <Alert variant="secondary" className="mb-3">Activez l option d import CSV et enregistrez le scenario avant de charger un fichier.</Alert>}
      <div className="sim-results-header">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <Badge bg={statusVariant(effectiveStatus)}>{statusLabel(effectiveStatus)}</Badge>
            {results?.simulated_at && <span>Simulation du {new Date(results.simulated_at).toLocaleString('fr-FR')}</span>}
          </div>
          <div className="d-flex flex-wrap gap-3">
            {scenario.last_run_started_at && <span>DÃ©marrage: {new Date(scenario.last_run_started_at).toLocaleString('fr-FR')}</span>}
            {scenario.last_run_finished_at && <span>Fin: {new Date(scenario.last_run_finished_at).toLocaleString('fr-FR')}</span>}
          </div>
        </div>
      </div>
      {effectiveStatus === 'running' && (
        <div className="sim-inline-progress mb-3">
          <span className="spinner-border spinner-border-sm text-warning" />
          <div>
            <strong>Simulation en cours</strong>
            <div className="text-muted small">Le statut passe automatiquement Ã  complÃ©tÃ© ou Ã  Ã©chec lorsque le run se termine.</div>
          </div>
        </div>
      )}
      {lastError && <Alert variant="danger">{lastError}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}
      <Row className="g-3 align-items-end">
        <Col md={8}><Form.Group><Form.Label>Fichier CSV</Form.Label><Form.Control type="file" accept=".csv,text/csv" disabled={!enabled || uploading} onChange={e => setFile(e.target.files?.[0] || null)} /></Form.Group></Col>
        <Col md={4}><div className="d-flex gap-2"><Button disabled={!enabled || !file || uploading} onClick={importCsv}>{uploading ? 'Import...' : 'Importer'}</Button><Button variant="outline-secondary" disabled={!arrivals.length} onClick={clearImport}>Vider</Button></div></Col>
      </Row>
      <div className="sim-arrivals-summary mt-3">
        <div><strong>{arrivals.length}</strong> arrivee(s) chargee(s)</div>
        <div>{loading ? 'Chargement...' : arrivals.length ? `Premiere arrivee a ${fmt(arrivals[0].arrival_offset_min, 2)} min` : 'Aucune arrivee importee'}</div>
      </div>
      {arrivals.length > 0 && <Table hover size="sm" className="sim-table mt-3 mb-0"><thead><tr><th>#</th><th>Valeur source</th><th>Offset (min)</th></tr></thead><tbody>{arrivals.slice(0, 8).map(arrival => <tr key={arrival.id || arrival.arrival_order}><td>{arrival.arrival_order}</td><td>{arrival.raw_value}</td><td>{fmt(arrival.arrival_offset_min, 2)}</td></tr>)}</tbody></Table>}
    </div>
  );
}

// -- Onglet Ressources ---------------------------------------------------------
function TabRessources({ scenarioId }) {
  const { confirmAction } = useSnackbar();
  const [resources, setResources] = useState([]);
  const [showForm,  setShowForm]  = useState(false);
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({ name:'', resource_type:'human', quantity:1, cost_per_hour:0, availability:100 });
  const [saving,    setSaving]    = useState(false);

  const load = async () => {
    const r = await fetch(`${API}/simulations/${scenarioId}/resources`);
    if (r.ok) setResources(await r.json());
  };
  useEffect(() => { load(); }, [scenarioId]);

  const openNew  = () => { setForm({ name:'', resource_type:'human', quantity:1, cost_per_hour:0, availability:100 }); setEditing(null); setShowForm(true); };
  const openEdit = r => { setForm({ ...r }); setEditing(r.id); setShowForm(true); };

  const save = async () => {
    setSaving(true);
    const url    = editing ? `${API}/simulations/${scenarioId}/resources/${editing}` : `${API}/simulations/${scenarioId}/resources`;
    const method = editing ? 'PUT' : 'POST';
    const res    = await fetch(url, { method, headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(form) });
    if (res.ok) { await load(); setShowForm(false); }
    setSaving(false);
  };

  const del = async id => {
    const confirmed = await confirmAction({
      title: 'Supprimer la ressource',
      message: 'Supprimer cette ressource ?',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
      cancelLabel: 'Annuler',
    });
    if (!confirmed) return;
    await fetch(`${API}/simulations/${scenarioId}/resources/${id}`, { method:'DELETE' });
    load();
  };

  const typeLabel = t => ({ human:'Humain', machine:'Machine', system:'Système' }[t] || t);

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <span className="text-muted small">{resources.length} ressource(s)</span>
        <Button variant="outline-primary" size="sm" onClick={openNew}>+ Ajouter</Button>
      </div>
      {resources.length === 0
        ? <div className="sim-empty"><i className="bi bi-people" /><p>Aucune ressource définie.</p></div>
        : (
          <Table hover size="sm" className="sim-table">
            <thead><tr><th>Nom</th><th>Type</th><th>Quantité</th><th>Coût/h (€)</th><th>Dispo (%)</th><th /></tr></thead>
            <tbody>
              {resources.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td><Badge bg="light" text="dark">{typeLabel(r.resource_type)}</Badge></td>
                  <td>{r.quantity}</td>
                  <td>{fmt(r.cost_per_hour, 2)}</td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <ProgressBar now={r.availability} style={{ width:80, height:6 }} />
                      <span>{r.availability}%</span>
                    </div>
                  </td>
                  <td className="text-end">
                    <Button variant="link" size="sm" className="p-0 me-2" onClick={() => openEdit(r)}>??</Button>
                    <Button variant="link" size="sm" className="p-0 text-danger" onClick={() => del(r.id)}>??</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      }
      <Modal show={showForm} onHide={() => setShowForm(false)}>
        <Modal.Header closeButton><Modal.Title>{editing ? 'Modifier' : 'Ajouter'} une ressource</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-2"><Form.Label>Nom *</Form.Label>
            <Form.Control value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value}))} /></Form.Group>
          <Form.Group className="mb-2"><Form.Label>Type</Form.Label>
            <Form.Select value={form.resource_type} onChange={e => setForm(f=>({...f, resource_type:e.target.value}))}>
              <option value="human">Humain</option><option value="machine">Machine</option><option value="system">Système</option>
            </Form.Select></Form.Group>
          <Row>
            <Col><Form.Group className="mb-2"><Form.Label>Quantité</Form.Label>
              <Form.Control type="number" min={1} value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:+e.target.value}))} /></Form.Group></Col>
            <Col><Form.Group className="mb-2"><Form.Label>Coût/h (€)</Form.Label>
              <Form.Control type="number" min={0} value={form.cost_per_hour} onChange={e=>setForm(f=>({...f,cost_per_hour:+e.target.value}))} /></Form.Group></Col>
          </Row>
          <Form.Group><Form.Label>Disponibilité (%)</Form.Label>
            <Form.Control type="number" min={0} max={100} value={form.availability} onChange={e=>setForm(f=>({...f,availability:+e.target.value}))} /></Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowForm(false)}>Annuler</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving?'…':'Enregistrer'}</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

// -- Onglet Données des tâches -------------------------------------------------
function TabTaches({ scenarioId, bpmnElements }) {
  const [tasks,     setTasks]     = useState([]);
  const [resources, setResources] = useState([]);
  const [editing,   setEditing]   = useState(null); // task_id being edited
  const [form,      setForm]      = useState({});
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');

  const load = async () => {
    const [t, r] = await Promise.all([
      fetch(`${API}/simulations/${scenarioId}/tasks`),
      fetch(`${API}/simulations/${scenarioId}/resources`),
    ]);
    if (t.ok) setTasks(await t.json());
    if (r.ok) setResources(await r.json());
  };
  useEffect(() => { load(); }, [scenarioId]);

  const taskElements = bpmnElements.filter(
    (e) => e.type?.endsWith('Task') || ['subProcess', 'callActivity', 'transaction', 'adHocSubProcess'].includes(e.type)
  );
  const getTaskData  = id => tasks.find(t => t.task_id === id);

  const openEdit = el => {
    const ex = getTaskData(el.id);
    setForm({ task_id:el.id, task_name:el.label||el.id,
      duration_min:ex?.duration_min??30, duration_type:ex?.duration_type??'fixed',
      duration_std:ex?.duration_std??0, resource_id:ex?.resource_id??'', cost:ex?.cost??0 });
    setEditing(el.id);
  };

  const save = async () => {
    setSaving(true); setMsg('');
    const res = await fetch(`${API}/simulations/${scenarioId}/tasks/${form.task_id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ ...form, resource_id: form.resource_id||null }),
    });
    if (res.ok) { await load(); setEditing(null); setMsg('? Enregistré'); setTimeout(()=>setMsg(''),2000); }
    setSaving(false);
  };

  const distLabel = t => ({ fixed:'Fixe', normal:'Normale', uniform:'Uniforme', exponential:'Exponentielle' }[t]||t);

  return (
    <div>
      {msg && <Alert variant="success" className="py-2">{msg}</Alert>}
      {taskElements.length === 0
        ? <div className="sim-empty"><i className="bi bi-diagram-3" /><p>Aucune tâche détectée.<br/>Sauvegardez d'abord votre diagramme BPMN.</p></div>
        : (
          <Table hover size="sm" className="sim-table">
            <thead><tr><th>Tâche</th><th>Durée (min)</th><th>Distribution</th><th>Ressource</th><th>Coût (€)</th><th /></tr></thead>
            <tbody>
              {taskElements.map(el => {
                const td     = getTaskData(el.id);
                const isEdit = editing === el.id;
                return (
                  <tr key={el.id} className={isEdit ? 'table-primary' : ''}>
                    <td>
                      <strong>{el.label || el.id}</strong>
                      <br /><span className="text-muted" style={{fontSize:10}}>{el.type}</span>
                    </td>
                    {isEdit ? (
                      <>
                        <td>
                          <div className="d-flex gap-1">
                            <Form.Control size="sm" type="number" min={0} value={form.duration_min} style={{width:70}}
                              onChange={e=>setForm(f=>({...f,duration_min:+e.target.value}))} />
                            {form.duration_type==='normal' && (
                              <Form.Control size="sm" type="number" min={0} value={form.duration_std} style={{width:60}}
                                placeholder="s" onChange={e=>setForm(f=>({...f,duration_std:+e.target.value}))} />
                            )}
                          </div>
                        </td>
                        <td>
                          <Form.Select size="sm" value={form.duration_type} style={{width:130}}
                            onChange={e=>setForm(f=>({...f,duration_type:e.target.value}))}>
                            <option value="fixed">Fixe</option>
                            <option value="normal">Normale</option>
                            <option value="uniform">Uniforme</option>
                            <option value="exponential">Exponentielle</option>
                          </Form.Select>
                        </td>
                        <td>
                          <Form.Select size="sm" value={form.resource_id||''} style={{width:130}}
                            onChange={e=>setForm(f=>({...f,resource_id:e.target.value||null}))}>
                            <option value="">— Aucune —</option>
                            {resources.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </Form.Select>
                        </td>
                        <td>
                          <Form.Control size="sm" type="number" min={0} value={form.cost} style={{width:70}}
                            onChange={e=>setForm(f=>({...f,cost:+e.target.value}))} />
                        </td>
                        <td className="text-end">
                          <Button size="sm" variant="success" onClick={save} disabled={saving} className="me-1">?</Button>
                          <Button size="sm" variant="secondary" onClick={()=>setEditing(null)}>?</Button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{td ? `${fmt(td.duration_min)} min` : <span className="text-muted">—</span>}</td>
                        <td>{td ? distLabel(td.duration_type) : <span className="text-muted">—</span>}</td>
                        <td>{td?.resource_name || <span className="text-muted">—</span>}</td>
                        <td>{td ? `${fmt(td.cost,2)} €` : <span className="text-muted">—</span>}</td>
                        <td className="text-end">
                          <Button variant="link" size="sm" className="p-0" onClick={()=>openEdit(el)}>??</Button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )
      }
    </div>
  );
}

// -- Onglet Probabilités enchainements -----------------------------------------
// FIX: useState inside .map() was forbidden — replaced with a controlled state object
function TabFlows({ scenarioId, bpmnElements, bpmnConnections }) {
  const [flows,   setFlows]   = useState([]);
  const [probs,   setProbs]   = useState({}); // { [flow_id]: probability }
  const [saving,  setSaving]  = useState({});
  const [msg,     setMsg]     = useState('');

  const load = async () => {
    const r = await fetch(`${API}/simulations/${scenarioId}/flows`);
    if (r.ok) {
      const data = await r.json();
      setFlows(data);
      // Initialize probs from saved data
      const p = {};
      data.forEach(f => { p[f.flow_id] = f.probability; });
      setProbs(p);
    }
  };
  useEffect(() => { load(); }, [scenarioId]);

  const gatewayIds    = bpmnElements.filter(e => e.type?.endsWith('Gateway')).map(e => e.id);
  const relevantFlows = bpmnConnections.filter(c => gatewayIds.includes(c.from));

  // Initialize any missing probs when relevantFlows changes
  useEffect(() => {
    setProbs(prev => {
      const next = { ...prev };
      relevantFlows.forEach(c => { if (!(c.id in next)) next[c.id] = 50; });
      return next;
    });
  }, [bpmnConnections.length]);

  const getElLabel = id => bpmnElements.find(e => e.id === id)?.label || id;

  const saveFlow = async (conn) => {
    const probability = probs[conn.id] ?? 50;
    setSaving(s => ({ ...s, [conn.id]: true }));
    await fetch(`${API}/simulations/${scenarioId}/flows/${conn.id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ flow_name:conn.label||'', from_element:conn.from, to_element:conn.to, probability }),
    });
    await load();
    setSaving(s => ({ ...s, [conn.id]: false }));
    setMsg('? Enregistré'); setTimeout(()=>setMsg(''), 2000);
  };

  return (
    <div>
      {msg && <Alert variant="success" className="py-2">{msg}</Alert>}
      <div className="sim-info-box mb-3">
        <i className="bi bi-info-circle me-2" />
        Définissez la probabilité (%) de chaque sortie des passerelles exclusives. La somme doit être égale à 100%.
      </div>
      {relevantFlows.length === 0
        ? <div className="sim-empty"><i className="bi bi-diagram-2" /><p>Aucune passerelle détectée.<br/>Ajoutez des gateways dans votre diagramme BPMN.</p></div>
        : (
          <Table hover size="sm" className="sim-table">
            <thead><tr><th>De (gateway)</th><th>Vers</th><th>Libellé</th><th style={{width:200}}>Probabilité (%)</th></tr></thead>
            <tbody>
              {relevantFlows.map(conn => (
                <tr key={conn.id}>
                  <td><Badge bg="warning" text="dark">{getElLabel(conn.from)}</Badge></td>
                  <td>{getElLabel(conn.to)}</td>
                  <td className="text-muted">{conn.label || '—'}</td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Control type="number" size="sm" min={0} max={100}
                        value={probs[conn.id] ?? 50} style={{width:70}}
                        onChange={e => setProbs(p => ({ ...p, [conn.id]: +e.target.value }))} />
                      <ProgressBar now={probs[conn.id] ?? 50} style={{flex:1, height:6}} />
                      <Button size="sm" variant="outline-primary" disabled={saving[conn.id]}
                        onClick={() => saveFlow(conn)}>
                        {saving[conn.id] ? '…' : '?'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      }
    </div>
  );
}

// -- Onglet Résultats ----------------------------------------------------------
function TabResultats({ scenario, onRun }) {
  const [running, setRunning] = useState(false);
  const [err,     setErr]     = useState('');
  const results = scenario.results;
  const effectiveStatus = running ? 'running' : (scenario.status || results?.status || 'draft');
  const lastError = err || scenario.last_error;

  const run = async () => {
    setRunning(true); setErr('');
    onRun({ type:'status', status:'running', last_error:null });
    try {
      const res  = await fetch(`${API}/simulations/${scenario.id}/run`, { method:'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onRun({
        type:'completed',
        status:data.status || 'completed',
        scenario:data.scenario,
        results:data.results,
        last_error:null,
      });
    } catch (e) {
      const message = e.message || 'Simulation failed.';
      setErr(message);
      onRun({ type:'failed', status:'failed', last_error:message });
    }
    setRunning(false);
  };

  return (
    <div>
      <div className="d-flex justify-content-end mb-3">
        <Button variant="success" onClick={run} disabled={running}>
          {running
            ? <><span className="spinner-border spinner-border-sm me-2"/>Simulation en cours…</>
            : <><i className="bi bi-play-fill me-2"/>Simuler</>}
        </Button>
      </div>
      {err && <Alert variant="danger">{err}</Alert>}
      {!results
        ? <div className="sim-empty"><i className="bi bi-bar-chart"/><p>Aucun résultat.<br/>Cliquez sur <strong>Simuler</strong> pour lancer.</p></div>
        : (
          <>
            <div className="sim-results-header">
              Simulation du {new Date(results.simulated_at).toLocaleString('fr-FR')}
              &nbsp;·&nbsp;{results.instances} instances &nbsp;·&nbsp;{results.active_instances} actives
            </div>
            <Row className="g-3 mb-4">
              {[
                { label:'Durée moyenne', value:`${fmt(results.avg_duration_min)} min`, color:'primary' },
                { label:'Min',           value:`${fmt(results.min_duration_min)} min`, color:'success' },
                { label:'Max',           value:`${fmt(results.max_duration_min)} min`, color:'danger'  },
                { label:'P95',           value:`${fmt(results.p95_duration_min)} min`, color:'warning' },
                { label:'P99',           value:`${fmt(results.p99_duration_min)} min`, color:'secondary'},
                { label:'Coût total',    value:`${fmt(results.total_cost,2)} €`,       color:'info'    },
              ].map(k => (
                <Col xs={6} md={4} lg={2} key={k.label}>
                  <Card className={`border-0 sim-kpi-card border-${k.color}`}>
                    <Card.Body className="py-2 px-3 text-center">
                      <div className={`sim-kpi-value text-${k.color}`}>{k.value}</div>
                      <div className="sim-kpi-label">{k.label}</div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
            {results.histogram?.length > 0 && (
              <Card className="border-0 shadow-sm mb-4">
                <Card.Header className="bg-white"><strong>Distribution des durées (min)</strong></Card.Header>
                <Card.Body><Histogram data={results.histogram} /></Card.Body>
              </Card>
            )}
            {results.task_results?.length > 0 && (
              <Card className="border-0 shadow-sm">
                <Card.Header className="bg-white"><strong>Résultats par tâche</strong></Card.Header>
                <Card.Body className="p-0">
                  <Table hover size="sm" className="sim-table mb-0">
                    <thead><tr><th>Tâche</th><th>Moy.</th><th>Min</th><th>Max</th><th>P95</th><th>Ressource</th><th>Coût (€)</th></tr></thead>
                    <tbody>
                      {results.task_results.map(t => (
                        <tr key={t.task_id}>
                          <td><strong>{t.task_name||t.task_id}</strong></td>
                          <td>{fmt(t.avg_duration)} min</td>
                          <td>{fmt(t.min_duration)}</td>
                          <td>{fmt(t.max_duration)}</td>
                          <td>{fmt(t.p95_duration)}</td>
                          <td>{t.resource_name||<span className="text-muted">—</span>}</td>
                          <td>{fmt(t.total_cost,2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            )}
          </>
        )
      }
    </div>
  );
}

// -- Page principale -----------------------------------------------------------
function SimulationArrivalTimesCard({ scenarioId, enabled, onImported, onCleared }) {
  const [arrivals, setArrivals] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const unavailableMessage = "L'import CSV n'est pas encore disponible sur le backend actif. Redemarrez le serveur backend pour charger cette fonctionnalite.";

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times`);
      const payload = await readApiPayload(response);
      if (response.status === 404) {
        setArrivals([]);
        setErr(unavailableMessage);
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Impossible de charger les arrivees importees.');
      }
      setArrivals(Array.isArray(payload.arrivals) ? payload.arrivals : []);
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioId]);

  const importCsv = async () => {
    if (!file) {
      setErr('Choisissez un fichier CSV.');
      return;
    }

    setUploading(true);
    setErr('');
    setMsg('');

    try {
      const csvText = await file.text();
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, fileName: file.name }),
      });
      const payload = await readApiPayload(response);
      if (response.status === 404) {
        throw new Error(unavailableMessage);
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Import CSV impossible.');
      }
      setArrivals(Array.isArray(payload.arrivals) ? payload.arrivals : []);
      setFile(null);
      setMsg(`${payload.count} arrivee(s) importee(s).`);
      onImported?.(payload);
    } catch (error) {
      setErr(error.message);
    } finally {
      setUploading(false);
    }
  };

  const clearImport = async () => {
    setErr('');
    setMsg('');
    try {
      const response = await fetch(`${API}/simulations/${scenarioId}/arrival-times`, { method:'DELETE' });
      const payload = await readApiPayload(response);
      if (response.status === 404) {
        throw new Error(unavailableMessage);
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Suppression impossible.');
      }
      setArrivals([]);
      setMsg('Import CSV vide.');
      onCleared?.();
    } catch (error) {
      setErr(error.message);
    }
  };

  return (
    <div className="sim-section">
      <div className="sim-section-title">Arrivees exactes (CSV)</div>
      <div className="sim-info-box mb-3">
        <i className="bi bi-upload me-2" />
        Importez un CSV contenant une colonne d arrivee. Valeurs supportees: minutes, heure HH:MM, ou date ISO.
      </div>
      {!enabled && (
        <Alert variant="secondary" className="mb-3">
          Activez l option d import CSV et enregistrez le scenario avant de charger un fichier.
        </Alert>
      )}
      {err && <Alert variant="danger">{err}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}
      <Row className="g-3 align-items-end">
        <Col md={8}>
          <Form.Group>
            <Form.Label>Fichier CSV</Form.Label>
            <Form.Control
              type="file"
              accept=".csv,text/csv"
              disabled={!enabled || uploading}
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <div className="d-flex gap-2">
            <Button disabled={!enabled || !file || uploading} onClick={importCsv}>
              {uploading ? 'Import...' : 'Importer'}
            </Button>
            <Button variant="outline-secondary" disabled={!arrivals.length} onClick={clearImport}>
              Vider
            </Button>
          </div>
        </Col>
      </Row>
      <div className="sim-arrivals-summary mt-3">
        <div><strong>{arrivals.length}</strong> arrivee(s) chargee(s)</div>
        <div>
          {loading
            ? 'Chargement...'
            : arrivals.length
              ? `Premiere arrivee a ${fmt(arrivals[0].arrival_offset_min, 2)} min`
              : 'Aucune arrivee importee'}
        </div>
      </div>
      {arrivals.length > 0 && (
        <Table hover size="sm" className="sim-table mt-3 mb-0">
          <thead>
            <tr><th>#</th><th>Valeur source</th><th>Offset (min)</th></tr>
          </thead>
          <tbody>
            {arrivals.slice(0, 8).map(arrival => (
              <tr key={arrival.id || arrival.arrival_order}>
                <td>{arrival.arrival_order}</td>
                <td>{arrival.raw_value}</td>
                <td>{fmt(arrival.arrival_offset_min, 2)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ScenarioComparisonPanel({ scenario, scenarios, compareScenarioId, onCompareScenarioIdChange, compareData, onLoadCompare, compareLoading }) {
  const compareCandidates = scenarios.filter((entry) => entry.id !== scenario.id && entry.results);

  return (
    <Card className="border-0 shadow-sm mb-4">
      <Card.Header className="bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <strong>Scenario comparison</strong>
          <div className="text-muted small">Compare duration, cost, utilisation, and bottlenecks against another completed scenario.</div>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <Form.Select
            size="sm"
            style={{ minWidth: 240 }}
            value={compareScenarioId}
            onChange={(event) => onCompareScenarioIdChange(event.target.value)}
          >
            <option value="">Choose a scenario</option>
            {compareCandidates.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </Form.Select>
          <Button size="sm" variant="outline-dark" onClick={onLoadCompare} disabled={!compareScenarioId || compareLoading}>
            {compareLoading ? 'Comparing...' : 'Compare'}
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {!compareData ? (
          <div className="text-muted small">Select another simulated scenario to view deltas.</div>
        ) : (
          <>
            {!compareData.same_process && (
              <Alert variant="warning" className="mb-3">
                The selected scenarios are linked to different processes. The KPI comparison still works, but task deltas may be less comparable.
              </Alert>
            )}

            <Row className="g-3 mb-4">
              {compareData.summary.map((metric) => (
                <Col md={6} xl={4} key={metric.key}>
                  <Card className="border-0 bg-light h-100">
                    <Card.Body>
                      <div className="sim-kpi-label mb-2">{metric.label}</div>
                      <div className="d-flex justify-content-between gap-3">
                        <div>
                          <div className="fw-semibold">{compareData.primary.name}</div>
                          <div>{fmt(metric.primary, metric.unit === 'EUR' ? 2 : 1)} {metric.unit}</div>
                        </div>
                        <div>
                          <div className="fw-semibold">{compareData.secondary.name}</div>
                          <div>{fmt(metric.secondary, metric.unit === 'EUR' ? 2 : 1)} {metric.unit}</div>
                        </div>
                      </div>
                      <div className={`mt-2 fw-semibold ${metric.delta > 0 ? 'text-danger' : metric.delta < 0 ? 'text-success' : 'text-muted'}`}>
                        Delta: {metric.delta > 0 ? '+' : ''}{fmt(metric.delta, metric.unit === 'EUR' ? 2 : 1)} {metric.unit}
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>

            {compareData.resource_comparison?.length > 0 && (
              <div className="mb-4">
                <div className="fw-semibold mb-2">Resource utilisation deltas</div>
                <Table hover size="sm" className="sim-table mb-0">
                  <thead>
                    <tr>
                      <th>Resource</th>
                      <th>{compareData.primary.name}</th>
                      <th>{compareData.secondary.name}</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.resource_comparison.slice(0, 8).map((resource) => (
                      <tr key={resource.resource_name}>
                        <td><strong>{resource.resource_name}</strong></td>
                        <td>{fmt(resource.primary_utilization)}%</td>
                        <td>{fmt(resource.secondary_utilization)}%</td>
                        <td className={resource.utilization_delta > 0 ? 'text-danger fw-semibold' : resource.utilization_delta < 0 ? 'text-success fw-semibold' : 'text-muted'}>
                          {resource.utilization_delta > 0 ? '+' : ''}{fmt(resource.utilization_delta)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            <Row className="g-3 mb-4">
              <Col lg={6}>
                <div className="fw-semibold mb-2">Bottlenecks: {compareData.primary.name}</div>
                <div className="sim-bottlenecks">
                  {(compareData.bottlenecks.primary || []).slice(0, 3).map((item, index) => (
                    <Card key={`primary-${index}`} className={`border-0 shadow-sm sim-bottleneck-card severity-${item.severity}`}>
                      <Card.Body>
                        <div className="fw-semibold">{item.name}</div>
                        <div className="text-muted small">{item.details}</div>
                        <div className="sim-bottleneck-metric">{fmt(item.metric)} {item.unit}</div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              </Col>
              <Col lg={6}>
                <div className="fw-semibold mb-2">Bottlenecks: {compareData.secondary.name}</div>
                <div className="sim-bottlenecks">
                  {(compareData.bottlenecks.secondary || []).slice(0, 3).map((item, index) => (
                    <Card key={`secondary-${index}`} className={`border-0 shadow-sm sim-bottleneck-card severity-${item.severity}`}>
                      <Card.Body>
                        <div className="fw-semibold">{item.name}</div>
                        <div className="text-muted small">{item.details}</div>
                        <div className="sim-bottleneck-metric">{fmt(item.metric)} {item.unit}</div>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              </Col>
            </Row>

            {compareData.task_comparison?.length > 0 && (
              <div>
                <div className="fw-semibold mb-2">Task deltas</div>
                <Table hover size="sm" className="sim-table mb-0">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>{compareData.primary.name}</th>
                      <th>{compareData.secondary.name}</th>
                      <th>Duration delta</th>
                      <th>Wait delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareData.task_comparison.map((task) => (
                      <tr key={task.task_id}>
                        <td><strong>{task.task_name}</strong></td>
                        <td>{fmt(task.primary_duration)} min</td>
                        <td>{fmt(task.secondary_duration)} min</td>
                        <td className={task.duration_delta > 0 ? 'text-danger fw-semibold' : task.duration_delta < 0 ? 'text-success fw-semibold' : 'text-muted'}>
                          {task.duration_delta > 0 ? '+' : ''}{fmt(task.duration_delta)} min
                        </td>
                        <td className={task.wait_delta > 0 ? 'text-danger fw-semibold' : task.wait_delta < 0 ? 'text-success fw-semibold' : 'text-muted'}>
                          {task.wait_delta > 0 ? '+' : ''}{fmt(task.wait_delta)} min
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
}

function SimulationResultsPanel({ scenario, scenarios, onRun }) {
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [compareScenarioId, setCompareScenarioId] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [err, setErr] = useState('');
  const results = scenario.results;
  const effectiveStatus = running ? 'running' : (scenario.status || results?.status || 'draft');
  const lastError = err || scenario.last_error;

  useEffect(() => {
    setCompareScenarioId('');
    setCompareData(null);
  }, [scenario.id]);

  const run = async () => {
    setRunning(true);
    setErr('');
    onRun?.({ type:'status', status:'running', last_error:null });

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/run`, { method:'POST' });
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Simulation failed.');
      }
      onRun?.({
        type:'completed',
        status:payload.status || 'completed',
        scenario:payload.scenario,
        results:payload.results,
        last_error:null,
      });
    } catch (error) {
      const message = error.message || 'Simulation failed.';
      setErr(message);
      onRun?.({ type:'failed', status:'failed', last_error:message });
    } finally {
      setRunning(false);
    }
  };

  const exportResults = async () => {
    setExporting(true);
    setErr('');

    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/export`);
      if (!response.ok) {
        const payload = await readApiPayload(response);
        throw new Error(payload.error || 'Export impossible.');
      }

      const csvText = await response.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

      link.href = url;
      link.download = filenameMatch?.[1] || `simulation-${scenario.id}-results.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErr(error.message || 'Export impossible.');
    } finally {
      setExporting(false);
    }
  };

  const loadComparison = async () => {
    if (!compareScenarioId) {
      return;
    }

    setCompareLoading(true);
    setErr('');
    try {
      const response = await fetch(`${API}/simulations/${scenario.id}/compare/${compareScenarioId}`);
      const payload = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(payload.error || 'Comparison failed.');
      }
      setCompareData(payload);
    } catch (error) {
      setErr(error.message || 'Comparison failed.');
    } finally {
      setCompareLoading(false);
    }
  };

  return (
    <div>
      <div className="d-flex justify-content-end gap-2 mb-3">
        <Button variant="outline-secondary" onClick={exportResults} disabled={!results || exporting}>
          {exporting ? 'Export...' : 'Exporter CSV'}
        </Button>
        <Button variant="success" onClick={run} disabled={running}>
          {running
            ? <><span className="spinner-border spinner-border-sm me-2" />Simulation en cours...</>
            : <><i className="bi bi-play-fill me-2" />Simuler</>}
        </Button>
      </div>

      <div className="sim-results-header">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <Badge bg={statusVariant(effectiveStatus)}>{statusLabel(effectiveStatus)}</Badge>
            {results?.simulated_at && <span>Simulation du {new Date(results.simulated_at).toLocaleString('fr-FR')}</span>}
          </div>
          <div className="d-flex flex-wrap gap-3">
            {scenario.last_run_started_at && <span>Demarrage: {new Date(scenario.last_run_started_at).toLocaleString('fr-FR')}</span>}
            {scenario.last_run_finished_at && <span>Fin: {new Date(scenario.last_run_finished_at).toLocaleString('fr-FR')}</span>}
          </div>
        </div>
      </div>

      {effectiveStatus === 'running' && (
        <div className="sim-inline-progress mb-3">
          <span className="spinner-border spinner-border-sm text-warning" />
          <div>
            <strong>Simulation en cours</strong>
            <div className="text-muted small">Le statut bascule automatiquement vers Completed ou Failed une fois le run termine.</div>
          </div>
        </div>
      )}

      {lastError && <Alert variant="danger">{lastError}</Alert>}

      {!results ? (
        <div className="sim-empty">
          <i className="bi bi-bar-chart" />
          <p>Aucun resultat.<br />Cliquez sur <strong>Simuler</strong> pour lancer.</p>
        </div>
      ) : (
        <>
          <Row className="g-3 mb-4">
            {[
              { label:'Duree moyenne', value:`${fmt(results.avg_duration_min)} min`, color:'primary' },
              { label:'P95', value:`${fmt(results.p95_duration_min)} min`, color:'warning' },
              { label:'P99', value:`${fmt(results.p99_duration_min)} min`, color:'secondary' },
              { label:'Cout total', value:`${fmt(results.total_cost, 2)} EUR`, color:'info' },
              { label:'Cout / instance', value:`${fmt(results.avg_cost_per_instance, 2)} EUR`, color:'dark' },
              { label:'Horizon', value:`${fmt(results.simulation_horizon_min)} min`, color:'success' },
              { label:'Instances actives', value:results.active_instances ?? 0, color:'primary' },
              { label:'Source arrivees', value:results.arrival_source === 'csv' ? 'CSV' : 'Generees', color:'danger' },
            ].map(kpi => (
              <Col xs={6} md={4} lg={3} xl={2} key={kpi.label}>
                <Card className={`border-0 sim-kpi-card border-${kpi.color}`}>
                  <Card.Body className="py-2 px-3 text-center">
                    <div className={`sim-kpi-value text-${kpi.color}`}>{kpi.value}</div>
                    <div className="sim-kpi-label">{kpi.label}</div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {scenario.bpmn_xml && results?.task_results?.length > 0 && (
            <Card className="border-0 shadow-sm mb-4">
              <Card.Body>
                <BpmnHeatmapViewer bpmnXml={scenario.bpmn_xml} results={results} />
              </Card.Body>
            </Card>
          )}

          <ScenarioComparisonPanel
            scenario={scenario}
            scenarios={scenarios}
            compareScenarioId={compareScenarioId}
            onCompareScenarioIdChange={setCompareScenarioId}
            compareData={compareData}
            onLoadCompare={loadComparison}
            compareLoading={compareLoading}
          />

          {results.histogram?.length > 0 && (
            <Card className="border-0 shadow-sm mb-4">
              <Card.Header className="bg-white"><strong>Cycle times</strong></Card.Header>
              <Card.Body><Histogram data={results.histogram} /></Card.Body>
            </Card>
          )}

          {results.resource_results?.length > 0 && (
            <Card className="border-0 shadow-sm mb-4">
              <Card.Header className="bg-white d-flex justify-content-between align-items-center">
                <strong>Taux d utilisation des ressources</strong>
                <span className="text-muted small">{results.resource_results.length} ressource(s)</span>
              </Card.Header>
              <Card.Body className="p-0">
                <Table hover size="sm" className="sim-table mb-0">
                  <thead>
                    <tr>
                      <th>Ressource</th>
                      <th>Capacite</th>
                      <th>Disponibilite</th>
                      <th>Taches traitees</th>
                      <th>Temps occupe</th>
                      <th>Attente moy.</th>
                      <th style={{ width: 220 }}>Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.resource_results.map(resource => (
                      <tr key={resource.resource_id}>
                        <td><strong>{resource.resource_name}</strong></td>
                        <td>{resource.quantity}</td>
                        <td>{fmt(resource.availability, 0)}%</td>
                        <td>{resource.tasks_handled}</td>
                        <td>{fmt(resource.total_busy_min)} min</td>
                        <td>{fmt(resource.avg_wait_min)} min</td>
                        <td>
                          <div className="sim-resource-util">
                            <ProgressBar
                              now={resource.utilization_rate}
                              variant={resource.utilization_rate >= 90 ? 'danger' : resource.utilization_rate >= 75 ? 'warning' : 'success'}
                            />
                            <span>{fmt(resource.utilization_rate)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}

          {results.bottlenecks?.length > 0 && (
            <div className="sim-bottlenecks mb-4">
              {results.bottlenecks.map((bottleneck, index) => (
                <Card key={`${bottleneck.type}-${bottleneck.name}-${index}`} className={`border-0 shadow-sm sim-bottleneck-card severity-${bottleneck.severity}`}>
                  <Card.Body>
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <div>
                        <div className="sim-kpi-label">{bottleneck.type === 'resource' ? 'Ressource' : 'Tache'}</div>
                        <h6 className="mb-0">{bottleneck.name}</h6>
                      </div>
                      <Badge className={`badge-risk-${bottleneck.severity || 'low'}`}>
                        {bottleneck.severity}
                      </Badge>
                    </div>
                    <div className="sim-bottleneck-metric">{fmt(bottleneck.metric)} {bottleneck.unit}</div>
                    <div className="text-muted small">{bottleneck.details}</div>
                  </Card.Body>
                </Card>
              ))}
            </div>
          )}

          {results.task_results?.length > 0 && (
            <Card className="border-0 shadow-sm">
              <Card.Header className="bg-white"><strong>Resultats par tache</strong></Card.Header>
              <Card.Body className="p-0">
                <Table hover size="sm" className="sim-table mb-0">
                  <thead>
                    <tr>
                      <th>Tache</th>
                      <th>Moy.</th>
                      <th>Min</th>
                      <th>Max</th>
                      <th>P95</th>
                      <th>Attente moy.</th>
                      <th>Executions</th>
                      <th>Ressource</th>
                      <th>Cout (EUR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.task_results.map(task => (
                      <tr key={task.task_id}>
                        <td><strong>{task.task_name || task.task_id}</strong></td>
                        <td>{fmt(task.avg_duration)} min</td>
                        <td>{fmt(task.min_duration)}</td>
                        <td>{fmt(task.max_duration)}</td>
                        <td>{fmt(task.p95_duration)}</td>
                        <td>{fmt(task.avg_wait_min)} min</td>
                        <td>{task.executions ?? '-'}</td>
                        <td>{task.resource_name || <span className="text-muted">-</span>}</td>
                        <td>{fmt(task.total_cost, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function SimulationScenarios() {
  const { confirmAction } = useSnackbar();
  const [scenarios,       setScenarios]       = useState([]);
  const [processes,       setProcesses]       = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [showCreate,      setShowCreate]      = useState(false);
  const [activeScenario,  setActiveScenario]  = useState(null);
  const [activeTab,       setActiveTab]       = useState('caracteristiques');
  const [toast,           setToast]           = useState({ text:'', type:'success' });

  const showToast = (text, type='success') => {
    setToast({ text, type });
    setTimeout(() => setToast({ text:'', type:'success' }), 4000);
  };

  const loadScenarios = async () => {
    setLoading(true);
    const r = await fetch(`${API}/simulations`);
    if (r.ok) setScenarios(await r.json());
    setLoading(false);
  };
  const loadProcesses = async () => {
    const r = await fetch(`${API}/processes`);
    if (r.ok) setProcesses(await r.json());
  };

  useEffect(() => { loadScenarios(); loadProcesses(); }, []);

  const openScenario = async id => {
    const r = await fetch(`${API}/simulations/${id}`);
    if (r.ok) { setActiveScenario(await r.json()); setActiveTab('caracteristiques'); }
  };

  const deleteScenario = async id => {
    const confirmed = await confirmAction({
      title: 'Supprimer le scénario',
      message: 'Supprimer ce scénario ?',
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
      cancelLabel: 'Annuler',
    });
    if (!confirmed) return;
    const r = await fetch(`${API}/simulations/${id}`, { method:'DELETE' });
    if (r.ok) {
      showToast('Scénario supprimé');
      if (activeScenario?.id === id) setActiveScenario(null);
      loadScenarios();
    }
  };

  // Parse BPMN XML to extract tasks and gateways
  const bpmnParsed = (() => {
    const linked = processes.find(p => p.id === activeScenario?.process_id);
    const src = activeScenario?.bpmn_xml || linked?.bpmn_xml;
    if (!src) return { elements:[], connections:[] };
    
    try {
      // Try JSON first (legacy format)
      const d = JSON.parse(src);
      return { elements: d.elements||[], connections: d.connections||[] };
    } catch {
      // Parse BPMN XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(src, 'text/xml');
      
      // Helper to get element name
      const getName = (el) => {
        const nameAttr = el.getAttribute('name');
        return nameAttr || el.id || el.getAttribute('id');
      };
      
      // Extract elements (tasks, events, gateways, sub-processes)
      const elements = [];
      const bpmnElements = xmlDoc.querySelectorAll('[id]');
      bpmnElements.forEach(el => {
        const tagName = el.tagName.toLowerCase();
        const id = el.getAttribute('id');
        const name = getName(el);
        
        if (tagName.includes('task')) {
          elements.push({ id, label: name, type: tagName.includes('user') ? 'userTask' : 
                                          tagName.includes('service') ? 'serviceTask' :
                                          tagName.includes('script') ? 'scriptTask' :
                                          tagName.includes('manual') ? 'manualTask' :
                                          tagName.includes('send') ? 'sendTask' :
                                          tagName.includes('receive') ? 'receiveTask' :
                                          tagName.includes('business') ? 'businessRuleTask' : 'task' });
        } else if (tagName.includes('event')) {
          elements.push({ id, label: name, type: tagName.includes('start') ? 'startEvent' :
                                          tagName.includes('end') ? 'endEvent' : 'intermediateEvent' });
        } else if (tagName.includes('gateway')) {
          elements.push({ id, label: name, type: tagName.includes('exclusive') ? 'exclusiveGateway' :
                                          tagName.includes('parallel') ? 'parallelGateway' :
                                          tagName.includes('inclusive') ? 'inclusiveGateway' : 'gateway' });
        } else if (tagName.includes('callactivity')) {
          elements.push({ id, label: name, type: 'callActivity' });
        } else if (tagName.includes('transaction')) {
          elements.push({ id, label: name, type: 'transaction' });
        } else if (tagName.includes('adhocsubprocess')) {
          elements.push({ id, label: name, type: 'adHocSubProcess' });
        } else if (tagName.includes('subprocess') || tagName.includes('sub-process')) {
          elements.push({ id, label: name, type: 'subProcess' });
        }
      });
      
      // Extract connections (sequence flows)
      const connections = [];
      const flows = xmlDoc.querySelectorAll('sequenceFlow');
      flows.forEach(flow => {
        const id = flow.getAttribute('id');
        const source = flow.getAttribute('sourceRef');
        const target = flow.getAttribute('targetRef');
        const name = getName(flow);
        if (source && target) {
          connections.push({ id, from: source, to: target, label: name });
        }
      });
      
      return { elements, connections };
    }
  })();

  // -- Liste --
  if (!activeScenario) {
    return (
      <Container fluid className="py-4">
        <Row className="mb-3">
          <Col>
            <div className="d-flex justify-content-between align-items-center">
              <h4 className="mb-0 fw-bold">
                <i className="bi bi-clock-history me-2 text-primary"/>Scénarios de simulation
              </h4>
              <Button variant="primary" onClick={() => setShowCreate(true)}>
                <i className="bi bi-plus-lg me-1"/>Nouveau scénario
              </Button>
            </div>
          </Col>
        </Row>

        {toast.text && (
          <Row className="mb-3"><Col>
            <Alert variant={toast.type} dismissible onClose={()=>setToast({text:'',type:'success'})}>
              {toast.text}
            </Alert>
          </Col></Row>
        )}

        {loading
          ? <div className="text-center py-5"><div className="spinner-border text-primary"/></div>
          : scenarios.length === 0
            ? (
              <Card className="border-0 shadow-sm">
                <Card.Body className="text-center py-5 text-muted">
                  <i className="bi bi-clock-history display-4 d-block mb-3 opacity-25"/>
                  <p className="mb-0">Aucun scénario de simulation.</p>
                  <Button variant="primary" className="mt-3" onClick={()=>setShowCreate(true)}>
                    <i className="bi bi-plus-lg me-1"/>Créer le premier scénario
                  </Button>
                </Card.Body>
              </Card>
            )
            : (
              <Row className="g-3">
                {scenarios.map(s => (
                  <Col md={6} lg={4} key={s.id}>
                    <Card className="border-0 shadow-sm h-100 sim-card" onClick={() => openScenario(s.id)}>
                      <Card.Body>
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <h6 className="mb-0 fw-bold">{s.name}</h6>
                          <Badge bg={statusVariant(s.status)}>{statusLabel(s.status)}</Badge>
                        </div>
                        {s.description && <p className="text-muted small mb-2">{s.description}</p>}
                        <div className="d-flex gap-3 text-muted" style={{fontSize:12}}>
                          <span><i className="bi bi-diagram-3 me-1"/>{s.process_name||'—'}</span>
                          <span><i className="bi bi-hash me-1"/>{s.process_instances} instances</span>
                        </div>
                        {s.status === 'failed' && s.last_error && (
                          <div className="text-danger small mt-2">{s.last_error}</div>
                        )}
                        {s.results && (
                          <div className="mt-2 pt-2 border-top d-flex gap-3" style={{fontSize:12}}>
                            <span className="text-primary fw-bold">
                              <i className="bi bi-stopwatch me-1"/>{fmt(s.results.avg_duration_min)} min moy.
                            </span>
                            <span className="text-success">
                              <i className="bi bi-currency-euro me-1"/>{fmt(s.results.total_cost,2)} €
                            </span>
                          </div>
                        )}
                      </Card.Body>
                      <Card.Footer className="bg-transparent border-0 pt-0">
                        <div className="d-flex justify-content-between align-items-center">
                          <span className="text-muted" style={{fontSize:11}}>
                            {new Date(s.updated_at).toLocaleDateString('fr-FR')}
                          </span>
                          <button className="btn btn-link btn-sm text-danger p-0"
                            onClick={e=>{e.stopPropagation(); deleteScenario(s.id);}}>
                            <i className="bi bi-trash"/>
                          </button>
                        </div>
                      </Card.Footer>
                    </Card>
                  </Col>
                ))}
              </Row>
            )
        }

        <ScenarioModal show={showCreate} onHide={()=>setShowCreate(false)}
          processes={processes}
          onCreated={sc => { loadScenarios(); setShowCreate(false); openScenario(sc.id); }} />
      </Container>
    );
  }

  // -- Détail scénario --
  return (
    <Container fluid className="py-4">
      <Row className="mb-3">
        <Col>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-link p-0 text-muted" onClick={()=>setActiveScenario(null)}>
              <i className="bi bi-arrow-left me-1"/>Scénarios
            </button>
            <span className="text-muted">/</span>
            <span className="fw-bold">{activeScenario.name}</span>
            <Badge bg={statusVariant(activeScenario.status)} className="ms-1">
              {statusLabel(activeScenario.status)}
            </Badge>
          </div>
        </Col>
      </Row>

      <Card className="border-0 shadow-sm">
        <div className="sim-tabs-header">
          {[
            ['caracteristiques', 'Caractéristiques'],
            ['ressources',       'Ressources'],
            ['taches',           'Données des tâches'],
            ['flows',            'Probabilités enchainements'],
            ['resultats',        'Résultats'],
          ].map(([key, label]) => (
            <button key={key}
              className={`sim-tab${activeTab===key?' active':''}`}
              onClick={()=>setActiveTab(key)}>
              {label}
            </button>
          ))}
        </div>

        <Card.Body className="p-4">
          {activeTab==='caracteristiques' && (
            <TabCaracteristiques scenario={activeScenario} processes={processes}
              onSaved={updated=>setActiveScenario(prev=>({...prev,...updated}))} />
          )}
          {activeTab==='ressources' && <TabRessources scenarioId={activeScenario.id} />}
          {activeTab==='taches' && (
            <TabTaches scenarioId={activeScenario.id} bpmnElements={bpmnParsed.elements} />
          )}
          {activeTab==='flows' && (
            <TabFlows scenarioId={activeScenario.id}
              bpmnElements={bpmnParsed.elements}
              bpmnConnections={bpmnParsed.connections} />
          )}
          {activeTab==='resultats' && (
            <SimulationResultsPanel scenario={activeScenario} scenarios={scenarios}
              onRun={payload => {
                setActiveScenario(prev => {
                  if (!prev) return prev;
                  if (payload.type === 'status') {
                    return { ...prev, status: payload.status, last_error: payload.last_error ?? null };
                  }
                  if (payload.type === 'failed') {
                    return { ...prev, status: 'failed', last_error: payload.last_error || 'Simulation failed.' };
                  }
                  if (payload.type === 'completed') {
                    return {
                      ...prev,
                      ...(payload.scenario || {}),
                      status: payload.status || payload.scenario?.status || 'completed',
                      results: payload.results,
                      last_error: null,
                    };
                  }
                  return prev;
                });
                if (payload.type === 'completed') {
                  loadScenarios();
                  showToast('Simulation terminee !');
                  return;
                }
                if (payload.type === 'failed') {
                  loadScenarios();
                  showToast('La simulation a echoue.', 'danger');
                  return;
                }
                if (payload.type === 'status') {
                  return;
                }
                showToast('Simulation terminée !');
              }} />
          )}
        </Card.Body>
      </Card>
    </Container>
  );
}
