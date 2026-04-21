import { useEffect, useMemo, useState } from 'react';
import { ACTIVE_ROLES, getRoleDisplayName, useAuth, ROLES } from '../contexts/AuthContext';
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
import { useSnackbar } from '../components/SnackbarProvider';

const EMPTY_FORM = {
  username: '',
  password: '',
  email: '',
  fullName: '',
  role: ROLES.DESIGNER,
  additionalRoles: [],
};

function formatExpiryLabel(expiresOn) {
  if (!expiresOn) {
    return 'Permanent';
  }

  const parsed = new Date(`${expiresOn}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return expiresOn;
  }

  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatRoleWindowLabel(startsOn, expiresOn) {
  const formattedStart = startsOn ? formatExpiryLabel(startsOn) : null;
  const formattedEnd = expiresOn ? formatExpiryLabel(expiresOn) : null;

  if (formattedStart && formattedEnd) {
    return `${formattedStart} to ${formattedEnd}`;
  }

  if (formattedStart) {
    return `from ${formattedStart}`;
  }

  if (formattedEnd) {
    return `until ${formattedEnd}`;
  }

  return 'Permanent';
}

export function UserManagement() {
  const { confirmAction } = useSnackbar();
  const {
    user,
    getAllUsers,
    createUser,
    updateUser,
    deleteUser,
  } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const roleOptions = useMemo(() => ACTIVE_ROLES, []);

  const loadUsers = async () => {
    setLoading(true);
    const data = await getAllUsers();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = users.filter((item) => {
    const haystack = [
      item.username,
      item.fullName,
      item.email,
      item.role,
      ...(item.additionalRoles || []).map((roleItem) => roleItem.role),
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
      role: roleOptions[0] || ROLES.DESIGNER,
      additionalRoles: [],
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
      role: roleOptions.includes(selectedUser.role) ? selectedUser.role : (roleOptions[0] || ROLES.DESIGNER),
      additionalRoles: (selectedUser.additionalRoles || []).map((item) => ({
        role: item.role || '',
        startsOn: item.startsOn || '',
        expiresOn: item.expiresOn || '',
      })),
    });
    setError('');
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    const confirmed = await confirmAction({
      title: 'Delete user',
      message: 'Are you sure you want to delete this user?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) {
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

    const payload = {
      username: formData.username.trim(),
      email: formData.email.trim(),
      fullName: formData.fullName.trim(),
      role: formData.role,
      additionalRoles: formData.additionalRoles
        .filter((item) => item.role)
        .map((item) => ({
          role: item.role,
          startsOn: item.startsOn || null,
          expiresOn: item.expiresOn || null,
        })),
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

  const updateAdditionalRole = (index, field, value) => {
    setFormData((current) => ({
      ...current,
      additionalRoles: current.additionalRoles.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const addAdditionalRole = () => {
    setFormData((current) => ({
      ...current,
      additionalRoles: [...current.additionalRoles, { role: '', startsOn: '', expiresOn: '' }],
    }));
  };

  const removeAdditionalRole = (index) => {
    setFormData((current) => ({
      ...current,
      additionalRoles: current.additionalRoles.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case ROLES.ADMIN:
        return 'danger';
      case ROLES.DESIGNER:
        return 'primary';
      case ROLES.VALIDATOR:
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
                Manage workspace accounts, permissions, and temporary role assignments.
              </p>
            </div>
            <Button variant="success" onClick={handleCreate}>
              <i className="bi bi-plus-circle me-2"></i>
              Create User
            </Button>
          </div>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col md={7} xl={6}>
          <InputGroup>
            <InputGroup.Text>
              <i className="bi bi-search"></i>
            </InputGroup.Text>
            <Form.Control
              placeholder="Search by name, email, username, or role..."
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
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="text-center py-4 text-muted">
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
                              <div className="d-flex flex-wrap gap-1">
                                <Badge bg={getRoleBadgeVariant(item.role)}>{getRoleDisplayName(item.role)}</Badge>
                                {(item.additionalRoles || [])
                                  .filter((roleItem) => roleItem.active)
                                  .map((roleItem) => (
                                    <Badge key={`${item.id}-${roleItem.role}`} bg="dark">
                                      {getRoleDisplayName(roleItem.role)}
                                      {` ${formatRoleWindowLabel(roleItem.startsOn, roleItem.expiresOn)}`}
                                    </Badge>
                                  ))}
                              </div>
                            </td>
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
                      <option key={role} value={role}>{getRoleDisplayName(role)}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <div className="border rounded-3 p-3 mb-3 bg-light">
              <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
                <div>
                  <Form.Label className="mb-1">Additional roles</Form.Label>
                  <div className="text-muted small">
                    Add temporary or permanent extra roles with a start date and an end date.
                  </div>
                </div>
                <Button type="button" variant="outline-secondary" size="sm" onClick={addAdditionalRole}>
                  <i className="bi bi-plus-circle me-2"></i>
                  Add role
                </Button>
              </div>

              {formData.additionalRoles.length === 0 ? (
                <div className="text-muted small">No additional roles assigned.</div>
              ) : (
                <div className="d-flex flex-column gap-3">
                  {formData.additionalRoles.map((item, index) => (
                    <Row key={`extra-role-${index}`} className="g-2 align-items-end">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label className="small text-muted">Role</Form.Label>
                          <Form.Select
                            value={item.role}
                            onChange={(event) => updateAdditionalRole(index, 'role', event.target.value)}
                          >
                            <option value="">Select additional role</option>
                            {roleOptions
                              .filter((roleOption) => roleOption !== formData.role)
                              .map((roleOption) => (
                                <option key={`${index}-${roleOption}`} value={roleOption}>
                                  {getRoleDisplayName(roleOption)}
                                </option>
                              ))}
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label className="small text-muted">Starts on</Form.Label>
                          <Form.Control
                            type="date"
                            value={item.startsOn}
                            onChange={(event) => updateAdditionalRole(index, 'startsOn', event.target.value)}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={3}>
                        <Form.Group>
                          <Form.Label className="small text-muted">Ends on</Form.Label>
                          <Form.Control
                            type="date"
                            value={item.expiresOn}
                            onChange={(event) => updateAdditionalRole(index, 'expiresOn', event.target.value)}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={2}>
                        <Button
                          type="button"
                          variant="outline-danger"
                          className="w-100"
                          onClick={() => removeAdditionalRole(index)}
                        >
                          Remove
                        </Button>
                      </Col>
                    </Row>
                  ))}
                </div>
              )}
            </div>

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
