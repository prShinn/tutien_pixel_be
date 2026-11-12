const crypto = require('node:crypto');
const { DomainError } = require('../domain');

const VALID_SOURCE_TYPES = new Set(['SYSTEM', 'ADMIN', 'EVENT', 'COMPENSATION', 'TOPUP_BONUS']);

function validateRequestId(requestId) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    throw new DomainError('INVALID_REQUEST_ID', 'requestId phải dài 8-80 ký tự');
  }
}

function createMailService({ store, catalog, players }) {
  async function list(userId, query = {}) {
    const rawLimit = query.limit == null ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      throw new DomainError('INVALID_LIMIT', 'limit phải là số nguyên từ 1 đến 50');
    }
    return store.listPlayerMail(userId, { limit: rawLimit, cursor: query.cursor || null });
  }

  async function claim(userId, mailId, requestId) {
    validateRequestId(requestId);
    if (typeof mailId !== 'string' || !/^[a-zA-Z0-9_-]{4,64}$/.test(mailId)) {
      throw new DomainError('INVALID_MAIL_ID', 'Mã thư không hợp lệ');
    }
    const mutation = await store.claimPlayerMail(userId, requestId, mailId, catalog.listItems());
    return { player: players.decorate(mutation.player), result: mutation.result };
  }

  async function sendSystemMail(actorId, payload = {}, fallbackRequestId = null) {
    const requestId = payload.requestId || fallbackRequestId || `adm_mail_${crypto.randomUUID()}`;
    validateRequestId(requestId);
    const playerId = typeof payload.playerId === 'string' ? payload.playerId.trim() : '';
    if (!playerId || playerId.length > 64) {
      throw new DomainError('INVALID_PLAYER_ID', 'playerId không hợp lệ');
    }
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!title || title.length > 120) throw new DomainError('INVALID_MAIL_TITLE', 'Tiêu đề thư dài 1-120 ký tự');
    if (!body || body.length > 2000) throw new DomainError('INVALID_MAIL_BODY', 'Nội dung thư dài 1-2000 ký tự');

    const sourceType = String(payload.sourceType || 'SYSTEM').trim().toUpperCase();
    if (!VALID_SOURCE_TYPES.has(sourceType)) {
      throw new DomainError('INVALID_SOURCE_TYPE', 'sourceType thư không hợp lệ');
    }
    const sourceRef = payload.sourceRef == null ? null : String(payload.sourceRef).trim().slice(0, 64) || null;

    let expiresAt = null;
    if (payload.expiresInHours != null && payload.expiresInHours !== '') {
      const hours = Number(payload.expiresInHours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
        throw new DomainError('INVALID_EXPIRY', 'expiresInHours phải trong khoảng (0, 8760]');
      }
      expiresAt = new Date(Date.now() + hours * 3600_000);
    }

    const rawAttachments = payload.attachments && typeof payload.attachments === 'object' ? payload.attachments : {};
    const xu = rawAttachments.xu == null ? 0 : Math.floor(Number(rawAttachments.xu));
    const linhThach = rawAttachments.linhThach == null ? 0 : Math.floor(Number(rawAttachments.linhThach));
    const tuVi = rawAttachments.tuVi == null ? 0 : Math.floor(Number(rawAttachments.tuVi));
    if (!Number.isSafeInteger(xu) || xu < 0 || xu > 1_000_000) throw new DomainError('INVALID_ATTACHMENT', 'Số lượng xu đính kèm không hợp lệ (0..1,000,000)');
    if (!Number.isSafeInteger(linhThach) || linhThach < 0 || linhThach > 100_000) throw new DomainError('INVALID_ATTACHMENT', 'Số lượng linh thạch đính kèm không hợp lệ (0..100,000)');
    if (!Number.isSafeInteger(tuVi) || tuVi < 0 || tuVi > 1_000_000) throw new DomainError('INVALID_ATTACHMENT', 'Số lượng tu vi đính kèm không hợp lệ (0..1,000,000)');

    const rawItems = Array.isArray(rawAttachments.items) ? rawAttachments.items : [];
    if (rawItems.length > 5) throw new DomainError('INVALID_ATTACHMENT', 'Mỗi thư đính kèm tối đa 5 vật phẩm');
    const mergedItems = new Map();
    for (const entry of rawItems) {
      const code = typeof entry?.itemCode === 'string' ? entry.itemCode.trim() : '';
      const qty = Math.floor(Number(entry?.quantity));
      if (!code || !Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
        throw new DomainError('INVALID_ATTACHMENT', 'Vật phẩm đính kèm phải có itemCode và quantity từ 1..99');
      }
      const def = catalog.getItemByCode(code);
      if (!def) throw new DomainError('ITEM_NOT_FOUND', `Vật phẩm ${code} không tồn tại trong catalog`, 404);
      const nextQty = (mergedItems.get(def.id) || 0) + qty;
      if (nextQty > 99) throw new DomainError('INVALID_ATTACHMENT', `Số lượng vật phẩm ${def.id} vượt quá 99`);
      mergedItems.set(def.id, nextQty);
    }

    const attachments = {
      xu,
      linhThach,
      tuVi,
      items: [...mergedItems.entries()].map(([itemCode, quantity]) => ({ itemCode, quantity })),
    };

    return store.sendPlayerMail(actorId, { requestId, playerId, title, body, sourceType, sourceRef, expiresAt, attachments });
  }

  return { list, claim, sendSystemMail };
}

module.exports = { createMailService };
