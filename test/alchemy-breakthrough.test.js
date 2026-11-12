const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BALANCE,
  resolveBreakthroughPillRate,
  calcBreakthroughFailurePenalty,
  calcBreakthroughRegression,
  breakthroughThreshold,
} = require('../src/data/balance');
const { realms, items, lootTables, worlds, alchemyRecipes, pillQualityTiers } = require('../src/data/mock-data');
const { validateWorld } = require('../src/admin/admin-world-service');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createAlchemyService, evaluateAlchemyOutcome } = require('../src/alchemy/alchemy-service');
const { createCultivationService } = require('../src/cultivation/cultivation-service');
const { createMysqlStore } = require('../src/store/mysql-store');

const { createGameplayService } = require('../src/realtime/gameplay-service');
const { createCultivationRouter } = require('../src/http/cultivation-routes');

test('all seed worlds pass full validation with zero errors and define typed Shop NPCs & categorized materials', () => {
  assert.ok(worlds.length >= 4);
  for (const worldDoc of worlds) {
    const validation = validateWorld(worldDoc, worlds);
    assert.equal(validation.valid, true, `World ${worldDoc.code} validation errors: ${JSON.stringify(validation.errors)}`);
    assert.deepEqual(validation.errors, [], `World ${worldDoc.code} expected empty errors`);
  }

  const city = worlds.find((w) => w.code === 'thanh_van_tran');
  assert.ok(city);
  const byId = new Map(city.npcs.map((npc) => [npc.id, npc]));
  assert.equal(byId.get('npc_tho_ren').type, 'shop');
  assert.equal(byId.get('npc_tho_ren').shopCategory, 'EQUIPMENT');
  assert.equal(byId.get('npc_duoc_su').type, 'shop');
  assert.equal(byId.get('npc_duoc_su').shopCategory, 'ALCHEMY');
  assert.equal(byId.get('npc_thuong_nhan').type, 'shop');
  assert.equal(byId.get('npc_thuong_nhan').shopCategory, 'ALL');
  assert.equal(byId.get('npc_truong_thon').type, 'dialog');
  assert.equal(byId.get('npc_giao_dau').type, 'dialog');

  const catalog = createCatalogService();
  assert.equal(catalog.getItemByCode('MAT_QUANG_SAT').shopCategory, 'EQUIPMENT');
  assert.equal(catalog.getItemByCode('MAT_DA_THU').shopCategory, 'EQUIPMENT');
  assert.equal(catalog.getItemByCode('MAT_HOA_TINH').giaMua, 0);
  assert.equal(catalog.getItemByCode('MAT_HUYET_NGUYET_TINH').giaMua, 0);
});

test('catalog enforces 4 quality tiers across 12 realms, <= 70% craft cap, materials in shop & loot', () => {
  const catalog = createCatalogService();
  assert.equal(BALANCE.alchemy.maxCraftSuccessRate, 0.7);
  assert.equal(BALANCE.alchemy.mutationChance, 0.05);
  assert.equal(catalog.listPillQualities().length, 4);

  const recipes = catalog.listAlchemyRecipes();
  assert.equal(recipes.length, alchemyRecipes.length);
  for (const recipe of recipes) {
    assert.ok(recipe.craftSuccessRate > 0 && recipe.craftSuccessRate <= 0.7, `Recipe ${recipe.code} exceeds 70% craft rate`);
  }

  const phiThangLines = ['HA_PHAM', 'TRUNG_PHAM', 'THUONG_PHAM', 'CUC_PHAM'].map((q) =>
    recipes.find((r) => r.pillGroup === 'DAN_PHI_THANG' && r.quality === q));
  assert.ok(phiThangLines.every(Boolean));
  // Basic/Lower-Mid recipes use STONE_LINH_NHO item + Xu (0 wallet Linh Thach); High/Perfect also charge wallet Linh Thach.
  assert.equal(phiThangLines[0].costLinhThach, 0);
  assert.equal(phiThangLines[1].costLinhThach, 0);
  assert.ok(phiThangLines[2].costLinhThach > 0);
  assert.ok(phiThangLines[3].costLinhThach > 0);
  for (const r of phiThangLines) {
    assert.ok(r.ingredients.some((ing) => ing.itemCode === 'STONE_LINH_NHO'));
  }

  // 12 realms x 4 breakthrough pill qualities = 48 breakthrough pills
  const btPills = catalog.listItems().filter((item) => item.loai === 'BREAKTHROUGH_PILL');
  assert.equal(btPills.length, 48);
  assert.equal(resolveBreakthroughPillRate(catalog.getItemByCode('DAN_PHI_THANG')), 0.7);
  assert.equal(resolveBreakthroughPillRate(catalog.getItemByCode('DAN_PHI_THANG_TRUNG')), 0.8);
  assert.equal(resolveBreakthroughPillRate(catalog.getItemByCode('DAN_PHI_THANG_THUONG')), 0.9);
  assert.equal(resolveBreakthroughPillRate(catalog.getItemByCode('DAN_PHI_THANG_CUC')), 1.0);

  // Materials available in monster drops & Xu shop
  const shopMaterials = ['STONE_LINH_NHO', 'MAT_THAO_DUOC', 'MAT_LINH_CHI'];
  for (const code of shopMaterials) {
    const item = catalog.getItemByCode(code);
    assert.ok(item && item.giaMua > 0 && (item.currency || 'XU') === 'XU', `Expected shop item ${code}`);
  }
  const allLootItemIds = new Set(Object.values(lootTables).flat().map((entry) => entry.itemId));
  for (const code of ['STONE_LINH_NHO', 'MAT_THAO_DUOC', 'MAT_LINH_CHI', 'MAT_YEU_DAN_SO', 'MAT_HOA_TINH', 'MAT_HUYET_NGUYET_TINH']) {
    assert.ok(allLootItemIds.has(code), `Missing alchemy ingredient ${code} in monster lootTables`);
  }

  // Service & evaluateAlchemyOutcome guard rejects recipe craft rate > 70%
  assert.throws(
    () => evaluateAlchemyOutcome({ code: 'BAD_RECIPE', outputItemCode: 'DAN_PHI_THANG', craftSuccessRate: 0.71 }, () => 0.1),
    (err) => err.code === 'INVALID_ALCHEMY_CONFIG',
  );
});

