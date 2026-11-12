const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createShopRouter({ auth, shop, rateLimitRedis = null, onPlayerChanged = null }) {
  const router = express.Router();
  const shopLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 60,
    redis: rateLimitRedis,
    key: (request) => `shop_tx:${request.auth?.sub || request.ip}`,
  });

  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort */ }
  }

  router.get('/catalog/items', (_req, res) => res.json({ items: shop.listCatalog() }));
  router.get('/shop/premium', (_req, res) => res.json({ ok: true, items: shop.listPremiumCatalog() }));

  router.post('/player/shop/buy', auth.authenticate, shopLimiter, asyncRoute(async (req, res) => {
    const { requestId, itemCode, quantity } = req.body || {};
    const data = await shop.buy(req.auth.sub, requestId, itemCode, quantity);
    await notifySync(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  router.post('/player/shop/sell', auth.authenticate, shopLimiter, asyncRoute(async (req, res) => {
    const { requestId, itemCode, quantity, instanceId } = req.body || {};
    const data = await shop.sell(req.auth.sub, requestId, itemCode, quantity, instanceId);
    await notifySync(req.auth.sub);
    return res.json({ ok: true, ...data });
  }));

  return router;
}

module.exports = { createShopRouter };
