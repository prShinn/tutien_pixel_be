const { DomainError } = require('./domain');

function validateRequest(requestId, itemCode, quantity, catalog, operation) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    throw new DomainError('INVALID_REQUEST_ID', 'requestId phải dài 8-80 ký tự');
  }
  if (typeof itemCode !== 'string') throw new DomainError('ITEM_NOT_FOUND', 'Vật phẩm không tồn tại', 404);
  const definition = catalog.getItemByCode(itemCode);
  if (!definition) throw new DomainError('ITEM_NOT_FOUND', 'Vật phẩm không tồn tại', 404);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new DomainError('INVALID_QUANTITY', 'Số lượng phải là số nguyên từ 1 đến 99');
  }

  const currency = String(definition.currency || 'XU').toUpperCase() === 'LINH_THACH' ? 'LINH_THACH' : 'XU';
  if (operation === 'SELL_ITEM' && currency !== 'XU') {
    throw new DomainError('ITEM_NOT_SELLABLE', 'Vật phẩm Kỳ Trân Các không thể bán lại bằng Xu', 400);
  }
  const price = operation === 'BUY_ITEM' ? Number(definition.giaMua) : Number(definition.giaBan);
  if (!Number.isSafeInteger(price) || price < 0 || (operation === 'BUY_ITEM' && price <= 0)) {
    const code = operation === 'BUY_ITEM' ? 'ITEM_NOT_BUYABLE' : 'ITEM_NOT_SELLABLE';
    throw new DomainError(code, operation === 'BUY_ITEM' ? 'Vật phẩm này không thể mua' : 'Vật phẩm này không thể bán', 400);
  }
  return { definition, item: { currency, price, sellPrice: price } };
}

function createShopService({ store, catalog, players }) {
  function listCatalog() { return catalog.listItems(); }
  function listPremiumCatalog() { return catalog.listPremiumItems(); }

  async function buy(userId, requestId, itemCode, quantity) {
    const { definition, item } = validateRequest(requestId, itemCode, quantity, catalog, 'BUY_ITEM');
    const player = await store.buyItem(userId, requestId, definition.id, quantity, item);
    return {
      player: players.decorate(player),
      result: { type: 'bought', itemId: definition.id, itemCode: definition.id, quantity, currency: item.currency, price: item.price * quantity },
    };
  }

  async function sell(userId, requestId, itemCode, quantity, instanceId = null) {
    const cleanInstanceId = instanceId != null ? String(instanceId).trim() : '';
    if (cleanInstanceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanInstanceId)) {
      throw new DomainError('INVALID_INSTANCE_ID', 'instanceId không hợp lệ', 400);
    }
    const { definition, item } = validateRequest(requestId, itemCode, quantity, catalog, 'SELL_ITEM');
    if (item.sellPrice <= 0) throw new DomainError('ITEM_NOT_SELLABLE', 'Vật phẩm này không thể bán', 400);
    const soldPlayer = cleanInstanceId
      ? await store.sellItem(userId, requestId, definition.id, quantity, item, cleanInstanceId)
      : await store.sellItem(userId, requestId, definition.id, quantity, item);
    const actualPrice = Number.isFinite(Number(soldPlayer?._sellTotal))
      ? Number(soldPlayer._sellTotal)
      : item.sellPrice * quantity;
    return {
      player: players.decorate(soldPlayer),
      result: { type: 'sold', itemId: definition.id, itemCode: definition.id, quantity, currency: 'XU', price: actualPrice },
    };
  }

  return { listCatalog, listPremiumCatalog, buy, sell };
}

module.exports = { createShopService };
