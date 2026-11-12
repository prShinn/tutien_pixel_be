const express = require('express');
const asyncRoute = require('./async-route');

function createGameplayMutationRouter({ auth, equipment, skills, onPlayerChanged = null }) {
  const router = express.Router();
  async function notifySync(userId) {
    if (!onPlayerChanged) return;
    try { await onPlayerChanged(userId); } catch { /* socket sync best-effort */ }
  }
  router.post('/player/equipment/equip', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await equipment.equip(req.auth.sub, req.body);
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  router.post('/player/equipment/unequip', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await equipment.unequip(req.auth.sub, req.body);
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  router.post('/player/skills/learn', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await skills.learn(req.auth.sub, req.body);
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  router.put('/player/skills/equip', auth.authenticate, asyncRoute(async (req, res) => {
    const data = await skills.equip(req.auth.sub, req.body);
    await notifySync(req.auth.sub);
    return res.json(data);
  }));
  return router;
}

module.exports = { createGameplayMutationRouter };
