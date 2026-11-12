const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BALANCE,
  enhanceStatMultiplier,
  scaledEquipmentStats,
  resolveEquipmentModifiers,
  calcEquipmentSellPrice,
  deriveStats,
  combatPower,
} = require('../src/data/balance');
const { publicPlayer, DomainError } = require('../src/domain');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createEnhanceService, planEnhanceAttempt, evaluateEnhanceOutcome } = require('../src/enhance/enhance-service');
const { createAdminContentService } = require('../src/admin/admin-content-service');
const { createEquipmentService } = require('../src/equipment/equipment-service');
const { createShopService } = require('../src/shop');

const TINY_32X32_PNG_DATA_URL = (() => {
  // Minimal valid 32x32 RGBA PNG (precomputed zlib headerless/minimal test fixture via node:zlib)
  const zlib = require('node:zlib');
  const w = 32;
  const h = 32;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  raw[1] = 255;
  raw[2] = 215;
  raw[3] = 0;
  raw[4] = 255;
  const compressed = zlib.deflateSync(raw);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
})();

test('enhanceStatMultiplier and scaledEquipmentStats scale +0..+15 accurately', () => {
  assert.equal(enhanceStatMultiplier(0), 1);
  assert.equal(Math.round(enhanceStatMultiplier(7) * 100) / 100, 1.56);
  assert.equal(Math.round(enhanceStatMultiplier(9) * 100) / 100, 1.72);
  assert.equal(Math.round(enhanceStatMultiplier(13) * 100) / 100, 2.2);
  assert.equal(Math.round(enhanceStatMultiplier(15) * 100) / 100, 2.44);

  const scaled = scaledEquipmentStats({
    stats: { pAtk: 10, crit: 0.05 },
    enhanceLevel: 9,
  });
  assert.equal(scaled.pAtk, 17);
  assert.equal(scaled.crit, 0.05);

  const baseSell = calcEquipmentSellPrice(100, 0, 'NORMAL');
  const upgradedSell = calcEquipmentSellPrice(100, 10, 'EXL');
  assert.equal(baseSell, 100);
  assert.ok(upgradedSell > 300);
});

test('resolveEquipmentModifiers computes glow tiers, Luck crit, and capped Exl bonuses', () => {
  const mods = resolveEquipmentModifiers({
    weapon: {
      enhanceLevel: 11,
      hasLuck: true,
      exlOptions: [
        { code: 'DMG_PCT', val: 10 },
        { code: 'ARMOR_PIERCE_PCT', val: 10 },
      ],
    },
    armor: {
      enhanceLevel: 7,
      exlOptions: [{ code: 'MAX_HP_PCT', val: 10 }, { code: 'EVASION_PCT', val: 6 }],
    },
  });
  assert.equal(mods.glowTier, 3);
  assert.equal(mods.luckCritBonus, BALANCE.enhance.luckCombatCritBonus);
  assert.equal(mods.exl.dmgPct, 0.1);
  assert.equal(mods.exl.armorPiercePct, 0.1);
  assert.equal(mods.exl.maxHpPct, 0.1);
  assert.equal(mods.exl.evasionPct, 0.06);

  const derived = deriveStats({}, {
    armor: { enhanceLevel: 0, hasLuck: true, exlOptions: [{ code: 'MAX_HP_PCT', val: 10 }] },
  });
  assert.equal(derived.maxHp, Math.round(BALANCE.base.hp * 1.1));
  assert.ok(derived.crit >= 0.1);
});

