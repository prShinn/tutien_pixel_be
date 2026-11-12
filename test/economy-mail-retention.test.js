const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const mysql = require('mysql2/promise');

const {
  BALANCE,
  getVnDateString,
} = require('../src/data/balance');
const { publicPlayer } = require('../src/domain');
const { createMysqlStore, canonicalJson } = require('../src/store/mysql-store');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createShopService } = require('../src/shop');
const { createInventoryService } = require('../src/inventory/inventory-service');
const { createMailService } = require('../src/mail/mail-service');
const { createRetentionService } = require('../src/retention/retention-service');
const { createPlayerService } = require('../src/player');
const { createCatalogRouter } = require('../src/http/catalog-routes');
const { createRateLimiter } = require('../src/http/rate-limit');
const { createGameplayService } = require('../src/realtime/gameplay-service');
const { createRoomCluster } = require('../src/realtime/room-cluster');

test('BALANCE retention & VN UTC+7 clock configuration', () => {
  assert.equal(BALANCE.inventory.baseCapacity, 40);
  assert.equal(BALANCE.inventory.maxCapacity, 80);
  assert.equal(BALANCE.retention.timezoneOffsetMinutes, 420);
  assert.equal(BALANCE.retention.checkinRewards.length, 7);

  // 2026-11-12T16:59:59Z = 2026-11-12T23:59:59+07:00
  assert.equal(getVnDateString(Date.UTC(2026, 10, 12, 16, 59, 59)), '2026-11-12');
  // 2026-11-12T17:00:00Z = 2026-11-13T00:00:00+07:00
  assert.equal(getVnDateString(Date.UTC(2026, 10, 12, 17, 0, 0)), '2026-11-13');
});

test('catalog isolates Ky Tran Cac premium items and publicPlayer clamps inventoryCapacity', () => {
  const catalog = createCatalogService();
  const premium = catalog.listPremiumItems();
  const expectedIds = [
    'TUI_CAN_KHON_10',
    'PHU_TAY_TUY',
    'THUONG_PHAM_LINH_TINH',
    'POTION_DAI_HOAN',
    'NGAN_PHIEU_XU_250',
  ];
  for (const id of expectedIds) {
    assert.ok(premium.some((item) => item.id === id), `Expected premium item ${id}`);
  }
  for (const item of premium) {
    assert.equal(item.currency, 'LINH_THACH');
    assert.equal(item.shopTab, 'PREMIUM');
    assert.ok(item.giaMua > 0);
    assert.equal(item.giaBan, 0);
  }

  const basePlayer = { id: 'p1', userId: 'u1', name: 'DaoHuu', stats: {} };
  assert.equal(publicPlayer({ ...basePlayer, inventoryCapacity: 10 }, { xu: 50, linhThach: 9 }, []).inventoryCapacity, 40);
  const expanded = publicPlayer({ ...basePlayer, inventoryCapacity: 60 }, { xu: 50, linhThach: 9 }, []);
  assert.equal(expanded.inventoryCapacity, 60);
  assert.equal(expanded.linhThach, 9);
  assert.equal(expanded.wallet.linhThach, 9);
  assert.equal(publicPlayer({ ...basePlayer, inventoryCapacity: 120 }, {}, []).inventoryCapacity, 80);
});

test('shopService routes XU vs LINH_THACH purchases and blocks selling Ky Tran Cac items', async () => {
  const catalog = createCatalogService();
  const calls = [];
  const store = {
    async buyItem(userId, requestId, itemCode, quantity, item) {
      calls.push({ userId, requestId, itemCode, quantity, item });
      return { id: 'p1', userId, inventory: [], wallet: { xu: 100, linhThach: 50 } };
    },
    async sellItem() {
      throw new Error('sellItem store method must not be called for LINH_THACH items');
    },
  };
  const shop = createShopService({ store, catalog, players: { decorate: (p) => p } });

  const xuBuy = await shop.buy('u1', 'req_buy_xu_1', 'POTION_TIEU_HOAN', 2);
  assert.equal(xuBuy.result.currency, 'XU');
  assert.equal(calls[0].item.currency, 'XU');

  const ltBuy = await shop.buy('u1', 'req_buy_lt_1', 'TUI_CAN_KHON_10', 1);
  assert.equal(ltBuy.result.currency, 'LINH_THACH');
  assert.equal(calls[1].item.currency, 'LINH_THACH');

  await assert.rejects(
    () => shop.sell('u1', 'req_sell_lt_1', 'TUI_CAN_KHON_10', 1),
    (err) => err.code === 'ITEM_NOT_SELLABLE' && err.status === 400,
  );
});

