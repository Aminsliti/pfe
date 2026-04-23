import { createContext, useContext, useEffect, useState } from 'react';
import { apiUrl, isApiUrl } from '../utils/api';

const AuthContext = createContext(null);
const SESSION_EXPIRED_EVENT = 'vbpm:session-expired';
const SESSION_ID_KEY = 'currentSessionId';
const PRESENCE_PING_INTERVAL_MS = 45 * 1000;
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
};

export const ACTIVE_ROLES = Object.values(ROLES);

export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.DESIGNER]: 'Process Designer',
  [ROLES.VALIDATOR]: 'Process Manager',
};

const LEGACY_ROLE_MAP = {
  Administrator: ROLES.ADMIN,
  'Company Administrator': ROLES.ADMIN,
  'Business Analyst': ROLES.DESIGNER,
  'Process Owner': ROLES.DESIGNER,
  'Process Designer': ROLES.DESIGNER,
  'Risk Manager': ROLES.VALIDATOR,
  'Process Validator': ROLES.VALIDATOR,
  'Process Manager': ROLES.VALIDATOR,
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

function clearStoredSession() {
  try {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('permissions');
    sessionStorage.removeItem(SESSION_ID_KEY);
  } catch {}
}

function createSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getPresenceSessionId() {
  try {
    const existingValue = sessionStorage.getItem(SESSION_ID_KEY);
    if (existingValue) {
      return existingValue;
    }

    const nextValue = createSessionId();
    sessionStorage.setItem(SESSION_ID_KEY, nextValue);
    return nextValue;
  } catch {
    return createSessionId();
  }
}

export function getRoleDisplayName(role) {
  const canonicalRole = canonicalizeRoleName(role);
  return ROLE_LABELS[canonicalRole] || canonicalRole || '';
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
  return isApiUrl(url);
}

export function createAuthedFetch(fetchImpl = ORIGINAL_FETCH) {
  return async (input, init = undefined) => {
    const requestUrl = resolveRequestUrl(input);
    const currentUser = getStoredUser();
    const currentSessionId = getPresenceSessionId();

    if (!currentUser?.id || !shouldAttachUserHeader(requestUrl)) {
      return fetchImpl(input, init);
    }

    const sourceHeaders =
      init?.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined);
    const headers = new Headers(sourceHeaders);

    if (!headers.has('x-user-id')) {
      headers.set('x-user-id', String(currentUser.id));
    }

    if (currentSessionId && !headers.has('x-session-id')) {
      headers.set('x-session-id', currentSessionId);
    }

    const response = await fetchImpl(input, {
      ...init,
      headers,
    });

    if (response.status === 401 || response.status === 403) {
      try {
        const clone = response.clone();
        const payload = await clone.json().catch(() => null);
        const errorText = String(payload?.error || '').toLowerCase();

        if (errorText.includes('inactive') || errorText.includes('log in again') || errorText.includes('authentication required')) {
          clearStoredSession();
          window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { error: payload?.error || '' } }));
        }
      } catch {}
    }

    return response;
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
  const [loading, setLoading] = useState(true);

  const pingPresence = async (fetchImpl = fetch) => {
    const currentSessionUser = getStoredUser();
    if (!currentSessionUser?.id) {
      return { success: false, error: 'No active session.' };
    }

    try {
      const response = await fetchImpl(apiUrl('/presence/ping'), {
        method: 'POST',
      });

      await parseResponse(response, 'Failed to refresh presence');
      return { success: true };
    } catch (error) {
      console.error('Presence ping error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  useEffect(() => {
    const authedFetch = createAuthedFetch();
    globalThis.fetch = authedFetch;

    const handleSessionExpired = () => {
      setUser(null);
      setPermissions([]);
      setLoading(false);
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      globalThis.fetch = ORIGINAL_FETCH;
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  const refreshCurrentUser = async () => {
    const currentSessionUser = getStoredUser();
    if (!currentSessionUser?.id) {
      return { success: false, error: 'No active session.' };
    }

    try {
      const response = await fetch(apiUrl('/session'));
      const data = await parseResponse(response, 'Failed to refresh session');
      const nextPermissions = data.permissions || [];
      const normalizedUser = normalizeStoredUser(data.user);

      setUser(normalizedUser);
      setPermissions(nextPermissions);
      localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
      localStorage.setItem('permissions', JSON.stringify(nextPermissions));

      return { success: true, user: normalizedUser, permissions: nextPermissions };
    } catch (error) {
      console.error('Session refresh error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  };

  useEffect(() => {
    const savedUser = getStoredUser();
    const savedPermissions = localStorage.getItem('permissions');

    if (savedUser) {
      setUser(savedUser);
      localStorage.setItem('currentUser', JSON.stringify(savedUser));
      if (savedPermissions) {
        try {
          setPermissions(JSON.parse(savedPermissions));
        } catch {
          setPermissions([]);
        }
      }

      setLoading(false);
      refreshCurrentUser().catch(() => {});
      return;
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    pingPresence().catch(() => {});

    const intervalId = window.setInterval(() => {
      pingPresence().catch(() => {});
    }, PRESENCE_PING_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pingPresence().catch(() => {});
      }
    };

    const handleFocus = () => {
      pingPresence().catch(() => {});
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [user?.id]);

  const login = async (username, password) => {
    try {
      const response = await ORIGINAL_FETCH(apiUrl('/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, sessionId: getPresenceSessionId() }),
      });

      const data = await parseResponse(response, 'Login failed');
      const nextPermissions = data.permissions || [];
      const normalizedUser = normalizeStoredUser(data.user);

      setUser(normalizedUser);
      setPermissions(nextPermissions);
      localStorage.setItem('currentUser', JSON.stringify(normalizedUser));
      localStorage.setItem('permissions', JSON.stringify(nextPermissions));

      return { success: true, user: normalizedUser, permissions: nextPermissions };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message || 'Network error. Please try again.' };
    }
  };

  const logout = async () => {
    try {
      if (getStoredUser()?.id) {
        await fetch(apiUrl('/logout'), {
          method: 'POST',
        });
      }
    } catch (error) {
      console.error('Logout error:', error);
    }

    clearStoredSession();
    setUser(null);
    setPermissions([]);
    setLoading(false);
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    return permissions.includes(permission);
  };

  const hasRole = (role) => getActiveRoleNames(user).includes(role);
  const hasAnyRole = (roles) => getActiveRoleNames(user).some((role) => roles.includes(role));
  const isGlobalAdmin = () => hasRole(ROLES.ADMIN);
  const isCompanyAdmin = () => false;

  const getAllUsers = async () => {
    try {
      const response = await fetch(apiUrl('/users'));
      return await parseResponse(response, 'Failed to load users');
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    }
  };

  const createUser = async (userData) => {
    try {
      const response = await fetch(apiUrl('/users'), {
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
      const response = await fetch(apiUrl(`/users/${userId}`), {
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
      const response = await fetch(apiUrl(`/users/${userId}`), {
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
      const response = await fetch(apiUrl('/roles'));
      return await parseResponse(response, 'Failed to load roles');
    } catch (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
  };

  const getAllPermissions = async () => {
    try {
      const response = await fetch(apiUrl('/permissions'));
      return await parseResponse(response, 'Failed to load permissions');
    } catch (error) {
      console.error('Error fetching permissions:', error);
      return [];
    }
  };

  const getRolesWithPermissions = async () => {
    try {
      const response = await fetch(apiUrl('/roles-with-permissions'));
      return await parseResponse(response, 'Failed to load roles');
    } catch (error) {
      console.error('Error fetching roles with permissions:', error);
      return [];
    }
  };

  const updateRolePermissions = async (roleId, permissionIds) => {
    try {
      const response = await fetch(apiUrl(`/roles/${roleId}/permissions`), {
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
      const response = await fetch(apiUrl('/roles'), {
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
      const response = await fetch(apiUrl(`/roles/${roleId}`), {
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
      const response = await fetch(apiUrl(`/roles/${roleId}`), {
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
