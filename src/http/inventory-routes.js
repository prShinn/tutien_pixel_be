const express = require('express');
const asyncRoute = require('./async-route');

function createInventoryRouter({ auth, inventory, onPlayerChanged = null }) {
  const router = express.Router();
  router.post('/player/inventory/use', auth.authenticate, asyncRoute(async (req, res) => {
    const { requestId, itemCode } = req.body || {};
    const data = await inventory.use(req.auth.sub, requestId, itemCode);
    if (onPlayerChanged) {
      try { await onPlayerChanged(req.auth.sub); } catch { /* socket sync best-effort */ }
    }
    return res.json(data);
  }));
  return router;
}

module.exports = { createInventoryRouter };
