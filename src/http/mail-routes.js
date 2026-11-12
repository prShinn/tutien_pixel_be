const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createMailRouter({ auth, mail, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const claimLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 30,
    redis: rateLimitRedis,
    key: (request) => `mail_claim:${request.auth?.sub || request.ip}`,
  });

  router.use('/mail', auth.authenticate);
  router.get('/mail', asyncRoute(async (req, res) => res.json({ ok: true, ...await mail.list(req.auth.sub, req.query) })));
  router.post('/mail/:id/claim', claimLimiter, asyncRoute(async (req, res) => {
    const result = await mail.claim(req.auth.sub, req.params.id, req.body?.requestId);
    if (onPlayerChanged) {
      try { await onPlayerChanged(req.auth.sub); } catch { /* socket sync best-effort after commit */ }
    }
    return res.json({ ok: true, ...result });
  }));

  return router;
}

module.exports = { createMailRouter };
