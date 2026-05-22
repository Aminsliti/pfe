import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

const JWT_ALGORITHM = 'HS256';
const JWT_TYPE = 'JWT';
const JWT_ISSUER = 'v-bpm-platform';
const JWT_AUDIENCE = 'v-bpm-api';
const DEFAULT_EXPIRES_IN = '30d';
const MIN_PRODUCTION_SECRET_LENGTH = 32;
let warnedAboutFallbackSecret = false;

export class JwtVerificationError extends Error {
  constructor(message, code = 'invalid_token') {
    super(message);
    this.name = 'JwtVerificationError';
    this.code = code;
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(segment) {
  if (typeof segment !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new JwtVerificationError('Malformed token payload.');
  }

  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new JwtVerificationError('Malformed token payload.');
  }
}

function sign(input, secret) {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getJwtSecret() {
  const configuredSecret = String(process.env.JWT_SECRET || '').trim();

  if (configuredSecret) {
    if (process.env.NODE_ENV === 'production' && configuredSecret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }

    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production.');
  }

  if (!warnedAboutFallbackSecret && process.env.NODE_ENV !== 'test') {
    console.warn('[security] JWT_SECRET is not set. Using a development-only fallback secret.');
    warnedAboutFallbackSecret = true;
  }

  return 'v-bpm-development-secret-change-before-production';
}

export function parseDurationSeconds(value = DEFAULT_EXPIRES_IN) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  const normalizedValue = String(value || DEFAULT_EXPIRES_IN).trim();
  const match = normalizedValue.match(/^(\d+)\s*([smhd])?$/i);

  if (!match) {
    throw new Error(`Invalid JWT_EXPIRES_IN value "${normalizedValue}". Use values like 15m, 8h, or 30d.`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  };

  return Math.max(1, amount * multipliers[unit]);
}

export function getJwtExpiresInSeconds() {
  return parseDurationSeconds(process.env.JWT_EXPIRES_IN || DEFAULT_EXPIRES_IN);
}

export function createAccessToken(user, { sessionId = null, now = Math.floor(Date.now() / 1000) } = {}) {
  const userId = Number(user?.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Cannot create an access token without a valid user id.');
  }

  const expiresIn = getJwtExpiresInSeconds();
  const header = {
    alg: JWT_ALGORITHM,
    typ: JWT_TYPE,
  };
  const payload = {
    typ: 'access',
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    sub: String(userId),
    username: user.username || null,
    role: user.primaryRole || user.role || null,
    sid: sessionId || null,
    iat: now,
    exp: now + expiresIn,
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const token = `${signingInput}.${sign(signingInput, getJwtSecret())}`;

  return {
    token,
    tokenType: 'Bearer',
    expiresIn,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyAccessToken(token, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new JwtVerificationError('Missing access token.', 'missing_token');
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new JwtVerificationError('Malformed access token.');
  }

  const [encodedHeader, encodedPayload, signature] = segments;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(signingInput, getJwtSecret());

  if (!safeEqual(signature, expectedSignature)) {
    throw new JwtVerificationError('Invalid access token signature.');
  }

  const header = decodeJson(encodedHeader);
  const payload = decodeJson(encodedPayload);

  if (header.alg !== JWT_ALGORITHM || header.typ !== JWT_TYPE) {
    throw new JwtVerificationError('Unsupported access token header.');
  }

  if (payload.typ !== 'access' || payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) {
    throw new JwtVerificationError('Access token is not valid for this API.');
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new JwtVerificationError('Access token subject is invalid.');
  }

  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) {
    throw new JwtVerificationError('Access token has expired.', 'expired_token');
  }

  if (payload.nbf !== undefined && Number(payload.nbf) > now) {
    throw new JwtVerificationError('Access token is not active yet.', 'inactive_token');
  }

  return {
    ...payload,
    userId,
  };
}

export function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const parts = String(headerValue).trim().split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
    throw new JwtVerificationError('Invalid authorization header.', 'invalid_authorization_header');
  }

  return parts[1];
}
