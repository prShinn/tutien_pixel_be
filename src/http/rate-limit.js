const REDIS_INCREMENT_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  else
    local ttl = redis.call('PTTL', KEYS[1])
    if ttl < 0 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
  end
  local pttl = redis.call('PTTL', KEYS[1])
  return { count, pttl }
`;

function createRateLimiter({
  windowMs,
  max,
  key = (request) => request.ip || 'unknown',
  redis = null,
  prefix = 'tu-tien:rl',
  maxEntries = 20000,
}) {
  const entries = new Map();
  let lastRedisWarnAt = 0;

  function checkLocal(identity, response, request, next) {
    const now = Date.now();
    let entry = entries.get(identity);
    if (!entry || entry.resetAt <= now) {
      if (entry) entries.delete(identity);
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(identity, entry);
    }
    entry.count += 1;
    if (entries.size > maxEntries) {
      for (const [id, value] of entries) {
        if (value.resetAt <= now) entries.delete(id);
      }
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    }
    if (entry.count > max) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return response.status(429).json({
        ok: false,
        error: 'Yêu cầu quá thường xuyên',
        code: 'RATE_LIMITED',
        message: 'Yêu cầu quá thường xuyên',
        requestId: request.requestId,
      });
    }
    return next();
  }

  return function rateLimit(request, response, next) {
    const identity = String(key(request));
    if (!redis || (redis.status !== undefined && redis.status !== 'ready')) {
      return checkLocal(identity, response, request, next);
    }
    const redisKey = `${prefix}:${identity}`;
    Promise.resolve(redis.eval(REDIS_INCREMENT_LUA, 1, redisKey, String(windowMs)))
      .then((res) => {
        const count = Number(Array.isArray(res) ? res[0] : 0);
        const pttl = Math.max(1000, Number(Array.isArray(res) ? res[1] : windowMs));
        if (count > max) {
          response.set('Retry-After', String(Math.max(1, Math.ceil(pttl / 1000))));
          return response.status(429).json({
            ok: false,
            error: 'Yêu cầu quá thường xuyên',
            code: 'RATE_LIMITED',
            message: 'Yêu cầu quá thường xuyên',
            requestId: request.requestId,
          });
        }
        return next();
      })
      .catch(() => {
        const now = Date.now();
        if (now - lastRedisWarnAt >= 30000) {
          lastRedisWarnAt = now;
          process.stderr.write(`${JSON.stringify({ level: 'warn', event: 'rate_limit_redis_fallback', prefix })}\n`);
        }
        return checkLocal(identity, response, request, next);
      });
  };
}

module.exports = { createRateLimiter };
