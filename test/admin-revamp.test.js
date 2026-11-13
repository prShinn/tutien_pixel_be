'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createAdminContentService } = require('../src/admin/admin-content-service');
const { validateWorld } = require('../src/admin/admin-world-service');

function createInMemoryContentStore() {
  const overrides = new Map(); // key -> { collection, id, data, deleted, version }
  return {
    async listAdminContentRecords(collection) {
      return [...overrides.values()].filter((row) => row.collection === collection);
    },
    async getAdminContentRecord(collection, id) {
      return overrides.get(`${collection}:${id}`) || null;
    },
    async pageAdminCatalog(collection, searchRows, { q = '', ids = [], itemType = '', rarity = '', limit = 24, offset = 0 }) {
      const merged = new Map(searchRows.map((row) => [row.id, { ...row, data: null }]));
      for (const row of overrides.values()) {
        if (row.collection !== collection) continue;
        if (row.deleted) merged.delete(row.id);
        else {
          merged.set(row.id, {
            id: row.id,
            name: row.data.tenDo || row.data.name || '',
            code: row.data.maDo || row.data.code || row.id,
            type: String(row.data.type || row.data.loai || '').toUpperCase(),
            rarity: String(row.data.rarity || 'NORMAL').toUpperCase(),
            data: row.data,
          });
        }
      }
      const query = q.toLocaleLowerCase();
      const idSet = ids.length ? new Set(ids) : null;
      const filtered = [...merged.values()].filter((row) => {
        if (idSet && !idSet.has(row.id)) return false;
        if (itemType && row.type !== itemType) return false;
        if (rarity && row.rarity !== rarity) return false;
        if (!query) return true;
        return `${row.id} ${row.code} ${row.name}`.toLocaleLowerCase().includes(query);
      });
      return { total: filtered.length, rows: filtered.slice(offset, offset + limit) };
    },
    async mutateAdminContent(actorId, collection, id, data, deleted) {
      const key = `${collection}:${id}`;
      const prev = overrides.get(key);
      const next = {
        collection,
        id,
        data: data ? JSON.parse(JSON.stringify(data)) : null,
        deleted: Boolean(deleted),
        version: (prev?.version || 0) + 1,
        actorId,
      };
      overrides.set(key, next);
      return next;
    },
  };
}

function createContentDeps() {
  const catalog = createCatalogService();
  const store = createInMemoryContentStore();
  const world = {
    listAdminWorlds: () => [],
    listSummaries: () => [],
  };
  const quests = { applyOverrides: () => {} };
  const changedEvents = [];
  const adminContent = createAdminContentService({
    store,
    catalog,
    world,
    quests,
    onCatalogChange: (collection, id, saved) => changedEvents.push({ collection, id, version: saved.version }),
  });
  return { catalog, store, adminContent, changedEvents };
}

test('admin alchemyRecipes CRUD validates cap, item references, and hot-reloads catalog', async () => {
  const { catalog, adminContent, changedEvents } = createContentDeps();
  const realItems = catalog.listItems();
  const outputItemCode = realItems[0].id;
  const ingredientCode = realItems[1].id;
  const validBase = {
    code: 'REC_TEST_DAN',
    name: 'Linh Đan Thử Nghiệm',
    category: 'BASIC',
    quality: 'HA',
    outputItemCode,
    outputQuantity: 1,
    craftSuccessRate: 0.65,
    mutationChance: 0.05,
    requiredRealmStt: 1,
    costXu: 100,
    costLinhThach: 0,
    ingredients: [{ itemCode: ingredientCode, quantity: 2 }],
  };

  await assert.rejects(
    adminContent.create('alchemyRecipes', { ...validBase, craftSuccessRate: 0.85 }, 1, 'req-1'),
    { code: 'INVALID_ALCHEMY_RECIPE' },
  );
  await assert.rejects(
    adminContent.create('alchemyRecipes', { ...validBase, outputItemCode: 'KHONG_TON_TAI' }, 1, 'req-2'),
    { code: 'INVALID_ALCHEMY_RECIPE' },
  );
  await assert.rejects(
    adminContent.create('alchemyRecipes', { ...validBase, ingredients: [{ itemCode: 'FAKE_MAT', quantity: 1 }] }, 1, 'req-3'),
    { code: 'INVALID_ALCHEMY_RECIPE' },
  );

  const created = await adminContent.create('alchemyRecipes', {
    ...validBase,
    category: 'BREAKTHROUGH',
    quality: 'HA_PHAM',
    mutationChance: 0,
  }, 1, 'req-4');
  assert.equal(created.persisted, true);
  assert.equal(catalog.getAlchemyRecipeByCode('REC_TEST_DAN')?.mutationChance, 0);
  assert.equal(changedEvents[0].collection, 'alchemyRecipes');

  await adminContent.update('alchemyRecipes', 'REC_TEST_DAN', { craftSuccessRate: 0.55, costXu: 250 }, 1, 'req-5');
  const updated = catalog.getAlchemyRecipeByCode('REC_TEST_DAN');
  assert.equal(updated.craftSuccessRate, 0.55);
  assert.equal(updated.costXu, 250);

  await assert.rejects(
    adminContent.create('skills', { code: 'BAD_SKILL', name: 'Lỗi', linhCan: 'COMMON', mpTieuHao: -5 }, 1, 'req-s1'),
    { code: 'INVALID_SKILL' },
  );

  await adminContent.remove('alchemyRecipes', 'REC_TEST_DAN', 1, 'req-6');
  assert.equal(catalog.getAlchemyRecipeByCode('REC_TEST_DAN'), null);
});

