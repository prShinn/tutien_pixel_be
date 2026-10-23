const { DomainError } = require('./domain');

const catalog = Object.freeze({
  small_xu_pack: { type: 'CONSUMABLE', price: 10, sellPrice: 3, effect: { xu: 25 } },
  linh_dan: { type: 'CULTIVATION', price: 50, sellPrice: 15, effect: { tuVi: 100 } },
});

function createPlayerService({ store }) {
  async function create(userId, input) {
    const name = String(input?.name || '').trim();
    if (!/^[\p{L}0-9_ ]{2,24}$/u.test(name)) throw new DomainError('INVALID_PLAYER_NAME', 'Tên nhân vật dài 2-24 ký tự');
    return store.createPlayer(userId, { id: `plr_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, inventoryId: `inv_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, name, realmCode: 'PHAM_NHAN', realmStage: 1, tuVi: 0, mapCode: 'tan_thu_thon', x: 64, y: 64, version: 1 });
  }

  async function buy(userId, requestId, itemCode, quantity) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(requestId || ''))) throw new DomainError('INVALID_REQUEST_ID', 'requestId phải dài 8-80 ký tự');
    const item = catalog[itemCode]; const count = Math.max(1, Math.min(99, Number(quantity) || 1));
    if (!item) throw new DomainError('ITEM_NOT_FOUND', 'Vật phẩm không tồn tại', 404);
    return store.buyItem(userId, requestId, itemCode, count, item);
  }

  return { catalog, create, snapshot: store.playerSnapshot, buy };
}

module.exports = { createPlayerService };
