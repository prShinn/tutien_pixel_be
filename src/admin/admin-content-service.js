const { DomainError } = require('../domain');
const { BALANCE } = require('../data/balance');
const { QUEST_DEFINITIONS } = require('../quests/quest-catalog');
const { validateQuestDefinition } = require('../quests/quest-service');

const EDITABLE = new Set(['quests', 'items', 'skills', 'monsters']);
const VALID_ITEM_TYPES = new Set(BALANCE.itemTaxonomy?.types || [
  'EQUIPMENT', 'ENHANCE_GEM', 'PROTECT_CHARM', 'POTION', 'CONSUME', 'STONE',
  'ELEMSTONE', 'LINDAN', 'BREAKTHROUGH_PILL', 'MATERIAL', 'MAT', 'BAG_EXPAND', 'STAT_RESET', 'EXCHANGE_XU',
]);
const VALID_EQUIP_SLOTS = new Set(['weapon', 'armor', 'pants', 'boots', 'hat', 'gloves', 'ring', 'amulet', 'belt', 'gem']);
const VALID_RARITIES = new Set(Object.keys(BALANCE.itemTaxonomy?.rarities || { NORMAL: 1, MAGIC: 1, EXL: 1, ANCIENT: 1 }));
const VALID_SPARKLE_PRESETS = new Set(BALANCE.itemTaxonomy?.sparklePresets || ['NONE', 'DEWDROP', 'SHIMMER', 'MYTHIC_PRISM', 'ELEMENTAL']);
const seed = require('../data/mock-data');
const PAGED = { items: seed.items, monsters: seed.monsterDefs || [], skills: seed.skills };
const READ_ONLY = new Set(['accounts', 'npcs']);

function recordId(collection, record) {
  if (collection === 'skills') return String(record.code || record.id || '');
  return String(record.id || record.code || record.maDo || '');
}

function parseMonster(input, catalog) {
  const id = input.id;
  const code = input.code;
  const type = input.type;
  const linhCan = input.linhCan;
  const level = input.level;
  const hp = input.hp;
  const atk = input.atk;
  const def = input.def;
  const speed = input.speed;
  const respawnMs = input.respawnMs == null ? 10000 : input.respawnMs;
  const img = input.img;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const validInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const root = catalog.getRootByCode(linhCan);
  if (typeof id !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(id) || code !== id || !name || name.length > 80
      || !['NORMAL', 'ELITE', 'BOSS'].includes(type) || !root
      || !validInt(level, 1, 1000) || !validInt(hp, 1, 10000000) || !validInt(atk, 1, 100000)
      || !validInt(def, 0, 100000) || !Number.isFinite(speed) || speed < 0.1 || speed > 10
      || !validInt(respawnMs, 1000, 3600000)) {
    throw new DomainError('INVALID_MONSTER', 'Thông tin quái vật không hợp lệ');
  }
  const localAsset = typeof img === 'string' && /^(?:\.\/)?assets\/[A-Za-z0-9_/-]+\.png$/.test(img);
  const prefix = 'data:image/png;base64,';
  if (!localAsset && (typeof img !== 'string' || !img.startsWith(prefix) || img.length > 24000)) {
    throw new DomainError('INVALID_MONSTER_IMAGE', 'Sprite phải là PNG hợp lệ và không được vượt giới hạn dung lượng');
  }
  if (!localAsset) {
    const data = img.slice(prefix.length);
    const png = Buffer.from(data, 'base64');
    const size = png.length >= 33 ? png.readUInt32BE(16) : 0;
    if (png.toString('base64') !== data || ![32, 48, 64].includes(size)
        || png.subarray(0, 16).toString('hex') !== '89504e470d0a1a0a0000000d49484452'
        || png.readUInt32BE(20) !== size) {
      throw new DomainError('INVALID_MONSTER_IMAGE', 'Sprite phải là PNG vuông 32, 48 hoặc 64 px');
    }
  }
  const color = /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : root.color;
  return { ...input, id, code, name, img, type, linhCan, nguHanh: Array.isArray(input.nguHanh) ? input.nguHanh : [linhCan], color,
    level, hp, maxHp: validInt(input.maxHp, 1, 10000000) ? input.maxHp : hp, atk, def, speed, respawnMs };
}

