'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminWorldService } = require('../src/admin/admin-world-service');
const { makeMap, fakeSocket, makeHarness, send } = require('./helpers/realtime-harness');

// Cổng khóa theo nhiệm vụ: Admin cấu hình trên portal (requiredQuestId + lockedMessage) và gameplay phải tôn trọng.

function gateHarness({ portal, targetCode = 'target', questStatuses = {} }) {
  const field = makeMap('field', { portals: [{ id: 'gate', x: 1, y: 1, toMap: targetCode, toX: 5, toY: 5, ...portal }] });
  const harness = makeHarness({ maps: [['field', field], [targetCode, makeMap(targetCode)]] });
  harness.quests.snapshot = async () => ({ quests: Object.entries(questStatuses).map(([id, status]) => ({ id, status })) });
  return harness;
}

async function tryEnter(harness, requestId) {
  const socket = fakeSocket();
  await send(harness.gameplay, socket, `${requestId}_join`, 'world.join');
  return send(harness.gameplay, socket, requestId, 'map.change', { mapCode: harness.targetCode });
}

test('a portal configured with a required quest stays locked until that quest is ready, using the admin message', async (t) => {
  const locked = gateHarness({ portal: { requiredQuestId: 'q-gate', lockedMessage: 'Hãy gặp trưởng làng trước.' }, questStatuses: { 'q-gate': 'active' } });
  t.after(() => locked.gameplay.close());
  locked.targetCode = 'target';
  await assert.rejects(tryEnter(locked, 'gate_locked_01'), (error) => error.code === 'PORTAL_LOCKED' && error.message === 'Hãy gặp trưởng làng trước.');

  const missing = gateHarness({ portal: { requiredQuestId: 'q-gate' }, questStatuses: {} });
  t.after(() => missing.gameplay.close());
  missing.targetCode = 'target';
  await assert.rejects(tryEnter(missing, 'gate_missing_01'), { code: 'PORTAL_LOCKED' });

  for (const status of ['ready', 'completed']) {
    const open = gateHarness({ portal: { requiredQuestId: 'q-gate' }, questStatuses: { 'q-gate': status } });
    t.after(() => open.gameplay.close());
    open.targetCode = 'target';
    const moved = await tryEnter(open, `gate_open_${status}`);
    assert.equal(moved.result.mapCode, 'target', `quest ${status}`);
  }
});

test('a portal without any gate stays open', async (t) => {
  const harness = gateHarness({ portal: {} });
  t.after(() => harness.gameplay.close());
  harness.targetCode = 'target';
  assert.equal((await tryEnter(harness, 'gate_none_01')).result.mapCode, 'target');
});

test('the gate configured on a portal overrides the built-in default gate of the forest map', async (t) => {
  // Mặc định cứng: vào thanh_van_son_coc cần hoàn thành novice-06-forest-herbs.
  const defaultGate = gateHarness({ portal: {}, targetCode: 'thanh_van_son_coc', questStatuses: {} });
  t.after(() => defaultGate.gameplay.close());
  defaultGate.targetCode = 'thanh_van_son_coc';
  await assert.rejects(tryEnter(defaultGate, 'gate_default_01'), { code: 'PORTAL_LOCKED' });

  // Admin gắn điều kiện riêng cho portal: điều kiện đó thay thế mặc định cứng.
  const custom = gateHarness({ portal: { requiredQuestId: 'q-custom' }, targetCode: 'thanh_van_son_coc', questStatuses: { 'q-custom': 'completed' } });
  t.after(() => custom.gameplay.close());
  custom.targetCode = 'thanh_van_son_coc';
  assert.equal((await tryEnter(custom, 'gate_custom_01')).result.mapCode, 'thanh_van_son_coc');
});

function worldServiceHarness({ questIds = ['q-ok'] } = {}) {
  const base = (code) => ({
    id: code, code, tenMap: code, type: 'PLAIN', status: 'PUBLISHED', version: 1, w: 10, h: 10, spawnX: 5, spawnY: 5,
    jsonMap: Array.from({ length: 10 }, () => Array(10).fill(0)), portals: [], npcs: [], monsters: [], monsterSpawns: [],
  });
  const documents = [base('map_a'), base('map_b')];
  const world = {
    listAdminWorlds: () => documents.map((entry) => structuredClone(entry)),
    getByCode: (code) => documents.find((entry) => entry.code === code) || null,
    setWorld(map) { documents[documents.findIndex((entry) => entry.code === map.code)] = structuredClone(map); },
  };
  const store = { async saveAdminWorlds(_actor, updated) { for (const map of updated) world.setWorld(map); return updated.map((entry) => structuredClone(entry)); } };
  const quests = { list: () => questIds.map((id) => ({ id })) };
  const service = createAdminWorldService({ store, world, quests });
  const link = (extra = {}) => service.linkPortal({ sourceCode: 'map_a', targetCode: 'map_b', sourceX: 2, sourceY: 2, targetX: 3, targetY: 3, id: 'p1', twoWay: true, ...extra }, 'admin');
  const portal = (code, id) => world.listAdminWorlds().find((entry) => entry.code === code).portals.find((entry) => entry.id === id);
  return { link, portal, world };
}

test('linking a portal stores the quest gate and keeps it when the portal is saved again without gate fields', async () => {
  const { link, portal } = worldServiceHarness();
  await link({ requiredQuestId: 'q-ok', lockedMessage: '  Chưa đủ điều kiện  ' });
  assert.equal(portal('map_a', 'p1').requiredQuestId, 'q-ok');
  assert.equal(portal('map_a', 'p1').lockedMessage, 'Chưa đủ điều kiện');
  assert.equal(portal('map_b', 'p1_reverse').requiredQuestId, undefined, 'the gate belongs to the direction it was configured on');

  await link({ sourceX: 4, sourceY: 4 });
  assert.equal(portal('map_a', 'p1').x, 4);
  assert.equal(portal('map_a', 'p1').requiredQuestId, 'q-ok', 're-saving the position must not drop the gate');

  await link({ sourceX: 4, sourceY: 4, requiredQuestId: '', lockedMessage: '' });
  assert.equal(portal('map_a', 'p1').requiredQuestId, undefined, 'an explicit empty value removes the gate');
  assert.equal(portal('map_a', 'p1').lockedMessage, undefined);
});

test('re-saving a two-way portal keeps the gate already set on the reverse portal', async () => {
  const { link, portal, world } = worldServiceHarness();
  await link();
  const documents = world.listAdminWorlds();
  documents.find((entry) => entry.code === 'map_b').portals.find((entry) => entry.id === 'p1_reverse').requiredQuestId = 'q-ok';
  world.setWorld(documents.find((entry) => entry.code === 'map_b'));

  await link({ targetX: 6, targetY: 6 });
  assert.equal(portal('map_b', 'p1_reverse').x, 6);
  assert.equal(portal('map_b', 'p1_reverse').requiredQuestId, 'q-ok');
});

test('a portal gate must reference an existing quest with a valid id and a short message', async () => {
  const { link } = worldServiceHarness();
  await assert.rejects(link({ requiredQuestId: 'q-does-not-exist' }), (error) => error.code === 'WORLD_INVALID' && error.details.errors.some((message) => message.includes('q-does-not-exist')));
  await assert.rejects(link({ requiredQuestId: 'Bad Quest Id!' }), { code: 'WORLD_INVALID' });
  await assert.rejects(link({ requiredQuestId: 'q-ok', lockedMessage: 'x'.repeat(201) }), { code: 'WORLD_INVALID' });
});
