const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const config = require('./config');
const { createMysqlStore } = require('./store/mysql-store');
const { createAuth } = require('./auth');
const { createPlayerService } = require('./player');
const { createShopService } = require('./shop');
const { createAuthRouter } = require('./http/auth-routes');
const { createPlayerRouter } = require('./http/player-routes');
const { createShopRouter } = require('./http/shop-routes');
const { createCatalogRouter } = require('./http/catalog-routes');
const { errorHandler } = require('./http/error-handler');
const { attachGameGateway } = require('./realtime/game-gateway');
const { attachRedisAdapter } = require('./realtime/redis-adapter');
const { createRoomCluster } = require('./realtime/room-cluster');
const { createGameplayService } = require('./realtime/gameplay-service');
const { createCatalogService } = require('./catalog/catalog-service');
const { createWorldService } = require('./world/world-service');
const { createInventoryService } = require('./inventory/inventory-service');
const { createCultivationService } = require('./cultivation/cultivation-service');
const { createInventoryRouter } = require('./http/inventory-routes');
const { createCultivationRouter } = require('./http/cultivation-routes');
const { createAlchemyService } = require('./alchemy/alchemy-service');
const { createAlchemyRouter } = require('./http/alchemy-routes');
const { createEquipmentService } = require('./equipment/equipment-service');
const { createEnhanceService } = require('./enhance/enhance-service');
const { createEnhanceRouter } = require('./http/enhance-routes');
const { createSkillService } = require('./skills/skill-service');
const { createGameplayMutationRouter } = require('./http/gameplay-mutation-routes');
const { createQuestService } = require('./quests/quest-service');
const { createQuestRouter } = require('./http/quest-routes');
const { createMailService } = require('./mail/mail-service');
const { createMailRouter } = require('./http/mail-routes');
const { createRetentionService } = require('./retention/retention-service');
const { createRetentionRouter } = require('./http/retention-routes');
const { createAdminWorldService } = require('./admin/admin-world-service');
const { createAdminContentService } = require('./admin/admin-content-service');
const { createSkillVfxService } = require('./admin/skill-vfx-service');
const { createAdminRouter } = require('./http/admin-routes');
const { createPrometheusMetrics } = require('./observability/prometheus-metrics');
function mergeContentOverrides(base, overrides, key) {
  const records = new Map(base.map((record) => [String(key(record)), record]));
  for (const override of overrides) {
    if (override.deleted) records.delete(String(override.id));
    else records.set(String(override.id), override.data);
  }
  return [...records.values()];
}