function parseItem(input, catalog) {
  const id = String(input.id || input.maDo || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new DomainError('INVALID_ITEM', 'Mã vật phẩm chỉ gồm chữ cái, số, _ hoặc - (tối đa 64 ký tự)');
  }
  const name = String(input.name || input.tenDo || '').trim();
  if (!name || name.length > 80) {
    throw new DomainError('INVALID_ITEM', 'Tên vật phẩm dài 1-80 ký tự');
  }
  const loai = String(input.type || input.loai || 'MATERIAL').trim().toUpperCase();
  if (!VALID_ITEM_TYPES.has(loai)) {
    throw new DomainError('INVALID_ITEM_TYPE', `Loại vật phẩm không hợp lệ: ${loai}`);
  }
  const rarity = String(input.rarity || 'NORMAL').trim().toUpperCase();
  if (!VALID_RARITIES.has(rarity)) {
    throw new DomainError('INVALID_ITEM_RARITY', 'Phẩm chất vật phẩm không hợp lệ');
  }
  const requiredRealmStt = input.requiredRealmStt == null ? 1 : Number(input.requiredRealmStt);
  if (!Number.isSafeInteger(requiredRealmStt) || requiredRealmStt < 1 || requiredRealmStt > 12) {
    throw new DomainError('INVALID_ITEM', 'Yêu cầu cảnh giới phải là số nguyên 1..12');
  }
  const itemLevel = input.itemLevel == null ? requiredRealmStt * 10 : Number(input.itemLevel);
  if (!Number.isSafeInteger(itemLevel) || itemLevel < 1 || itemLevel > 999) {
    throw new DomainError('INVALID_ITEM', 'Cấp độ vật phẩm phải từ 1 đến 999');
  }
  const currency = String(input.currency || 'XU').trim().toUpperCase() === 'LINH_THACH' ? 'LINH_THACH' : 'XU';
  const giaMua = input.giaMua == null ? 0 : Number(input.giaMua);
  const giaBan = input.giaBan == null ? 0 : Number(input.giaBan);
  if (!Number.isSafeInteger(giaMua) || giaMua < 0 || giaMua > 100_000_000
      || !Number.isSafeInteger(giaBan) || giaBan < 0 || giaBan > 100_000_000) {
    throw new DomainError('INVALID_ITEM_PRICE', 'Giá mua/bán không hợp lệ');
  }

  let slot = input.slot != null ? String(input.slot).trim().toLowerCase().replace(/^helmet$/, 'hat') : undefined;
  if (loai === 'EQUIPMENT') {
    if (!slot || !VALID_EQUIP_SLOTS.has(slot)) {
      throw new DomainError('INVALID_ITEM_SLOT', 'Trang bị cần vị trí slot hợp lệ (weapon, armor, ...)');
    }
  } else if (slot && !VALID_EQUIP_SLOTS.has(slot)) {
    slot = undefined;
  }

  const linhCan = input.linhCan != null && String(input.linhCan).trim()
    ? String(input.linhCan).trim().toUpperCase()
    : undefined;
  if (linhCan && linhCan !== 'COMMON' && !catalog.getRootByCode(linhCan)) {
    throw new DomainError('INVALID_ITEM_ELEMENT', 'Linh căn vật phẩm không hợp lệ');
  }

  let img = input.img != null ? String(input.img).trim() : '';
  if (img) {
    const localAsset = /^(?:\.\/)?assets\/[A-Za-z0-9_/-]+\.(?:png|svg|webp)$/.test(img);
    const prefix = 'data:image/png;base64,';
    if (!localAsset) {
      if (!img.startsWith(prefix) || img.length > 24000) {
        throw new DomainError('INVALID_ITEM_IMAGE', 'Ảnh item phải là đường dẫn assets hoặc PNG base64 <= 24.000 ký tự');
      }
      const data = img.slice(prefix.length);
      const png = Buffer.from(data, 'base64');
      const w = png.length >= 33 ? png.readUInt32BE(16) : 0;
      const h = png.length >= 33 ? png.readUInt32BE(20) : 0;
      if (png.toString('base64') !== data
          || png.subarray(0, 16).toString('hex') !== '89504e470d0a1a0a0000000d49484452'
          || w !== h || ![16, 24, 32, 48, 64].includes(w)) {
        throw new DomainError('INVALID_ITEM_IMAGE', 'PNG icon item phải là ảnh vuông 16/24/32/48/64 px');
      }
    }
  }

  let stats = {};
  if (input.stats && typeof input.stats === 'object' && !Array.isArray(input.stats)) {
    for (const [k, rawVal] of Object.entries(input.stats)) {
      const val = Number(rawVal);
      if (!Number.isFinite(val)) throw new DomainError('INVALID_ITEM_STATS', `Chỉ số ${k} không hợp lệ`);
      if (k === 'crit') {
        if (val < 0 || val > 1) throw new DomainError('INVALID_ITEM_STATS', 'Chỉ số bạo kích nằm trong 0..1');
        if (val !== 0) stats[k] = Math.round(val * 10000) / 10000;
      } else {
        if (val < -10000 || val > 100000) throw new DomainError('INVALID_ITEM_STATS', `Chỉ số ${k} vượt giới hạn`);
        if (val !== 0) stats[k] = Math.trunc(val);
      }
    }
  }

  let sparkle = undefined;
  if (input.sparkle && typeof input.sparkle === 'object' && !Array.isArray(input.sparkle)) {
    const preset = String(input.sparkle.preset || 'DEWDROP').trim().toUpperCase();
    if (!VALID_SPARKLE_PRESETS.has(preset)) {
      throw new DomainError('INVALID_ITEM_SPARKLE', 'Hiệu ứng lấp lánh 2D không hợp lệ');
    }
    const sparkleColor = /^#[0-9a-f]{6}$/i.test(input.sparkle.color || '') ? input.sparkle.color : '#ffd966';
    const intensity = Math.max(1, Math.min(3, Math.floor(Number(input.sparkle.intensity || 2))));
    sparkle = { enabled: Boolean(input.sparkle.enabled ?? preset !== 'NONE'), preset, color: sparkleColor, intensity };
  }

  const strOpt = (val, maxLen = 400) => {
    if (typeof val !== 'string') return undefined;
    const trimmed = val.trim();
    return trimmed ? trimmed.slice(0, maxLen) : undefined;
  };
  const intOpt = (val, min = 0, max = 100_000_000) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return Number.isSafeInteger(num) && num >= min && num <= max ? num : undefined;
  };
  const numOpt = (val, min = 0, max = 1) => {
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return Number.isFinite(num) && num >= min && num <= max ? num : undefined;
  };
  const weaponKind = strOpt(input.weaponKind, 32)?.toUpperCase();
  const gemTier = strOpt(input.gemTier, 32)?.toUpperCase();
  const moTa = strOpt(input.moTa ?? input.mota ?? input.description, 400);
  const icon = strOpt(input.icon, 16);
  const shopCategory = strOpt(input.shopCategory, 48);
  const shopTab = strOpt(input.shopTab, 48);
  const realmCode = strOpt(input.realmCode, 64);
  const pillGroup = strOpt(input.pillGroup, 64);
  const quality = strOpt(input.quality, 48);
  const qualityLabel = strOpt(input.qualityLabel, 64);
  const nextQualityItemCode = strOpt(input.nextQualityItemCode, 64);
  const giaTriTuVi = intOpt(input.giaTriTuVi);
  const tuViLinhCanVal = intOpt(input.tuViLinhCanVal);
  const healHp = intOpt(input.healHp);
  const healMp = intOpt(input.healMp);
  const bagSlots = intOpt(input.bagSlots, 1, 80);
  const xuAmount = intOpt(input.xuAmount);
  const qualityTier = intOpt(input.qualityTier, 1, 10);
  const breakthroughRate = numOpt(input.breakthroughRate, 0, 1);

  return {
    id,
    maDo: id,
    name,
    tenDo: strOpt(input.tenDo, 80) || name,
    loai,
    type: loai,
    ...(icon ? { icon } : {}),
    ...(moTa ? { moTa } : {}),
    ...(shopCategory ? { shopCategory } : {}),
    ...(shopTab ? { shopTab } : {}),
    ...(slot ? { slot } : {}),
    ...(linhCan ? { linhCan } : {}),
    ...(weaponKind ? { weaponKind } : {}),
    ...(gemTier ? { gemTier } : {}),
    requiredRealmStt,
    itemLevel,
    rarity,
    hasLuck: Boolean(input.hasLuck),
    currency,
    giaMua,
    giaBan,
    ...(img ? { img } : {}),
    stats,
    ...(sparkle ? { sparkle } : {}),
    ...(giaTriTuVi !== undefined ? { giaTriTuVi } : {}),
    ...(tuViLinhCanVal !== undefined ? { tuViLinhCanVal } : {}),
    ...(healHp !== undefined ? { healHp } : {}),
    ...(healMp !== undefined ? { healMp } : {}),
    ...(bagSlots !== undefined ? { bagSlots } : {}),
    ...(xuAmount !== undefined ? { xuAmount } : {}),
    ...(realmCode ? { realmCode } : {}),
    ...(pillGroup ? { pillGroup } : {}),
    ...(quality ? { quality } : {}),
    ...(qualityTier !== undefined ? { qualityTier } : {}),
    ...(qualityLabel ? { qualityLabel } : {}),
    ...(breakthroughRate !== undefined ? { breakthroughRate } : {}),
    ...(nextQualityItemCode ? { nextQualityItemCode } : {}),
  };
}
function createAdminContentService({ store, catalog, world, quests, onCatalogChange = () => {} }) {
  const writes = new Map();
  const isPaged = (collection) => Object.hasOwn(PAGED, collection);

  function serialize(operation) {
    return (collection, ...args) => {
      const pending = (writes.get(collection) || Promise.resolve()).then(() => operation(collection, ...args));
      const settled = pending.catch(() => {});
      writes.set(collection, settled);
      void settled.then(() => { if (writes.get(collection) === settled) writes.delete(collection); });
      return pending;
    };
  }

  async function findRecord(collection, id) {
    if (!isPaged(collection)) {
      const data = (await list(collection)).data.find((entry) => recordId(collection, entry) === id);
      return data ? { data } : null;
    }
    const stored = await store.getAdminContentRecord(collection, id);
    if (stored) return stored.deleted ? null : stored;
    const data = PAGED[collection].find((entry) => recordId(collection, entry) === id);
    return data ? { data, version: 0 } : null;
  }

  async function publishChange(collection, id, saved) {
    if (collection !== 'items' && collection !== 'monsters') return refreshCatalog(collection);
    if (!catalog.applyAdminRecord(collection, id, saved)) return;
    try { onCatalogChange(collection, id, saved); }
    catch { process.stderr.write('{"level":"error","event":"catalog_notification_failed"}\n'); }
  }
  function baseRecords(collection) {
    if (collection === 'items' || collection === 'skills') return catalog.getAdminCollection(collection);
    if (collection === 'monsters') return catalog.listMonsters();
    if (collection === 'quests') return QUEST_DEFINITIONS.map((entry) => ({ ...entry }));
    if (collection === 'npcs') return world.listAdminWorlds().flatMap((entry) => entry.npcs || []);
    return [];
  }

  async function list(collection, query = {}) {
    if (!EDITABLE.has(collection) && !READ_ONLY.has(collection)) throw new DomainError('INVALID_CONTENT_COLLECTION', 'Nhóm nội dung không hợp lệ', 404);
    if (collection === 'accounts') return { collection, demo: false, persisted: true, data: await store.listAdminAccounts() };
    if (isPaged(collection) && ["page", "limit", "q", "ids"].some((key) => query[key] !== undefined)) {
      const page = Number(query.page ?? 1);
      const limit = Number(query.limit ?? 24);
      const q = query.q ?? "";
      const ids = typeof query.ids === "string" ? query.ids.split(",") : [];
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
          || typeof q !== "string" || q.length > 100 || (query.ids !== undefined && typeof query.ids !== "string")
          || ids.length > 50 || ids.some((id) => !/^[A-Za-z0-9_-]{1,80}$/.test(id))) {
        throw new DomainError("INVALID_CATALOG_PAGE", "Bộ lọc hoặc thông số phân trang không hợp lệ", 400);
      }
      const seeds = new Map(PAGED[collection].map((entry) => [recordId(collection, entry), entry]));
      const searchRows = [...seeds].map(([id, entry]) => ({ id, name: entry.tenDo || entry.name || "", code: entry.maDo || entry.code || "" }));
      const { total, rows } = await store.pageAdminCatalog(collection, searchRows, { q: q.trim(), ids, limit, offset: (page - 1) * limit });
      return { collection, demo: false, persisted: true, data: rows.map((row) => row.data ?? seeds.get(row.id)), pagination: { page, limit, total } };
    }
    const records = baseRecords(collection);
    const merged = new Map(records.map((entry) => [recordId(collection, entry), entry]));
    for (const override of await store.listAdminContentRecords(collection)) {
      if (override.deleted) merged.delete(override.id);
      else merged.set(override.id, override.data);
    }
    return { collection, demo: false, persisted: true, data: [...merged.values()] };
  }

  async function create(collection, input, actorId, requestId) {
    if (!EDITABLE.has(collection) && collection !== 'monsters') throw new DomainError('CONTENT_READ_ONLY', 'Nhóm nội dung này chỉ được xem', 403);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_PAYLOAD', 'Nội dung không hợp lệ');
    if (collection === 'monsters') input = parseMonster(input, catalog);
    if (collection === 'items') input = parseItem(input, catalog);
    if (collection === 'quests') input = validateQuestDefinition(input, catalog.listItems(), world.listSummaries(), catalog.listMonsters());
    const id = recordId(collection, input);
    if (!id) throw new DomainError('CONTENT_ID_REQUIRED', 'Bản ghi cần có id hoặc code');
    if (await findRecord(collection, id)) throw new DomainError('CONTENT_EXISTS', 'Bản ghi đã tồn tại', 409);
    const document = { ...input, id: input.id || id };
    const saved = await store.mutateAdminContent(actorId, collection, id, document, false, requestId, true);
    await publishChange(collection, id, saved);
    return { demo: false, persisted: true, data: saved.data };
  }

  async function update(collection, id, input, actorId, requestId) {
    if (!EDITABLE.has(collection)) throw new DomainError('CONTENT_READ_ONLY', 'Nhóm nội dung này chỉ được xem', 403);
    const found = await findRecord(collection, id);
    if (!found) throw new DomainError('CONTENT_NOT_FOUND', 'Bản ghi nội dung không tồn tại', 404);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_PAYLOAD', 'Nội dung không hợp lệ');
    if (input.id != null && recordId(collection, input) !== id) throw new DomainError('CONTENT_ID_MISMATCH', 'id trong body không khớp đường dẫn', 400);
    const previous = found.data;
    if (collection === 'monsters') input = parseMonster({ ...previous, ...input, id, code: previous.code || id }, catalog);
    if (collection === 'items') input = parseItem({ ...previous, ...input, id }, catalog);
    if (collection === 'quests') input = validateQuestDefinition({ ...previous, ...input, id }, catalog.listItems(), world.listSummaries(), catalog.listMonsters());
    const document = { ...previous, ...input, id: previous.id || id };
    const saved = await store.mutateAdminContent(actorId, collection, id, document, false, requestId, false, found.version);
    await publishChange(collection, id, saved);
    return { demo: false, persisted: true, data: saved.data };
  }

  async function remove(collection, id, actorId, requestId) {
    if (!EDITABLE.has(collection) || collection === 'quests' || collection === 'monsters') throw new DomainError('CONTENT_READ_ONLY', 'Quest và quái được giữ để bảo vệ tiến độ và cấu hình map', 403);
    const found = await findRecord(collection, id);
    if (!found) throw new DomainError('CONTENT_NOT_FOUND', 'Bản ghi nội dung không tồn tại', 404);
    const saved = await store.mutateAdminContent(actorId, collection, id, null, true, requestId, false, found.version);
    await publishChange(collection, id, saved);
    return { demo: false, persisted: true, removed: id };
  }

  async function refreshCatalog(collection) {
    if (collection === 'quests') {
      quests.applyOverrides(await store.listAdminContentRecords('quests'));
      return;
    }
    if (!['items', 'skills', 'monsters'].includes(collection)) return;
    const current = await list(collection);
    catalog.applyAdminCollection(collection, current.data);
  }

  return { list, create: serialize(create), update: serialize(update), remove: serialize(remove) };
}

module.exports = { createAdminContentService };
