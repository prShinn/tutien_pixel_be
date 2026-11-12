const { DomainError } = require('../domain');
const { validateRequestId } = require('../inventory/inventory-service');

const EQUIPMENT_SLOTS = new Set(['weapon', 'armor', 'pants', 'boots', 'hat', 'gloves', 'ring', 'amulet', 'belt', 'gem']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createEquipmentService({ store, catalog, players }) {
  async function equip(userId, input) {
    validateRequestId(input?.requestId);
    const rawInstanceId = input?.instanceId != null ? String(input.instanceId).trim() : '';
    if (rawInstanceId && !UUID_RE.test(rawInstanceId)) {
      throw new DomainError('INVALID_INSTANCE_ID', 'instanceId không hợp lệ', 400);
    }
    const player = await players.snapshot(userId);
    let itemCode = String(input?.itemCode || input?.itemId || '').trim();
    if (rawInstanceId && !itemCode) {
      const matched = (player.inventory || []).find((entry) => entry.instanceId === rawInstanceId);
      if (matched) itemCode = String(matched.itemCode || matched.id || '').trim();
    }
    const item = catalog.getItemByCode(itemCode);
    if (!item || String(item.type || item.loai || '').toUpperCase() !== 'EQUIPMENT') throw new DomainError('ITEM_NOT_EQUIPMENT', 'Không tìm thấy trang bị hợp lệ', 404);
    const itemSlot = String(item.slot || '').toLowerCase().replace(/^helmet$/, 'hat');
    const slot = String(input?.slot || itemSlot || 'weapon').toLowerCase();
    if (!EQUIPMENT_SLOTS.has(slot)) throw new DomainError('INVALID_EQUIPMENT_SLOT', 'Vị trí trang bị không hợp lệ');
    // Vị trí do client gửi chỉ được trùng với vị trí khai báo trong catalog của chính món đồ đó.
    if (itemSlot && slot !== itemSlot) throw new DomainError('INVALID_EQUIPMENT_SLOT', 'Trang bị này không dùng được ở vị trí đã chọn', 409);
    const playerRealmStt = Number(player.canhGioi?.stt || 1);
    const requiredRealmStt = Math.max(1, Number(item.requiredRealmStt || 1));
    if (playerRealmStt < requiredRealmStt) throw new DomainError('REALM_TOO_LOW', 'Cảnh giới chưa đủ để trang bị', 409);
    const mutation = rawInstanceId
      ? await store.equipItem(userId, input.requestId, item.id, slot, player.realmCode, playerRealmStt, requiredRealmStt, rawInstanceId)
      : await store.equipItem(userId, input.requestId, item.id, slot, player.realmCode, playerRealmStt, requiredRealmStt);
    return { player: players.decorate(mutation.player), result: mutation.result };
  }

  async function unequip(userId, input) {
    validateRequestId(input?.requestId);
    const slot = String(input?.slot || '').toLowerCase();
    if (!EQUIPMENT_SLOTS.has(slot)) throw new DomainError('INVALID_EQUIPMENT_SLOT', 'Vị trí trang bị không hợp lệ');
    const mutation = await store.unequipItem(userId, input.requestId, slot);
    return { player: players.decorate(mutation.player), result: mutation.result };
  }

  return { equip, unequip };
}

module.exports = { createEquipmentService, EQUIPMENT_SLOTS };
