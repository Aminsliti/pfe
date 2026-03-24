import { useEffect, useMemo, useState } from 'react';
import { useAuth, ROLES } from '../contexts/AuthContext';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  InputGroup,
  Modal,
  Row,
  Table,
} from 'react-bootstrap';

const API_URL = 'http://localhost:3001/api';

const EMPTY_FORM = {
  username: '',
  password: '',
  email: '',
  fullName: '',
  role: ROLES.VIEWER,
  companyId: '',
};

export function UserManagement() {
  const {
    user,
    company,
    getAllUsers,
    createUser,
    updateUser,
    deleteUser,
    isGlobalAdmin,
    isCompanyAdmin,
  } = useAuth();
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const globalAdmin = isGlobalAdmin();
  const companyAdmin = isCompanyAdmin();

  const roleOptions = useMemo(() => {
    if (globalAdmin) {
      return Object.values(ROLES);
    }

    return [
      ROLES.COMPANY_ADMINISTRATOR,
      ROLES.BUSINESS_ANALYST,
      ROLES.PROCESS_OWNER,
      ROLES.RISK_MANAGER,
      ROLES.VIEWER,
    ];
  }, [globalAdmin]);

  const loadUsers = async () => {
    setLoading(true);
    const data = await getAllUsers();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  const loadCompanies = async () => {
    try {
      const response = await fetch(`${API_URL}/companies`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      setCompanies(Array.isArray(data) ? data : []);
    } catch (requestError) {
      console.error('Error fetching companies:', requestError);
    }
  };

  useEffect(() => {
    loadUsers();
    loadCompanies();
  }, []);

  const filteredUsers = users.filter((item) => {
    const haystack = [
      item.username,
      item.fullName,
      item.email,
      item.role,
      item.companyName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(searchTerm.toLowerCase());
  });

  const resetForm = () => {
    setEditingUser(null);
    setFormData({
      ...EMPTY_FORM,
      role: roleOptions[0] || ROLES.VIEWER,
      companyId: globalAdmin ? '' : String(company?.id || ''),
    });
  };

  const handleCreate = () => {
    resetForm();
    setError('');
    setShowModal(true);
  };

  const handleEdit = (selectedUser) => {
    setEditingUser(selectedUser);
    setFormData({
      username: selectedUser.username || '',
      password: '',
      email: selectedUser.email || '',
      fullName: selectedUser.fullName || '',
      role: selectedUser.role || ROLES.VIEWER,
      companyId: selectedUser.companyId ? String(selectedUser.companyId) : '',
    });
    setError('');
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) {
      return;
    }

    const result = await deleteUser(userId);
    if (result.success) {
      loadUsers();
    } else {
      setError(result.error);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!formData.username || !formData.fullName || !formData.email) {
      setError('Please fill in all required fields.');
      return;
    }

    if (!editingUser && !formData.password) {
      setError('Password is required for new users.');
      return;
    }

    if (formData.role !== ROLES.ADMINISTRATOR && !formData.companyId) {
      setError('A company is required for non-administrator users.');
      return;
    }

    const payload = {
      username: formData.username.trim(),
      email: formData.email.trim(),
      fullName: formData.fullName.trim(),
      role: formData.role,
      companyId: formData.companyId ? Number(formData.companyId) : null,
    };

    if (formData.password) {
      payload.password = formData.password;
    }

    const result = editingUser
      ? await updateUser(editingUser.id, payload)
      : await createUser(payload);

    if (!result.success) {
      setError(result.error || 'Failed to save the user.');
      return;
    }

    await loadUsers();
    setShowModal(false);
  };

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case ROLES.ADMINISTRATOR:
        return 'danger';
      case ROLES.COMPANY_ADMINISTRATOR:
        return 'primary';
      case ROLES.BUSINESS_ANALYST:
        return 'info';
      case ROLES.PROCESS_OWNER:
        return 'success';
      case ROLES.RISK_MANAGER:
        return 'warning';
      default:
        return 'secondary';
    }
  };

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <h2 className="mb-1">User Management</h2>
              <p className="text-muted mb-0">
                {globalAdmin
                  ? 'Manage users across all companies and assign company administrators.'
                  : `Manage users inside ${company?.name || 'your company'} only.`}
              </p>
            </div>
            <Button variant="success" onClick={handleCreate}>
              <i className="bi bi-plus-circle me-2"></i>
              Create User
            </Button>
          </div>
        </Col>
      </Row>

      {(companyAdmin || company) && (
        <Alert variant="info">
          <strong>Company scope:</strong> {company?.name || 'Assigned company'}.
          Users on this page can only access data from that company.
        </Alert>
      )}

      <Row className="mb-4">
        <Col md={7} xl={6}>
          <InputGroup>
            <InputGroup.Text>
              <i className="bi bi-search"></i>
            </InputGroup.Text>
            <Form.Control
              placeholder="Search by name, email, username, role, or company..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </InputGroup>
        </Col>
        <Col md={5} xl={6} className="text-md-end mt-3 mt-md-0">
          <Badge bg="info" className="p-2">
            {filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'}
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
                    <span className="visually-hidden">Loading users...</span>
                  </div>
                  <p className="mt-2 text-muted">Loading users...</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>ID</th>
                        <th>Username</th>
                        <th>Full Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Company</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan="7" className="text-center py-4 text-muted">
                            {searchTerm ? 'No users found matching your search.' : 'No users available.'}
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((item) => (
                          <tr key={item.id}>
                            <td>{item.id}</td>
                            <td><strong>{item.username}</strong></td>
                            <td>{item.fullName}</td>
                            <td>{item.email}</td>
                            <td>
                              <Badge bg={getRoleBadgeVariant(item.role)}>{item.role}</Badge>
                            </td>
                            <td>{item.companyName || 'No company'}</td>
                            <td>
                              <Button
                                variant="outline-primary"
                                size="sm"
                                className="me-2"
                                onClick={() => handleEdit(item)}
                              >
                                <i className="bi bi-pencil"></i> Edit
                              </Button>
                              {item.id !== user?.id && (
                                <Button
                                  variant="outline-danger"
                                  size="sm"
                                  onClick={() => handleDelete(item.id)}
                                >
                                  <i className="bi bi-trash"></i> Delete
                                </Button>
                              )}
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

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{editingUser ? 'Edit User' : 'Create New User'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Form onSubmit={handleSubmit}>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Username *</Form.Label>
                  <Form.Control
                    type="text"
                    value={formData.username}
                    onChange={(event) => setFormData((current) => ({ ...current, username: event.target.value }))}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Password {editingUser ? '(leave blank to keep current)' : '*'}</Form.Label>
                  <Form.Control
                    type="password"
                    value={formData.password}
                    onChange={(event) => setFormData((current) => ({ ...current, password: event.target.value }))}
                    required={!editingUser}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Full Name *</Form.Label>
                  <Form.Control
                    type="text"
                    value={formData.fullName}
                    onChange={(event) => setFormData((current) => ({ ...current, fullName: event.target.value }))}
                    required
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Email *</Form.Label>
                  <Form.Control
                    type="email"
                    value={formData.email}
                    onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
                    required
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Role *</Form.Label>
                  <Form.Select
                    value={formData.role}
                    onChange={(event) => setFormData((current) => ({ ...current, role: event.target.value }))}
                    required
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Company {formData.role === ROLES.ADMINISTRATOR ? '(optional)' : '*'}</Form.Label>
                  <Form.Select
                    value={formData.companyId}
                    disabled={!globalAdmin}
                    onChange={(event) => setFormData((current) => ({ ...current, companyId: event.target.value }))}
                    required={formData.role !== ROLES.ADMINISTRATOR}
                  >
                    <option value="">Select company</option>
                    {companies.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </Form.Select>
                  {!globalAdmin && (
                    <Form.Text>
                      Company administrators can only create or edit users inside their own company.
                    </Form.Text>
                  )}
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {editingUser ? 'Update' : 'Create'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default UserManagement;