test('evaluateAlchemyOutcome & alchemyService handle success, 5% mutation, fail, validation, and replay', async () => {
  const catalog = createCatalogService();
  const recipeTrung = catalog.getAlchemyRecipeByCode('RECIPE_DAN_PHI_THANG_TRUNG');
  const recipeCuc = catalog.getAlchemyRecipeByCode('RECIPE_DAN_PHI_THANG_CUC');

  // Success without mutation
  const seqSuccess = [0.2, 0.4];
  const normalSuccess = evaluateAlchemyOutcome(recipeTrung, () => seqSuccess.shift());
  assert.equal(normalSuccess.outcome, 'SUCCESS');
  assert.equal(normalSuccess.mutated, false);
  assert.equal(normalSuccess.outputItemCode, 'DAN_PHI_THANG_TRUNG');

  // Success with 5% mutation -> +1 tier (TRUNG -> THUONG)
  const seqMutate = [0.2, 0.03];
  const mutated = evaluateAlchemyOutcome(recipeTrung, () => seqMutate.shift());
  assert.equal(mutated.outcome, 'MUTATED');
  assert.equal(mutated.mutated, true);
  assert.equal(mutated.outputItemCode, 'DAN_PHI_THANG_THUONG');

  // Failure when roll >= craftSuccessRate
  const failed = evaluateAlchemyOutcome(recipeTrung, () => 0.75);
  assert.equal(failed.outcome, 'FAILED');
  assert.equal(failed.success, false);
  assert.equal(failed.outputItemCode, null);

  // Cuc Pham never mutates higher
  const cucSuccess = evaluateAlchemyOutcome(recipeCuc, () => 0.1);
  assert.equal(cucSuccess.outcome, 'SUCCESS');
  assert.equal(cucSuccess.mutated, false);
  assert.equal(cucSuccess.outputItemCode, 'DAN_PHI_THANG_CUC');

  // Service listRecipes + replay + brew
  const snapshot = {
    id: 'p1',
    userId: 'u1',
    realmCode: 'LUYEN_THE',
    canhGioi: catalog.getRealmByCode('LUYEN_THE'),
    xu: 200,
    linhThach: 1,
    wallet: { xu: 200, linhThach: 1 },
    inventory: [
      { itemCode: 'MAT_THAO_DUOC', quantity: 5 },
      { itemCode: 'MAT_LANG_NANH', quantity: 3 },
      { itemCode: 'STONE_LINH_NHO', quantity: 4 },
    ],
  };

  let brewStoreCalled = 0;
  let replayResult = null;
  const rolls = [0.1, 0.02];
  const alchemy = createAlchemyService({
    catalog,
    players: { snapshot: async () => snapshot, decorate: (p) => p },
    randomRate: () => rolls.shift(),
    store: {
      async replayAlchemy() { return replayResult; },
      async brewAlchemy(_uid, _reqId, input) {
        brewStoreCalled += 1;
        const outcome = input.decideOutcome();
        return {
          player: snapshot,
          result: { type: 'alchemy_brew', ...outcome, recipeCode: input.recipe.code },
        };
      },
      async listAlchemyLogs() { return { items: [], nextCursor: null }; },
    },
  });

  const listed = await alchemy.listRecipes('u1');
  const phiHa = listed.recipes.find((r) => r.code === 'RECIPE_DAN_PHI_THANG_HA');
  const phiCuc = listed.recipes.find((r) => r.code === 'RECIPE_DAN_PHI_THANG_CUC');
  assert.equal(phiHa.canCraft, true);
  assert.equal(phiCuc.canCraft, false);
  assert.ok(phiCuc.missingReasons.includes('INSUFFICIENT_LINH_THACH'));
  assert.ok(phiCuc.missingReasons.includes('INSUFFICIENT_XU'));

  const brewed = await alchemy.brew('u1', 'req_alc_001', 'RECIPE_DAN_PHI_THANG_HA');
  assert.equal(brewed.result.outcome, 'MUTATED');
  assert.equal(brewed.result.outputItemCode, 'DAN_PHI_THANG_TRUNG');
  assert.equal(brewStoreCalled, 1);

  replayResult = { player: snapshot, result: brewed.result };
  const replayed = await alchemy.brew('u1', 'req_alc_001', 'RECIPE_DAN_PHI_THANG_HA');
  assert.equal(replayed.replayed, true);
  assert.equal(brewStoreCalled, 1);

  await assert.rejects(
    () => alchemy.brew('u1', 'req_alc_002', 'UNKNOWN_RECIPE'),
    (err) => err.code === 'ALCHEMY_RECIPE_NOT_FOUND' && err.status === 404,
  );
});