test('inventoryService resolves BAG_EXPAND, STAT_RESET, and EXCHANGE_XU effects', async () => {
  const catalog = createCatalogService();
  const effects = [];
  const store = {
    async useInventoryItem(userId, requestId, itemCode, operation, effect) {
      effects.push({ userId, requestId, itemCode, operation, effect });
      return { player: { id: 'p1', userId }, result: { type: effect.kind } };
    },
  };
  const inventory = createInventoryService({ store, catalog, players: { decorate: (p) => p } });

  await inventory.use('u1', 'req_use_bag_01', 'TUI_CAN_KHON_10');
  await inventory.use('u1', 'req_use_reset_01', 'PHU_TAY_TUY');
  await inventory.use('u1', 'req_use_xu_01', 'NGAN_PHIEU_XU_250');

  assert.equal(effects[0].effect.kind, 'bag_expand');
  assert.ok(effects[0].effect.slots >= 1);
  assert.deepEqual(effects[1].effect, { kind: 'stat_reset' });
  assert.equal(effects[2].effect.kind, 'exchange_xu');
  assert.ok(effects[2].effect.xuAmount >= 1);
});

test('mailService validates input limits, catalog attachments, merges duplicates, and decorates claim', async () => {
  const catalog = createCatalogService();
  const sent = [];
  const store = {
    async listPlayerMail(userId, opts) { return { unclaimedCount: 1, items: [], opts, userId }; },
    async claimPlayerMail(userId, requestId, mailId) {
      return { player: { id: 'p1', userId }, result: { type: 'mail_claimed', mailId, xu: 50 } };
    },
    async sendPlayerMail(actorId, data) {
      sent.push({ actorId, data });
      return { mail: { id: 'mail_1', ...data }, deduplicated: false };
    },
  };
  const mail = createMailService({ store, catalog, players: { decorate: (p) => ({ ...p, decorated: true }) } });

  await assert.rejects(() => mail.list('u1', { limit: 99 }), { code: 'INVALID_LIMIT' });
  await assert.rejects(() => mail.claim('u1', 'bad', 'req_mail_001'), { code: 'INVALID_MAIL_ID' });
  await assert.rejects(
    () => mail.sendSystemMail('adm1', { playerId: 'p1', title: 'Qua', body: 'Tang', attachments: { linhThach: 100001 } }),
    { code: 'INVALID_ATTACHMENT' },
  );
  await assert.rejects(
    () => mail.sendSystemMail('adm1', {
      playerId: 'p1',
      title: 'Qua',
      body: 'Tang',
      attachments: { items: [{ itemCode: 'KHONG_TON_TAI', quantity: 1 }] },
    }),
    (err) => err.code === 'ITEM_NOT_FOUND' && err.status === 404,
  );

  const created = await mail.sendSystemMail('adm1', {
    requestId: 'adm_mail_req_01',
    playerId: 'p1',
    title: 'Den bu bao tri',
    body: 'Chuc dao huu tu luyen vui ve',
    sourceType: 'COMPENSATION',
    expiresInHours: 48,
    attachments: {
      xu: 200,
      linhThach: 10,
      tuVi: 500,
      items: [
        { itemCode: 'POTION_TIEU_HOAN', quantity: 2 },
        { itemCode: 'POTION_TIEU_HOAN', quantity: 3 },
      ],
    },
  });
  assert.equal(created.deduplicated, false);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].data.attachments, {
    xu: 200,
    linhThach: 10,
    tuVi: 500,
    items: [{ itemCode: 'POTION_TIEU_HOAN', quantity: 5 }],
  });

  const claimed = await mail.claim('u1', 'mail_1234', 'req_mail_claim_1');
  assert.equal(claimed.player.decorated, true);
  assert.equal(claimed.result.mailId, 'mail_1234');
});

