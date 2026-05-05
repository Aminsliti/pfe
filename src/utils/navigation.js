import { PERMISSIONS } from '../contexts/AuthContext';

function getHomePath(user, permissions = []) {
  if (!user) {
    return '/login';
  }

  if (permissions.includes(PERMISSIONS.VIEW_DASHBOARD) || permissions.includes(PERMISSIONS.VIEW_REPORTS)) {
    return '/process-library';
  }

  return '/process-library';
}

function isUsableReturnPath(pathname) {
  return Boolean(pathname) && !['/login', '/unauthorized'].includes(pathname);
}

export { getHomePath, isUsableReturnPath };