test('admin items store weaponKind lowercase so remote staff/bow profiles stay intact', async () => {
  const { catalog, adminContent } = createContentDeps();
  await adminContent.create('items', {
    id: 'STAFF_ADMIN_TEST',
    name: 'Trượng Tinh Vân',
    type: 'EQUIPMENT',
    slot: 'weapon',
    weaponKind: 'STAFF',
    requiredRealmStt: 1,
    stats: { mAtk: 22, ene: 8 },
  }, 1, 'req-w1');
  const item = catalog.getItemByCode('STAFF_ADMIN_TEST');
  assert.equal(item.weaponKind, 'staff');
  assert.equal(item.basicAttack?.style, 'staff');
  assert.equal(item.basicAttack?.range, 56);
});

test('admin lootTables CRUD validates items, chance, min/max and hot-reloads catalog', async () => {
  const { catalog, adminContent, changedEvents } = createContentDeps();
  const realItemId = catalog.listItems()[0].id;
  await assert.rejects(
    adminContent.create('lootTables', { id: 'loot_bad_item', entries: [{ itemId: 'KHONG_CO', chance: 0.5, min: 1, max: 1 }] }, 1, 'req-l1'),
    { code: 'INVALID_LOOT_TABLE' },
  );
  await assert.rejects(
    adminContent.create('lootTables', { id: 'loot_bad_range', entries: [{ itemId: realItemId, chance: 0.5, min: 5, max: 2 }] }, 1, 'req-l2'),
    { code: 'INVALID_LOOT_TABLE' },
  );

  const created = await adminContent.create('lootTables', {
    id: 'loot_custom_boss',
    entries: [{ itemId: realItemId, chance: 0.75, min: 1, max: 3 }],
  }, 1, 'req-l3');
  assert.equal(created.persisted, true);
  assert.deepEqual(catalog.getLootTableById('loot_custom_boss'), [{ itemId: realItemId, chance: 0.75, min: 1, max: 3 }]);
  assert.equal(changedEvents[0].collection, 'lootTables');

  await adminContent.remove('lootTables', 'loot_custom_boss', 1, 'req-l4');
  assert.deepEqual(catalog.getLootTableById('loot_custom_boss'), []);
});

test('admin items catalog paging filters by itemType and rarity and rejects invalid filter values', async () => {
  const { adminContent } = createContentDeps();
  await adminContent.create('items', {
    id: 'TEST_SWORD_EXL',
    name: 'Huyền Thiết Kiếm EXL',
    type: 'EQUIPMENT',
    slot: 'weapon',
    rarity: 'EXL',
    requiredRealmStt: 2,
    stats: { pAtk: 35, str: 10, agi: 5, vit: 3, ene: 0 },
  }, 1, 'req-i1');

  const paged = await adminContent.list('items', { page: 1, limit: 24, itemType: 'EQUIPMENT', rarity: 'EXL' });
  assert.ok(paged.data.some((row) => row.id === 'TEST_SWORD_EXL'));
  assert.ok(paged.data.every((row) => String(row.type || row.loai).toUpperCase() === 'EQUIPMENT' && String(row.rarity || 'NORMAL').toUpperCase() === 'EXL'));

  await assert.rejects(
    adminContent.list('items', { page: 1, limit: 24, itemType: 'INVALID_TYPE' }),
    { code: 'INVALID_CATALOG_PAGE' },
  );
});

test('validateWorld checks npc.shopCategory only allows ALL, EQUIPMENT, ALCHEMY for shop NPCs', () => {
  const baseWorld = {
    code: 'MAP_SHOP_TEST',
    tenMap: 'Thị Trấn',
    w: 20,
    h: 20,
    spawnX: 5,
    spawnY: 5,
    jsonMap: Array.from({ length: 20 }, () => Array(20).fill(0)),
    npcs: [
      { id: 'npc_alchemy_shop', name: 'Dược Sư', role: 'MERCHANT', type: 'shop', shopCategory: 'ALCHEMY', x: 6, y: 6 },
    ],
  };
  const validResult = validateWorld(baseWorld, [baseWorld]);
  assert.equal(validResult.valid, true, validResult.errors.join('; '));

  const invalidWorld = {
    ...baseWorld,
    npcs: [{ id: 'npc_bad_shop', name: 'Shop Lỗi', role: 'MERCHANT', type: 'shop', shopCategory: 'BLACK_MARKET', x: 6, y: 6 }],
  };
  const invalidResult = validateWorld(invalidWorld, [invalidWorld]);
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.length > 0);
});