test('retentionService check-in + playerService.walletLedger + catalog /balance validation', async () => {
  const catalog = createCatalogService();
  const store = {
    async getRetentionState(userId) {
      return {
        serverTime: '2026-11-12T10:00:00.000Z',
        dateVn: '2026-11-12',
        checkin: { cycleNo: 1, streakDay: 0, canClaimToday: true, nextDay: 1, days: [] },
        userId,
      };
    },
    async claimDailyCheckin(userId, requestId) {
      return { player: { id: 'p1', userId }, result: { type: 'daily_checkin_claimed', day: 1, requestId } };
    },
    async listWalletLedger(userId, opts) { return { userId, ...opts, items: [] }; },
  };

  const retention = createRetentionService({
    store,
    catalog,
    players: { decorate: (p) => p },
  });

  const status = await retention.getStatus('u1');
  assert.equal(status.checkin.canClaimToday, true);
  await assert.rejects(() => retention.claimCheckin('u1', 'short'), { code: 'INVALID_REQUEST_ID' });
  const claimed = await retention.claimCheckin('u1', 'req_checkin_01');
  assert.equal(claimed.result.type, 'daily_checkin_claimed');
  assert.equal(claimed.result.day, 1);

  const players = createPlayerService({ store, catalog, world: { getDefault: () => ({}) } });
  await assert.rejects(() => players.walletLedger('u1', { currency: 'GOLD' }), { code: 'INVALID_CURRENCY' });
  await assert.rejects(() => players.walletLedger('u1', { limit: 100 }), { code: 'INVALID_LIMIT' });
  const ledger = await players.walletLedger('u1', { currency: 'linh_thach', limit: '15' });
  assert.equal(ledger.currency, 'LINH_THACH');
  assert.equal(ledger.limit, 15);

  const router = createCatalogRouter({
    auth: { authenticate: (_req, _res, next) => next() },
    catalog,
    players,
    world: { listSummaries: () => [], getDefault: () => ({}), getByCode: () => ({}), getStructure: () => ({}) },
  });
  const balanceLayer = router.stack.find((layer) => layer.route?.path === '/balance');
  assert.ok(balanceLayer);
  let jsonBody = null;
  balanceLayer.route.stack[0].handle({}, { json: (body) => { jsonBody = body; } });
  assert.equal(jsonBody.retention.checkinRewards.length, 7);
  assert.equal(jsonBody.ads, undefined);
});

