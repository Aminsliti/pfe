import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  Container, Row, Col, Card, Button, Modal,
  Form, Alert, Badge, InputGroup, FormControl,
} from 'react-bootstrap';
import BpmnEditor from '../components/BpmnEditor/BpmnEditor';

const API = 'http://localhost:3001/api';

export function ProcessManagement() {
  const { hasPermission } = useAuth();

  const [processes,      setProcesses]      = useState([]);
  const [categories,     setCategories]     = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [showModal,      setShowModal]      = useState(false);
  const [showImport,     setShowImport]     = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [searchTerm,     setSearchTerm]     = useState('');
  const [filterCat,      setFilterCat]      = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [message,        setMessage]        = useState({ text: '', type: 'success' });
  const [viewMode,       setViewMode]       = useState('hierarchy');
  const [bpmnTarget,     setBpmnTarget]     = useState(null);

  const [formData, setFormData] = useState({
    name: '', description: '', bpmn_xml: '', category_id: '', status: 'draft',
  });

  const canManage = hasPermission('manage_processes');

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: 'success' }), 4000);
  };

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadProcesses = async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm)   params.append('search',   searchTerm);
      if (filterCat)    params.append('category', filterCat);
      if (filterStatus) params.append('status',   filterStatus);
      const res = await fetch(`${API}/processes?${params}`);
      if (res.ok) setProcesses(await res.json());
      else showMsg('Failed to load processes', 'danger');
    } catch {
      showMsg('Network error', 'danger');
    }
    setLoading(false);
  };

  const loadCategories = async () => {
    try {
      const res = await fetch(`${API}/process-categories`);
      if (res.ok) setCategories(await res.json());
    } catch { /**/ }
  };

  useEffect(() => {
    if (canManage) { loadProcesses(); loadCategories(); }
  }, [canManage, searchTerm, filterCat, filterStatus]);

  // ── BPMN editor ───────────────────────────────────────────────────────────
  const openBpmnEditor = (p) => setBpmnTarget(p);

  /**
   * Called by BpmnEditor when user clicks 💾 Save.
   * Sends the diagram JSON (elements + connections) as bpmn_xml to the server.
   */
  const handleBpmnSave = async (bpmnJson) => {
    if (!bpmnTarget) throw new Error('No process selected');

    const body = {
      name:               bpmnTarget.name,
      description:        bpmnTarget.description || '',
      status:             bpmnTarget.status,
      category_id:        bpmnTarget.category_id || null,
      bpmn_xml:           bpmnJson,          // ← diagram JSON stored here
      change_description: 'Updated via BPMN editor',
    };

    const res = await fetch(`${API}/processes/${bpmnTarget.id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }

    // Update bpmnTarget locally so re-opening the editor shows the latest data
    const updated = await res.json();
    setBpmnTarget(prev => ({ ...prev, bpmn_xml: bpmnJson, version: updated.version }));
    loadProcesses(); // refresh list in background
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const openCreate = (defaultCatId = '') => {
    setEditingProcess(null);
    setFormData({ name: '', description: '', bpmn_xml: '', category_id: defaultCatId, status: 'draft' });
    setMessage({ text: '', type: 'success' });
    setShowModal(true);
  };

  const openEditDetails = (p) => {
    setEditingProcess(p);
    setFormData({
      name: p.name, description: p.description || '',
      bpmn_xml: p.bpmn_xml || '', category_id: p.category_id || '', status: p.status,
    });
    setMessage({ text: '', type: 'success' });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this process?')) return;
    try {
      const res = await fetch(`${API}/processes/${id}`, { method: 'DELETE' });
      if (res.ok) { showMsg('Process deleted'); loadProcesses(); }
      else { const e = await res.json(); showMsg(e.error || 'Delete failed', 'danger'); }
    } catch { showMsg('Network error', 'danger'); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name) { showMsg('Process name is required', 'danger'); return; }
    try {
      const url    = editingProcess ? `${API}/processes/${editingProcess.id}` : `${API}/processes`;
      const method = editingProcess ? 'PUT' : 'POST';
      const res    = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData),
      });
      if (res.ok) {
        showMsg(`Process ${editingProcess ? 'updated' : 'created'}`);
        setShowModal(false);
        loadProcesses();
      } else {
        const err = await res.json();
        showMsg(err.error || 'Save failed', 'danger');
      }
    } catch { showMsg('Network error', 'danger'); }
  };

  const handleExport = async (id) => {
    try {
      const res = await fetch(`${API}/processes/${id}/export`);
      if (!res.ok) { showMsg('Export failed', 'danger'); return; }
      const blob  = await res.blob();
      const fname = res.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g,'') || 'process.bpmn';
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fname });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { showMsg('Network error', 'danger'); }
  };

  const statusVariant = s => ({ draft:'secondary', active:'success', archived:'warning' }[s] || 'secondary');

  // ── Hierarchy grouping ────────────────────────────────────────────────────
  const grouped      = categories.map(cat => ({ ...cat, procs: processes.filter(p => p.category_id === cat.id) }));
  const uncategorised = processes.filter(p => !p.category_id);

  // ── Full-screen BPMN editor ───────────────────────────────────────────────
  if (bpmnTarget) {
    return (
      <BpmnEditor
        process={bpmnTarget}
        onClose={() => { setBpmnTarget(null); loadProcesses(); }}
        onSave={handleBpmnSave}
      />
    );
  }

  if (!canManage) return (
    <Container fluid className="py-4">
      <Alert variant="danger">You don't have permission to manage processes.</Alert>
    </Container>
  );

  // ── Process row (used in hierarchy + list) ────────────────────────────────
  const ProcessRow = ({ p, indent = false }) => (
    <div className="d-flex align-items-center gap-2 px-3 py-2"
      style={{ borderBottom: '1px solid #f1f5f9', paddingLeft: indent ? 64 : 16 }}>
      <i className="bi bi-file-earmark-text text-muted" style={{ fontSize: 15, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {p.name}
      </span>
      {p.description && (
        <span className="text-muted d-none d-lg-inline"
          style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.description}
        </span>
      )}
      <Badge bg={statusVariant(p.status)} style={{ fontSize: 10, flexShrink: 0 }}>{p.status}</Badge>
      <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>v{p.version}</span>

      {/* ── Action buttons (matching screenshot style) ── */}
      <div className="d-flex gap-1 ms-1" style={{ flexShrink: 0 }}>
        {/* Edit diagram — red pencil (THE button from the screenshot) */}
        <button onClick={() => openBpmnEditor(p)} title="Edit BPMN diagram"
          style={{ width:30, height:30, background:'#ef4444', color:'white', border:'none', borderRadius:5, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>
          <i className="bi bi-pencil-fill" />
        </button>
        {/* Delete */}
        <button onClick={() => handleDelete(p.id)} title="Delete"
          style={{ width:30, height:30, background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:5, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>
          <i className="bi bi-trash" />
        </button>
        {/* Export */}
        <button onClick={() => handleExport(p.id)} title="Export BPMN"
          style={{ width:30, height:30, background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:5, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>
          <i className="bi bi-download" />
        </button>
      </div>
    </div>
  );

  return (
    <Container fluid className="py-4">
      {/* ── Header ── */}
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h4 className="mb-0 fw-bold">Processus</h4>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" size="sm" onClick={() => setShowImport(true)}>
                <i className="bi bi-upload me-1" />Import
              </Button>
              <Button variant="danger" size="sm" onClick={() => openCreate()}>
                <i className="bi bi-plus-lg me-1" />Nouveau
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {message.text && (
        <Row className="mb-3">
          <Col>
            <Alert variant={message.type} dismissible onClose={() => setMessage({ text:'', type:'success' })}>
              {message.text}
            </Alert>
          </Col>
        </Row>
      )}

      {/* ── Toolbar ── */}
      <Row className="mb-3">
        <Col>
          <Card className="border-0 shadow-sm">
            <Card.Body className="py-2 px-3">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div className="btn-group btn-group-sm">
                  <button className={`btn ${viewMode==='hierarchy'?'btn-danger':'btn-outline-secondary'}`}
                    onClick={() => setViewMode('hierarchy')}>
                    <i className="bi bi-diagram-3 me-1" />Hiérarchie
                  </button>
                  <button className={`btn ${viewMode==='list'?'btn-danger':'btn-outline-secondary'}`}
                    onClick={() => setViewMode('list')}>
                    <i className="bi bi-list-ul me-1" />Liste
                  </button>
                </div>

                <div style={{ width:1, height:24, background:'#e2e8f0' }} />

                <InputGroup size="sm" style={{ maxWidth: 260 }}>
                  <InputGroup.Text className="bg-white"><i className="bi bi-search text-muted" /></InputGroup.Text>
                  <FormControl placeholder="Rechercher…" value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)} className="border-start-0" />
                </InputGroup>

                <Form.Select size="sm" style={{ maxWidth: 160 }} value={filterCat}
                  onChange={e => setFilterCat(e.target.value)}>
                  <option value="">Toutes catégories</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>

                <Form.Select size="sm" style={{ maxWidth: 130 }} value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">Tous statuts</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </Form.Select>

                <Badge bg="secondary" className="ms-auto">{processes.length} processus</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* ── Content ── */}
      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-danger" role="status" />
          <p className="mt-2 text-muted small">Chargement…</p>
        </div>
      ) : viewMode === 'hierarchy' ? (
        <Row>
          <Col>
            <Card className="border-0 shadow-sm">
              {/* Root row */}
              <div className="d-flex align-items-center px-3 py-2 gap-2"
                style={{ background:'#f8f9fa', borderBottom:'1px solid #e2e8f0' }}>
                <span style={{ color:'#6c757d', fontSize:13, userSelect:'none' }}>−</span>
                <i className="bi bi-folder text-muted" />
                <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>Catégories de processus</span>
              </div>

              {grouped.map(cat => (
                <div key={cat.id}>
                  {/* Category */}
                  <div className="d-flex align-items-center gap-2 py-2"
                    style={{ paddingLeft:32, borderBottom:'1px solid #f1f5f9', background:'white' }}>
                    <span style={{ color:'#6c757d', fontSize:12 }}>−</span>
                    <i className="bi bi-folder2 text-muted" />
                    <span style={{ fontSize:13, color:'#334155', fontWeight:500 }}>{cat.name}</span>
                    {cat.description && <span className="text-muted ms-2" style={{ fontSize:11 }}>{cat.description}</span>}
                    <button className="ms-auto me-2" title="Add process in this category"
                      onClick={() => openCreate(cat.id)}
                      style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:16, lineHeight:1, padding:'0 4px' }}>
                      +
                    </button>
                  </div>

                  {/* Processes */}
                  {cat.procs.length === 0 ? (
                    <div style={{ paddingLeft:64, padding:'6px 16px 6px 64px', fontSize:11, color:'#cbd5e1', borderBottom:'1px solid #f8fafc' }}>
                      No processes
                    </div>
                  ) : cat.procs.map(p => <ProcessRow key={p.id} p={p} indent />)}
                </div>
              ))}

              {/* Uncategorised */}
              {uncategorised.map(p => <ProcessRow key={p.id} p={p} />)}

              {processes.length === 0 && (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-diagram-3 display-5 d-block mb-2 opacity-25" />
                  <p className="mb-0">No processes yet.</p>
                  <Button variant="danger" size="sm" className="mt-3" onClick={() => openCreate()}>
                    <i className="bi bi-plus-lg me-1" />Create first process
                  </Button>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      ) : (
        /* ── List view ── */
        <Row>
          <Col>
            <Card className="border-0 shadow-sm">
              <div style={{ overflowX:'auto' }}>
                <table className="table table-hover mb-0" style={{ minWidth:600 }}>
                  <thead className="table-light">
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Version</th>
                      <th>Updated</th>
                      <th style={{ width:115 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-4 text-muted">No processes found</td></tr>
                    ) : processes.map(p => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.description && <div className="text-muted" style={{ fontSize:11 }}>{p.description}</div>}
                        </td>
                        <td>{p.category_name || <span className="text-muted">—</span>}</td>
                        <td><Badge bg={statusVariant(p.status)}>{p.status}</Badge></td>
                        <td>v{p.version}</td>
                        <td>{new Date(p.updated_at).toLocaleDateString()}</td>
                        <td>
                          <div className="d-flex gap-1">
                            <button onClick={() => openBpmnEditor(p)} title="Edit BPMN diagram"
                              className="btn btn-danger btn-sm" style={{ padding:'3px 7px' }}>
                              <i className="bi bi-pencil-fill" />
                            </button>
                            <button onClick={() => openEditDetails(p)} title="Edit details"
                              className="btn btn-outline-secondary btn-sm" style={{ padding:'3px 7px' }}>
                              <i className="bi bi-info-circle" />
                            </button>
                            <button onClick={() => handleExport(p.id)} title="Export"
                              className="btn btn-outline-secondary btn-sm" style={{ padding:'3px 7px' }}>
                              <i className="bi bi-download" />
                            </button>
                            <button onClick={() => handleDelete(p.id)} title="Delete"
                              className="btn btn-outline-danger btn-sm" style={{ padding:'3px 7px' }}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Col>
        </Row>
      )}

      {/* ── Create/Edit Modal ── */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{editingProcess ? 'Edit Process' : 'New Process'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Name *</Form.Label>
              <Form.Control required value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control as="textarea" rows={2} value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })} />
            </Form.Group>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Category</Form.Label>
                  <Form.Select value={formData.category_id}
                    onChange={e => setFormData({ ...formData, category_id: e.target.value })}>
                    <option value="">Select category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Status</Form.Label>
                  <Form.Select value={formData.status}
                    onChange={e => setFormData({ ...formData, status: e.target.value })}>
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" variant="danger">{editingProcess ? 'Update' : 'Create'}</Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* ── Import Modal ── */}
      <Modal show={showImport} onHide={() => setShowImport(false)}>
        <Modal.Header closeButton><Modal.Title>Import BPMN File</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Process Name *</Form.Label>
              <Form.Control type="text" required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Category</Form.Label>
              <Form.Select>
                <option value="">Select category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>BPMN File *</Form.Label>
              <Form.Control type="file" accept=".bpmn,.xml" required />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImport(false)}>Cancel</Button>
          <Button variant="danger"><i className="bi bi-upload me-1" />Import</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}

export default ProcessManagement;