test('breakthrough regression & failure penalty helpers enforce -1 stage, floor LUYEN_THE 1, and penalty scaling', () => {
  const r1 = realms.find((r) => r.code === 'LUYEN_THE');
  const r2 = realms.find((r) => r.code === 'KHI_DONG');

  // Luyen The 9 fail -> Luyen The 8, 50% tuVi retained, stats clamped >= 5
  const regStage9 = calcBreakthroughRegression({
    realm: r1,
    prevRealm: null,
    stage: 9,
    stats: { str: 10, agi: 10, vit: 10, ene: 10 },
    currentTuVi: breakthroughThreshold(r1, 9),
  });
  assert.equal(regStage9.nextRealm.code, 'LUYEN_THE');
  assert.equal(regStage9.nextStage, 8);
  assert.equal(regStage9.tuViAfter, Math.floor(breakthroughThreshold(r1, 8) * 0.5));
  assert.ok(regStage9.nextStats.str >= 5 && regStage9.nextStats.vit >= 5);

  // Khi Dong 1 fail -> Luyen The 9
  const regPrevRealm = calcBreakthroughRegression({
    realm: r2,
    prevRealm: r1,
    stage: 1,
    stats: { str: 20, agi: 20, vit: 20, ene: 20 },
    currentTuVi: 500,
  });
  assert.equal(regPrevRealm.nextRealm.code, 'LUYEN_THE');
  assert.equal(regPrevRealm.nextStage, 9);

  // Floor at Luyen The 1 never goes < 1
  const regFloor = calcBreakthroughRegression({
    realm: r1,
    prevRealm: null,
    stage: 1,
    stats: { str: 5, agi: 5, vit: 5, ene: 5 },
    currentTuVi: 999,
  });
  assert.equal(regFloor.nextRealm.code, 'LUYEN_THE');
  assert.equal(regFloor.nextStage, 1);
  assert.deepEqual(regFloor.statLoss, { str: 0, agi: 0, vit: 0, ene: 0 });

  const penR1 = calcBreakthroughFailurePenalty(1);
  const penR3 = calcBreakthroughFailurePenalty(3);
  assert.equal(penR1.xuPenalty, 100);
  assert.equal(penR1.linhThachPenalty, 1);
  assert.ok(penR3.xuPenalty > penR1.xuPenalty);
  assert.ok(penR3.linhThachPenalty > penR1.linhThachPenalty);
});

