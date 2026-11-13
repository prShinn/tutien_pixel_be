const express = require('express');
const asyncRoute = require('./async-route');
const { createRateLimiter } = require('./rate-limit');

function createAdminRouter({ auth, adminWorlds, adminContent, skillVfx, mail, rateLimitRedis = null, store = null }) {
  const router = express.Router();
  const authorize = require('./admin-auth').createAdminAuth({ auth });
  const adminMailLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 30,
    redis: rateLimitRedis,
    key: (request) => `admin_mail:${request.auth?.sub || request.ip}`,
  });
  const largeWorldJson = express.json({ limit: '8mb' });
  router.use(authorize);
  router.use('/worlds', largeWorldJson);

  router.get('/worlds', (_req, res) => res.json(adminWorlds.list()));
  router.post('/worlds', asyncRoute(async (req, res) => res.status(201).json(await adminWorlds.create(req.body, req.auth.sub, req))));
  router.get('/worlds/:code/validate', (req, res) => res.json(adminWorlds.validate(req.params.code)));
  router.post('/worlds/:code/publish', asyncRoute(async (req, res) => res.json(await adminWorlds.publish(req.params.code, req.auth.sub, req))));
  router.get('/worlds/:code', (req, res) => res.json(adminWorlds.get(req.params.code)));
  router.put('/worlds/:code', asyncRoute(async (req, res) => res.json(await adminWorlds.update(req.params.code, req.body, req.auth.sub, req))));
  router.delete('/worlds/:code', asyncRoute(async (req, res) => res.json(await adminWorlds.remove(req.params.code, req.auth.sub, req))));
  router.post('/portals/link', asyncRoute(async (req, res) => res.status(201).json(await adminWorlds.linkPortal(req.body, req.auth.sub, req))));
  router.delete('/worlds/:code/portals/:portalId', asyncRoute(async (req, res) => res.json(await adminWorlds.deletePortal(req.params.code, req.params.portalId, req.auth.sub, req))));

  router.get('/content/:collection', asyncRoute(async (req, res) => res.json(await adminContent.list(req.params.collection, req.query))));
  router.post('/content/:collection', asyncRoute(async (req, res) => res.status(201).json(await adminContent.create(req.params.collection, req.body, req.auth.sub, req.requestId || req.get('x-request-id')))));
  router.put('/content/:collection/:id', asyncRoute(async (req, res) => res.json(await adminContent.update(req.params.collection, req.params.id, req.body, req.auth.sub, req.requestId || req.get('x-request-id')))));
  router.delete('/content/:collection/:id', asyncRoute(async (req, res) => res.json(await adminContent.remove(req.params.collection, req.params.id, req.auth.sub, req.requestId || req.get('x-request-id')))));

  // --- Account Moderation (Status, Role, Password Reset) ---
  if (store) {
    router.put('/accounts/:userId/status', asyncRoute(async (req, res) => {
      const { status } = req.body || {};
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'Trạng thái không hợp lệ (ACTIVE hoặc SUSPENDED)' });
      }
      if (req.params.userId === req.auth.sub && status === 'SUSPENDED') {
        return res.status(400).json({ ok: false, error: 'Không thể tự khóa tài khoản của chính mình' });
      }
      const user = await store.updateUserStatus(req.params.userId, status);
      if (!user) return res.status(404).json({ ok: false, error: 'Tài khoản không tồn tại' });
      res.json({ ok: true, user });
    }));

    router.put('/accounts/:userId/role', asyncRoute(async (req, res) => {
      const { role } = req.body || {};
      if (!['PLAYER', 'GM', 'ADMIN'].includes(role)) {
        return res.status(400).json({ ok: false, error: 'Quyền hạn không hợp lệ (PLAYER, GM, ADMIN)' });
      }
      if (req.params.userId === req.auth.sub && role !== 'ADMIN') {
        return res.status(400).json({ ok: false, error: 'Không thể tự hạ quyền ADMIN của chính mình' });
      }
      const user = await store.updateUserRole(req.params.userId, role);
      if (!user) return res.status(404).json({ ok: false, error: 'Tài khoản không tồn tại' });
      res.json({ ok: true, user });
    }));

    router.post('/accounts/:userId/reset-password', asyncRoute(async (req, res) => {
      const { newPassword } = req.body || {};
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: 'Mật khẩu mới phải từ 6 ký tự trở lên' });
      }
      const result = await store.resetUserPassword(req.params.userId, newPassword);
      res.json({ ok: true, result });
    }));

    // --- Server Operations & Global Balance Configuration ---
    router.get('/server-config', asyncRoute(async (_req, res) => {
      const record = await store.getAdminContentRecord('server_config', 'current');
      const defaults = {
        maintenanceMode: false,
        maintenanceMessage: 'Máy chủ đang trong thời gian bảo trì nâng cấp. Đạo hữu vui lòng quay lại sau!',
        dropRateMultiplier: 1.0,
        expMultiplier: 1.0,
        goldMultiplier: 1.0,
        announcement: 'Thiên Địa sơ khai, chúc các đạo hữu tu hành tinh tấn, sớm ngày đắc đạo!',
        updatedAt: new Date().toISOString(),
      };
      res.json({ ok: true, data: record?.data ? { ...defaults, ...record.data } : defaults, version: record?.version || 0 });
    }));

    router.put('/server-config', asyncRoute(async (req, res) => {
      const body = req.body || {};
      const defaults = {
        maintenanceMode: false,
        maintenanceMessage: 'Máy chủ đang trong thời gian bảo trì nâng cấp. Đạo hữu vui lòng quay lại sau!',
        dropRateMultiplier: 1.0,
        expMultiplier: 1.0,
        goldMultiplier: 1.0,
        announcement: 'Thiên Địa sơ khai, chúc các đạo hữu tu hành tinh tấn, sớm ngày đắc đạo!',
      };
      const data = {
        maintenanceMode: Boolean(body.maintenanceMode),
        maintenanceMessage: typeof body.maintenanceMessage === 'string' && body.maintenanceMessage.trim() ? body.maintenanceMessage.trim() : defaults.maintenanceMessage,
        dropRateMultiplier: Math.max(0.1, Math.min(10, Number(body.dropRateMultiplier) || 1.0)),
        expMultiplier: Math.max(0.1, Math.min(10, Number(body.expMultiplier) || 1.0)),
        goldMultiplier: Math.max(0.1, Math.min(10, Number(body.goldMultiplier) || 1.0)),
        announcement: typeof body.announcement === 'string' ? body.announcement.trim() : defaults.announcement,
        updatedAt: new Date().toISOString(),
        updatedBy: req.auth.sub,
      };
      const saved = await store.mutateAdminContent(req.auth.sub, 'server_config', 'current', data, false, req.requestId || req.get('x-request-id'));
      res.json({ ok: true, data: saved.data, version: saved.version });
    }));
  }

  router.get('/skill-vfx', asyncRoute(async (_req, res) => res.json(await skillVfx.list())));
  router.post('/skill-vfx', asyncRoute(async (req, res) => res.status(201).json(await skillVfx.create(req.body, req.auth.sub, req.requestId || req.get('x-request-id')))));
  router.put('/skill-vfx/:skillCode', asyncRoute(async (req, res) => res.json(await skillVfx.update(req.params.skillCode, req.body, req.auth.sub, req.requestId || req.get('x-request-id')))));
  router.delete('/skill-vfx/:skillCode', asyncRoute(async (req, res) => res.json(await skillVfx.remove(req.params.skillCode, req.auth.sub, req.requestId || req.get('x-request-id')))));

  if (mail) {
    router.post('/mail/send', adminMailLimiter, asyncRoute(async (req, res) => res.status(201).json({
      ok: true,
      ...await mail.sendSystemMail(req.auth.sub, req.body, req.requestId || req.get('x-request-id')),
    })));
  }
  return router;
}

module.exports = { createAdminRouter };
