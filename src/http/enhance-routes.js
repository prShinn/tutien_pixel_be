const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createEnhanceRouter({ auth, enhance, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const enhanceLimiter = createRateLimiter({
    windowMs: 10_000,
    max: 15,
    redis: rateLimitRedis,
    key: (request) => `equip_enhance:${request.auth?.sub || request.ip}`,
  });

  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort after commit */ }
  }

  router.get('/player/enhance/config', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await enhance.getConfig(req.auth.sub, req.query || {});
    return res.json({ ok: true, ...data });
  }));

  router.post('/player/equipment/enhance', auth.authenticate, enhanceLimiter, asyncRoute(async (req, res) => {
    const data = await enhance.enhance(req.auth.sub, req.body || {});
    await notifySync(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  return router;
}

module.exports = { createEnhanceRouter };