test('cultivationService breakthrough rejects mismatched pill and prioritizes highest owned quality when omitted', async () => {
  const catalog = createCatalogService();
  const captured = [];
  const player = {
    id: 'p1',
    userId: 'u1',
    realmCode: 'LUYEN_THE',
    realmStage: 9,
    tuVi: breakthroughThreshold(catalog.getRealmByCode('LUYEN_THE'), 9),
    tuViHienTai: breakthroughThreshold(catalog.getRealmByCode('LUYEN_THE'), 9),
    tuViLinhCan: 500,
    linhCan: 'KIM',
    stats: { str: 200, agi: 200, vit: 200, ene: 200 },
    equipment: {},
    learnedSkills: [],
  };
  const cultivation = createCultivationService({
    catalog,
    players: { snapshot: async () => player, decorate: (p) => p },
    inventory: { absorb: async () => {} },
    store: {
      async replayBreakthrough() { return null; },
      async breakthrough(_uid, _reqId, prog) {
        captured.push(prog);
        return { player, result: { type: 'realm_breakthrough', success: true } };
      },
    },
  });

  // Invalid pill from realm 2 while breaking through realm 1
  await assert.rejects(
    () => cultivation.breakthrough('u1', 'req_bt_bad_01', { pillCode: 'TRUC_CO_DAN' }),
    (err) => err.code === 'INVALID_BREAKTHROUGH_PILL' && err.status === 400,
  );

  // Auto-selection list prioritizes CUC -> THUONG -> TRUNG -> HA
  await cultivation.breakthrough('u1', 'req_bt_auto_01');
  assert.deepEqual(captured[0].candidatePillCodes, [
    'DAN_PHI_THANG_CUC',
    'DAN_PHI_THANG_THUONG',
    'DAN_PHI_THANG_TRUNG',
    'DAN_PHI_THANG',
  ]);

  // Explicit pill restricts candidate list to exact quality requested
  await cultivation.breakthrough('u1', 'req_bt_ha_01', { pillCode: 'DAN_PHI_THANG' });
  assert.deepEqual(captured[1].candidatePillCodes, ['DAN_PHI_THANG']);
});

