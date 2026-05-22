/** @jest-environment node */

import {
  createAccessToken,
  extractBearerToken,
  getJwtExpiresInSeconds,
  JwtVerificationError,
  parseDurationSeconds,
  verifyAccessToken,
} from '../../server/utils/jwt.js';

describe('jwt utilities', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalExpiresIn = process.env.JWT_EXPIRES_IN;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
    process.env.JWT_EXPIRES_IN = '15m';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }

    if (originalExpiresIn === undefined) {
      delete process.env.JWT_EXPIRES_IN;
    } else {
      process.env.JWT_EXPIRES_IN = originalExpiresIn;
    }
  });

  it('creates and verifies signed access tokens', () => {
    const tokenDetails = createAccessToken(
      { id: 42, username: 'admin', role: 'Admin' },
      { sessionId: 'session-42', now: 1000 }
    );

    expect(tokenDetails.tokenType).toBe('Bearer');
    expect(tokenDetails.expiresIn).toBe(900);

    const payload = verifyAccessToken(tokenDetails.token, { now: 1001 });
    expect(payload.userId).toBe(42);
    expect(payload.username).toBe('admin');
    expect(payload.sid).toBe('session-42');
  });

  it('rejects tampered and expired tokens', () => {
    const tokenDetails = createAccessToken({ id: 5, username: 'designer', role: 'Designer' }, { now: 2000 });
    const tamperedToken = `${tokenDetails.token.slice(0, -1)}x`;

    expect(() => verifyAccessToken(tamperedToken, { now: 2001 })).toThrow(JwtVerificationError);
    expect(() => verifyAccessToken(tokenDetails.token, { now: 2000 + 901 })).toThrow(JwtVerificationError);
  });

  it('parses bearer headers and duration settings', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(parseDurationSeconds('2h')).toBe(7200);
    expect(parseDurationSeconds('30m')).toBe(1800);
    expect(() => extractBearerToken('Basic abc')).toThrow(JwtVerificationError);
  });

  it('defaults sessions to thirty days when no expiry is configured', () => {
    delete process.env.JWT_EXPIRES_IN;

    expect(getJwtExpiresInSeconds()).toBe(30 * 24 * 60 * 60);
  });
});