test('canonicalJson & createMysqlStore enforce UTC, MySQL JSON replay order, and authoritative vitals', async () => {
  assert.equal(
    canonicalJson({ xu: 10, items: [{ itemCode: 'A', quantity: 2 }], linhThach: 5 }),
    canonicalJson({ items: [{ quantity: 2, itemCode: 'A' }], linhThach: 5, xu: 10 }),
  );

  const sessionInitQueries = [];
  const rawPool = new EventEmitter();
  const executedSql = [];
  const fakeConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      executedSql.push({ sql, params });
      if (sql.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT')) return [[]];
      if (sql.includes('FROM idempotency_keys')) return [[]];
      if (sql.includes('FROM players WHERE user_id')) {
        return [[{
          id: 'p1',
          userId: 'u1',
          name: 'HanLap',
          gender: 'NAM',
          linhCan: 'HOA',
          realmCode: 'LUYEN_KHI',
          realmStage: 1,
          tuVi: 100,
          tuViLinhCan: 0,
          hp: 150,
          maxHp: 160,
          mp: 80,
          maxMp: 90,
          mapCode: 'thanh_lam',
          x: 10,
          y: 10,
          positionVersion: 1,
          version: 1,
          str: 5,
          agi: 5,
          vit: 5,
          ene: 5,
          unspentPoints: 0,
          inventoryCapacity: 40,
        }]];
      }
      if (sql.includes('FROM players WHERE id = ? FOR UPDATE')) return [[{ id: 'p1' }]];
      if (sql.includes('FROM player_mail WHERE player_id = ? AND idempotency_key')) {
        return [[{
          id: 'mail_1',
          playerId: 'p1',
          title: 'Qua',
          body: 'Noi dung',
          sourceType: 'SYSTEM',
          sourceRef: null,
          attachmentsJson: JSON.stringify({ items: [{ quantity: 2, itemCode: 'POTION_TIEU_HOAN' }], tuVi: 0, linhThach: 1, xu: 50 }),
          isRead: 0,
          claimedAt: null,
          expiresAt: null,
          createdAt: '2026-11-12T10:00:00.000Z',
        }]];
      }
      if (sql.includes('FROM wallets')) return [[{ xu: 100, linhThach: 0 }]];
      return [[]];
    },
    async execute(sql, params) {
      executedSql.push({ sql, params });
      if (sql.includes('FROM player_equipment')) return [[]];
      if (sql.includes('FROM player_skills')) return [[]];
      return [{ affectedRows: 1 }];
    },
  };
  const fakePool = {
    pool: rawPool,
    async getConnection() { return fakeConnection; },
    async query(sql) { return fakeConnection.query(sql, []); },
    async execute(sql, params) { return fakeConnection.execute(sql, params); },
    async end() {},
  };

  const origCreatePool = mysql.createPool;
  let store;
  try {
    mysql.createPool = () => fakePool;
    store = createMysqlStore({ host: '127.0.0.1', user: 'root', database: 'test' });
    rawPool.emit('connection', { query(sql) { sessionInitQueries.push(sql); } });
    assert.ok(sessionInitQueries.includes("SET time_zone = '+00:00'"));

    // P0-4: updateVitals must ignore stale high maxHp/maxMp and compute effective vitals from locked player (100 + 5*12 = 160 maxHp, 50 + 5*8 = 90 maxMp)
    const vitals = await store.updateVitals('u1', 'req_vit_1', 'NATURAL_REGEN', { hp: 500, mp: 500, maxHp: 9999, maxMp: 9999 });
    assert.equal(vitals.result.maxHp, 160);
    assert.equal(vitals.result.hp, 160);
    assert.equal(vitals.result.maxMp, 90);
    assert.equal(vitals.result.mp, 90);

    // P0-3: idempotent mail replay succeeds even when MySQL reordered keys in attachments_json
    const replay = await store.sendPlayerMail('adm1', {
      requestId: 'req_mail_replay',
      playerId: 'p1',
      title: 'Qua',
      body: 'Noi dung',
      attachments: { xu: 50, linhThach: 1, tuVi: 0, items: [{ itemCode: 'POTION_TIEU_HOAN', quantity: 2 }] },
    });
    assert.equal(replay.deduplicated, true);
  } finally {
    mysql.createPool = origCreatePool;
  }
});

test('createRateLimiter enforces bounded local LRU fallback and Redis INCR Lua script', async () => {
  const localLimiter = createRateLimiter({ windowMs: 60_000, max: 2, maxEntries: 3, key: (req) => req.k });
  const call = (limiter, k) => new Promise((resolve) => {
    const headers = {};
    const res = {
      set(name, val) { headers[name] = val; },
      status(code) { return { json(body) { resolve({ code, body, headers }); } }; },
    };
    limiter({ k, requestId: 'r1' }, res, () => resolve({ code: 200 }));
  });
  for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) {
    assert.equal((await call(localLimiter, key)).code, 200);
  }
  // Because k1 was evicted after k4/k5 pushed size beyond maxEntries=3, k1 starts fresh rather than leaking memory
  assert.equal((await call(localLimiter, 'k1')).code, 200);
  assert.equal((await call(localLimiter, 'k1')).code, 200);
  assert.equal((await call(localLimiter, 'k1')).code, 429);

  let counts = new Map();
  const fakeRedis = {
    status: 'ready',
    async eval(_script, _n, redisKey) {
      const next = (counts.get(redisKey) || 0) + 1;
      counts.set(redisKey, next);
      return [next, 5000];
    },
  };
  const redisLimiter = createRateLimiter({ windowMs: 60_000, max: 1, redis: fakeRedis, key: (req) => req.k });
  assert.equal((await call(redisLimiter, 'shared_user')).code, 200);
  const blocked = await call(redisLimiter, 'shared_user');
  assert.equal(blocked.code, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
});