test('createMysqlStore brewAlchemy and breakthrough failure execute atomic SQL, lock order, and idempotent replay', async (t) => {
  const mysql = require('mysql2/promise');
  const executed = [];
  let state = {
    player: {
      id: 'p1', userId: 'u1', name: 'DaoHuu', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_THE', realmStage: 9, tuVi: 50000, tuViLinhCan: 500,
      hp: 2500, maxHp: 2500, mp: 1650, maxMp: 1650,
      mapCode: 'thanh_van_tran', x: 300, y: 200, positionVersion: 1, version: 1,
      str: 200, agi: 200, vit: 200, ene: 200, unspentPoints: 0, inventoryCapacity: 40,
    },
    wallet: { xu: 500, linhThach: 10 },
    inventory: [
      { id: 'inv_1', itemCode: 'MAT_LINH_CHI', quantity: 5, slot: 0 },
      { id: 'inv_2', itemCode: 'MAT_YEU_DAN_SO', quantity: 4, slot: 1 },
      { id: 'inv_3', itemCode: 'MAT_HOA_TINH', quantity: 3, slot: 2 },
      { id: 'inv_4', itemCode: 'STONE_LINH_NHO', quantity: 7, slot: 3 },
      { id: 'inv_5', itemCode: 'DAN_PHI_THANG', quantity: 1, slot: 4 },
    ],
    idempotency: new Map(),
    alchemyLogs: [],
    ledger: [],
    committed: 0,
    rolledBack: 0,
  };

  function makeConnection() {
    const runQuery = async (sql, params = []) => {
      executed.push({ sql, params });
      if (sql.startsWith('SELECT id, user_id AS userId, linh_can AS linhCan') || sql.startsWith('SELECT id, linh_can AS linhCan')) {
        return [[{ ...state.player }]];
      }
      if (sql.startsWith('SELECT id, user_id AS userId, name, gender')) {
        return [[{ ...state.player }]];
      }
      if (sql.startsWith('SELECT result_json AS resultJson FROM idempotency_keys')) {
        const row = state.idempotency.get(`${params[0]}:${params[1]}`);
        return [row ? [{ resultJson: row }] : []];
      }
      if (sql.startsWith('SELECT xu, linh_thach AS linhThach FROM wallets')) {
        return [[{ ...state.wallet }]];
      }
      if (sql.startsWith('SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items WHERE player_id = ? AND item_code IN')) {
        const codes = params.slice(1);
        return [state.inventory.filter((i) => codes.includes(i.itemCode) && i.quantity > 0).map((i) => ({ ...i }))];
      }
      if (sql.startsWith('SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items') || sql.startsWith('SELECT id, item_code AS itemCode, quantity FROM inventory_items WHERE player_id = ? AND item_code IN')) {
        if (sql.includes('item_code IN')) {
          const codes = params.slice(1);
          return [state.inventory.filter((i) => codes.includes(i.itemCode) && i.quantity > 0).map((i) => ({ ...i }))];
        }
        return [state.inventory.map((i) => ({ ...i }))];
      }
      if (sql.startsWith('SELECT slot, item_code AS itemCode FROM player_equipment')) return [[]];
      if (sql.startsWith('SELECT skill_code AS skillCode FROM player_skills')) return [[]];
      if (sql.startsWith('SELECT skill_code AS skillCode FROM player_equipped_skills')) return [[]];
      if (sql.startsWith('UPDATE wallets SET xu =')) {
        state.wallet.xu = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE wallets SET linh_thach =')) {
        state.wallet.linhThach = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO currency_ledger')) {
        state.ledger.push({ currency: params[2], reason: params[3], amount: params[4], balanceAfter: params[5], key: params[8] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('DELETE FROM inventory_items WHERE id = ?')) {
        state.inventory = state.inventory.filter((i) => i.id !== params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE inventory_items SET quantity = quantity - ?')) {
        const row = state.inventory.find((i) => i.id === params[1]);
        if (row) row.quantity -= params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE players SET realm_code = ?')) {
        state.player.realmCode = params[0];
        state.player.realmStage = params[1];
        state.player.tuVi = params[2];
        state.player.hp = params[3];
        state.player.maxHp = params[4];
        state.player.mp = params[5];
        state.player.maxMp = params[6];
        state.player.str = params[7];
        state.player.agi = params[8];
        state.player.vit = params[9];
        state.player.ene = params[10];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO player_alchemy_logs')) {
        state.alchemyLogs.push({ id: params[0], recipeCode: params[2], outputItemCode: params[4], outcome: params[5], key: params[11] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        state.idempotency.set(`${params[0]}:${params[1]}`, params[2]);
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    };
    return {
      beginTransaction: async () => {},
      commit: async () => { state.committed += 1; },
      rollback: async () => { state.rolledBack += 1; },
      release: () => {},
      query: runQuery,
      execute: runQuery,
    };
  }

  t.mock.method(mysql, 'createPool', () => ({
    pool: null,
    getConnection: async () => makeConnection(),
    query: (...args) => makeConnection().query(...args),
    execute: (...args) => makeConnection().execute(...args),
    end: async () => {},
  }));

  const store = createMysqlStore({ host: '127.0.0.1', user: 'u', password: 'p', database: 'd' });
  const catalog = createCatalogService();

  // 1) Failed Thượng Phẩm brew consumes materials + Xu + Linh Thạch and writes currency_ledger + alchemy_logs
  const thuongRecipe = catalog.getAlchemyRecipeByCode('RECIPE_DAN_PHI_THANG_THUONG');
  const failBrew = await store.brewAlchemy('u1', 'req_sql_brew_fail', {
    recipe: thuongRecipe,
    itemCatalog: catalog.listItems(),
    realmCatalog: catalog.listRealms(),
    decideOutcome: () => ({
      outcome: 'FAILED', success: false, mutated: false, outputItemCode: null, outputQuantity: 0, craftSuccessRate: 0.55, mutationRate: 0.05,
    }),
  });
  assert.equal(failBrew.result.outcome, 'FAILED');
  assert.equal(state.wallet.xu, 500 - thuongRecipe.costXu);
  assert.equal(state.wallet.linhThach, 10 - thuongRecipe.costLinhThach);
  assert.equal(state.alchemyLogs.length, 1);
  assert.equal(state.alchemyLogs[0].outcome, 'FAILED');
  assert.ok(state.ledger.some((l) => l.key === 'req_sql_brew_fail:XU' && l.reason === 'ALCHEMY_COST'));
  assert.ok(state.ledger.some((l) => l.key === 'req_sql_brew_fail:LINH_THACH' && l.reason === 'ALCHEMY_COST'));

  // 2) Verify lock order: players FOR UPDATE -> idempotency_keys FOR UPDATE -> wallets FOR UPDATE -> inventory_items FOR UPDATE
  const lockSqls = executed.map((e) => e.sql).filter((s) => s.includes('FOR UPDATE'));
  const pIdx = lockSqls.findIndex((s) => s.includes('FROM players'));
  const iIdx = lockSqls.findIndex((s) => s.includes('FROM idempotency_keys'));
  const wIdx = lockSqls.findIndex((s) => s.includes('FROM wallets'));
  const invIdx = lockSqls.findIndex((s) => s.includes('FROM inventory_items'));
  assert.ok(pIdx >= 0 && pIdx < iIdx && iIdx < wIdx && wIdx < invIdx, 'Expected canonical lock hierarchy');

  // 3) Breakthrough failure with HA_PHAM pill (roll = 0.85 >= 0.70): regresses stage 9 -> 8, burns pill + Xu + Linh Thạch
  const xuBeforeBt = state.wallet.xu;
  const ltBeforeBt = state.wallet.linhThach;
  const luyenThe = catalog.getRealmByCode('LUYEN_THE');
  const failBt = await store.breakthrough('u1', 'req_sql_bt_fail', {
    realm: luyenThe,
    nextRealm: catalog.getRealmByCode('KHI_DONG'),
    stage: 9,
    major: true,
    threshold: breakthroughThreshold(luyenThe, 9),
    requiredOvr: 1000,
    itemCatalog: catalog.listItems(),
    realmCatalog: catalog.listRealms(),
    requestedPillCode: 'DAN_PHI_THANG',
    candidatePillCodes: ['DAN_PHI_THANG'],
    gain: { str: 3, agi: 3, vit: 3, ene: 2 },
    rollRate: () => 0.85,
  });
  assert.equal(failBt.result.type, 'realm_breakthrough_failed');
  assert.equal(failBt.result.success, false);
  assert.equal(failBt.result.toRealmCode, 'LUYEN_THE');
  assert.equal(failBt.result.toStage, 8);
  assert.equal(failBt.result.xuLost, 100);
  assert.equal(failBt.result.linhThachLost, 1);
  assert.equal(state.wallet.xu, xuBeforeBt - 100);
  assert.equal(state.wallet.linhThach, ltBeforeBt - 1);
  assert.equal(state.inventory.some((i) => i.itemCode === 'DAN_PHI_THANG'), false);

  // Replay exact same requestId with identical pillCode returns identical failure result without double deduction
  const replayedBt = await store.breakthrough('u1', 'req_sql_bt_fail', {
    realm: luyenThe,
    nextRealm: catalog.getRealmByCode('KHI_DONG'),
    stage: 8,
    major: true,
    threshold: 100,
    requiredOvr: 100,
    requestedPillCode: 'DAN_PHI_THANG',
    itemCatalog: catalog.listItems(),
    realmCatalog: catalog.listRealms(),
  });
  assert.equal(replayedBt.replayed, true);
  assert.equal(replayedBt.result.toStage, 8);
  assert.equal(state.wallet.xu, xuBeforeBt - 100);
});

test('createMysqlStore rejects dead players (P0-1), enforces breakthrough pillCode idempotency (P1-1), and pre-checks 99 stack cap (P1-2)', async (t) => {
  const mysql = require('mysql2/promise');
  const state = {
    player: {
      id: 'p1', userId: 'u1', name: 'DaoHuu', gender: 'MALE', linhCan: 'KIM',
      realmCode: 'LUYEN_THE', realmStage: 9, tuVi: 50000, tuViLinhCan: 500,
      hp: 0, maxHp: 2500, mp: 1650, maxMp: 1650,
      mapCode: 'thanh_van_tran', x: 300, y: 200, positionVersion: 1, version: 1,
      str: 200, agi: 200, vit: 200, ene: 200, unspentPoints: 0, inventoryCapacity: 40,
    },
    wallet: { xu: 500, linhThach: 10 },
    inventory: [
      { id: 'inv_mat_1', itemCode: 'MAT_THAO_DUOC', quantity: 10, slot: 0 },
      { id: 'inv_mat_2', itemCode: 'MAT_LANG_NANH', quantity: 10, slot: 1 },
      { id: 'inv_stone', itemCode: 'STONE_LINH_NHO', quantity: 10, slot: 2 },
      { id: 'inv_pill', itemCode: 'DAN_PHI_THANG', quantity: 99, slot: 3 },
    ],
    idempotency: new Map(),
    ledger: [],
    alchemyLogs: [],
    rolledBack: 0,
  };
  function makeConnection() {
    const runQuery = async (sql, params = []) => {
      if (sql.startsWith('SELECT id, user_id AS userId, linh_can AS linhCan') || sql.startsWith('SELECT id, linh_can AS linhCan')) {
        return [[{ ...state.player }]];
      }
      if (sql.startsWith('SELECT id, user_id AS userId, name, gender')) {
        return [[{ ...state.player, xu: state.wallet.xu, linhThach: state.wallet.linhThach, mapCode: 'thanh_van_tran', x: 300, y: 200, positionVersion: 1, version: 1 }]];
      }
      if (sql.startsWith('SELECT xu, linh_thach AS linhThach FROM wallets')) {
        return [[{ ...state.wallet }]];
      }
      if (sql.startsWith('SELECT slot, item_code AS itemCode FROM player_equipment')) return [[]];
      if (sql.startsWith('SELECT skill_code AS skillCode FROM player_skills') || sql.startsWith('SELECT skill_code AS skillCode, slot FROM player_equipped_skills')) return [[]];
      if (sql.startsWith('SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items') || sql.startsWith('SELECT item_code AS itemCode, quantity, slot FROM inventory_items')) {
        return [state.inventory.map((r) => ({ ...r }))];
      }
      if (sql.startsWith('SELECT id, item_code AS itemCode, quantity FROM inventory_items')) {
        const codes = params.slice(1);
        return [state.inventory.filter((r) => codes.includes(r.itemCode)).map((r) => ({ ...r }))];
      }
      if (sql.startsWith('SELECT result_json AS resultJson FROM idempotency_keys')) {
        const hit = state.idempotency.get(params[1]);
        return [hit ? [{ resultJson: hit }] : []];
      }
      if (sql.startsWith('INSERT INTO currency_ledger')) {
        state.ledger.push({ key: params[4], delta: params[2] });
        return [{ insertId: state.ledger.length }];
      }
      if (sql.startsWith('UPDATE wallets')) {
        if (sql.includes('xu = ?')) state.wallet.xu = params[0];
        else state.wallet.linhThach = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE inventory_items SET quantity = quantity - 1')) {
        const row = state.inventory.find((r) => r.id === params[0]);
        if (row) row.quantity -= 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE players SET realm_code')) {
        state.player.realmCode = params[0];
        state.player.realmStage = params[1];
        state.player.tuVi = params[2];
        state.player.hp = params[3];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO player_actions')) return [{ insertId: 1 }];
      if (sql.startsWith('INSERT INTO idempotency_keys')) {
        state.idempotency.set(params[1], params[2]);
        return [{ insertId: 1 }];
      }
      return [[]];
    };
    return {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => { state.rolledBack += 1; },
      release: () => {},
      query: runQuery,
      execute: runQuery,
    };
  }
  t.mock.method(mysql, 'createPool', () => ({
    pool: null,
    getConnection: async () => makeConnection(),
    query: (...args) => makeConnection().query(...args),
    execute: (...args) => makeConnection().execute(...args),
    end: async () => {},
  }));

  const store = createMysqlStore({ host: '127.0.0.1', user: 'u', password: 'p', database: 'd' });
  const catalog = createCatalogService();
  const luyenThe = catalog.getRealmByCode('LUYEN_THE');
  const haRecipe = catalog.getAlchemyRecipeByCode('RECIPE_DAN_PHI_THANG_HA');

  // P0-1: Dead player (hp === 0) blocked from breakthrough & alchemy
  await assert.rejects(
    () => store.breakthrough('u1', 'req_dead_bt', {
      realm: luyenThe,
      nextRealm: catalog.getRealmByCode('KHI_DONG'),
      stage: 9,
      major: true,
      threshold: breakthroughThreshold(luyenThe, 9),
      requiredOvr: 1000,
      itemCatalog: catalog.listItems(),
      realmCatalog: catalog.listRealms(),
      requestedPillCode: 'DAN_PHI_THANG',
      candidatePillCodes: ['DAN_PHI_THANG'],
      gain: { str: 3, agi: 3, vit: 3, ene: 2 },
    }),
    (err) => err.code === 'PLAYER_DEAD' && err.status === 409,
  );
  await assert.rejects(
    () => store.brewAlchemy('u1', 'req_dead_brew', {
      recipe: haRecipe,
      itemCatalog: catalog.listItems(),
      realmCatalog: catalog.listRealms(),
    }),
    (err) => err.code === 'PLAYER_DEAD' && err.status === 409,
  );

  // Revive player for P1-2 & P1-1 checks
  state.player.hp = 2500;

  // P1-2: Output stack at 99 rejects BEFORE charging Xu, ingredients, or writing ledger
  await assert.rejects(
    () => store.brewAlchemy('u1', 'req_stack_99', {
      recipe: haRecipe,
      itemCatalog: catalog.listItems(),
      realmCatalog: catalog.listRealms(),
    }),
    (err) => err.code === 'INVENTORY_FULL' && err.status === 409,
  );
  assert.equal(state.wallet.xu, 500);
  assert.equal(state.ledger.length, 0);
  assert.equal(state.inventory.find((r) => r.itemCode === 'STONE_LINH_NHO').quantity, 10);

  // P1-1: Same requestId with different pillCode must raise 409 IDEMPOTENCY_CONFLICT
  const btOk = await store.breakthrough('u1', 'req_bt_pill_key', {
    realm: luyenThe,
    nextRealm: catalog.getRealmByCode('KHI_DONG'),
    stage: 9,
    major: true,
    threshold: breakthroughThreshold(luyenThe, 9),
    requiredOvr: 1000,
    itemCatalog: catalog.listItems(),
    realmCatalog: catalog.listRealms(),
    requestedPillCode: 'DAN_PHI_THANG',
    candidatePillCodes: ['DAN_PHI_THANG'],
    gain: { str: 3, agi: 3, vit: 3, ene: 2 },
    rollRate: () => 0.1,
  });
  assert.equal(btOk.result.success, true);
  await assert.rejects(
    () => store.replayBreakthrough('u1', 'req_bt_pill_key', 'DAN_PHI_THANG_CUC'),
    (err) => err.code === 'IDEMPOTENCY_CONFLICT' && err.status === 409,
  );
  const samePillReplay = await store.replayBreakthrough('u1', 'req_bt_pill_key', 'DAN_PHI_THANG');
  assert.equal(samePillReplay.result.success, true);
});

test('gameplay emitPlayerState propagates realm fields (P1-4) and cultivation router rate-limits requests (P2-1)', async () => {
  const catalog = createCatalogService();
  const emitted = [];
  const io = {
    to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; },
    local: { to() { return { emit() {} }; }, emit() {} },
    in() { return { async socketsJoin() {}, disconnectSockets() {} }; },
    sockets: { sockets: new Map() },
  };
  let currentPlayer = {
    id: 'p1', userId: 'u1', name: 'HanLap', gender: 'NAM', linhCan: 'HOA',
    realmCode: 'LUYEN_THE', realmStage: 9, stats: { str: 20, agi: 20, vit: 20, ene: 20 },
    derivedStats: {}, equipment: {}, learnedSkills: [], equippedSkills: [],
    hp: 340, maxHp: 340, mp: 210, maxMp: 210, xu: 500, linhThach: 5, inventoryCapacity: 40,
    tuVi: 5000, tuViHienTai: 5000, tuViLenCap: 5000, tuViLinhCan: 0, unspentStatPoints: 0, combatPower: 300,
    canhGioi: catalog.getRealmByCode('LUYEN_THE'), tenCanhGioi: 'Luyện Thể', realm: 1,
    mapCode: 'thanh_van_tran', x: 5, y: 5,
  };
  const players = { async snapshot() { return currentPlayer; }, decorate: (p) => p };
  const world = {
    getByCode: () => ({ code: 'thanh_van_tran', w: 50, h: 50, version: 1, spawnX: 5, spawnY: 5, portals: [], monsterSpawns: [], npcs: [] }),
    getDefault: () => ({ code: 'thanh_van_tran', w: 50, h: 50, version: 1, spawnX: 5, spawnY: 5, portals: [], monsterSpawns: [], npcs: [] }),
  };
  const gameplay = createGameplayService({
    io, auth: {}, players, store: { async savePlayerPosition() { return currentPlayer; } }, catalog, world, quests: null,
  });
  const socket = {
    id: 'sock_realm', auth: { sub: 'u1', username: 'hanlap' }, data: {},
    emit() {}, to() { return { emit() {} }; }, async join() {},
  };
  await gameplay.commandLocal(socket, { requestId: 'req_join_realm', type: 'world.join', payload: {} });
  emitted.length = 0;

  const khiDong = catalog.getRealmByCode('KHI_DONG');
  currentPlayer = {
    ...currentPlayer,
    realmCode: 'KHI_DONG',
    realmStage: 1,
    tangTuVi: 1,
    realm: khiDong.stt,
    canhGioi: khiDong,
    tenCanhGioi: khiDong.tenCanhGioi,
  };
  await gameplay.playerChanged('u1');
  const syncMsg = emitted.find((entry) => entry.room === 'sock_realm' && entry.event === 'player_state_update');
  assert.ok(syncMsg);
  assert.equal(syncMsg.payload.realmCode, 'KHI_DONG');
  assert.equal(syncMsg.payload.realmStage, 1);
  assert.equal(syncMsg.payload.tangTuVi, 1);
  assert.equal(syncMsg.payload.realm, 2);
  assert.equal(syncMsg.payload.tenCanhGioi, khiDong.tenCanhGioi);
  await gameplay.close();

  // P2-1: Cultivation router attaches rate limiter middleware
  const cultRouter = createCultivationRouter({
    auth: { authenticate: (_req, _res, next) => next() },
    cultivation: { absorb: async () => ({}), breakthrough: async () => ({}) },
  });
  const btLayer = cultRouter.stack.find((l) => l.route?.path === '/player/cultivation/breakthrough');
  assert.ok(btLayer && btLayer.route.stack.length >= 3, 'Expected auth + rateLimiter + handler on breakthrough route');
});
