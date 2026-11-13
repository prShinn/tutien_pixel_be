'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createAdminContentService } = require('../src/admin/admin-content-service');

// Bộ kiểm tra tính toàn vẹn khi cấu hình nội dung qua Admin: kỹ năng, liên kết quái → bảng rớt và chặn xóa khi còn tham chiếu.

function createStore() {
  const overrides = new Map();
  return {
    async listAdminContentRecords(collection) { return [...overrides.values()].filter((row) => row.collection === collection); },
    async getAdminContentRecord(collection, id) { return overrides.get(`${collection}:${id}`) || null; },
    async mutateAdminContent(actorId, collection, id, data, deleted) {
      const key = `${collection}:${id}`;
      const next = { collection, id, data: data ? JSON.parse(JSON.stringify(data)) : null, deleted: Boolean(deleted), version: (overrides.get(key)?.version || 0) + 1 };
      overrides.set(key, next);
      return next;
    },
  };
}

function setup({ questDefinitions = [], worldDefinitions = [] } = {}) {
  const catalog = createCatalogService();
  const adminContent = createAdminContentService({
    store: createStore(),
    catalog,
    world: { listAdminWorlds: () => worldDefinitions, listSummaries: () => [] },
    quests: { applyOverrides() {}, list: () => questDefinitions },
  });
  return { catalog, adminContent };
}

const baseSkill = { code: 'TEST_SKILL', name: 'Kỹ năng thử', linhCan: 'COMMON', tier: 1, type: 'PHYS', category: 'ACTIVE', mpTieuHao: 5, hoiChieu: 3, range: 4, satThuong: 1.2, dienRong: 0, effect: '', effectVal: 0, thoiGianBuff: 0 };
let requestCounter = 0;
const nextRequest = () => `integrity-req-${(requestCounter += 1)}`;

test('every seeded skill still passes the stricter validation when an admin re-saves it', async () => {
  const { catalog, adminContent } = setup();
  const skills = catalog.listSkills();
  assert.ok(skills.length > 50);
  for (const skill of skills) {
    await assert.doesNotReject(adminContent.update('skills', skill.code, {}, 1, nextRequest()), `skill ${skill.code}`);
  }
});

test('admin skills reject unsupported effects, percent-scale passives, oversized damage and bad weapon kinds', async () => {
  const { adminContent } = setup();
  const reject = (patch, code) => assert.rejects(adminContent.create('skills', { ...baseSkill, ...patch }, 1, nextRequest()), { code });

  await reject({ code: 'BAD_EFFECT', effect: 'stun_forever' }, 'INVALID_SKILL_EFFECT');
  await reject({ code: 'BAD_PASSIVE_SCALE', category: 'PASSIVE', effect: 'passive', passiveModifiers: { defensePct: 50 } }, 'INVALID_SKILL_PASSIVE');
  await reject({ code: 'BAD_PASSIVE_KEY', category: 'PASSIVE', effect: 'passive', passiveModifiers: { godMode: 0.1 } }, 'INVALID_SKILL_PASSIVE');
  await reject({ code: 'BAD_PASSIVE_NEG', category: 'PASSIVE', effect: 'passive', passiveModifiers: { critPct: -0.1 } }, 'INVALID_SKILL_PASSIVE');
  await reject({ code: 'BAD_PASSIVE_NULL', category: 'PASSIVE', effect: 'passive', passiveModifiers: { critPct: null } }, 'INVALID_SKILL_PASSIVE');
  await reject({ code: 'BAD_DAMAGE', satThuong: 100000 }, 'INVALID_SKILL');
  await reject({ code: 'BAD_WEAPON', weaponKinds: ['bow', 'x'] }, 'INVALID_SKILL');
  await reject({ code: 'BAD_WEAPON_TYPE', weaponKinds: 'bow' }, 'INVALID_SKILL');
});

test('admin skills accept valid configuration and normalize effect and weapon kinds', async () => {
  const { catalog, adminContent } = setup();
  const created = await adminContent.create('skills', {
    ...baseSkill,
    effect: 'BURN',
    effectVal: 12,
    thoiGianBuff: 4,
    weaponKinds: ['Bow', 'bow', 'crossbow'],
  }, 1, nextRequest());
  assert.equal(created.data.effect, 'burn');
  assert.deepEqual(created.data.weaponKinds, ['bow', 'crossbow']);

  const passive = await adminContent.create('skills', {
    ...baseSkill, code: 'TEST_PASSIVE', category: 'PASSIVE', effect: 'passive', satThuong: 0,
    passiveModifiers: { defensePct: 0.005, critPct: 0.01 },
  }, 1, nextRequest());
  assert.deepEqual(passive.data.passiveModifiers, { defensePct: 0.005, critPct: 0.01 });
  assert.ok(catalog.listSkills().some((skill) => skill.code === 'TEST_SKILL'));
});

test('a monster can only point at a loot table that exists', async () => {
  const { catalog, adminContent } = setup();
  const monster = catalog.listMonsters()[0];
  await assert.rejects(adminContent.update('monsters', monster.id, { lootTableId: 'KHONG_CO_BANG_ROT' }, 1, nextRequest()), { code: 'INVALID_MONSTER_LOOT_TABLE' });
  await assert.rejects(adminContent.update('monsters', monster.id, { lootTableId: 42 }, 1, nextRequest()), { code: 'INVALID_MONSTER_LOOT_TABLE' });

  const otherTable = catalog.listLootTables().find((table) => table.id !== monster.lootTableId);
  const saved = await adminContent.update('monsters', monster.id, { lootTableId: otherTable.id }, 1, nextRequest());
  assert.equal(saved.data.lootTableId, otherTable.id);
});

