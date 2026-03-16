import { useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuth, PERMISSIONS, ROLES } from '../contexts/AuthContext';
import { 
  Navbar, 
  Nav, 
  Container, 
  Button, 
  Dropdown,
  Badge,
  Offcanvas
} from 'react-bootstrap';
import logo from '../assets/logo.png';

// v-bpm Logo Component
const VBPMLogo = ({ size = 30, className = "" }) => (
  <img 
    src={logo} 
    alt="v-bpm Logo" 
    width={size * 1.5} 
    height={size} 
    className={className}
    style={{ objectFit: 'contain' }}
  />
);

export function Layout() {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarShow, setSidebarShow] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { 
      path: '/dashboard', 
      label: 'Dashboard', 
      icon: 'bi-speedometer2', 
      permission: PERMISSIONS.VIEW_DASHBOARD 
    },
    { 
      path: '/processes', 
      label: 'Process Management', 
      icon: 'bi-diagram-3', 
      permission: PERMISSIONS.MANAGE_PROCESSES 
    },
    { 
      path: '/companies', 
      label: 'Company Management', 
      icon: 'bi-building', 
      permission: PERMISSIONS.USER_MANAGEMENT 
    },
    { 
      path: '/users', 
      label: 'User Management', 
      icon: 'bi-people', 
      permission: PERMISSIONS.USER_MANAGEMENT 
    },
    { 
      path: '/roles', 
      label: 'Role Management', 
      icon: 'bi-shield-check', 
      permission: PERMISSIONS.ROLE_MANAGEMENT 
    },
  ];

  const visibleNavItems = navItems.filter(item => hasPermission(item.permission));

  const getRoleBadgeVariant = (role) => {
    switch (role) {
      case ROLES.ADMINISTRATOR:
        return 'danger'; // Red
      case ROLES.BUSINESS_ANALYST:
        return 'dark'; // Black
      case ROLES.PROCESS_OWNER:
        return 'secondary'; // Grey
      case ROLES.RISK_MANAGER:
        return 'dark'; // Black
      case ROLES.VIEWER:
        return 'secondary'; // Grey
      default:
        return 'secondary';
    }
  };

  return (
    <>
      <Navbar style={{ background: '#dc2626' }} expand={false} className="mb-4 shadow-sm">
        <Container fluid>
          <Button
            variant="outline-light"
            onClick={() => setSidebarShow(true)}
            className="d-lg-none border-0"
          >
            <i className="bi bi-list fs-5"></i>
          </Button>
          
          <Navbar.Brand href="#" className="d-flex align-items-center fw-bold">
            <VBPMLogo size={50} className="me-2" />
            <span style={{ color: 'white', fontSize: '18px', fontWeight: 600 }}>v-bpm</span>
          </Navbar.Brand>

          <Nav className="ms-auto d-none d-lg-flex align-items-center">
            {visibleNavItems.map(item => (
              <Nav.Link
                key={item.path}
                as={Link}
                to={item.path}
                className={`px-3 rounded-3 mx-1 ${location.pathname === item.path ? 'active' : 'text-white'}`}
                style={{ 
                  background: location.pathname === item.path ? 'white' : 'transparent',
                  color: location.pathname === item.path ? '#dc2626' : 'white',
                  fontWeight: location.pathname === item.path ? '600' : '400'
                }}
              >
                <i className={`bi ${item.icon} me-2`}></i>
                {item.label}
              </Nav.Link>
            ))}
          </Nav>

          <Dropdown align="end">
            <Dropdown.Toggle variant="outline-light" id="user-dropdown" className="border-0">
              <div className="d-flex align-items-center">
                <div style={{ background: 'white', color: '#dc2626', borderRadius: '50%', padding: '6px', marginRight: '8px' }}>
                  <i className="bi bi-person-fill"></i>
                </div>
                <span className="d-none d-md-inline">{user?.fullName}</span>
              </div>
            </Dropdown.Toggle>
            
            <Dropdown.Menu className="shadow border-0">
              <Dropdown.Header style={{ background: '#f9fafb' }}>
                <div className="d-flex align-items-center">
                  <div style={{ background: '#dc2626', color: 'white', borderRadius: '50%', padding: '8px', marginRight: '12px' }}>
                    <i className="bi bi-person-fill fs-5"></i>
                  </div>
                  <div>
                    <strong>{user?.fullName}</strong>
                    <br />
                    <small className="text-muted">{user?.email}</small>
                    <br />
                    <Badge bg={getRoleBadgeVariant(user?.role)} className="mt-1">
                      {user?.role}
                    </Badge>
                  </div>
                </div>
              </Dropdown.Header>
              <Dropdown.Divider />
              <Dropdown.Item onClick={() => navigate('/dashboard')} className="py-2">
                <i className="bi bi-speedometer2 me-2" style={{ color: '#dc2626' }}></i>
                <span>Dashboard</span>
              </Dropdown.Item>
              <Dropdown.Item onClick={handleLogout} className="py-2 text-danger">
                <i className="bi bi-box-arrow-right me-2"></i>
                <span>Logout</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </Container>
      </Navbar>

      <Offcanvas show={sidebarShow} onHide={() => setSidebarShow(false)} placement="start">
        <Offcanvas.Header closeButton style={{ background: '#dc2626', color: 'white', border: 'none' }}>
          <Offcanvas.Title className="d-flex align-items-center">
            <VBPMLogo size={50} className="me-2" />
            <span>v-bpm</span>
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body style={{ background: '#f9fafb' }}>
          <Nav className="flex-column">
            {visibleNavItems.map(item => (
              <Nav.Link
                key={item.path}
                as={Link}
                to={item.path}
                className={`py-3 px-3 rounded-3 mb-2 ${location.pathname === item.path ? 'active' : 'text-dark'}`}
                style={{ 
                  background: location.pathname === item.path ? '#dc2626' : 'transparent',
                  color: location.pathname === item.path ? 'white' : '#374151',
                  fontWeight: location.pathname === item.path ? '600' : '400'
                }}
                onClick={() => setSidebarShow(false)}
              >
                <i className={`bi ${item.icon} me-3 fs-5`}></i>
                <span className="fw-medium">{item.label}</span>
              </Nav.Link>
            ))}
          </Nav>
          
          <div className="mt-auto pt-3 border-top bg-white rounded-3 p-3">
            <div className="d-flex align-items-center mb-3">
              <div style={{ background: '#dc2626', color: 'white', borderRadius: '50%', padding: '8px', marginRight: '12px' }}>
                <i className="bi bi-person-fill fs-5"></i>
              </div>
              <div>
                <strong>{user?.fullName}</strong>
                <br />
                <small className="text-muted">{user?.email}</small>
                <br />
                <Badge bg={getRoleBadgeVariant(user?.role)} className="mt-1">
                  {user?.role}
                </Badge>
              </div>
            </div>
            <Button variant="outline-danger" size="sm" onClick={handleLogout} className="w-100">
              <i className="bi bi-box-arrow-right me-2"></i>Logout
            </Button>
          </div>
        </Offcanvas.Body>
      </Offcanvas>

      <main className="flex-grow-1">
        <Container fluid className="py-3">
          <Outlet />
        </Container>
      </main>
    </>
  );
}

export default Layout;