test('admin store and router account moderation supports status, role, resetPassword and blocks self-lockout', async () => {
  const { createAdminRouter } = require('../src/http/admin-routes');
  const express = require('express');

  const users = new Map([
    ['usr_admin', { id: 'usr_admin', username: 'admin', role: 'ADMIN', status: 'ACTIVE' }],
    ['usr_player1', { id: 'usr_player1', username: 'tiendao', role: 'PLAYER', status: 'ACTIVE' }],
  ]);
  const mockTokens = new Set(['token_p1_abc']);

  const mockStore = {
    async updateUserStatus(userId, status) {
      const u = users.get(userId);
      if (!u) return null;
      u.status = status;
      if (status === 'SUSPENDED') mockTokens.clear();
      return { ...u };
    },
    async updateUserRole(userId, role) {
      const u = users.get(userId);
      if (!u) return null;
      u.role = role;
      return { ...u };
    },
    async resetUserPassword(userId, newPassword) {
      const u = users.get(userId);
      if (!u) return null;
      if (!newPassword || newPassword.length < 6) throw new Error('Mật khẩu ngắn');
      mockTokens.clear();
      return { ok: true, userId };
    },
    async getAdminContentRecord() { return null; },
    async mutateAdminContent() { return { data: {}, version: 1 }; },
  };

  const fakeAuth = {
    async authenticateToken(_token) {
      return { sub: 'usr_admin', username: 'admin', role: 'ADMIN' };
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter({
    auth: fakeAuth,
    adminWorlds: { list: () => [] },
    adminContent: { list: () => ({ data: [] }) },
    skillVfx: { list: () => [] },
    store: mockStore,
  }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer mock_admin_token' };

  try {
    // 1. Role update
    const r1 = await fetch(`${base}/admin/accounts/usr_player1/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role: 'GM' }),
    });
    const b1 = await r1.json();
    assert.equal(r1.status, 200);
    assert.equal(b1.user.role, 'GM');

    // 2. Self demote protection
    const r2 = await fetch(`${base}/admin/accounts/usr_admin/role`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ role: 'PLAYER' }),
    });
    assert.equal(r2.status, 400);

    // 3. Suspend user
    const r3 = await fetch(`${base}/admin/accounts/usr_player1/status`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    const b3 = await r3.json();
    assert.equal(r3.status, 200);
    assert.equal(b3.user.status, 'SUSPENDED');
    assert.equal(mockTokens.size, 0);

    // 4. Self suspend protection
    const r4 = await fetch(`${base}/admin/accounts/usr_admin/status`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'SUSPENDED' }),
    });
    assert.equal(r4.status, 400);

    // 5. Reset password
    const r5 = await fetch(`${base}/admin/accounts/usr_player1/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ newPassword: 'secretpassword123' }),
    });
    const b5 = await r5.json();
    assert.equal(r5.status, 200);
    assert.equal(b5.result.ok, true);
  } finally {
    server.close();
  }
});

test('admin server-config GET and PUT handles maintenance mode and operational multipliers', async () => {
  const { createAdminRouter } = require('../src/http/admin-routes');
  const express = require('express');

  let currentConfig = null;
  const mockStore = {
    async getAdminContentRecord(collection, id) {
      if (collection === 'server_config' && id === 'current') {
        return currentConfig ? { data: currentConfig, version: 1 } : null;
      }
      return null;
    },
    async mutateAdminContent(actorId, collection, id, data) {
      if (collection === 'server_config' && id === 'current') {
        currentConfig = data;
        return { data, version: 2 };
      }
      return { data, version: 1 };
    },
  };

  const fakeAuth = {
    async authenticateToken(_token) {
      return { sub: 'usr_admin', username: 'admin', role: 'ADMIN' };
    },
  };

  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter({
    auth: fakeAuth,
    adminWorlds: { list: () => [] },
    adminContent: { list: () => ({ data: [] }) },
    skillVfx: { list: () => [] },
    store: mockStore,
  }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer mock_admin_token' };

  try {
    const r1 = await fetch(`${base}/admin/server-config`, { headers });
    const b1 = await r1.json();
    assert.equal(r1.status, 200);
    assert.equal(b1.data.dropRateMultiplier, 1.0);
    assert.equal(b1.data.maintenanceMode, false);

    const r2 = await fetch(`${base}/admin/server-config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        maintenanceMode: true,
        maintenanceMessage: 'Đang bảo trì nâng cấp cụm máy chủ',
        dropRateMultiplier: 2.0,
        expMultiplier: 1.5,
        goldMultiplier: 1.2,
        announcement: 'Chào mừng Đại Lễ!',
      }),
    });
    const b2 = await r2.json();
    assert.equal(r2.status, 200);
    assert.equal(b2.data.maintenanceMode, true);
    assert.equal(b2.data.dropRateMultiplier, 2.0);
    assert.equal(b2.data.expMultiplier, 1.5);
    assert.equal(b2.data.goldMultiplier, 1.2);
    assert.equal(b2.data.announcement, 'Chào mừng Đại Lễ!');
  } finally {
    server.close();
  }
});
