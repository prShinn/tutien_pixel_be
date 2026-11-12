const test = require('node:test');
const assert = require('node:assert/strict');
const { createEquipmentService } = require('../src/equipment/equipment-service');

function makeService(items) {
  const calls = [];
  const store = {
    async equipItem(userId, requestId, itemId, slot) { calls.push({ itemId, slot }); return { player: { id: 'p1' }, result: { type: 'equipped', itemId, slot } }; },
    async unequipItem(userId, requestId, slot) { return { player: { id: 'p1' }, result: { type: 'unequipped', slot } }; },
  };
  const catalog = { getItemByCode: (code) => items.find((item) => item.id === code || item.maDo === code) || null };
  const players = { snapshot: async () => ({ canhGioi: { stt: 1 } }), decorate: (player) => player };
  return { service: createEquipmentService({ store, catalog, players }), calls };
}

const items = [
  { id: 'SWORD', type: 'EQUIPMENT', slot: 'weapon', requiredRealmStt: 1 },
  { id: 'CAP', type: 'EQUIPMENT', slot: 'hat', requiredRealmStt: 1 },
  { id: 'OLD_HELM', type: 'EQUIPMENT', slot: 'helmet', requiredRealmStt: 1 },
  { id: 'STONE', type: 'STONE' },
];
const requestId = (name) => `equip_req_${name}`;

test('equip uses the item slot from the catalog when the client sends none', async () => {
  const { service, calls } = makeService(items);
  await service.equip('u1', { requestId: requestId('default'), itemCode: 'SWORD' });
  assert.deepEqual(calls, [{ itemId: 'SWORD', slot: 'weapon' }]);
});

test('equip accepts the matching slot and the legacy helmet alias for hats', async () => {
  const { service, calls } = makeService(items);
  await service.equip('u1', { requestId: requestId('match1'), itemCode: 'SWORD', slot: 'weapon' });
  await service.equip('u1', { requestId: requestId('match2'), itemCode: 'OLD_HELM', slot: 'hat' });
  await service.equip('u1', { requestId: requestId('match3'), itemCode: 'CAP', slot: 'HAT' });
  assert.deepEqual(calls.map((call) => call.slot), ['weapon', 'hat', 'hat']);
});

test('equip refuses a client-chosen slot that differs from the item slot and never reaches the store', async () => {
  const { service, calls } = makeService(items);
  await assert.rejects(service.equip('u1', { requestId: requestId('bad1'), itemCode: 'SWORD', slot: 'hat' }), { code: 'INVALID_EQUIPMENT_SLOT', status: 409 });
  await assert.rejects(service.equip('u1', { requestId: requestId('bad2'), itemCode: 'CAP', slot: 'weapon' }), { code: 'INVALID_EQUIPMENT_SLOT' });
  assert.deepEqual(calls, []);
});

test('equip still rejects unknown slots and non-equipment items', async () => {
  const { service } = makeService(items);
  await assert.rejects(service.equip('u1', { requestId: requestId('unknown'), itemCode: 'SWORD', slot: 'wings' }), { code: 'INVALID_EQUIPMENT_SLOT' });
  await assert.rejects(service.equip('u1', { requestId: requestId('stone'), itemCode: 'STONE' }), { code: 'ITEM_NOT_EQUIPMENT' });
  await assert.rejects(service.equip('u1', { requestId: requestId('missing'), itemCode: 'NOPE' }), { code: 'ITEM_NOT_EQUIPMENT' });
});
