const FALLBACK_API_ORIGIN = 'http://localhost:3001';

function getBrowserHostname() {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return null;
  }

  return window.location.hostname;
}

function getExplicitApiOrigin() {
  const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '');
  }

  return null;
}

export function getApiOrigin() {
  const explicitOrigin = getExplicitApiOrigin();

  if (explicitOrigin) {
    return explicitOrigin;
  }

  const hostname = getBrowserHostname();

  if (hostname) {
    return `${window.location.protocol}//${hostname}:3001`;
  }

  return FALLBACK_API_ORIGIN;
}

export const API_BASE = `${getApiOrigin()}/api`;

export function apiUrl(path = '') {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

export function isApiUrl(url) {
  if (!url) {
    return false;
  }

  if (url.startsWith('/api/')) {
    return true;
  }

  try {
    const parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : FALLBACK_API_ORIGIN);
    const configuredApiOrigin = new URL(getApiOrigin());

    return parsedUrl.origin === configuredApiOrigin.origin && parsedUrl.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}