test('a loot table used by a monster cannot be deleted, and the error names the monster', async () => {
  const { catalog, adminContent } = setup();
  const monster = catalog.listMonsters()[0];
  await assert.rejects(
    adminContent.remove('lootTables', monster.lootTableId, 1, nextRequest()),
    (error) => error.code === 'CONTENT_IN_USE' && error.status === 409 && error.message.includes(monster.id) && error.details.usedBy.includes(`quái ${monster.id}`),
  );
  assert.ok(catalog.getLootTableById(monster.lootTableId).length > 0, 'the table must still drop items');
});

test('an item referenced by a loot table, recipe or quest cannot be deleted until the reference is removed', async () => {
  const { catalog, adminContent } = setup({
    questDefinitions: [
      { id: 'quest-needs-item', targetItemId: 'REF_ITEM_QUEST', rewards: [] },
      { id: 'quest-rewards-item', rewards: [{ type: 'item', itemId: 'REF_ITEM_REWARD', amount: 1, label: 'x' }] },
    ],
  });
  const makeItem = (id) => adminContent.create('items', { id, name: id, type: 'MATERIAL' }, 1, nextRequest());
  for (const id of ['REF_ITEM_LOOT', 'REF_ITEM_RECIPE_IN', 'REF_ITEM_RECIPE_OUT', 'REF_ITEM_QUEST', 'REF_ITEM_REWARD', 'REF_ITEM_FREE']) await makeItem(id);

  await adminContent.create('lootTables', { id: 'ref_loot_table', entries: [{ itemId: 'REF_ITEM_LOOT', chance: 0.5, min: 1, max: 1 }] }, 1, nextRequest());
  await adminContent.create('alchemyRecipes', {
    code: 'ref_recipe', name: 'Công thức thử', category: 'BASIC', outputItemCode: 'REF_ITEM_RECIPE_OUT', craftSuccessRate: 0.5,
    ingredients: [{ itemCode: 'REF_ITEM_RECIPE_IN', quantity: 2 }],
  }, 1, nextRequest());

  const blocked = async (id, expectedRef) => assert.rejects(
    adminContent.remove('items', id, 1, nextRequest()),
    (error) => error.code === 'CONTENT_IN_USE' && error.details.usedBy.includes(expectedRef),
    id,
  );
  await blocked('REF_ITEM_LOOT', 'bảng rớt ref_loot_table');
  await blocked('REF_ITEM_RECIPE_IN', 'công thức ref_recipe');
  await blocked('REF_ITEM_RECIPE_OUT', 'công thức ref_recipe');
  await blocked('REF_ITEM_QUEST', 'nhiệm vụ quest-needs-item');
  await blocked('REF_ITEM_REWARD', 'nhiệm vụ quest-rewards-item');

  const removed = await adminContent.remove('items', 'REF_ITEM_FREE', 1, nextRequest());
  assert.equal(removed.removed, 'REF_ITEM_FREE');

  // Dọn tham chiếu rồi mới xóa được.
  await adminContent.remove('lootTables', 'ref_loot_table', 1, nextRequest());
  await assert.doesNotReject(adminContent.remove('items', 'REF_ITEM_LOOT', 1, nextRequest()));
  assert.equal(catalog.getItemByCode('REF_ITEM_LOOT'), null);
});

test('new skill codes must be ASCII even though one legacy seeded code contains accents', async () => {
  const { adminContent } = setup();
  await assert.rejects(adminContent.create('skills', { ...baseSkill, code: 'KỸ_NĂNG_MỚI' }, 1, nextRequest()), { code: 'INVALID_SKILL' });
});

test('a monster referenced by a map spawn or quest cannot be deleted, but an unused monster can be deleted', async () => {
  const { adminContent } = setup({
    worldDefinitions: [
      { code: 'map_rung', tenMap: 'Rừng Rậm', monsterSpawns: [{ templateId: 'REF_MONSTER_MAP' }] },
    ],
    questDefinitions: [
      { id: 'quest_diet_quai', targetMonsterId: 'REF_MONSTER_QUEST' },
    ],
  });

  const makeMonster = (id) => adminContent.create('monsters', {
    id, code: id, name: id, type: 'NORMAL', linhCan: 'KIM', level: 1, hp: 100, atk: 10, def: 5, speed: 1.2, respawnMs: 15000,
    img: './assets/monsters/test_monster.png',
  }, 1, nextRequest());

  await makeMonster('REF_MONSTER_MAP');
  await makeMonster('REF_MONSTER_QUEST');
  await makeMonster('REF_MONSTER_UNUSED');

  await assert.rejects(
    adminContent.remove('monsters', 'REF_MONSTER_MAP', 1, nextRequest()),
    (error) => error.code === 'CONTENT_IN_USE' && error.details.usedBy.includes('map map_rung'),
  );

  await assert.rejects(
    adminContent.remove('monsters', 'REF_MONSTER_QUEST', 1, nextRequest()),
    (error) => error.code === 'CONTENT_IN_USE' && error.details.usedBy.includes('nhiệm vụ quest_diet_quai'),
  );

  const removed = await adminContent.remove('monsters', 'REF_MONSTER_UNUSED', 1, nextRequest());
  assert.equal(removed.removed, 'REF_MONSTER_UNUSED');
});
