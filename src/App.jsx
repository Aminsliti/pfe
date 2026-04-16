import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, ROLES, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { getHomePath } from './utils/navigation';
import './App.css';

const Login = lazy(() => import('./pages/Login'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const RoleManagement = lazy(() => import('./pages/RoleManagement'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const ProcessManagement = lazy(() => import('./pages/ProcessManagement'));
const OrgChart = lazy(() => import('./pages/OrgChart'));
const ProcessLibrary = lazy(() => import('./pages/ProcessLibrary'));
const PublicPortal = lazy(() => import('./pages/PublicPortal'));
const Unauthorized = lazy(() => import('./pages/Unauthorized'));
const Layout = lazy(() => import('./components/Layout'));
const SimulationWorkbench = lazy(() => import('./pages/SimulationWorkbench'));

function AppRouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #fffdf8 0%, #f8fafc 100%)',
      }}
    >
      <div style={{ textAlign: 'center', color: '#475569' }}>
        <div
          className="spinner-border text-danger"
          role="status"
          style={{ width: '2.5rem', height: '2.5rem' }}
        />
        <div style={{ marginTop: 12, fontWeight: 600 }}>Loading workspace...</div>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { user, permissions } = useAuth();

  return <Navigate to={getHomePath(user, permissions)} replace />;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<AppRouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/portal" element={<PublicPortal />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={<HomeRedirect />} />

              <Route
                path="processes"
                element={
                  <ProtectedRoute
                    allowedRoles={[
                      ROLES.ADMIN,
                      ROLES.DESIGNER,
                      ROLES.VALIDATOR,
                      ROLES.PROCESS_OBSERVER,
                    ]}
                  >
                    <ProcessManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="process-library"
                element={
                  <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                    <ProcessLibrary />
                  </ProtectedRoute>
                }
              />
              <Route
                path="simulations"
                element={
                  <ProtectedRoute
                    allowedRoles={[
                      ROLES.ADMIN,
                      ROLES.DESIGNER,
                      ROLES.VALIDATOR,
                    ]}
                  >
                    <SimulationWorkbench />
                  </ProtectedRoute>
                }
              />
              <Route
                path="orgchart"
                element={
                  <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                    <OrgChart />
                  </ProtectedRoute>
                }
              />
              <Route
                path="users"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="audit-logs"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <AuditLogs />
                  </ProtectedRoute>
                }
              />
              <Route
                path="roles"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
                    <RoleManagement />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
