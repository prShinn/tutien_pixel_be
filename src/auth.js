const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DomainError, publicUser } = require('./domain');

function createAuth({ store, secret }) {
  const sign = (user) => jwt.sign({ sub: user.id, username: user.username, role: user.role }, secret, { expiresIn: '15m' });

  async function register({ username, password }) {
    const normalized = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,32}$/.test(normalized) || String(password || '').length < 8) {
      throw new DomainError('INVALID_CREDENTIALS', 'Username hoặc password không hợp lệ');
    }
    const user = { id: `usr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, username: normalized, passwordHash: await bcrypt.hash(password, 12), role: 'PLAYER', status: 'ACTIVE', createdAt: new Date().toISOString() };
    if (await store.findUserByUsername(normalized)) throw new DomainError('USERNAME_TAKEN', 'Username đã tồn tại', 409);
    await store.insertUser(user);
    return { user: publicUser(user), accessToken: sign(user) };
  }

  async function login({ username, password }) {
    const user = await store.findUserByUsername(String(username || '').trim().toLowerCase());
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) throw new DomainError('INVALID_CREDENTIALS', 'Thông tin đăng nhập không đúng', 401);
    return { user: publicUser(user), accessToken: sign(user) };
  }

  function authenticate(req, _res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new Error('missing');
      req.auth = jwt.verify(token, secret);
      next();
    } catch { next(new DomainError('UNAUTHORIZED', 'Token không hợp lệ hoặc đã hết hạn', 401)); }
  }

  return { register, login, authenticate };
}

module.exports = { createAuth };