async function createApp() {
  const store = createMysqlStore(config.db);
  await store.init();

  const catalog = createCatalogService();
  const [worldOverrides, itemOverrides, skillOverrides, monsterOverrides, questOverrides, alchemyRecipeOverrides, lootTableOverrides, vfxProfiles] = await Promise.all([
    store.listAdminWorlds(),
    store.listAdminContentRecords('items'),
    store.listAdminContentRecords('skills'),
    store.listAdminContentRecords('monsters'),
    store.listAdminContentRecords('quests'),
    store.listAdminContentRecords('alchemyRecipes'),
    store.listAdminContentRecords('lootTables'),
    store.listAdminSkillVfx(),
  ]);
  for (const record of itemOverrides) catalog.applyAdminRecord('items', record.id, record);
  catalog.applyAdminCollection('skills', mergeContentOverrides(catalog.getAdminCollection('skills'), skillOverrides, (skill) => skill.code || skill.id));
  for (const record of monsterOverrides) catalog.applyAdminRecord('monsters', record.id, record);
  for (const record of alchemyRecipeOverrides) catalog.applyAdminRecord('alchemyRecipes', record.id, record);
  for (const record of lootTableOverrides) catalog.applyAdminRecord('lootTables', record.id, record);
  for (const [skillCode, profile] of Object.entries(vfxProfiles)) catalog.setSkillVfxProfile(skillCode, profile);
  store.bindCatalog?.({
    get items() { return catalog.listItems(); },
    get skills() { return catalog.listSkills(); },
    get realms() { return catalog.listRealms(); },
  });
  await store.backfillLegacyEquipment?.();
  const world = createWorldService({ overrides: worldOverrides });
  const auth = createAuth({ store, secret: config.jwtSecret });
  await auth.ensureAdminUser?.();
  const players = createPlayerService({ store, catalog, world });
  const inventory = createInventoryService({ store, catalog, players });
  const cultivation = createCultivationService({ store, catalog, players, inventory });
  const alchemy = createAlchemyService({ store, catalog, players });
  const equipment = createEquipmentService({ store, catalog, players });
  const skills = createSkillService({ store, catalog, players });
  const quests = createQuestService({ store, catalog, world, initialOverrides: questOverrides });
  const skillVfx = createSkillVfxService({ store, catalog });
  const shop = createShopService({ store, catalog, players });
  const mail = createMailService({ store, catalog, players });
  const retention = createRetentionService({ store, catalog, players });
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: config.corsOrigin, credentials: true } });
  const metrics = createPrometheusMetrics({ token: config.metricsToken });
  let realtimeAdapter;
  try { realtimeAdapter = await attachRedisAdapter(io, config.redisUrl); }
  catch (error) { await store.close(); throw error; }

  let rateLimitRedis = null;
  async function closeRateLimitRedis() {
    if (!rateLimitRedis) return;
    if (rateLimitRedis.status === 'ready') await rateLimitRedis.quit();
    else rateLimitRedis.disconnect();
  }
  if (config.redisUrl) {
    rateLimitRedis = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectionName: 'tu-tien-rate-limit',
    });
    let lastRateLimitRedisErrorAt = 0;
    rateLimitRedis.on('error', () => {
      const now = Date.now();
      if (now - lastRateLimitRedisErrorAt < 30000) return;
      lastRateLimitRedisErrorAt = now;
      process.stderr.write(`${JSON.stringify({ level: 'error', event: 'rate_limit_redis_connection_error' })}\n`);
    });
    try {
      await rateLimitRedis.connect();
    } catch (error) {
      await Promise.allSettled([closeRateLimitRedis(), realtimeAdapter.close(), store.close()]);
      throw error;
    }
  }

  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use((req, res, next) => {
    const provided = req.get('x-request-id');
    const requestId = typeof provided === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(provided)
      ? provided
      : `http_${crypto.randomUUID()}`;
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.set('X-Request-Id', requestId);
    res.once('finish', () => {
      const route = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : req.path;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const metricRoute = typeof req.route?.path === 'string' ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      metrics.observeRequest({ method: req.method, route: metricRoute, status: res.statusCode, durationSeconds: durationMs / 1000 });
      process.stdout.write(`${JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'info', event: 'http_request', requestId, method: req.method, route, status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100 })}\n`);
    });
    next();
  });
  const defaultJsonParser = express.json({ limit: '256kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/admin/worlds') ? next() : defaultJsonParser(req, res, next)));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tu-tien-pixel-be', time: new Date().toISOString() }));
  app.get('/api/health/ready', async (_req, res) => {
    let mysqlReady = false;
    let redisReady = !realtimeAdapter.enabled;
    try { await store.healthCheck(); mysqlReady = true; } catch { /* readiness reports the failed dependency */ }
    if (realtimeAdapter.enabled) {
      try { redisReady = await realtimeAdapter.healthCheck() && await roomCluster.healthCheck(); } catch { redisReady = false; }
    }
    const dependencies = { mysql: mysqlReady ? 'ready' : 'unavailable' };
    if (realtimeAdapter.enabled) dependencies.redis = redisReady ? 'ready' : 'unavailable';
    const readiness = { dependencies, realtime: roomCluster.enabled ? 'redis-room-owners' : 'single-process' };
    if (!mysqlReady || !redisReady) return res.status(503).json({ ok: false, ...readiness });
    return res.json({ ok: true, ...readiness });
  });
  app.get('/metrics', (req, res) => {
    if (!config.metricsToken) return res.status(503).json({ ok: false, error: 'Metrics chưa được bật', code: 'METRICS_DISABLED' });
    if (!metrics.isAuthorized(req.get('authorization'))) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ ok: false, error: 'Không được phép', code: 'UNAUTHORIZED' });
    }
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    return res.send(metrics.render({ socketCount: io.engine.clientsCount }));
  });

  app.get('/api/server-info', async (_req, res) => {
    try {
      const record = await store.getAdminContentRecord('server_config', 'current');
      const cfg = record?.data || {};
      res.json({
        ok: true,
        maintenanceMode: Boolean(cfg.maintenanceMode),
        maintenanceMessage: cfg.maintenanceMessage || '',
        announcement: cfg.announcement || 'Thiên Địa sơ khai, chúc các đạo hữu tu hành tinh tấn!',
        multipliers: {
          drop: Number(cfg.dropRateMultiplier) || 1.0,
          exp: Number(cfg.expMultiplier) || 1.0,
          gold: Number(cfg.goldMultiplier) || 1.0,
        },
        time: new Date().toISOString(),
      });
    } catch {
      res.json({
        ok: true,
        maintenanceMode: false,
        maintenanceMessage: '',
        announcement: 'Thiên Địa sơ khai, chúc các đạo hữu tu hành tinh tấn!',
        multipliers: { drop: 1.0, exp: 1.0, gold: 1.0 },
        time: new Date().toISOString(),
      });
    }
  });

  let gameplay = null;
  const onPlayerChanged = (userId) => gameplay?.playerChanged?.(userId);
  const enhance = createEnhanceService({
    store,
    catalog,
    players,
    onAnnouncement: (payload) => gameplay?.broadcastAnnouncement?.(payload),
  });
  app.use('/api/auth', createAuthRouter(auth, config, { rateLimitRedis }));
  app.use('/api', createAuthRouter(auth, config, { rateLimitRedis }));
  app.use('/api', createCatalogRouter({ auth, catalog, players, world }));
  app.use('/api', createShopRouter({ auth, shop, rateLimitRedis, onPlayerChanged }));
  app.use('/api', createInventoryRouter({ auth, inventory, onPlayerChanged }));
  app.use('/api', createCultivationRouter({ auth, cultivation, rateLimitRedis, onPlayerChanged }));
  app.use('/api', createAlchemyRouter({ auth, alchemy, rateLimitRedis, onPlayerChanged }));
  app.use('/api', createEnhanceRouter({ auth, enhance, rateLimitRedis, onPlayerChanged }));
  app.use('/api', createGameplayMutationRouter({ auth, equipment, skills, onPlayerChanged }));
  app.use('/api', createQuestRouter({ auth, quests }));
  app.use('/api', createMailRouter({ auth, mail, rateLimitRedis, onPlayerChanged }));
  app.use('/api', createRetentionRouter({ auth, retention, rateLimitRedis, onPlayerChanged }));
  const roomCluster = createRoomCluster({ io, redisUrl: config.redisUrl, players, world });
  gameplay = createGameplayService({ io, auth, players, store, catalog, world, quests, cluster: roomCluster });
  try {
    await roomCluster.start();
  } catch (error) {
    gameplay.stop();
    await Promise.allSettled([roomCluster.close(), closeRateLimitRedis(), realtimeAdapter.close(), store.close()]);
    throw error;
  }
  const adminContent = createAdminContentService({ store, catalog, world, quests, onCatalogChange(collection, id, saved) {
    gameplay.catalogChanged(collection, id, saved);
    if (realtimeAdapter.enabled) io.serverSideEmit("admin_catalog_committed", collection, id);
  } });
  if (realtimeAdapter.enabled) io.on("admin_catalog_committed", (collection, id) => {
    if (!["items", "monsters", "skills", "quests", "alchemyRecipes", "lootTables"].includes(collection) || typeof id !== "string") return;
    if (collection === "quests") {
      void store.listAdminContentRecords("quests").then((records) => {
        quests.applyOverrides(records);
      }).catch(() => process.stderr.write('{"level":"error","event":"catalog_peer_refresh_failed"}\n'));
      return;
    }
    void store.getAdminContentRecord(collection, id).then((saved) => {
      if (saved && catalog.applyAdminRecord(collection, id, saved)) gameplay.catalogChanged(collection, id, saved);
    }).catch(() => process.stderr.write('{"level":"error","event":"catalog_peer_refresh_failed"}\n'));
  });
  const adminWorlds = createAdminWorldService({ store, world, quests, onWorldChange(code) {
    gameplay.worldChanged(code);
    if (realtimeAdapter.enabled) io.serverSideEmit("admin_world_committed", code);
  } });
  if (realtimeAdapter.enabled) io.on("admin_world_committed", (code) => {
    if (typeof code !== "string" || !/^[a-z0-9_-]{1,80}$/.test(code)) return;
    void store.listAdminWorlds().then((documents) => {
      const saved = documents.find((entry) => entry.code === code);
      if (saved) world.setWorld(saved);
      else world.removeWorld(code);
      gameplay.worldChanged(code);
    }).catch(() => process.stderr.write('{"level":"error","event":"world_peer_refresh_failed"}\n'));
  });
  app.use('/api/admin', createAdminRouter({ auth, adminWorlds, adminContent, skillVfx, mail, rateLimitRedis, store }));
  app.use('/api/player', createPlayerRouter({ auth, players, onPlayerChanged }));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'API không tồn tại', code: 'NOT_FOUND', message: 'API không tồn tại' }));
  app.use(errorHandler);
  attachGameGateway(io, { auth, gameplay });
  metrics.start();

  return {
    app,
    server,
    io,
    store,
    async close() {
      gameplay.stop();
      metrics.close();
      await new Promise((resolve) => io.close(resolve));
      await gameplay.drain();
      await roomCluster.close();
      await closeRateLimitRedis();
      await realtimeAdapter.close();
      await store.close();
    },
  };
}

if (require.main === module) {
  createApp()
    .then((application) => {
      application.server.listen(config.port, () => console.log(`Tu Tien Pixel BE listening on ${config.port}`));
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try { await application.close(); }
        catch { process.exitCode = 1; }
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch(() => {
      console.error('Tu Tien Pixel BE failed to start');
      process.exitCode = 1;
    });
}

module.exports = { createApp };
