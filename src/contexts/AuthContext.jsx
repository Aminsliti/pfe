import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

const API_URL = 'http://localhost:3001/api';
const ORIGINAL_FETCH =
  typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : async () => {
        throw new Error('Fetch is not available in this environment.');
      };

export const ROLES = {
  ADMIN: 'Admin',
  DESIGNER: 'Designer',
  VALIDATOR: 'Validator',
  PROCESS_OBSERVER: 'Process Observer',
};

const LEGACY_ROLE_MAP = {
  Administrator: ROLES.ADMIN,
  'Company Administrator': ROLES.ADMIN,
  'Business Analyst': ROLES.DESIGNER,
  'Process Owner': ROLES.DESIGNER,
  'Risk Manager': ROLES.VALIDATOR,
  Viewer: ROLES.PROCESS_OBSERVER,
};

export const PERMISSIONS = {
  USER_MANAGEMENT: 'user_management',
  ROLE_MANAGEMENT: 'role_management',
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_REPORTS: 'view_reports',
  MANAGE_PROCESSES: 'manage_processes',
  MANAGE_RISKS: 'manage_risks',
};

function getActiveRoleNames(user) {
  if (Array.isArray(user?.activeRoles) && user.activeRoles.length) {
    return [...new Set(user.activeRoles.map(canonicalizeRoleName).filter(Boolean))];
  }

  return user?.role ? [canonicalizeRoleName(user.role)] : [];
}

function canonicalizeRoleName(role) {
  return LEGACY_ROLE_MAP[role] || role || null;
}

function normalizeRoleAssignment(assignment = {}) {
  return {
    ...assignment,
    role: canonicalizeRoleName(assignment.role),
  };
}

function normalizeStoredUser(user) {
  if (!user) {
    return null;
  }

  const primaryRole = canonicalizeRoleName(user.primaryRole || user.role);
  const additionalRoles = Array.isArray(user.additionalRoles)
    ? user.additionalRoles.map(normalizeRoleAssignment)
    : [];
  const activeRoles = Array.isArray(user.activeRoles) && user.activeRoles.length
    ? [...new Set(user.activeRoles.map(canonicalizeRoleName).filter(Boolean))]
    : [...new Set([primaryRole, ...additionalRoles.filter((role) => role.active).map((role) => role.role)].filter(Boolean))];

  return {
    ...user,
    role: primaryRole,
    primaryRole,
    activeRoles,
    additionalRoles,
  };
}

export function getStoredUser() {
  try {
    return normalizeStoredUser(JSON.parse(localStorage.getItem('currentUser') || 'null'));
  } catch {
    return null;
  }
}

export function resolveRequestUrl(input) {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }

  return '';
}

export function shouldAttachUserHeader(url) {
  return url.startsWith(API_URL) || url.startsWith('/api/') || url.includes('://localhost:3001/api');
}

export function createAuthedFetch(fetchImpl = ORIGINAL_FETCH) {
  return (input, init = undefined) => {
    const requestUrl = resolveRequestUrl(input);
    const currentUser = getStoredUser();

    if (!currentUser?.id || !shouldAttachUserHeader(requestUrl)) {
      return fetchImpl(input, init);
    }

    const sourceHeaders =
      init?.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders);

    if (!headers.has('x-user-id')) {
      headers.set('x-user-id', String(currentUser.id));
    }

    return fetchImpl(input, {
      ...init,
      headers,
    });
  };
}

