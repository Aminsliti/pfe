import { useAuth } from '../contexts/AuthContext';
import { 
  Container, 
  Row, 
  Col, 
  Card, 
  Badge,
  ListGroup,
  Alert
} from 'react-bootstrap';

export function Dashboard() {
  const { user, hasPermission, ROLES, PERMISSIONS } = useAuth();

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case ROLES.ADMINISTRATOR:
        return 'danger';
      case ROLES.BUSINESS_ANALYST:
        return 'primary';
      case ROLES.PROCESS_OWNER:
        return 'success';
      case ROLES.RISK_MANAGER:
        return 'warning';
      case ROLES.VIEWER:
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getPermissionIcon = (hasPermission) => {
    return hasPermission ? '✅' : '❌';
  };

  const getPermissionVariant = (hasPermission) => {
    return hasPermission ? 'success' : 'secondary';
  };

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <div className="text-center mb-4">
            <h1 className="display-4">Welcome, {user?.fullName}!</h1>
            <p className="lead">
              Role: <Badge bg={getRoleBadgeVariant(user?.role)} className="p-2">
                {user?.role}
              </Badge>
            </p>
          </div>
        </Col>
      </Row>

      <Row className="mb-4">
        <Col lg={4} md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-primary text-white">
              <h5 className="mb-0">
                <i className="bi bi-person-circle me-2"></i>Your Profile
              </h5>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                <ListGroup.Item>
                  <strong>Username:</strong> {user?.username}
                </ListGroup.Item>
                <ListGroup.Item>
                  <strong>Email:</strong> {user?.email}
                </ListGroup.Item>
                <ListGroup.Item>
                  <strong>Role:</strong> 
                  <Badge bg={getRoleBadgeVariant(user?.role)} className="ms-2">
                    {user?.role}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item>
                  <strong>User ID:</strong> {user?.id}
                </ListGroup.Item>
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={4} md={6} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-success text-white">
              <h5 className="mb-0">
                <i className="bi bi-shield-check me-2"></i>Your Permissions
              </h5>
            </Card.Header>
            <Card.Body>
              <ListGroup variant="flush">
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>User Management</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.USER_MANAGEMENT))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.USER_MANAGEMENT))}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>Role Management</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.ROLE_MANAGEMENT))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.ROLE_MANAGEMENT))}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>View Dashboard</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.VIEW_DASHBOARD))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.VIEW_DASHBOARD))}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>View Reports</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.VIEW_REPORTS))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.VIEW_REPORTS))}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>Manage Processes</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.MANAGE_PROCESSES))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.MANAGE_PROCESSES))}
                  </Badge>
                </ListGroup.Item>
                <ListGroup.Item className="d-flex justify-content-between align-items-center">
                  <span>Manage Risks</span>
                  <Badge bg={getPermissionVariant(hasPermission(PERMISSIONS.MANAGE_RISKS))}>
                    {getPermissionIcon(hasPermission(PERMISSIONS.MANAGE_RISKS))}
                  </Badge>
                </ListGroup.Item>
              </ListGroup>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={4} md={12} className="mb-4">
          <Card className="h-100">
            <Card.Header className="bg-info text-white">
              <h5 className="mb-0">
                <i className="bi bi-info-circle me-2"></i>Account Info
              </h5>
            </Card.Header>
            <Card.Body>
              <Alert variant="info" className="mb-3">
                <i className="bi bi-clock me-2"></i>
                Account created: {new Date(user?.createdAt).toLocaleDateString()}
              </Alert>
              <Alert variant="secondary">
                <i className="bi bi-arrow-clockwise me-2"></i>
                Last updated: {new Date(user?.updatedAt).toLocaleDateString()}
              </Alert>
              <div className="text-center mt-3">
                <Badge bg="light" text="dark" className="p-2">
                  <i className="bi bi-person-badge me-1"></i>
                  {user?.role}
                </Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col>
          <Card>
            <Card.Header className="bg-dark text-white">
              <h5 className="mb-0">
                <i className="bi bi-grid-3x3-gap me-2"></i>System Features Access
              </h5>
            </Card.Header>
            <Card.Body>
              <Row>
                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.USER_MANAGEMENT) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.USER_MANAGEMENT) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-people-fill display-4 mb-3"></i>
                      <h6>User Management</h6>
                      <p className="small mb-0">Manage user accounts (CRUD operations)</p>
                      {hasPermission(PERMISSIONS.USER_MANAGEMENT) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.ROLE_MANAGEMENT) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.ROLE_MANAGEMENT) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-shield-fill-check display-4 mb-3"></i>
                      <h6>Role Management</h6>
                      <p className="small mb-0">Assign roles and define permissions</p>
                      {hasPermission(PERMISSIONS.ROLE_MANAGEMENT) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.VIEW_DASHBOARD) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.VIEW_DASHBOARD) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-speedometer2 display-4 mb-3"></i>
                      <h6>Dashboard</h6>
                      <p className="small mb-0">View dashboard and overview</p>
                      {hasPermission(PERMISSIONS.VIEW_DASHBOARD) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.VIEW_REPORTS) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.VIEW_REPORTS) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-file-earmark-bar-graph display-4 mb-3"></i>
                      <h6>Reports</h6>
                      <p className="small mb-0">View and generate reports</p>
                      {hasPermission(PERMISSIONS.VIEW_REPORTS) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.MANAGE_PROCESSES) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.MANAGE_PROCESSES) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-diagram-3-fill display-4 mb-3"></i>
                      <h6>Process Management</h6>
                      <p className="small mb-0">Create and manage processes</p>
                      {hasPermission(PERMISSIONS.MANAGE_PROCESSES) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>

                <Col md={6} lg={4} className="mb-3">
                  <Card 
                    className={`h-100 ${hasPermission(PERMISSIONS.MANAGE_RISKS) ? 'border-success' : 'border-secondary'}`}
                    bg={hasPermission(PERMISSIONS.MANAGE_RISKS) ? 'light' : 'secondary'}
                  >
                    <Card.Body className="text-center">
                      <i className="bi bi-exclamation-triangle-fill display-4 mb-3"></i>
                      <h6>Risk Management</h6>
                      <p className="small mb-0">Manage risk assessments</p>
                      {hasPermission(PERMISSIONS.MANAGE_RISKS) ? (
                        <Badge bg="success" className="mt-2">Accessible</Badge>
                      ) : (
                        <Badge bg="secondary" className="mt-2">Restricted</Badge>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

export default Dashboard;
