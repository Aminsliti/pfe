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
  Table,
  Badge,
  Dropdown
} from 'react-bootstrap';

export function CompanyManagement() {
  console.log('CompanyManagement component loaded');
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logo_url: ''
  });

  const canManageCompanies = hasPermission('user_management');

  const loadCompanies = async () => {
    if (!canManageCompanies) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/companies');
      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      } else {
        setMessage('Failed to load companies');
      }
    } catch (error) {
      console.error('Error loading companies:', error);
      setMessage('Failed to load companies');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (canManageCompanies) {
      loadCompanies();
    }
  }, [canManageCompanies]);

  const handleCreate = () => {
    setEditingCompany(null);
    setFormData({
      name: '',
      description: '',
      logo_url: ''
    });
    setMessage('');
    setShowModal(true);
  };

  const handleEdit = (company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name,
      description: company.description,
      logo_url: company.logo_url
    });
    setMessage('');
    setShowModal(true);
  };

  const handleDelete = async (companyId) => {
    if (!window.confirm('Are you sure you want to delete this company?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:3001/api/companies/${companyId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessage('Company deleted successfully');
        loadCompanies();
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to delete company');
      }
    } catch (error) {
      console.error('Error deleting company:', error);
      setMessage('Network error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (!formData.name) {
      setMessage('Company name is required');
      return;
    }

    try {
      const url = editingCompany 
        ? `http://localhost:3001/api/companies/${editingCompany.id}`
        : 'http://localhost:3001/api/companies';
      
      const method = editingCompany ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setMessage(`Company ${editingCompany ? 'updated' : 'created'} successfully`);
        setShowModal(false);
        loadCompanies();
      } else {
        const error = await response.json();
        setMessage(error.error || 'Failed to save company');
      }
    } catch (error) {
      console.error('Error saving company:', error);
      setMessage('Network error');
    }
  };

  if (!canManageCompanies) {
    return (
      <Container fluid className="py-4">
        <Alert variant="danger">
          You don't have permission to manage companies. Contact your administrator.
        </Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Company Management</h2>
            <Button variant="success" onClick={handleCreate}>
              <i className="bi bi-plus-circle me-2"></i>Create Company
            </Button>
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

      <Row>
        <Col>
          <Card>
            <Card.Body className="p-0">
              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading companies...</span>
                  </div>
                  <p className="mt-2 text-muted">Loading companies...</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Name</th>
                        <th>Description</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="text-center py-4 text-muted">
                            No companies found
                          </td>
                        </tr>
                      ) : (
                        companies.map(company => (
                          <tr key={company.id}>
                            <td>
                              <strong>{company.name}</strong>
                              {company.description && (
                                <>
                                  <br />
                                  <small className="text-muted">{company.description}</small>
                                </>
                              )}
                            </td>
                            <td>{new Date(company.created_at).toLocaleDateString()}</td>
                            <td>
                              <Dropdown>
                                <Dropdown.Toggle variant="outline-primary" size="sm">
                                  Actions
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                  <Dropdown.Item onClick={() => handleEdit(company)}>
                                    <i className="bi bi-pencil me-2"></i>Edit
                                  </Dropdown.Item>
                                  <Dropdown.Divider />
                                  <Dropdown.Item 
                                    className="text-danger"
                                    onClick={() => handleDelete(company.id)}
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
            {editingCompany ? 'Edit Company' : 'Create New Company'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {message && <Alert variant="danger">{message}</Alert>}

          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Company Name *</Form.Label>
              <Form.Control
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter company name"
                required
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter company description"
                rows={3}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Logo URL</Form.Label>
              <Form.Control
                type="url"
                value={formData.logo_url}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                placeholder="Enter logo URL (optional)"
              />
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {editingCompany ? 'Update' : 'Create'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default CompanyManagement;
