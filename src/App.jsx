import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider, ROLES } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import './App.css';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const RoleManagement = lazy(() => import('./pages/RoleManagement'));
const CompanyManagement = lazy(() => import('./pages/CompanyManagement'));
const ProcessManagement = lazy(() => import('./pages/ProcessManagement'));
const OrgChart = lazy(() => import('./pages/OrgChart'));
const ProcessLibrary = lazy(() => import('./pages/ProcessLibrary'));
const Unauthorized = lazy(() => import('./pages/Unauthorized'));
const Layout = lazy(() => import('./components/Layout'));
const SimulationScenarios = lazy(() => import('./pages/SimulationScenarios'));

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

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<AppRouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            <Route
              path="/"
              element={
                <ProtectedRoute allowedRoles={Object.values(ROLES)}>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="dashboard" element={<Dashboard />} />

              <Route
                path="processes"
                element={
                  <ProtectedRoute
                    allowedRoles={[
                      ROLES.ADMINISTRATOR,
                      ROLES.COMPANY_ADMINISTRATOR,
                      ROLES.BUSINESS_ANALYST,
                      ROLES.PROCESS_OWNER,
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
                      ROLES.ADMINISTRATOR,
                      ROLES.COMPANY_ADMINISTRATOR,
                      ROLES.BUSINESS_ANALYST,
                      ROLES.PROCESS_OWNER,
                    ]}
                  >
                    <SimulationScenarios />
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
                path="companies"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR, ROLES.COMPANY_ADMINISTRATOR]}>
                    <CompanyManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="users"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR, ROLES.COMPANY_ADMINISTRATOR]}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="roles"
                element={
                  <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR]}>
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
