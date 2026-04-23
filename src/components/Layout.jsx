import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { getRoleDisplayName, useAuth, PERMISSIONS } from '../contexts/AuthContext';
import { Button, Dropdown, Badge, Offcanvas, Nav } from 'react-bootstrap';
import logo from '../assets/logo.png';
import NotificationCenter from './NotificationCenter';
import { getHomePath } from '../utils/navigation';

const VBPMLogo = ({ size = 30, className = '' }) => (
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
  const { user, permissions, logout, hasPermission, hasRole, ROLES } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarShow, setSidebarShow] = useState(false);
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(() => {
    try {
      const savedValue = window.localStorage.getItem('vbpm.desktopSidebarVisible');
      return savedValue === null ? true : savedValue === 'true';
    } catch {
      return true;
    }
  });
  const homePath = useMemo(() => getHomePath(user, permissions), [user, permissions]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const displayRole = (role) => getRoleDisplayName(role || ROLES.ADMIN);

  const navItems = [
    { path: '/process-library', label: 'Process Library', icon: 'bi-collection', permission: PERMISSIONS.VIEW_DASHBOARD },
    { path: '/processes', label: 'Process Management', icon: 'bi-diagram-3', permission: PERMISSIONS.VIEW_DASHBOARD },
    { path: '/simulations', label: 'Simulations', icon: 'bi-clock-history', permission: PERMISSIONS.MANAGE_PROCESSES },
    { path: '/orgchart', label: 'Org Chart', icon: 'bi-diagram-3-fill', permission: PERMISSIONS.VIEW_DASHBOARD },
    { path: '/users', label: 'User Management', icon: 'bi-people', permission: PERMISSIONS.USER_MANAGEMENT },
    { path: '/audit-logs', label: 'Audit Log', icon: 'bi-journal-text', permission: PERMISSIONS.USER_MANAGEMENT },
    { path: '/roles', label: 'Role Management', icon: 'bi-shield-check', permission: PERMISSIONS.ROLE_MANAGEMENT },
  ];

  const visibleNavItems = navItems.filter((item) => hasPermission(item.permission));
  const adminPaths = new Set(['/users', '/roles', '/audit-logs']);
  const isAdmin = hasRole(ROLES.ADMIN);
  const primaryNavItems = visibleNavItems.filter((item) => !adminPaths.has(item.path));
  const adminNavItems = isAdmin ? visibleNavItems.filter((item) => adminPaths.has(item.path)) : [];
  const isActive = (path) => location.pathname === path;

  useEffect(() => {
    try {
      window.localStorage.setItem('vbpm.desktopSidebarVisible', String(desktopSidebarVisible));
    } catch {}
  }, [desktopSidebarVisible]);

  const getRoleBadgeVariant = (role) => {
    const map = {
      Admin: 'danger',
      Designer: 'primary',
      Validator: 'warning',
    };
    return map[role] || 'secondary';
  };

  const SidebarLinks = ({ items, onNavigateLink, compact = false }) => (
    <>
      {items.map((item) => (
        <Nav.Link
          key={item.path}
          as={Link}
          to={item.path}
          onClick={onNavigateLink}
          className={`vbpm-side-link${isActive(item.path) ? ' is-active' : ''}`}
        >
          <i className={`bi ${item.icon}`}></i>
          <span className="vbpm-side-label">{item.label}</span>
          {!compact && isActive(item.path) && <span className="vbpm-side-dot" />}
        </Nav.Link>
      ))}
    </>
  );

  return (
    <>
      <style>{`
        .vbpm-shell {
          min-height: 100vh;
          display: flex;
          position: relative;
          background: linear-gradient(180deg, #fffdf8 0%, #f8fafc 100%);
        }
        .vbpm-sidebar {
          width: 268px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          padding: 18px 16px 16px;
          background: #fff;
          border-right: 1px solid #eceff3;
          box-shadow: 8px 0 28px rgba(15, 23, 42, 0.04);
          position: sticky;
          top: 0;
          height: 100vh;
          overflow: hidden;
          opacity: 1;
          transition: width 0.22s ease, padding 0.22s ease, opacity 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .vbpm-sidebar.is-hidden {
          width: 0;
          padding-left: 0;
          padding-right: 0;
          border-right-color: transparent;
          box-shadow: none;
          opacity: 0;
          pointer-events: none;
        }
        .vbpm-sidebar-head {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 4px;
        }
        .vbpm-sidebar-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          margin-right: -4px;
        }
        .vbpm-sidebar-body::-webkit-scrollbar {
          width: 8px;
        }
        .vbpm-sidebar-body::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.45);
          border-radius: 999px;
        }
        .vbpm-sidebar-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          padding: 10px 10px 18px;
          text-decoration: none;
          color: #0f172a;
          min-width: 0;
        }
        .vbpm-sidebar-brand:hover {
          color: #0f172a;
        }
        .vbpm-sidebar-brandmark {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);
          border: 1px solid #fecdd3;
          flex-shrink: 0;
        }
        .vbpm-sidebar-brandcopy {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .vbpm-sidebar-toggle {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.16s ease;
        }
        .vbpm-sidebar-toggle:hover,
        .vbpm-sidebar-toggle:focus {
          border-color: #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
        }
        .vbpm-sidebar-peek {
          position: fixed;
          left: 14px;
          top: 16px;
          z-index: 1031;
          width: 44px;
          height: 44px;
          border-radius: 16px;
          border: 1px solid #fecdd3;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
          color: #b91c1c;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(10px);
        }
        .vbpm-sidebar-brandcopy strong {
          font-size: 1.12rem;
          line-height: 1.1;
        }
        .vbpm-sidebar-brandcopy span {
          margin-top: 4px;
          color: #64748b;
          font-size: 0.76rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .vbpm-sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 8px;
        }
        .vbpm-side-link {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 46px;
          border-radius: 16px;
          padding: 0 12px;
          color: #334155;
          text-decoration: none;
          font-weight: 600;
          position: relative;
          transition: all 0.16s ease;
          min-width: 0;
        }
        .vbpm-side-link:hover,
        .vbpm-side-link:focus {
          color: #b91c1c;
          background: #fff5f5;
        }
        .vbpm-side-link.is-active {
          color: #b91c1c;
          background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);
          box-shadow: inset 0 0 0 1px #fecdd3;
        }
        .vbpm-side-link i {
          font-size: 0.95rem;
          width: 16px;
          text-align: center;
          flex-shrink: 0;
        }
        .vbpm-side-link span {
          min-width: 0;
        }
        .vbpm-side-label {
          flex: 1 1 auto;
          min-width: 0;
          overflow: visible;
          text-overflow: clip;
          white-space: normal;
          line-height: 1.15;
          font-size: 0.96rem;
        }
        .vbpm-side-dot {
          margin-left: 4px;
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #dc2626;
          flex-shrink: 0;
        }
        .vbpm-sidebar-section {
          margin-top: 18px;
          padding: 0 10px;
          color: #94a3b8;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .vbpm-sidebar-footer {
          margin-top: auto;
          padding-top: 18px;
          flex-shrink: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 18px);
        }
        .vbpm-sidebar-tools {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 12px;
        }
        .vbpm-user-card {
          border-radius: 20px;
          border: 1px solid #eceff3;
          background: #f8fafc;
          padding: 14px;
        }
        .vbpm-user-head {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .vbpm-user-avatar {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          background: #dc2626;
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 1rem;
        }
        .vbpm-user-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .vbpm-user-copy strong {
          font-size: 0.95rem;
          color: #0f172a;
          line-height: 1.1;
        }
        .vbpm-user-copy small {
          margin-top: 4px;
          color: #64748b;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vbpm-user-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 12px;
        }
        .vbpm-main {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .vbpm-content {
          width: 100%;
          padding: 14px 16px 24px;
        }
        .vbpm-mobile-top {
          position: sticky;
          top: 0;
          z-index: 1030;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid #eceff3;
        }
        .vbpm-mobile-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #0f172a;
          text-decoration: none;
          min-width: 0;
        }
        .vbpm-mobile-brand strong {
          font-size: 1rem;
        }
        .vbpm-mobile-icon {
          width: 40px;
          height: 40px;
          border-radius: 14px;
          border: 1px solid #fecdd3;
          background: #fff1f2;
          color: #b91c1c;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .vbpm-mobile-user {
          border: 0;
          background: transparent;
          color: #334155;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .vbpm-mobile-user::after {
          display: none;
        }
        .vbpm-dropdown-menu.dropdown-menu {
          border: 0;
          border-radius: 18px;
          padding: 12px;
          min-width: 250px;
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.14);
        }
        .vbpm-mobile-header {
          background: #fff;
          border-bottom: 1px solid #eceff3;
        }
        .vbpm-mobile-nav .nav-link {
          border-radius: 16px;
          padding: 12px 14px;
        }
        .vbpm-mobile-section-title {
          color: #94a3b8;
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin: 18px 0 10px;
        }
        @media (max-width: 991.98px) {
          .vbpm-shell {
            display: block;
          }
        }
        @media (min-width: 992px) {
          .vbpm-content {
            padding: 18px 22px 28px;
          }
        }
      `}</style>

      <div className="vbpm-shell">
        <aside className={`vbpm-sidebar d-none d-lg-flex${desktopSidebarVisible ? '' : ' is-hidden'}`}>
          <div className="vbpm-sidebar-head">
            <Link to={homePath} className="vbpm-sidebar-brand">
              <span className="vbpm-sidebar-brandmark">
                <VBPMLogo size={40} />
              </span>
              <span className="vbpm-sidebar-brandcopy">
                <strong>V-BPM</strong>
                <span>Process workspace</span>
              </span>
            </Link>
            <button
              type="button"
              className="vbpm-sidebar-toggle"
              onClick={() => setDesktopSidebarVisible(false)}
              title="Hide navbar"
              aria-label="Hide navbar"
            >
              <i className="bi bi-layout-sidebar-inset"></i>
            </button>
          </div>

          <div className="vbpm-sidebar-body">
            <Nav className="vbpm-sidebar-nav flex-column">
              <SidebarLinks items={primaryNavItems} />
            </Nav>

            {adminNavItems.length > 0 && (
              <>
                <div className="vbpm-sidebar-section">Administration</div>
                <Nav className="vbpm-sidebar-nav flex-column">
                  <SidebarLinks items={adminNavItems} />
                </Nav>
              </>
            )}
          </div>

          <div className="vbpm-sidebar-footer">
            <div className="vbpm-sidebar-tools">
              <NotificationCenter />
            </div>
            <div className="vbpm-user-card">
              <div className="vbpm-user-head">
                <span className="vbpm-user-avatar">
                  <i className="bi bi-person-fill"></i>
                </span>
                <span className="vbpm-user-copy">
                  <strong>{user?.fullName}</strong>
                  <small>{user?.email}</small>
                </span>
              </div>
              <div className="vbpm-user-actions">
                <Badge bg={getRoleBadgeVariant(user?.role)}>{displayRole(user?.role)}</Badge>
                <Button variant="outline-danger" size="sm" onClick={handleLogout}>
                  <i className="bi bi-box-arrow-right me-2"></i>
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </aside>

        {!desktopSidebarVisible ? (
          <button
            type="button"
            className="vbpm-sidebar-peek d-none d-lg-inline-flex"
            onClick={() => setDesktopSidebarVisible(true)}
            title="Show navbar"
            aria-label="Show navbar"
          >
            <i className="bi bi-layout-sidebar"></i>
          </button>
        ) : null}

        <div className="vbpm-main">
          <header className="vbpm-mobile-top d-lg-none">
            <Button variant="light" onClick={() => setSidebarShow(true)} className="border-0 shadow-none px-2">
              <i className="bi bi-list fs-4"></i>
            </Button>

            <Link to={homePath} className="vbpm-mobile-brand">
              <span className="vbpm-mobile-icon">
                <VBPMLogo size={26} />
              </span>
              <strong>V-BPM</strong>
            </Link>

            <div className="d-flex align-items-center gap-2">
              <NotificationCenter />
              <Dropdown align="end">
                <Dropdown.Toggle variant="link" className="vbpm-mobile-user text-decoration-none">
                  <span className="vbpm-user-avatar" style={{ width: 34, height: 34, fontSize: '0.9rem' }}>
                    <i className="bi bi-person-fill"></i>
                  </span>
                </Dropdown.Toggle>
                <Dropdown.Menu className="vbpm-dropdown-menu">
                  <Dropdown.Header style={{ background: '#f8fafc', borderRadius: 12 }}>
                    <strong>{user?.fullName}</strong><br />
                    <small className="text-muted">{user?.email}</small><br />
                    <Badge bg={getRoleBadgeVariant(user?.role)} className="mt-2">{displayRole(user?.role)}</Badge>
                  </Dropdown.Header>
                  <Dropdown.Divider />
                  <Dropdown.Item onClick={handleLogout} className="text-danger">
                    <i className="bi bi-box-arrow-right me-2"></i>
                    Logout
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </header>

          <main className="flex-grow-1">
            <div className="vbpm-content">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <Offcanvas show={sidebarShow} onHide={() => setSidebarShow(false)} placement="start">
        <Offcanvas.Header closeButton className="vbpm-mobile-header">
          <Offcanvas.Title className="d-flex align-items-center gap-2">
            <VBPMLogo size={34} />
            <span>V-BPM</span>
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body style={{ background: '#f9fafb' }}>
          <Nav className="flex-column vbpm-mobile-nav">
            <div className="vbpm-mobile-section-title">Navigation</div>
            <SidebarLinks items={primaryNavItems} onNavigateLink={() => setSidebarShow(false)} compact />
            {adminNavItems.length > 0 && (
              <>
                <div className="vbpm-mobile-section-title">Administration</div>
                <SidebarLinks items={adminNavItems} onNavigateLink={() => setSidebarShow(false)} compact />
              </>
            )}
          </Nav>

          <div className="mt-4 pt-3 border-top">
            <div className="vbpm-user-card">
              <div className="vbpm-user-head">
                <span className="vbpm-user-avatar">
                  <i className="bi bi-person-fill"></i>
                </span>
                <span className="vbpm-user-copy">
                  <strong>{user?.fullName}</strong>
                  <small>{user?.email}</small>
                </span>
              </div>
              <div className="d-flex align-items-center justify-content-between mt-3 gap-2 flex-wrap">
                <Badge bg={getRoleBadgeVariant(user?.role)}>{displayRole(user?.role)}</Badge>
                <Button variant="outline-danger" size="sm" onClick={handleLogout}>
                  <i className="bi bi-box-arrow-right me-2"></i>
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}

export default Layout;