test('gameplayService.playerChangedLocal + roomCluster.notifyPlayerSync propagate REST player state to active socket', async () => {
  const catalog = createCatalogService();
  const emitted = [];
  const io = {
    to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; },
    local: { to() { return { emit() {} }; }, emit() {} },
    in() { return { async socketsJoin() {}, disconnectSockets() {} }; },
    sockets: { sockets: new Map() },
  };
  const basePlayer = {
    id: 'p1', userId: 'u1', name: 'HanLap', gender: 'NAM', linhCan: 'HOA',
    realmCode: 'LUYEN_KHI', realmStage: 1, stats: { str: 5, agi: 5, vit: 5, ene: 5 },
    derivedStats: {}, equipment: {}, learnedSkills: [], equippedSkills: [],
    hp: 160, maxHp: 160, mp: 90, maxMp: 90, xu: 50, linhThach: 0, inventoryCapacity: 40,
    tuVi: 100, tuViHienTai: 100, tuViLenCap: 1000, tuViLinhCan: 0, unspentStatPoints: 0, combatPower: 100,
    mapCode: 'thanh_lam', x: 5, y: 5,
  };
  let currentPlayer = basePlayer;
  const players = {
    async snapshot() {
      return currentPlayer;
    },
    decorate: (p) => p,
  };
  const world = {
    getByCode: () => ({ code: 'thanh_lam', w: 50, h: 50, version: 1, spawnX: 5, spawnY: 5, portals: [], monsterSpawns: [], npcs: [] }),
    getDefault: () => ({ code: 'thanh_lam', w: 50, h: 50, version: 1, spawnX: 5, spawnY: 5, portals: [], monsterSpawns: [], npcs: [] }),
  };

  // Fake Redis pub/sub verifying cluster.notifyPlayerSync triggers gameplay.playerChangedLocal
  const channels = new Map();
  const makeFakeRedis = () => {
    const handlers = {};
    return {
      status: 'ready',
      on(ev, fn) { handlers[ev] = fn; },
      async connect() {},
      async subscribe(ch) {
        if (!channels.has(ch)) channels.set(ch, new Set());
        channels.get(ch).add((msg) => handlers.message?.(ch, msg));
      },
      async publish(ch, msg) {
        for (const fn of channels.get(ch) || []) fn(msg);
      },
      async eval(_script, _n, ...args) { return `${args[0]}|1`; },
      async get() { return null; },
      async set() {},
      async del() {},
      async sadd() {},
      async srem() {},
      async smembers() { return []; },
      async ping() { return 'PONG'; },
      async quit() {},
      disconnect() {},
    };
  };
  const cluster = createRoomCluster({ io, redisUrl: 'redis://fake', players, world, clientFactory: makeFakeRedis });
  const gameplay = createGameplayService({
    io,
    auth: {},
    players,
    store: { async savePlayerPosition() { return basePlayer; } },
    catalog,
    world,
    quests: null,
    cluster,
  });
  await cluster.start();
  const socket = {
    id: 'sock_1',
    auth: { sub: 'u1', username: 'hanlap' },
    data: {},
    emit() {},
    to() { return { emit() {} }; },
    async join(room) { socket.data.joined = room; },
  };
  await gameplay.commandLocal(socket, { requestId: 'req_join_1', type: 'world.join', payload: {} });
  emitted.length = 0;

  currentPlayer = { ...basePlayer, xu: 150, linhThach: 25, inventoryCapacity: 50, tuVi: 600, tuViHienTai: 600, unspentStatPoints: 4 };
  await gameplay.playerChanged('u1');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const syncMsg = emitted.find((entry) => entry.room === 'sock_1' && entry.event === 'player_state_update');
  assert.ok(syncMsg);
  assert.equal(syncMsg.payload.xu, 150);
  assert.equal(syncMsg.payload.linhThach, 25);
  assert.equal(syncMsg.payload.inventoryCapacity, 50);
  assert.equal(syncMsg.payload.tuVi, 600);
  assert.equal(syncMsg.payload.unspentStatPoints, 4);

  await cluster.close();
  await gameplay.close();
});
