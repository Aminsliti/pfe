import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import RoleManagement from './pages/RoleManagement';
import CompanyManagement from './pages/CompanyManagement';
import ProcessManagement from './pages/ProcessManagement';
import Unauthorized from './pages/Unauthorized';
import Layout from './components/Layout';
import { ROLES } from './contexts/AuthContext';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          
          <Route path="/" element={
            <ProtectedRoute allowedRoles={Object.values(ROLES)}>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            
            <Route path="processes" element={
              <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR, ROLES.BUSINESS_ANALYST, ROLES.PROCESS_OWNER]}>
                <ProcessManagement />
              </ProtectedRoute>
            } />
            
            <Route path="companies" element={
              <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR]}>
                <CompanyManagement />
              </ProtectedRoute>
            } />
            
            <Route path="users" element={
              <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR]}>
                <UserManagement />
              </ProtectedRoute>
            } />
            
            <Route path="roles" element={
              <ProtectedRoute allowedRoles={[ROLES.ADMINISTRATOR]}>
                <RoleManagement />
              </ProtectedRoute>
            } />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;

