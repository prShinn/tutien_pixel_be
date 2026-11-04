const { timingSafeEqual } = require('node:crypto');
const { DomainError } = require('../domain');

function equalSecret(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

function createAdminAuth({ auth, apiKey }) {
  return async function authenticateAdmin(req, _res, next) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    try {
      if (token) {
        const identity = await auth.authenticateToken(token);
        if (!['GM', 'ADMIN'].includes(identity.role)) throw new DomainError('FORBIDDEN', 'Tài khoản không có quyền quản trị', 403);
        req.auth = identity;
        return next();
      }
      const legacyKey = req.get('x-admin-key') || '';
      if (!apiKey || !equalSecret(legacyKey, apiKey)) throw new DomainError('UNAUTHORIZED', 'Thiếu quyền quản trị', 401);
      req.auth = { sub: 'legacy-admin-key', role: 'ADMIN' };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createAdminAuth };
