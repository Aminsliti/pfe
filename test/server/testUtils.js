export function makeResult(rows = [], overrides = {}) {
  return {
    rows,
    rowCount: overrides.rowCount ?? rows.length,
    ...overrides,
  };
}

export function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

export function createQueryMock(handlers = []) {
  return jest.fn(async (sql, params = []) => {
    const normalized = normalizeSql(sql);

    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      return makeResult([]);
    }

    for (const handler of handlers) {
      const matches =
        typeof handler.match === 'function'
          ? handler.match({ sql: normalized, params })
          : handler.match instanceof RegExp
            ? handler.match.test(normalized)
            : normalized.includes(handler.match);

      if (!matches) {
        continue;
      }

      if (typeof handler.result === 'function') {
        return handler.result({ sql: normalized, params });
      }

      return handler.result;
    }

    throw new Error(`Unhandled query: ${normalized}\nparams: ${JSON.stringify(params)}`);
  });
}

export function createClientMock(handlers = []) {
  return {
    query: createQueryMock(handlers),
    release: jest.fn(),
  };
}

export function createRequestUserMiddleware(user = null) {
  const publicPrefixes = [
    '/api/login',
    '/api/forgot-password',
    '/api/verify-reset-code',
    '/api/reset-password',
  ];

  return (req, res, next) => {
    if (publicPrefixes.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }

    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    req.user = user;
    return next();
  };
}

export function createUser(overrides = {}) {
  const baseRole = overrides.role ?? 'Admin';

  return {
    id: 1,
    username: 'admin',
    email: 'admin@pfe.com',
    fullName: 'System Administrator',
    role: baseRole,
    primaryRole: baseRole,
    activeRoles: [baseRole],
    additionalRoles: [],
    companyId: null,
    company: null,
    permissions: [
      'user_management',
      'role_management',
      'view_dashboard',
      'view_reports',
      'manage_processes',
      'manage_risks',
    ],
    ...overrides,
  };
}
