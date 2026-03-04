import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

// API base URL
const API_URL = 'http://localhost:3001/api';

export const ROLES = {
  ADMINISTRATOR: 'Administrator',
  BUSINESS_ANALYST: 'Business Analyst',
  PROCESS_OWNER: 'Process Owner',
  RISK_MANAGER: 'Risk Manager',
  VIEWER: 'Viewer',
};

export const PERMISSIONS = {
  USER_MANAGEMENT: 'user_management',
  ROLE_MANAGEMENT: 'role_management',
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',
  MANAGE_PROCESSES: 'manage_processes',
  MANAGE_RISKS: 'manage_risks',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for persisted session
    const savedUser = localStorage.getItem('currentUser');
    const savedPermissions = localStorage.getItem('permissions');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
      if (savedPermissions) {
        setPermissions(JSON.parse(savedPermissions));
      }
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        setUser(data.user);
        setPermissions(data.permissions || []);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        localStorage.setItem('permissions', JSON.stringify(data.permissions || []));
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Network error. Please try again.' };
    }
  };

  const logout = () => {
    setUser(null);
    setPermissions([]);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('permissions');
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    return permissions.includes(permission);
  };

  const hasRole = (role) => {
    if (!user) return false;
    return user.role === role;
  };

  const hasAnyRole = (roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  // User management functions - API calls
  const getAllUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/users`);
      if (response.ok) {
        return await response.json();
      }
      return [];
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
  };

  const createUser = async (userData) => {
    try {
      const response = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, user: data };
      }
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const updateUser = async (userId, userData) => {
    try {
      const response = await fetch(`${API_URL}/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, user: data };
      }
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error updating user:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const deleteUser = async (userId) => {
    try {
      const response = await fetch(`${API_URL}/users/${userId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        return { success: true };
      }
      const data = await response.json();
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: 'Network error' };
    }
  };

  // Role management functions - API calls
  const getAllRoles = async () => {
    try {
      const response = await fetch(`${API_URL}/roles`);
      if (response.ok) {
        return await response.json();
      }
      return [];
    } catch (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
  };

  const getAllPermissions = async () => {
    try {
      const response = await fetch(`${API_URL}/permissions`);
      if (response.ok) {
        return await response.json();
      }
      return [];
    } catch (error) {
      console.error('Error fetching permissions:', error);
      return [];
    }
  };

  const getRolesWithPermissions = async () => {
    try {
      const response = await fetch(`${API_URL}/roles-with-permissions`);
      if (response.ok) {
        return await response.json();
      }
      return [];
    } catch (error) {
      console.error('Error fetching roles with permissions:', error);
      return [];
    }
  };

  const updateRolePermissions = async (roleId, permissionIds) => {
    try {
      const response = await fetch(`${API_URL}/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissionIds }),
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error updating role permissions:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const createRole = async (roleData) => {
    try {
      const response = await fetch(`${API_URL}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(roleData),
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, role: data };
      }
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error creating role:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const updateRole = async (roleId, roleData) => {
    try {
      const response = await fetch(`${API_URL}/roles/${roleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(roleData),
      });

      const data = await response.json();
      if (response.ok) {
        return { success: true, role: data };
      }
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error updating role:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const deleteRole = async (roleId) => {
    try {
      const response = await fetch(`${API_URL}/roles/${roleId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        return { success: true };
      }
      const data = await response.json();
      return { success: false, error: data.error };
    } catch (error) {
      console.error('Error deleting role:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const value = {
    user,
    permissions,
    loading,
    login,
    logout,
    hasPermission,
    hasRole,
    hasAnyRole,
    createUser,
    updateUser,
    deleteUser,
    getAllUsers,
    getAllRoles,
    getAllPermissions,
    getRolesWithPermissions,
    updateRolePermissions,
    createRole,
    updateRole,
    deleteRole,
    ROLES,
    PERMISSIONS,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;