test('planEnhanceAttempt & evaluateEnhanceOutcome enforce Luck, fail down, fail reset, and protection charm', () => {
  const planSafe = planEnhanceAttempt({ itemDef: { id: 'SWORD' }, instance: { enhanceLevel: 0 }, useProtection: false });
  assert.equal(planSafe.successRate, 1);
  assert.equal(planSafe.consumedItems.GEM_BLESS, 1);

  const planRisk = planEnhanceAttempt({
    itemDef: { id: 'SWORD' },
    instance: { enhanceLevel: 5, hasLuck: true },
    useProtection: false,
  });
  // +6 base is 0.65, +0.15 Luck = 0.80
  assert.equal(planRisk.successRate, 0.8);
  assert.equal(evaluateEnhanceOutcome(planRisk, () => 0.25).outcome, 'SUCCESS');
  assert.equal(evaluateEnhanceOutcome(planRisk, () => 0.25).toLevel, 6);
  const downRes = evaluateEnhanceOutcome(planRisk, () => 0.95);
  assert.equal(downRes.outcome, 'FAIL_DOWN');
  assert.equal(downRes.toLevel, 4);

  const planHigh = planEnhanceAttempt({
    itemDef: { id: 'SWORD' },
    instance: { enhanceLevel: 9, hasLuck: false },
    useProtection: false,
  });
  assert.equal(planHigh.consumedItems.GEM_CHAOS, 1);
  assert.equal(planHigh.costLinhThach, 2);
  const resetRes = evaluateEnhanceOutcome(planHigh, () => 0.99);
  assert.equal(resetRes.outcome, 'FAIL_RESET_ZERO');
  assert.equal(resetRes.toLevel, 0);

  const planProtected = planEnhanceAttempt({
    itemDef: { id: 'SWORD' },
    instance: { enhanceLevel: 9, hasLuck: false },
    useProtection: true,
  });
  assert.equal(planProtected.consumedItems.CHARM_BAO_VE, 1);
  const protRes = evaluateEnhanceOutcome(planProtected, () => 0.99);
  assert.equal(protRes.outcome, 'FAIL_PROTECTED');
  assert.equal(protRes.toLevel, 9);

  assert.throws(
    () => planEnhanceAttempt({ itemDef: { id: 'SWORD' }, instance: { enhanceLevel: 15 } }),
    (err) => err instanceof DomainError && err.code === 'ENHANCE_MAX_LEVEL',
  );
});

test('enhanceService validates instanceId UUID and emits server announcement on +11/+13/+15', async () => {
  const announcements = [];
  const validId = '11111111-1111-4111-8111-111111111111';
  const catalog = createCatalogService();
  let enhanceCallCount = 0;
  const fakePlayer = publicPlayer(
    {
      id: 'plr_1', userId: 'usr_1', name: 'Hàn Lập', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_KHI', realmStage: 1, tuVi: 0, hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      mapCode: 'tan_thu_thon', x: 5, y: 5, positionVersion: 1, version: 2,
      stats: { str: 10, agi: 10, vit: 10, ene: 10 },
    },
    { xu: 50000, linhThach: 20 },
    [{
      id: validId, instanceId: validId, isInstance: true, itemCode: 'WEAPON_KIEM_GO',
      quantity: 1, slot: 0, rarity: 'EXL', enhanceLevel: 11, hasLuck: true,
      exlOptions: [{ code: 'DMG_PCT', val: 10 }],
    }],
    { weapon: null },
  );
  const players = {
    snapshot: async () => fakePlayer,
    decorate: (p) => catalog.decoratePlayer({ ...p, canhGioi: catalog.getRealmByCode(p.realmCode) }),
  };
  const store = {
    async listEnhanceLogs() { return { items: [], nextCursor: null }; },
    async enhanceEquipment(userId, requestId, input) {
      enhanceCallCount += 1;
      return {
        player: fakePlayer,
        replayed: enhanceCallCount > 1,
        result: {
          type: 'equipment_enhanced',
          itemCode: 'WEAPON_KIEM_GO',
          itemName: 'Kiếm Gỗ Tân Thủ',
          fromLevel: 10,
          toLevel: 11,
          outcome: 'SUCCESS',
        },
      };
    },
  };
  const service = createEnhanceService({
    store,
    catalog,
    players,
    onAnnouncement: (msg) => announcements.push(msg),
  });

  await assert.rejects(
    () => service.enhance('usr_1', { requestId: 'req_enhance_bad_id', instanceId: 'not-a-uuid' }),
    (err) => err instanceof DomainError && err.code === 'INVALID_INSTANCE_ID',
  );

  const first = await service.enhance('usr_1', { requestId: 'req_enhance_1', instanceId: validId });
  assert.equal(first.result.toLevel, 11);
  assert.equal(announcements.length, 1);
  assert.match(announcements[0].message, /\+11/);

  const second = await service.enhance('usr_1', { requestId: 'req_enhance_1', instanceId: validId });
  assert.equal(second.replayed, true);
  assert.equal(announcements.length, 1);
});

