const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createCultivationRouter({ auth, cultivation, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const cultivationLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 60,
    redis: rateLimitRedis,
    key: (request) => `cultivation:${request.auth?.sub || request.ip}`,
  });
  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort */ }
  }
  router.post('/player/cultivation/absorb', auth.authenticate, cultivationLimiter, asyncRoute(async (req, res) => {
    const { requestId, itemCode } = req.body || {};
    const data = await cultivation.absorb(req.auth.sub, requestId, itemCode);
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  router.post('/player/cultivation/breakthrough', auth.authenticate, cultivationLimiter, asyncRoute(async (req, res) => {
    const { requestId, pillCode } = req.body || {};
    const data = await cultivation.breakthrough(req.auth.sub, requestId, { pillCode });
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  return router;
}

module.exports = { createCultivationRouter };
