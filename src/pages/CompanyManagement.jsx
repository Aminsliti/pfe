import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Dropdown,
  Form,
  InputGroup,
  Modal,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import './CompanyManagement.css';

const EMPTY_FORM = {
  name: '',
  description: '',
  logo_url: '',
};

function formatDate(value) {
  if (!value) return 'Not available';

  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CO';
}

export function CompanyManagement() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [feedback, setFeedback] = useState({ text: '', variant: 'success' });
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);

  const canManageCompanies = hasPermission('user_management');

  const setMessage = (text, variant = 'success') => {
    setFeedback({ text, variant });
  };

  const clearMessage = () => {
    setFeedback({ text: '', variant: 'success' });
  };

  const loadCompanies = async () => {
    if (!canManageCompanies) return;

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/api/companies');
      if (!response.ok) {
        setMessage('Failed to load companies.', 'danger');
        return;
      }

      const data = await response.json();
      setCompanies(data);
    } catch (error) {
      console.error('Error loading companies:', error);
      setMessage('Failed to load companies.', 'danger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, [canManageCompanies]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingCompany(null);
  };

  const handleCreate = () => {
    resetForm();
    clearMessage();
    setShowModal(true);
  };

  const handleEdit = (company) => {
    setEditingCompany(company);
    setFormData({
      name: company.name || '',
      description: company.description || '',
      logo_url: company.logo_url || '',
    });
    clearMessage();
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleDelete = async (companyId) => {
    if (!window.confirm('Are you sure you want to delete this company?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:3001/api/companies/${companyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        setMessage(error.error || 'Failed to delete company.', 'danger');
        return;
      }

      setMessage('Company deleted successfully.', 'success');
      loadCompanies();
    } catch (error) {
      console.error('Error deleting company:', error);
      setMessage('Network error while deleting company.', 'danger');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    clearMessage();

    if (!formData.name.trim()) {
      setMessage('Company name is required.', 'danger');
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
        body: JSON.stringify({
          ...formData,
          name: formData.name.trim(),
          description: formData.description.trim(),
          logo_url: formData.logo_url.trim(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        setMessage(error.error || 'Failed to save company.', 'danger');
        return;
      }

      setMessage(
        `Company ${editingCompany ? 'updated' : 'created'} successfully.`,
        'success'
      );
      handleCloseModal();
      loadCompanies();
    } catch (error) {
      console.error('Error saving company:', error);
      setMessage('Network error while saving company.', 'danger');
    }
  };

  if (!canManageCompanies) {
    return (
      <Container fluid className="company-page py-4">
        <Card className="company-page__restricted">
          <Card.Body>
            <Alert variant="danger" className="mb-0">
              You do not have permission to manage companies. Contact your administrator.
            </Alert>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  const filteredCompanies = companies.filter((company) => {
    const haystack = `${company.name || ''} ${company.description || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  const companiesWithLogos = companies.filter((company) => company.logo_url).length;
  const recentlyUpdated = companies.filter((company) => {
    if (!company.updated_at) return false;

    const updatedAt = new Date(company.updated_at);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return updatedAt >= sevenDaysAgo;
  }).length;

  return (
    <Container fluid className="company-page">
      <section className="company-hero">
        <div>
          <span className="company-hero__eyebrow">Administration</span>
          <h1>Company Management</h1>
          <p>
            Manage the legal entities and workspaces that structure processes,
            users, and reporting across the platform.
          </p>
        </div>
        <Button className="company-hero__button" onClick={handleCreate}>
          <i className="bi bi-plus-circle me-2"></i>
          Create Company
        </Button>
      </section>

      {feedback.text && (
        <Alert
          variant={feedback.variant}
          dismissible
          onClose={clearMessage}
          className="company-feedback"
        >
          {feedback.text}
        </Alert>
      )}

      <Row className="g-3 company-metrics">
        <Col xl={4} md={6}>
          <Card className="company-metric-card">
            <Card.Body>
              <span className="company-metric-card__label">Total companies</span>
              <strong>{companies.length}</strong>
              <p>All entities available in the workspace.</p>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={4} md={6}>
          <Card className="company-metric-card">
            <Card.Body>
              <span className="company-metric-card__label">With branded logo</span>
              <strong>{companiesWithLogos}</strong>
              <p>Companies with a configured visual identity.</p>
            </Card.Body>
          </Card>
        </Col>
        <Col xl={4} md={12}>
          <Card className="company-metric-card">
            <Card.Body>
              <span className="company-metric-card__label">Updated this week</span>
              <strong>{recentlyUpdated}</strong>
              <p>Recently maintained entities that changed in the last 7 days.</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Card className="company-directory-card">
        <Card.Body>
          <div className="company-directory-card__header">
            <div>
              <span className="company-directory-card__eyebrow">Directory</span>
              <h2>Companies</h2>
              <p>Search and maintain the organizations used throughout the app.</p>
            </div>
            <div className="company-directory-card__tools">
              <InputGroup>
                <InputGroup.Text>
                  <i className="bi bi-search"></i>
                </InputGroup.Text>
                <Form.Control
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by name or description"
                />
              </InputGroup>
              <Badge bg="light" text="dark" className="company-count-badge">
                {filteredCompanies.length} shown
              </Badge>
            </div>
          </div>

          {loading ? (
            <div className="company-state">
              <Spinner animation="border" variant="danger" />
              <p>Loading companies...</p>
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="company-state">
              <div className="company-state__icon">
                <i className="bi bi-building"></i>
              </div>
              <h3>No companies found</h3>
              <p>
                {searchTerm
                  ? 'Try adjusting the search term or clear the filter.'
                  : 'Create the first company to start structuring the workspace.'}
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <Table hover className="company-table align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ minWidth: '280px' }}>Company</th>
                    <th>Description</th>
                    <th style={{ minWidth: '130px' }}>Created</th>
                    <th style={{ minWidth: '130px' }}>Updated</th>
                    <th style={{ minWidth: '120px' }} className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <div className="company-row__identity">
                          <div className="company-row__avatar">
                            {company.logo_url ? (
                              <img src={company.logo_url} alt={`${company.name} logo`} />
                            ) : (
                              <span>{getInitials(company.name)}</span>
                            )}
                          </div>
                          <div className="company-row__copy">
                            <strong>{company.name}</strong>
                            <small>ID #{company.id}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <p className="company-row__description">
                          {company.description || 'No description provided.'}
                        </p>
                      </td>
                      <td>
                        <span className="company-row__date">{formatDate(company.created_at)}</span>
                      </td>
                      <td>
                        <span className="company-row__date">{formatDate(company.updated_at)}</span>
                      </td>
                      <td className="text-end">
                        <Dropdown align="end">
                          <Dropdown.Toggle
                            variant="outline-secondary"
                            size="sm"
                            className="company-row__actions"
                          >
                            Actions
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => handleEdit(company)}>
                              <i className="bi bi-pencil me-2"></i>
                              Edit
                            </Dropdown.Item>
                            <Dropdown.Divider />
                            <Dropdown.Item
                              className="text-danger"
                              onClick={() => handleDelete(company.id)}
                            >
                              <i className="bi bi-trash me-2"></i>
                              Delete
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={handleCloseModal} centered size="lg">
        <Modal.Header closeButton className="company-modal__header">
          <Modal.Title>
            {editingCompany ? 'Edit Company' : 'Create New Company'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="company-modal__body">
          {feedback.variant === 'danger' && feedback.text && (
            <Alert variant="danger">{feedback.text}</Alert>
          )}

          <Form onSubmit={handleSubmit}>
            <Row className="g-3">
              <Col md={7}>
                <Form.Group>
                  <Form.Label>Company Name *</Form.Label>
                  <Form.Control
                    type="text"
                    value={formData.name}
                    onChange={(event) =>
                      setFormData({ ...formData, name: event.target.value })
                    }
                    placeholder="Enter company name"
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={5}>
                <Form.Group>
                  <Form.Label>Logo URL</Form.Label>
                  <Form.Control
                    type="url"
                    value={formData.logo_url}
                    onChange={(event) =>
                      setFormData({ ...formData, logo_url: event.target.value })
                    }
                    placeholder="https://example.com/logo.png"
                  />
                </Form.Group>
              </Col>
              <Col xs={12}>
                <Form.Group>
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    value={formData.description}
                    onChange={(event) =>
                      setFormData({ ...formData, description: event.target.value })
                    }
                    placeholder="Describe the company or business unit"
                    rows={4}
                  />
                </Form.Group>
              </Col>
            </Row>

            {formData.logo_url && (
              <div className="company-modal__preview">
                <span>Logo preview</span>
                <div className="company-modal__preview-card">
                  <img src={formData.logo_url} alt="Company logo preview" />
                  <strong>{formData.name || 'Company name'}</strong>
                </div>
              </div>
            )}

            <div className="company-modal__actions">
              <Button variant="outline-secondary" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button type="submit" variant="danger">
                {editingCompany ? 'Save changes' : 'Create company'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default CompanyManagement;