test('catalog.decoratePlayer and publicPlayer preserve instance metadata and boost combatPower', () => {
  const catalog = createCatalogService();
  const basePlayer = publicPlayer(
    {
      id: 'plr_2', userId: 'usr_2', name: 'Lệ Phi Vũ', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_THE', realmStage: 1, tuVi: 0, hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      mapCode: 'tan_thu_thon', x: 5, y: 5, positionVersion: 1, version: 1,
      stats: { str: 5, agi: 5, vit: 5, ene: 5 },
    },
    { xu: 100, linhThach: 0 },
    [],
    {
      weapon: {
        id: 'WEAPON_KIEM_GO', itemCode: 'WEAPON_KIEM_GO', instanceId: '22222222-2222-4222-8222-222222222222',
        isInstance: true, rarity: 'NORMAL', enhanceLevel: 0, hasLuck: false, exlOptions: [],
      },
    },
  );
  const normalDecorated = catalog.decoratePlayer({ ...basePlayer, canhGioi: catalog.getRealmByStt(1) });
  const enhancedPlayer = publicPlayer(
    {
      id: 'plr_2', userId: 'usr_2', name: 'Lệ Phi Vũ', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_THE', realmStage: 1, tuVi: 0, hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      mapCode: 'tan_thu_thon', x: 5, y: 5, positionVersion: 1, version: 2,
      stats: { str: 5, agi: 5, vit: 5, ene: 5 },
    },
    { xu: 100, linhThach: 0 },
    [],
    {
      weapon: {
        id: 'WEAPON_KIEM_GO', itemCode: 'WEAPON_KIEM_GO', instanceId: '22222222-2222-4222-8222-222222222222',
        isInstance: true, rarity: 'EXL', enhanceLevel: 11, hasLuck: true, exlOptions: [{ code: 'DMG_PCT', val: 10 }],
      },
    },
  );
  const exlDecorated = catalog.decoratePlayer({ ...enhancedPlayer, canhGioi: catalog.getRealmByStt(1) });
  assert.equal(exlDecorated.equipment.weapon.enhanceLevel, 11);
  assert.equal(exlDecorated.equipment.weapon.rarity, 'EXL');
  assert.equal(exlDecorated.equipment.weapon.hasLuck, true);
  assert.equal(exlDecorated.derivedStats.glowTier, 3);
  assert.ok(exlDecorated.combatPower > normalDecorated.combatPower);
});

test('adminContentService validates PNG converted items and sparkle config', async () => {
  const catalog = createCatalogService();
  const overrides = new Map();
  const store = {
    async listAdminAccounts() { return []; },
    async listAdminContentRecords() { return []; },
    async getAdminContentRecord(col, id) { return overrides.get(`${col}:${id}`) || null; },
    async mutateAdminContent(_actor, col, id, data, deleted) {
      const saved = { data, deleted, version: 1 };
      overrides.set(`${col}:${id}`, saved);
      return saved;
    },
  };
  const service = createAdminContentService({ store, catalog, world: { listAdminWorlds: () => [], listSummaries: () => [] }, quests: { applyOverrides() {} } });

  await assert.rejects(
    () => service.create('items', {
      id: 'BAD_SPARKLE_ITEM',
      name: 'Kiếm Hỏng',
      loai: 'EQUIPMENT',
      slot: 'weapon',
      sparkle: { enabled: true, preset: 'GALAXY_FAKE' },
    }, 'adm_1', 'req_admin_1'),
    (err) => err instanceof DomainError && err.code === 'INVALID_ITEM_SPARKLE',
  );

  const created = await service.create('items', {
    id: 'HOANG_KIM_KIEM_PNG',
    name: 'Hoàng Kim Kiếm',
    loai: 'EQUIPMENT',
    slot: 'weapon',
    rarity: 'EXL',
    itemLevel: 30,
    requiredRealmStt: 2,
    hasLuck: true,
    stats: { pAtk: 35, crit: 0.05 },
    giaMua: 1200,
    giaBan: 600,
    img: TINY_32X32_PNG_DATA_URL,
    sparkle: { enabled: true, preset: 'MYTHIC_PRISM', color: '#5ef2a8', intensity: 3 },
  }, 'adm_1', 'req_admin_2');

  assert.equal(created.data.id, 'HOANG_KIM_KIEM_PNG');
  assert.equal(created.data.rarity, 'EXL');
  assert.equal(created.data.sparkle.preset, 'MYTHIC_PRISM');
  assert.equal(catalog.getItemByCode('HOANG_KIM_KIEM_PNG').itemLevel, 30);
});

