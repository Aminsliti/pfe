import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  Button, 
  Modal, 
  Form, 
  Alert,
  Badge,
  InputGroup,
  FormControl,
  Table,
  Dropdown
} from 'react-bootstrap';

export function ProcessManagement() {
  const { hasPermission } = useAuth();
  const [processes, setProcesses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingProcess, setEditingProcess] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    bpmn_xml: '',
    category_id: '',
    status: 'draft'
  });

  const canManageProcesses = hasPermission('manage_processes');

  const loadProcesses = async () => {
    if (!canManageProcesses) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (filterCategory) params.append('category', filterCategory);
      if (filterStatus) params.append('status', filterStatus);

      const response = await fetch(`http://localhost:3001/api/processes?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProcesses(data);
      } else {
        setMessage('Failed to load processes');
      }
    } catch (error) {
      console.error('Error loading processes:', error);
      setMessage('Failed to load processes');
    }
    setLoading(false);
  };

  const loadCategories = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/process-categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(data);
      }
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  useEffect(() => {
    if (canManageProcesses) {
      loadProcesses();
      loadCategories();
    }
  }, [canManageProcesses, searchTerm, filterCategory, filterStatus]);

  const handleCreate = () => {
    setEditingProcess(null);
    setFormData({
      name: '',
      description: '',
      bpmn_xml: '',
      category_id: '',
      status: 'draft'
    });
    setMessage('');
    setShowModal(true);
  };

  const handleEdit = (process) => {
    setEditingProcess(process);
    setFormData({
      name: process.name,
      description: process.description,
      bpmn_xml: process.bpmn_xml || '',
      category_id: process.category_id || '',
      status: process.status
    });
    setMessage('');
    setShowModal(true);
  };

  const handleDelete = async (processId) => {
    if (!window.confirm('Are you sure you want to delete this process?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:3001/api/processes/${processId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessage('Process deleted successfully');
        loadProcesses();
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to delete process');
      }
    } catch (error) {
      console.error('Error deleting process:', error);
      setMessage('Network error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.name) {
      setMessage('Process name is required');
      return;
    }

    try {
      const url = editingProcess 
        ? `http://localhost:3001/api/processes/${editingProcess.id}`
        : 'http://localhost:3001/api/processes';
      
      const method = editingProcess ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setMessage(`Process ${editingProcess ? 'updated' : 'created'} successfully`);
        setShowModal(false);
        loadProcesses();
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to save process');
      }
    } catch (error) {
      console.error('Error saving process:', error);
      setMessage('Network error');
    }
  };

  const handleExport = async (processId, version = null) => {
    try {
      const url = version 
        ? `http://localhost:3001/api/processes/${processId}/export?version=${version}`
        : `http://localhost:3001/api/processes/${processId}/export`;
      
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'process.bpmn';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
      } else {
        setMessage('Failed to export process');
      }
    } catch (error) {
      console.error('Error exporting process:', error);
      setMessage('Network error');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'draft': return 'secondary';
      case 'active': return 'success';
      case 'archived': return 'warning';
      default: return 'secondary';
    }
  };

  if (!canManageProcesses) {
    return (
      <Container fluid className="py-4">
        <Alert variant="danger">
          You don't have permission to manage processes. Contact your administrator.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Process Management</h2>
            <div>
              <Button variant="outline-primary" className="me-2" onClick={() => setShowImportModal(true)}>
                <i className="bi bi-upload me-2"></i>Import BPMN
              </Button>
              <Button variant="success" onClick={handleCreate}>
                <i className="bi bi-plus-circle me-2"></i>Create Process
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {message && (
        <Row className="mb-4">
          <Col>
            <Alert variant={message.includes('success') ? 'success' : 'danger'} dismissible onClose={() => setMessage('')}>
              {message}
            </Alert>
          </Col>
        </Row>
      )}

      <Row className="mb-4">
        <Col md={4}>
          <InputGroup>
            <InputGroup.Text>
              <i className="bi bi-search"></i>
            </InputGroup.Text>
            <FormControl
              placeholder="Search processes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </InputGroup>
        </Col>
        <Col md={3}>
          <Form.Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Form.Select>
        </Col>
        <Col md={2}>
          <Badge bg="info" className="p-2">
            {processes.length} processes
          </Badge>
        </Col>
      </Row>

      <Row>
        <Col>
          <Card>
            <Card.Body className="p-0">
              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading processes...</span>
                  </div>
                  <p className="mt-2 text-muted">Loading processes...</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Version</th>
                        <th>Created By</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processes.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center py-4 text-muted">
                            No processes found
                          </td>
                        </tr>
                      ) : (
                        processes.map(process => (
                          <tr key={process.id}>
                            <td>
                              <div>
                                <strong>{process.name}</strong>
                                {process.description && (
                                  <>
                                    <br />
                                    <small className="text-muted">{process.description}</small>
                                  </>
                                )}
                              </div>
                            </td>
                            <td>
                              {process.category_name || (
                                <Badge bg="light" text="dark">Uncategorized</Badge>
                              )}
                            </td>
                            <td>
                              <Badge bg={getStatusBadge(process.status)}>
                                {process.status}
                              </Badge>
                            </td>
                            <td>v{process.version}</td>
                            <td>{process.created_by_name}</td>
                            <td>{new Date(process.updated_at).toLocaleDateString()}</td>
                            <td>
                              <Dropdown>
                                <Dropdown.Toggle variant="outline-primary" size="sm">
                                  Actions
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                  <Dropdown.Item onClick={() => handleEdit(process)}>
                                    <i className="bi bi-pencil me-2"></i>Edit
                                  </Dropdown.Item>
                                  <Dropdown.Item onClick={() => handleExport(process.id)}>
                                    <i className="bi bi-download me-2"></i>Export
                                  </Dropdown.Item>
                                  <Dropdown.Divider />
                                  <Dropdown.Item 
                                    className="text-danger"
                                    onClick={() => handleDelete(process.id)}
                                  >
                                    <i className="bi bi-trash me-2"></i>Delete
                                  </Dropdown.Item>
                                </Dropdown.Menu>
                              </Dropdown>
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

      {/* Create/Edit Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {editingProcess ? 'Edit Process' : 'Create New Process'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message && <Alert variant="danger">{message}</Alert>}

          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Process Name *</Form.Label>
              <Form.Control
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter process name"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter process description"
                rows={3}
              />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Category</Form.Label>
                  <Form.Select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Status</Form.Label>
                  <Form.Select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>BPMN XML</Form.Label>
              <Form.Control
                as="textarea"
                value={formData.bpmn_xml}
                onChange={(e) => setFormData({ ...formData, bpmn_xml: e.target.value })}
                placeholder="Paste BPMN XML here (optional)"
                rows={6}
              />
              <Form.Text className="text-muted">
                You can paste BPMN XML directly or use the Import option to upload a file
              </Form.Text>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {editingProcess ? 'Update' : 'Create'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>

      {/* Import Modal */}
      <Modal show={showImportModal} onHide={() => setShowImportModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Import BPMN File</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Process Name *</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter process name"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                placeholder="Enter process description"
                rows={3}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Category</Form.Label>
              <Form.Select>
                <option value="">Select category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>BPMN File *</Form.Label>
              <Form.Control
                type="file"
                accept=".bpmn,.xml"
                required
              />
              <Form.Text className="text-muted">
                Select a BPMN file (.bpmn or .xml format)
              </Form.Text>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImportModal(false)}>
            Cancel
          </Button>
          <Button variant="primary">
            <i className="bi bi-upload me-2"></i>Import
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}

export default ProcessManagement;
