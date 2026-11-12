const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createAlchemyRouter({ auth, alchemy, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const alchemyLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 60,
    redis: rateLimitRedis,
    key: (request) => `alchemy_brew:${request.auth?.sub || request.ip}`,
  });

  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort after commit */ }
  }

  router.get('/alchemy/recipes', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await alchemy.listRecipes(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  router.get('/alchemy/history', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await alchemy.listHistory(req.auth.sub, req.query || {});
    return res.json({ ok: true, ...data });
  }));

  router.post('/player/alchemy/brew', auth.authenticate, alchemyLimiter, asyncRoute(async (req, res) => {
    const { requestId, recipeCode } = req.body || {};
    const data = await alchemy.brew(req.auth.sub, requestId, recipeCode);
    await notifySync(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  return router;
}

module.exports = { createAlchemyRouter };
