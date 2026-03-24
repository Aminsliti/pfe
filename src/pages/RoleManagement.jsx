import { useState, useEffect } from 'react';
import { useAuth, PERMISSIONS } from '../contexts/AuthContext';
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
  FormControl
} from 'react-bootstrap';

export function RoleManagement() {
  const { 
    getRolesWithPermissions, 
    getAllPermissions, 
    updateRolePermissions,
    createRole,
    updateRole,
    deleteRole,
    PERMISSIONS 
  } = useAuth();
  const [roles, setRoles] = useState([]);
  const [allPermissions, setAllPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [message, setMessage] = useState('');

  const loadData = async () => {
    setLoading(true);
    const rolesData = await getRolesWithPermissions();
    const permsData = await getAllPermissions();
    setRoles(rolesData);
    setAllPermissions(permsData);
    setLoading(false);
  };

  const handleEditRole = (role) => {
    setEditingRole({ ...role });
    setSelectedPermissions(role.permissions?.map(p => p.id) || []);
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleCreateRole = () => {
    setEditingRole({ name: '', description: '' });
    setSelectedPermissions([]);
    setIsEditing(true);
    setIsCreating(true);
  };

  const handleSaveRole = async () => {
    if (!editingRole.name.trim()) {
      setMessage('Role name is required');
      return;
    }

    let result;
    if (isCreating) {
      result = await createRole(editingRole);
    } else {
      result = await updateRole(editingRole.id, editingRole);
    }

    if (result.success) {
      const role = result.role;
      await updateRolePermissions(role.id, selectedPermissions);
      setMessage(`Role ${isCreating ? 'created' : 'updated'} successfully`);
      setIsEditing(false);
      setEditingRole(null);
      setSelectedPermissions([]);
      loadData();
    } else {
      setMessage(result.error);
    }
  };

  const handleDeleteRole = async (role) => {
    if (!window.confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      return;
    }

    const result = await deleteRole(role.id);
    if (result.success) {
      setMessage('Role deleted successfully');
      if (selectedRole?.id === role.id) {
        setSelectedRole(null);
      }
      loadData();
    } else {
      setMessage(result.error);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingRole(null);
    setSelectedPermissions([]);
    setMessage('');
  };

  const togglePermission = (permissionId) => {
    setSelectedPermissions(prev => 
      prev.includes(permissionId) 
        ? prev.filter(id => id !== permissionId)
        : [...prev, permissionId]
    );
  };

  useEffect(() => {
    loadData();
  }, []);

  const getPermissionLabel = (permName) => {
    const permKeys = Object.keys(PERMISSIONS);
    for (const key of permKeys) {
      if (PERMISSIONS[key] === permName) {
        return key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    return permName;
  };

  const getRoleBadgeVariant = (roleName) => {
    switch (roleName) {
      case 'Administrator':
        return 'danger';
      case 'Company Administrator':
        return 'primary';
      case 'Business Analyst':
        return 'info';
      case 'Process Owner':
        return 'success';
      case 'Risk Manager':
        return 'warning';
      case 'Viewer':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getRoleHeaderVariant = (roleName) => {
    switch (roleName) {
      case 'Administrator':
        return 'bg-danger';
      case 'Company Administrator':
        return 'bg-primary';
      case 'Business Analyst':
        return 'bg-info';
      case 'Process Owner':
        return 'bg-success';
      case 'Risk Manager':
        return 'bg-warning';
      case 'Viewer':
        return 'bg-secondary';
      default:
        return 'bg-secondary';
    }
  };

  if (loading) {
    return (
      <Container fluid className="py-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading roles...</span>
          </div>
          <p className="mt-2 text-muted">Loading roles...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Role & Permission Management</h2>
            <Button variant="success" onClick={handleCreateRole}>
              <i className="bi bi-plus-circle me-2"></i>Create New Role
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

      <Row className="mb-4">
        {roles.map(role => (
          <Col md={6} lg={4} className="mb-4" key={role.id}>
            <Card 
              className={`h-100 ${selectedRole?.id === role.id ? 'border-primary' : ''}`}
              onClick={() => setSelectedRole(role)}
              style={{ cursor: 'pointer' }}
            >
              <Card.Header className={`d-flex justify-content-between align-items-center ${getRoleHeaderVariant(role.name)}`}>
                <h5 className="mb-0 text-white">{role.name}</h5>
                <div>
                  <Button
                    variant="outline-light"
                    size="sm"
                    className="me-2 border-white text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditRole(role);
                    }}
                    title="Edit Role"
                  >
                    <i className="bi bi-pencil-fill"></i>
                  </Button>
                  {role.name !== 'Administrator' && (
                    <Button
                      variant="outline-light"
                      size="sm"
                      className="border-white text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRole(role);
                      }}
                      title="Delete Role"
                    >
                      <i className="bi bi-trash-fill"></i>
                    </Button>
                  )}
                </div>
              </Card.Header>
              <Card.Body className="bg-white">
                <p className="text-dark mb-3">{role.description}</p>
                <h6 className="text-dark">Permissions ({role.permissions?.length || 0}):</h6>
                <div className="d-flex flex-wrap gap-1">
                  {role.permissions?.map(perm => (
                    <Badge key={perm.id} bg="info" text="white" className="mb-1">
                      {getPermissionLabel(perm.name)}
                    </Badge>
                  ))}
                </div>
              </Card.Body>
              <Card.Footer className="bg-transparent">
                <Badge bg={getRoleBadgeVariant(role.name)} className="w-100 justify-content-center">
                  {role.name}
                </Badge>
              </Card.Footer>
            </Card>
          </Col>
        ))}
      </Row>

      <Row>
        <Col>
          <Card>
            <Card.Header>
              <h5 className="mb-0">All Available Permissions</h5>
            </Card.Header>
            <Card.Body>
              <Row>
                {allPermissions.map(perm => (
                  <Col md={6} lg={4} className="mb-3" key={perm.id}>
                    <div className="border rounded p-3 h-100">
                      <h6 className="text-primary">{getPermissionLabel(perm.name)}</h6>
                      <p className="text-muted small mb-0">{perm.description}</p>
                    </div>
                  </Col>
                ))}
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Modal show={isEditing} onHide={handleCancelEdit} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{isCreating ? 'Create New Role' : 'Edit Role'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={(e) => { e.preventDefault(); handleSaveRole(); }}>
            <Form.Group className="mb-3">
              <Form.Label>Role Name</Form.Label>
              <Form.Control
                type="text"
                value={editingRole?.name || ''}
                onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                placeholder="Enter role name"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                value={editingRole?.description || ''}
                onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })}
                placeholder="Enter role description"
                rows={3}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Permissions</Form.Label>
              <div className="border rounded p-3" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {allPermissions.map(perm => (
                  <Form.Check 
                    key={perm.id}
                    type="checkbox"
                    id={`perm-${perm.id}`}
                    label={
                      <div>
                        <strong>{getPermissionLabel(perm.name)}</strong>
                        <br />
                        <small className="text-muted">{perm.description}</small>
                      </div>
                    }
                    checked={selectedPermissions.includes(perm.id)}
                    onChange={() => togglePermission(perm.id)}
                    className="mb-2"
                  />
                ))}
              </div>
            </Form.Group>

            <div className="d-flex justify-content-end gap-2">
              <Button variant="secondary" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                {isCreating ? 'Create' : 'Save'}
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
}

export default RoleManagement;