test('equipmentService & shopService validate optional instanceId UUID safely', async () => {
  const catalog = createCatalogService();
  const players = {
    snapshot: async () => ({ canhGioi: { stt: 1 }, realmCode: 'LUYEN_THE', inventory: [] }),
    decorate: (p) => p,
  };
  const equipCalls = [];
  const equipmentService = createEquipmentService({
    catalog,
    players,
    store: {
      async equipItem(...args) { equipCalls.push(args); return { player: {}, result: {} }; },
      async unequipItem() { return { player: {}, result: {} }; },
    },
  });
  await assert.rejects(
    () => equipmentService.equip('usr_1', { requestId: 'req_eq_bad_1', itemCode: 'WEAPON_KIEM_GO', instanceId: 'bad-id' }),
    (err) => err instanceof DomainError && err.code === 'INVALID_INSTANCE_ID',
  );
  await equipmentService.equip('usr_1', {
    requestId: 'req_eq_good_1',
    itemCode: 'WEAPON_KIEM_GO',
    instanceId: '33333333-3333-4333-8333-333333333333',
  });
  assert.equal(equipCalls[0][7], '33333333-3333-4333-8333-333333333333');

  const shopService = createShopService({ catalog, players, store: { async sellItem() { return {}; }, async buyItem() { return {}; } } });
  await assert.rejects(
    () => shopService.sell('usr_1', 'req_sell_bad_1', 'WEAPON_KIEM_GO', 1, 'bad-id'),
    (err) => err instanceof DomainError && err.code === 'INVALID_INSTANCE_ID',
  );
});

