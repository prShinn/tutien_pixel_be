const { DomainError } = require('../domain');
const { QUEST_DEFINITIONS } = require('../quests/quest-catalog');

const EDITABLE = new Set(['quests', 'npcs', 'items', 'skills']);
const READ_ONLY = new Set(['accounts', 'monsters']);

function recordId(collection, record) {
  if (collection === 'skills') return String(record.code || record.id || '');
  return String(record.id || record.code || record.maDo || '');
}

function createAdminContentService({ store, catalog, world }) {
  function baseRecords(collection) {
    if (collection === 'items' || collection === 'skills') return catalog.getAdminCollection(collection);
    if (collection === 'monsters') return catalog.listMonsters();
    if (collection === 'quests') return QUEST_DEFINITIONS.map((entry) => ({ ...entry }));
    if (collection === 'npcs') return world.listAdminWorlds().flatMap((entry) => entry.npcs || []);
    return [];
  }

  async function list(collection) {
    if (!EDITABLE.has(collection) && !READ_ONLY.has(collection)) throw new DomainError('INVALID_CONTENT_COLLECTION', 'Nhóm nội dung không hợp lệ', 404);
    if (collection === 'accounts') return { collection, demo: false, persisted: true, data: await store.listAdminAccounts() };
    const records = baseRecords(collection);
    const merged = new Map(records.map((entry) => [recordId(collection, entry), entry]));
    for (const override of await store.listAdminContentRecords(collection)) {
      if (override.deleted) merged.delete(override.id);
      else merged.set(override.id, override.data);
    }
    return { collection, demo: false, persisted: true, data: [...merged.values()] };
  }

  async function create(collection, input, actorId, requestId) {
    if (!EDITABLE.has(collection)) throw new DomainError('CONTENT_READ_ONLY', 'Nhóm nội dung này chỉ được xem', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_PAYLOAD', 'Nội dung không hợp lệ');
    const id = recordId(collection, input);
    if (!id) throw new DomainError('CONTENT_ID_REQUIRED', 'Bản ghi cần có id hoặc code');
    const current = await list(collection);
    if (current.data.some((entry) => recordId(collection, entry) === id)) throw new DomainError('CONTENT_EXISTS', 'Bản ghi đã tồn tại', 409);
    const document = { ...input, id: input.id || id };
    const saved = await store.mutateAdminContent(actorId, collection, id, document, false, requestId);
    await refreshCatalog(collection);
    return { demo: false, persisted: true, data: saved.data };
  }

  async function update(collection, id, input, actorId, requestId) {
    if (!EDITABLE.has(collection)) throw new DomainError('CONTENT_READ_ONLY', 'Nhóm nội dung này chỉ được xem', 403);
    const current = await list(collection);
    if (!current.data.some((entry) => recordId(collection, entry) === id)) throw new DomainError('CONTENT_NOT_FOUND', 'Bản ghi nội dung không tồn tại', 404);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_PAYLOAD', 'Nội dung không hợp lệ');
    if (input.id != null && recordId(collection, input) !== id) throw new DomainError('CONTENT_ID_MISMATCH', 'id trong body không khớp đường dẫn', 400);
    const previous = current.data.find((entry) => recordId(collection, entry) === id);
    const document = { ...previous, ...input, id: previous.id || id };
    const saved = await store.mutateAdminContent(actorId, collection, id, document, false, requestId);
    await refreshCatalog(collection);
    return { demo: false, persisted: true, data: saved.data };
  }

  async function remove(collection, id, actorId, requestId) {
    if (!EDITABLE.has(collection)) throw new DomainError('CONTENT_READ_ONLY', 'Nhóm nội dung này chỉ được xem', 403);
    const current = await list(collection);
    if (!current.data.some((entry) => recordId(collection, entry) === id)) throw new DomainError('CONTENT_NOT_FOUND', 'Bản ghi nội dung không tồn tại', 404);
    await store.mutateAdminContent(actorId, collection, id, null, true, requestId);
    await refreshCatalog(collection);
    return { demo: false, persisted: true, removed: id };
  }

  async function refreshCatalog(collection) {
    if (collection !== 'items' && collection !== 'skills') return;
    const current = await list(collection);
    catalog.applyAdminCollection(collection, current.data);
  }

  return { list, create, update, remove };
}

module.exports = { createAdminContentService };
