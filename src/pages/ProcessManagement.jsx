import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, Badge, InputGroup, FormControl, ProgressBar } from 'react-bootstrap';
import BpmnEditorModeler from '../components/BpmnEditor/BpmnEditorModeler';

const API = 'http://localhost:3001/api';

export function ProcessManagement() {
  const { company, hasPermission, isGlobalAdmin } = useAuth();
  const globalAdmin = isGlobalAdmin();
  const canManage = hasPermission('manage_processes');
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [message, setMessage] = useState({ text: '', type: 'success' });
  const [viewMode, setViewMode] = useState('hierarchy');
  const [bpmnTarget, setBpmnTarget] = useState(null);
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [uncategorisedExpanded, setUncategorisedExpanded] = useState(true);
  const [importForm, setImportForm] = useState({ name: '', description: '', category_id: '', company_id: globalAdmin ? '' : String(company?.id || ''), status: 'draft' });
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');
  const [formData, setFormData] = useState({ name: '', description: '', bpmn_xml: '', category_id: '', company_id: globalAdmin ? '' : String(company?.id || ''), status: 'draft' });
  const fileInputRef = useRef(null);

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: 'success' }), 4000);
  };

  const loadProcesses = async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (filterCat) params.append('category', filterCat);
      if (filterStatus) params.append('status', filterStatus);
      const response = await fetch(`${API}/processes?${params.toString()}`);
      if (!response.ok) showMsg('Failed to load processes', 'danger');
      else setProcesses(await response.json());
    } catch {
      showMsg('Network error', 'danger');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API}/process-categories`);
      if (response.ok) setCategories(await response.json());
    } catch {}
  };

  const loadCompanies = async () => {
    try {
      const response = await fetch(`${API}/companies`);
      if (response.ok) setCompanies(await response.json());
    } catch {}
  };

  useEffect(() => {
    if (canManage) {
      loadCategories();
      loadCompanies();
    }
  }, [canManage]);
  useEffect(() => { if (canManage) loadProcesses(); }, [canManage, searchTerm, filterCat, filterStatus]);
  useEffect(() => {
    setCollapsedCategories((previous) => {
      const next = { ...previous };
      let changed = false;
      categories.forEach((category) => {
        if (!(category.id in next)) {
          next[category.id] = false;
          changed = true;
        }
      });
      Object.keys(next).forEach((key) => {
        if (!categories.some((category) => String(category.id) === key)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [categories]);

  const openBpmnEditor = (process) => setBpmnTarget(process);
  const openCreate = (defaultCategoryId = '') => {
    setEditingProcess(null);
    setFormData({
      name: '',
      description: '',
      bpmn_xml: '',
      category_id: defaultCategoryId,
      company_id: globalAdmin ? '' : String(company?.id || ''),
      status: 'draft',
    });
    setShowModal(true);
  };
  const openEditDetails = (process) => {
    setEditingProcess(process);
    setFormData({
      name: process.name,
      description: process.description || '',
      bpmn_xml: process.bpmn_xml || '',
      category_id: process.category_id || '',
      company_id: process.company_id || (globalAdmin ? '' : String(company?.id || '')),
      status: process.status,
    });
    setShowModal(true);
  };
  const toggleCategory = (categoryId) => setCollapsedCategories((previous) => ({ ...previous, [categoryId]: !previous[categoryId] }));

  const handleBpmnSave = async (bpmnXml) => {
    if (!bpmnTarget) throw new Error('No process selected');
    const response = await fetch(`${API}/processes/${bpmnTarget.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bpmnTarget.name,
        description: bpmnTarget.description || '',
        status: bpmnTarget.status,
        category_id: bpmnTarget.category_id || null,
        bpmn_xml: bpmnXml,
        change_description: 'Updated via BPMN editor',
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Save failed');
    }
    const updated = await response.json();
    setBpmnTarget((previous) => ({ ...previous, bpmn_xml: bpmnXml, version: updated.version }));
    loadProcesses();
  };

  const openImportModal = () => {
    setImportForm({
      name: '',
      description: '',
      category_id: '',
      company_id: globalAdmin ? '' : String(company?.id || ''),
      status: 'draft',
    });
    setImportFile(null);
    setImportError('');
    setImportSuccess('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setShowImport(true);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(bpmn|xml)$/i)) {
      setImportError('Invalid format. Only .bpmn and .xml files are accepted.');
      setImportFile(null);
      return;
    }
    setImportError('');
    setImportFile(file);
    setImportForm((previous) => ({ ...previous, name: previous.name || file.name.replace(/\.(bpmn|xml)$/i, '').replace(/[-_]/g, ' ') }));
  };

  const handleImportSubmit = async (event) => {
    event.preventDefault();
    setImportError('');
    setImportSuccess('');
    if (!importForm.name.trim()) return setImportError('Process name is required.');
    if (!importFile) return setImportError('Please choose a BPMN or XML file.');
    setImporting(true);
    try {
      const form = new FormData();
      form.append('bpmnFile', importFile);
      form.append('name', importForm.name.trim());
      form.append('description', importForm.description || '');
      form.append('category_id', importForm.category_id || '');
      form.append('company_id', importForm.company_id || '');
      form.append('status', importForm.status);
      const response = await fetch(`${API}/processes/import`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Server error (${response.status})`);
      setImportSuccess(`"${data.name}" imported successfully (v${data.version || 1}).`);
      loadProcesses();
      setTimeout(() => setShowImport(false), 1800);
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this process?')) return;
    try {
      const response = await fetch(`${API}/processes/${id}`, { method: 'DELETE' });
      if (response.ok) {
        showMsg('Process deleted');
        loadProcesses();
      } else {
        const error = await response.json();
        showMsg(error.error || 'Delete failed', 'danger');
      }
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!formData.name) return showMsg('Process name is required', 'danger');
    try {
      const url = editingProcess ? `${API}/processes/${editingProcess.id}` : `${API}/processes`;
      const method = editingProcess ? 'PUT' : 'POST';
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (response.ok) {
        showMsg(`Process ${editingProcess ? 'updated' : 'created'}`);
        setShowModal(false);
        loadProcesses();
      } else {
        const error = await response.json();
        showMsg(error.error || 'Save failed', 'danger');
      }
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const handleExport = async (id) => {
    try {
      const response = await fetch(`${API}/processes/${id}/export`);
      if (!response.ok) return showMsg('Export failed', 'danger');
      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'process.bpmn';
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      showMsg('Network error', 'danger');
    }
  };

  const statusVariant = (status) => ({ draft: 'secondary', active: 'success', archived: 'warning' }[status] || 'secondary');
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const getCategoryLabel = (process) => categoryById.get(String(process.category_id))?.name || process.category_name || null;
  const grouped = categories.map((category) => ({ ...category, procs: processes.filter((process) => String(process.category_id) === String(category.id)) }));
  const uncategorised = processes.filter((process) => !process.category_id);

  if (bpmnTarget) {
    return <BpmnEditorModeler process={bpmnTarget} onClose={() => { setBpmnTarget(null); loadProcesses(); }} onSave={handleBpmnSave} />;
  }

  if (!canManage) {
    return <Container fluid className="py-4"><Alert variant="danger">You do not have permission to manage processes.</Alert></Container>;
  }

  const ProcessRow = ({ process, indent = false }) => (
    <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #f1f5f9', paddingLeft: indent ? 64 : 16 }}>
      <i className="bi bi-file-earmark-text text-muted" style={{ fontSize: 15, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: '#1e293b', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{process.name}</span>
      {process.description && <span className="text-muted d-none d-lg-inline" style={{ fontSize: 11, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{process.description}</span>}
      <Badge bg={statusVariant(process.status)} style={{ fontSize: 10, flexShrink: 0 }}>{process.status}</Badge>
      <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>v{process.version}</span>
      <div className="d-flex gap-1 ms-1" style={{ flexShrink: 0 }}>
        <button type="button" onClick={() => openBpmnEditor(process)} title="Edit BPMN diagram" style={{ width: 30, height: 30, background: '#ef4444', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-pencil-fill" /></button>
        <button type="button" onClick={() => openEditDetails(process)} title="Edit details" style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-info-circle" /></button>
        <button type="button" onClick={() => handleDelete(process.id)} title="Delete" style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-trash" /></button>
        <button type="button" onClick={() => handleExport(process.id)} title="Export BPMN" style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}><i className="bi bi-download" /></button>
      </div>
    </div>
  );

  return (
    <Container fluid className="py-4">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h4 className="mb-0 fw-bold">Processus</h4>
            <div className="d-flex gap-2">
              <Button variant="outline-secondary" size="sm" onClick={openImportModal}><i className="bi bi-upload me-1" />Import</Button>
              <Button variant="danger" size="sm" onClick={() => openCreate()}><i className="bi bi-plus-lg me-1" />Nouveau</Button>
            </div>
          </div>
        </Col>
      </Row>

      {message.text && <Row className="mb-3"><Col><Alert variant={message.type} dismissible onClose={() => setMessage({ text: '', type: 'success' })}>{message.text}</Alert></Col></Row>}

      <Row className="mb-3">
        <Col>
          <Card className="border-0 shadow-sm">
            <Card.Body className="py-2 px-3">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <div className="btn-group btn-group-sm">
                  <button type="button" className={`btn ${viewMode === 'hierarchy' ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={() => setViewMode('hierarchy')}><i className="bi bi-diagram-3 me-1" />Hierarchie</button>
                  <button type="button" className={`btn ${viewMode === 'list' ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={() => setViewMode('list')}><i className="bi bi-list-ul me-1" />Liste</button>
                </div>
                <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />
                <InputGroup size="sm" style={{ maxWidth: 280 }}>
                  <InputGroup.Text className="bg-white"><i className="bi bi-search text-muted" /></InputGroup.Text>
                  <FormControl placeholder="Rechercher..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="border-start-0" />
                </InputGroup>
                <Form.Select size="sm" style={{ maxWidth: 180 }} value={filterCat} onChange={(event) => setFilterCat(event.target.value)}>
                  <option value="">Toutes categories</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Form.Select>
                <Form.Select size="sm" style={{ maxWidth: 140 }} value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
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

      {loading ? (
        <div className="text-center py-5"><div className="spinner-border text-danger" role="status" /><p className="mt-2 text-muted small">Chargement...</p></div>
      ) : viewMode === 'hierarchy' ? (
        <Row><Col><Card className="border-0 shadow-sm">
          <button type="button" onClick={() => setCategoriesExpanded((previous) => !previous)} className="d-flex align-items-center px-3 py-2 gap-2 w-100 text-start" style={{ background: '#f8f9fa', border: 'none', borderBottom: '1px solid #e2e8f0' }}>
            <i className={`bi ${categoriesExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#6c757d', fontSize: 13 }} />
            <i className="bi bi-folder text-muted" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Categories de processus</span>
            <Badge bg="light" text="dark" pill className="ms-auto">{grouped.length}</Badge>
          </button>
          {categoriesExpanded && grouped.map((category) => {
            const isCollapsed = !!collapsedCategories[category.id];
            return (
              <div key={category.id}>
                <div className="d-flex align-items-center gap-2 py-2" style={{ paddingLeft: 24, borderBottom: '1px solid #f1f5f9', background: 'white' }}>
                  <button type="button" onClick={() => toggleCategory(category.id)} className="d-flex align-items-center gap-2 flex-grow-1 text-start" style={{ background: 'none', border: 'none', padding: 0 }}>
                    <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} style={{ color: '#6c757d', fontSize: 12 }} />
                    <i className="bi bi-folder2 text-muted" />
                    <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>{category.name}</span>
                    {category.description && <span className="text-muted ms-2" style={{ fontSize: 11 }}>{category.description}</span>}
                    <Badge bg="light" text="dark" pill className="ms-auto">{category.procs.length}</Badge>
                  </button>
                  <button type="button" className="me-2" title="Add process" onClick={() => openCreate(String(category.id))} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}><i className="bi bi-plus-lg" /></button>
                </div>
                {!isCollapsed && (category.procs.length === 0 ? <div style={{ padding: '6px 16px 6px 64px', fontSize: 11, color: '#cbd5e1', borderBottom: '1px solid #f8fafc' }}>No processes</div> : category.procs.map((process) => <ProcessRow key={process.id} process={process} indent />))}
              </div>
            );
          })}
          {categoriesExpanded && uncategorised.length > 0 && (
            <div>
              <button type="button" onClick={() => setUncategorisedExpanded((previous) => !previous)} className="d-flex align-items-center gap-2 py-2 w-100 text-start" style={{ paddingLeft: 24, border: 'none', borderBottom: '1px solid #f1f5f9', background: 'white' }}>
                <i className={`bi ${uncategorisedExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#6c757d', fontSize: 12 }} />
                <i className="bi bi-inboxes text-muted" />
                <span style={{ fontSize: 13, color: '#334155', fontWeight: 500 }}>Sans categorie</span>
                <Badge bg="light" text="dark" pill className="ms-auto me-3">{uncategorised.length}</Badge>
              </button>
              {uncategorisedExpanded && uncategorised.map((process) => <ProcessRow key={process.id} process={process} />)}
            </div>
          )}
          {processes.length === 0 && <div className="text-center py-5 text-muted"><i className="bi bi-diagram-3 display-5 d-block mb-2 opacity-25" /><p className="mb-0">No processes yet.</p><Button variant="danger" size="sm" className="mt-3" onClick={() => openCreate()}><i className="bi bi-plus-lg me-1" />Create first process</Button></div>}
        </Card></Col></Row>
      ) : (
        <Row><Col><Card className="border-0 shadow-sm"><div style={{ overflowX: 'auto' }}>
          <table className="table table-hover mb-0" style={{ minWidth: 650 }}>
            <thead className="table-light"><tr><th>Name</th><th>Category</th><th>Status</th><th>Version</th><th>Updated</th><th style={{ width: 150 }}>Actions</th></tr></thead>
            <tbody>
              {processes.length === 0 ? <tr><td colSpan={6} className="text-center py-4 text-muted">No processes found</td></tr> : processes.map((process) => (
                <tr key={process.id}>
                  <td><strong>{process.name}</strong>{process.description && <div className="text-muted" style={{ fontSize: 11 }}>{process.description}</div>}</td>
                  <td>{getCategoryLabel(process) || <span className="text-muted">-</span>}</td>
                  <td><Badge bg={statusVariant(process.status)}>{process.status}</Badge></td>
                  <td>v{process.version}</td>
                  <td>{process.updated_at ? new Date(process.updated_at).toLocaleDateString() : '-'}</td>
                  <td><div className="d-flex gap-1">
                    <button type="button" onClick={() => openBpmnEditor(process)} className="btn btn-danger btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-pencil-fill" /></button>
                    <button type="button" onClick={() => openEditDetails(process)} className="btn btn-outline-secondary btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-info-circle" /></button>
                    <button type="button" onClick={() => handleExport(process.id)} className="btn btn-outline-secondary btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-download" /></button>
                    <button type="button" onClick={() => handleDelete(process.id)} className="btn btn-outline-danger btn-sm" style={{ padding: '3px 7px' }}><i className="bi bi-trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></Card></Col></Row>
      )}

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton><Modal.Title>{editingProcess ? 'Edit Process' : 'New Process'}</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3"><Form.Label>Name *</Form.Label><Form.Control required value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} /></Form.Group>
            <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={formData.description} onChange={(event) => setFormData({ ...formData, description: event.target.value })} /></Form.Group>
            <Row>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Select value={formData.category_id} onChange={(event) => setFormData({ ...formData, category_id: event.target.value })}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Form.Select></Form.Group></Col>
              <Col md={6}><Form.Group className="mb-3"><Form.Label>Status</Form.Label><Form.Select value={formData.status} onChange={(event) => setFormData({ ...formData, status: event.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></Form.Select></Form.Group></Col>
            </Row>
            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label>Company {globalAdmin ? '*' : ''}</Form.Label>
                  <Form.Select
                    value={formData.company_id}
                    disabled={!globalAdmin}
                    onChange={(event) => setFormData({ ...formData, company_id: event.target.value })}
                    required={globalAdmin}
                  >
                    <option value="">Select company</option>
                    {companies.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <div className="d-flex justify-content-end gap-2"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button type="submit" variant="danger">{editingProcess ? 'Update' : 'Create'}</Button></div>
          </Form>
        </Modal.Body>
      </Modal>

      <Modal show={showImport} onHide={() => !importing && setShowImport(false)} size="lg">
        <Modal.Header closeButton={!importing}><Modal.Title><i className="bi bi-upload me-2 text-primary" />Import BPMN file</Modal.Title></Modal.Header>
        <Modal.Body>
          {importError && <Alert variant="danger" dismissible onClose={() => setImportError('')}>{importError}</Alert>}
          {importSuccess && <Alert variant="success">{importSuccess}</Alert>}
          {!importSuccess && (
            <Form onSubmit={handleImportSubmit}>
              <div className="mb-4 text-center p-4 rounded-3" style={{ border: `2px dashed ${importFile ? '#198754' : '#dee2e6'}`, background: importFile ? '#f0fdf4' : '#f8f9fa', cursor: 'pointer', transition: 'all .2s' }} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); event.currentTarget.style.borderColor = '#0d6efd'; }} onDragLeave={(event) => { event.currentTarget.style.borderColor = importFile ? '#198754' : '#dee2e6'; }} onDrop={(event) => { event.preventDefault(); event.currentTarget.style.borderColor = importFile ? '#198754' : '#dee2e6'; handleFileChange({ target: { files: event.dataTransfer.files } }); }}>
                {importFile ? <><i className="bi bi-file-earmark-check text-success" style={{ fontSize: 40 }} /><p className="mt-2 mb-0 fw-bold text-success">{importFile.name}</p><p className="text-muted small mb-0">{(importFile.size / 1024).toFixed(1)} KB - click to change</p></> : <><i className="bi bi-cloud-upload text-muted" style={{ fontSize: 40 }} /><p className="mt-2 mb-1 fw-semibold">Drop a file here or click to browse</p><p className="text-muted small mb-0">Accepted formats: <code>.bpmn</code> and <code>.xml</code></p></>}
                <input ref={fileInputRef} type="file" accept=".bpmn,.xml" style={{ display: 'none' }} onChange={handleFileChange} />
              </div>
              <Row>
                <Col md={8}><Form.Group className="mb-3"><Form.Label>Process name *</Form.Label><Form.Control value={importForm.name} onChange={(event) => setImportForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="Displayed name in the process list" /></Form.Group></Col>
                <Col md={4}><Form.Group className="mb-3"><Form.Label>Initial status</Form.Label><Form.Select value={importForm.status} onChange={(event) => setImportForm((previous) => ({ ...previous, status: event.target.value }))}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></Form.Select></Form.Group></Col>
              </Row>
              <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} value={importForm.description} onChange={(event) => setImportForm((previous) => ({ ...previous, description: event.target.value }))} placeholder="Optional" /></Form.Group>
              <Form.Group className="mb-3"><Form.Label>Category</Form.Label><Form.Select value={importForm.category_id} onChange={(event) => setImportForm((previous) => ({ ...previous, category_id: event.target.value }))}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Form.Select></Form.Group>
              <Form.Group className="mb-4">
                <Form.Label>Company {globalAdmin ? '*' : ''}</Form.Label>
                <Form.Select
                  value={importForm.company_id}
                  disabled={!globalAdmin}
                  onChange={(event) => setImportForm((previous) => ({ ...previous, company_id: event.target.value }))}
                  required={globalAdmin}
                >
                  <option value="">Select company</option>
                  {companies.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </Form.Select>
              </Form.Group>
              {importing && <ProgressBar animated now={100} label="Importing..." className="mb-3" />}
              <div className="d-flex justify-content-end gap-2">
                <Button variant="secondary" onClick={() => setShowImport(false)} disabled={importing}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={importing || !importFile}>{importing ? <><span className="spinner-border spinner-border-sm me-2" />Importing...</> : <><i className="bi bi-upload me-2" />Import</>}</Button>
              </div>
            </Form>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default ProcessManagement;