test('Phase 4 regressions: stackable inv items omit instanceId, sell uses scaled total, charm skipped at 100%, deriveStats includes attr gear, admin whitelists fields, and drops/broadcasts behave safely', async (t) => {
  const catalog = createCatalogService();
  const stackPlayer = publicPlayer(
    {
      id: 'plr_stack', userId: 'usr_stack', name: 'Hàn Lập', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_THE', realmStage: 1, tuVi: 0, hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      mapCode: 'tan_thu_thon', x: 5, y: 5, positionVersion: 1, version: 1,
      stats: { str: 5, agi: 5, vit: 5, ene: 5 },
    },
    { xu: 500, linhThach: 0 },
    [
      { id: 'inv_legacy_row_1', itemCode: 'STONE_LINH_NHO', quantity: 3, slot: 0 },
      { id: '44444444-4444-4444-8444-444444444444', instanceId: '44444444-4444-4444-8444-444444444444', isInstance: true, itemCode: 'WEAPON_KIEM_GO', quantity: 1, slot: 1, rarity: 'EXL', enhanceLevel: 10 },
    ],
    {},
  );
  assert.equal(stackPlayer.inventory[0].instanceId, undefined);
  assert.equal(stackPlayer.inventory[1].instanceId, '44444444-4444-4444-8444-444444444444');

  const soldPlayer = { ...stackPlayer, canhGioi: catalog.getRealmByStt(1) };
  Object.defineProperty(soldPlayer, '_sellTotal', { value: 1250, enumerable: false });
  const shopService = createShopService({
    catalog,
    players: { decorate: (p) => p, snapshot: async () => soldPlayer },
    store: {
      async sellItem() { return soldPlayer; },
      async buyItem() { return soldPlayer; },
    },
  });
  const sellStack = await shopService.sell('usr_stack', 'req_sell_stack_ok', 'STONE_LINH_NHO', 2, stackPlayer.inventory[0].instanceId);
  assert.equal(sellStack.result.price, 1250);

  // Enhance: luckRateBonus exposed, logs carry itemName, and 100% rate (+0->+1) skips CHARM_BAO_VE
  const planGuaranteed = planEnhanceAttempt({
    itemDef: { id: 'WEAPON_KIEM_GO', name: 'Kiếm Gỗ', type: 'EQUIPMENT' },
    instance: { enhanceLevel: 0, hasLuck: true },
    useProtection: true,
  });
  assert.equal(planGuaranteed.successRate, 1);
  assert.equal(planGuaranteed.useProtection, false);
  assert.equal(planGuaranteed.consumedItems.CHARM_BAO_VE, undefined);

  const enhSvc = createEnhanceService({
    catalog,
    players: { snapshot: async () => soldPlayer, decorate: (p) => p },
    store: {
      async listEnhanceLogs() {
        return {
          items: [{ id: 'log_1', itemCode: 'WEAPON_KIEM_GO', fromLevel: 0, toLevel: 1, outcome: 'SUCCESS' }],
          nextCursor: null,
        };
      },
    },
  });
  const cfg = await enhSvc.getConfig('usr_stack');
  assert.equal(cfg.luckRateBonus, BALANCE.enhance.luckRateBonus);
  assert.equal(cfg.logs[0].itemName, catalog.getItemByCode('WEAPON_KIEM_GO').name);

  // Breakthrough pills use rarity='NORMAL' (taxonomy key) rather than Vietnamese label
  const pills = catalog.listItems().filter((entry) => entry.type === 'BREAKTHROUGH_PILL');
  assert.ok(pills.length >= 4);
  for (const pill of pills) assert.equal(pill.rarity, 'NORMAL');

  // deriveStats includes scaled equipment str/agi/vit/ene bonuses
  const gearDerived = deriveStats(
    { str: 5, agi: 5, vit: 5, ene: 5 },
    { boots: { enhanceLevel: 10, stats: { agi: 10 } } }, // mult at +10 = 1.84 -> 18 agi
  );
  const nakedDerived = deriveStats({ str: 5, agi: 5, vit: 5, ene: 5 }, {});
  assert.ok(gearDerived.evasion > nakedDerived.evasion);
  assert.ok(gearDerived.pAtk > nakedDerived.pAtk);

  // Admin parseItem strips unwhitelisted arbitrary properties
  const adminSvc = createAdminContentService({
    store: {
      async listAdminAccounts() { return []; },
      async listAdminContentRecords() { return []; },
      async getAdminContentRecord() { return null; },
      async mutateAdminContent(_actor, _col, _id, data, deleted) { return { data, deleted, version: 1 }; },
    },
    catalog,
    world: { listAdminWorlds: () => [], listSummaries: () => [] },
    quests: { applyOverrides() {} },
  });
  const sanitized = await adminSvc.create('items', {
    id: 'WHITELIST_TEST_GEM',
    name: 'Ngọc Test',
    loai: 'ENHANCE_GEM',
    gemTier: 'bless',
    isAdminOverride: true,
    __malicious: 'drop table',
  }, 'adm_1', 'req_adm_wl_1');
  assert.equal(sanitized.data.gemTier, 'BLESS');
  assert.equal(sanitized.data.isAdminOverride, undefined);
  assert.equal(sanitized.data.__malicious, undefined);

  // Realtime broadcastAnnouncement uses io.emit and playerChangedLocal emits player_appearance_update
  const { makeMap, makePlayer, fakeSocket, makeHarness, send } = require('./helpers/realtime-harness');
  const boots = { id: 'BOOTS_DROP', maDo: 'BOOTS_DROP', name: 'Hành Cước Ngoa', loai: 'EQUIPMENT', type: 'EQUIPMENT', slot: 'boots', rarity: 'ANCIENT' };
  const mob = { id: 'DROP_MOB', code: 'DROP_MOB', name: 'Drop Mob', type: 'BOSS', level: 1, hp: 1, maxHp: 1, def: 0, atk: 1, speed: 1, lootTableId: 'LOOT_BOOTS' };
  const field = makeMap('field', {
    monsters: [mob],
    monsterSpawns: [{ packId: 'DP', templateId: 'DROP_MOB', centerX: 1, centerY: 1, count: 1, radius: 1, aggroRange: 5 }],
  });
  field.rules = { monsterPacksOnly: true };
  const harness = makeHarness({
    maps: [['field', field]],
    player: makePlayer({ equipment: { weapon: { itemCode: 'WEAPON_KIEM_GO', enhanceLevel: 11 } } }),
    items: [boots],
    lootTables: { LOOT_BOOTS: [{ itemId: 'BOOTS_DROP', chance: 1, min: 1, max: 1 }] },
  });
  t.after(() => harness.gameplay.close());
  const globalEmits = [];
  harness.io.emit = (name, payload) => globalEmits.push({ name, payload });

  const sock = fakeSocket('sock_drop');
  await send(harness.gameplay, sock, 'join_drop_1', 'world.join');
  harness.gameplay.broadcastAnnouncement({ type: 'ENHANCE_MILESTONE', level: 13, message: 'Test' });
  assert.equal(globalEmits[0].name, 'server_announcement');

  await harness.gameplay.playerChangedLocal('user_test');
  const appearanceEvt = harness.broadcastEvents.find((e) => e.name === 'player_appearance_update');
  assert.equal(appearanceEvt?.payload?.glowTier, 3);
  assert.equal(appearanceEvt?.payload?.enhanceMaxLevel, 11);

  const spawned = harness.gameplay.runtime.listMonsters('field')[0];
  assert.ok(spawned, 'spawned monster must exist');
  await send(harness.gameplay, sock, 'atk_drop_1', 'combat.attack', { targetId: spawned.id, mapCode: 'field' });
  const lootEvt = harness.broadcastEvents.find((e) => e.name === 'ground_loot_spawn');
  const dropped = lootEvt?.payload?.drops?.[0]?.item;
  assert.ok(Array.isArray(dropped?.exlOptions) && dropped.exlOptions.length >= 1);
  for (const opt of dropped.exlOptions) {
    assert.ok(BALANCE.exlOptions[opt.code].slots.includes('boots'));
  }
});