async function parseResponse(response, fallbackError = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const errorText = isJson ? payload?.error : payload;
    throw new Error(errorText || fallbackError);
  }

  return payload;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const authedFetch = createAuthedFetch();
    globalThis.fetch = authedFetch;

    return () => {
      globalThis.fetch = ORIGINAL_FETCH;
    };
  }, []);

  useEffect(() => {
    const savedUser = getStoredUser();
    const savedPermissions = localStorage.getItem('permissions');

    if (savedUser) {
      setUser(savedUser);
      setCompany(savedUser.company || null);
      localStorage.setItem('currentUser', JSON.stringify(savedUser));
      if (savedPermissions) {
        try {
          setPermissions(JSON.parse(savedPermissions));
        } catch {
          setPermissions([]);
        }
      }
    }

    setLoading(false);
  }, []);

  const login = async (username, password) => {
    try {
      const response = await ORIGINAL_FETCH(`${API_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await parseResponse(response, 'Login failed');
      const nextPermissions = data.permissions || [];
      const normalizedUser = normalizeStoredUser(data.user);

      setUser(normalizedUser);
      setPermissions(nextPermissions);
      setCompany(normalizedUser?.company || null);
      localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
      localStorage.setItem('permissions', JSON.stringify(nextPermissions));

      return { success: true, user: normalizedUser, permissions: nextPermissions };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Network error. Please try again.' };
    }
  };

  const refreshCurrentUser = async () => {
    if (!user?.id) {
      return { success: false, error: 'No active session.' };
    }

    try {
      const response = await fetch(`${API_URL}/session`);
      const data = await parseResponse(response, 'Failed to refresh session');
      const nextPermissions = data.permissions || [];
      const normalizedUser = normalizeStoredUser(data.user);

      setUser(normalizedUser);
      setPermissions(nextPermissions);
      setCompany(normalizedUser?.company || null);
      localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
      localStorage.setItem('permissions', JSON.stringify(nextPermissions));

      return { success: true, user: normalizedUser, permissions: nextPermissions };
    } catch (error) {
      console.error('Session refresh error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const logout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('permissions');
    localStorage.removeItem('company');
    setUser(null);
    setPermissions([]);
    setCompany(null);
    setLoading(false);
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    return permissions.includes(permission);
  };

  const hasRole = (role) => getActiveRoleNames(user).includes(role);
  const hasAnyRole = (roles) => getActiveRoleNames(user).some((role) => roles.includes(role));
  const isGlobalAdmin = () => hasRole(ROLES.ADMIN) && !user?.companyId;
  const isCompanyAdmin = () => hasRole(ROLES.ADMIN) && !!user?.companyId;

  const getAllUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/users`);
      return await parseResponse(response, 'Failed to load users');
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

      const data = await parseResponse(response, 'Failed to create user');
      return { success: true, user: data };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: error.message || 'Network error' };
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

      const data = await parseResponse(response, 'Failed to update user');
      if (Number(userId) === Number(user?.id)) {
        await refreshCurrentUser();
      }
      return { success: true, user: data };
    } catch (error) {
      console.error('Error updating user:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const deleteUser = async (userId) => {
    try {
      const response = await fetch(`${API_URL}/users/${userId}`, {
        method: 'DELETE',
      });

      await parseResponse(response, 'Failed to delete user');
      return { success: true };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const getAllRoles = async () => {
    try {
      const response = await fetch(`${API_URL}/roles`);
      return await parseResponse(response, 'Failed to load roles');
    } catch (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
  };

  const getAllPermissions = async () => {
    try {
      const response = await fetch(`${API_URL}/permissions`);
      return await parseResponse(response, 'Failed to load permissions');
    } catch (error) {
      console.error('Error fetching permissions:', error);
      return [];
    }
  };

  const getRolesWithPermissions = async () => {
    try {
      const response = await fetch(`${API_URL}/roles-with-permissions`);
      return await parseResponse(response, 'Failed to load roles');
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

      await parseResponse(response, 'Failed to update role permissions');
      return { success: true };
    } catch (error) {
      console.error('Error updating role permissions:', error);
      return { success: false, error: error.message || 'Network error' };
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

      const data = await parseResponse(response, 'Failed to create role');
      return { success: true, role: data };
    } catch (error) {
      console.error('Error creating role:', error);
      return { success: false, error: error.message || 'Network error' };
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

      const data = await parseResponse(response, 'Failed to update role');
      return { success: true, role: data };
    } catch (error) {
      console.error('Error updating role:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const deleteRole = async (roleId) => {
    try {
      const response = await fetch(`${API_URL}/roles/${roleId}`, {
        method: 'DELETE',
      });

      await parseResponse(response, 'Failed to delete role');
      return { success: true };
    } catch (error) {
      console.error('Error deleting role:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  const value = {
    user,
    permissions,
    company,
    loading,
    login,
    refreshCurrentUser,
    logout,
    hasPermission,
    hasRole,
    hasAnyRole,
    isGlobalAdmin,
    isCompanyAdmin,
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
