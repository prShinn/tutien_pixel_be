const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createRetentionRouter({ auth, retention, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const claimLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 30,
    redis: rateLimitRedis,
    key: (request) => `retention_claim:${request.auth?.sub || request.ip}`,
  });

  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort after commit */ }
  }

  router.use('/retention', auth.authenticate);
  router.get('/retention/status', asyncRoute(async (req, res) => res.json({ ok: true, ...await retention.getStatus(req.auth.sub) })));
  router.post('/retention/checkin/claim', claimLimiter, asyncRoute(async (req, res) => {
    const data = await retention.claimCheckin(req.auth.sub, req.body?.requestId);
    await notifySync(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  return router;
}

module.exports = { createRetentionRouter };
