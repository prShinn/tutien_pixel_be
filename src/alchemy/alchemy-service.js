const crypto = require('node:crypto');
const { DomainError } = require('../domain');
const { BALANCE } = require('../data/balance');
const { validateRequestId } = require('../inventory/inventory-service');

function defaultRandomRate() {
  return crypto.randomInt(0, 10_000) / 10_000;
}

function summarizeCatalogItem(item, fallbackId) {
  if (!item) {
    return { id: fallbackId, name: fallbackId, icon: '💊', quality: null, qualityTier: null, qualityLabel: null, breakthroughRate: null };
  }
  return {
    id: item.id,
    name: item.name,
    icon: item.icon || '💊',
    loai: item.loai || 'MATERIAL',
    quality: item.quality || null,
    qualityTier: item.qualityTier ?? null,
    qualityLabel: item.qualityLabel || null,
    breakthroughRate: item.breakthroughRate ?? null,
    desc: item.desc || item.description || '',
  };
}

function evaluateAlchemyOutcome(recipe, nextRoll) {
  const craftSuccessRate = Number(recipe.craftSuccessRate || 0);
  if (!(craftSuccessRate > 0 && craftSuccessRate <= BALANCE.alchemy.maxCraftSuccessRate)) {
    throw new DomainError('INVALID_ALCHEMY_CONFIG', 'Tỷ lệ luyện đan vượt giới hạn cho phép', 500);
  }
  const craftRoll = Math.min(0.9999, Math.max(0, Number(nextRoll())));
  if (craftRoll >= craftSuccessRate) {
    return {
      outcome: 'FAILED',
      success: false,
      mutated: false,
      outputItemCode: null,
      outputQuantity: 0,
      craftSuccessRate,
      mutationRate: recipe.upgradedItemCode ? Number(recipe.mutationChance ?? BALANCE.alchemy.mutationChance ?? 0.05) : 0,
    };
  }
  const mutationRate = recipe.upgradedItemCode
    ? Math.max(0, Math.min(1, Number(recipe.mutationChance ?? BALANCE.alchemy.mutationChance ?? 0.05)))
    : 0;
  const mutationRoll = mutationRate > 0 ? Math.min(0.9999, Math.max(0, Number(nextRoll()))) : 1;
  const mutated = Boolean(recipe.upgradedItemCode && mutationRate > 0 && mutationRoll < mutationRate);
  return {
    outcome: mutated ? 'MUTATED' : 'SUCCESS',
    success: true,
    mutated,
    outputItemCode: mutated ? recipe.upgradedItemCode : recipe.outputItemCode,
    outputQuantity: Math.max(1, Math.floor(Number(recipe.outputQuantity || 1))),
    craftSuccessRate,
    mutationRate,
  };
}

function createAlchemyService({ store, catalog, players, randomRate = defaultRandomRate }) {
  async function listRecipes(userId) {
    const player = await players.snapshot(userId);
    const ownedByCode = new Map();
    for (const entry of player.inventory || []) {
      const code = String(entry.itemCode || entry.id || '').trim();
      if (!code) continue;
      const qty = Math.max(0, Math.floor(Number(entry.quantity ?? entry.count ?? 0)));
      ownedByCode.set(code, (ownedByCode.get(code) || 0) + qty);
    }
    const xu = Math.max(0, Math.floor(Number(player.xu || 0)));
    const linhThach = Math.max(0, Math.floor(Number(player.linhThach ?? player.wallet?.linhThach ?? 0)));
    const realmStt = Number(player.canhGioi?.stt || catalog.getRealmByCode(player.realmCode)?.stt || 1);

    const recipes = catalog.listAlchemyRecipes().map((recipe) => {
      const outputItem = summarizeCatalogItem(catalog.getItemByCode(recipe.outputItemCode), recipe.outputItemCode);
      const upgradedItem = recipe.upgradedItemCode
        ? summarizeCatalogItem(catalog.getItemByCode(recipe.upgradedItemCode), recipe.upgradedItemCode)
        : null;
      const ingredients = (recipe.ingredients || []).map((reqItem) => {
        const meta = catalog.getItemByCode(reqItem.itemCode);
        const owned = ownedByCode.get(reqItem.itemCode) || 0;
        const quantity = Math.max(1, Math.floor(Number(reqItem.quantity || 1)));
        return {
          itemCode: reqItem.itemCode,
          name: meta?.name || reqItem.itemCode,
          icon: meta?.icon || '🌿',
          quantity,
          owned,
          enough: owned >= quantity,
        };
      });
      const costXu = Math.max(0, Math.floor(Number(recipe.costXu || 0)));
      const costLinhThach = Math.max(0, Math.floor(Number(recipe.costLinhThach || 0)));
      const requiredRealmStt = Math.max(1, Math.floor(Number(recipe.requiredRealmStt || 1)));
      const missingReasons = [];
      if (realmStt < requiredRealmStt) missingReasons.push('REALM_TOO_LOW');
      if (xu < costXu) missingReasons.push('INSUFFICIENT_XU');
      if (linhThach < costLinhThach) missingReasons.push('INSUFFICIENT_LINH_THACH');
      if (ingredients.some((entry) => !entry.enough)) missingReasons.push('INSUFFICIENT_INGREDIENTS');

      return {
        ...recipe,
        costXu,
        costLinhThach,
        requiredRealmStt,
        outputItem,
        upgradedItem,
        ingredients,
        canCraft: missingReasons.length === 0,
        missingReasons,
      };
    });

    return {
      recipes,
      qualities: catalog.listPillQualities(),
      maxCraftSuccessRate: BALANCE.alchemy.maxCraftSuccessRate,
      mutationChance: BALANCE.alchemy.mutationChance,
      wallet: { xu, linhThach },
      realmStt,
    };
  }

  async function listHistory(userId, query = {}) {
    const result = await store.listAlchemyLogs(userId, { limit: query.limit, cursor: query.cursor });
    const items = (result.items || []).map((entry) => {
      const recipe = catalog.getAlchemyRecipeByCode(entry.recipeCode);
      const baseItem = catalog.getItemByCode(entry.baseItemCode);
      const outputItem = entry.outputItemCode ? catalog.getItemByCode(entry.outputItemCode) : null;
      return {
        ...entry,
        recipeName: recipe?.name || entry.recipeCode,
        baseItemName: baseItem?.name || entry.baseItemCode,
        outputItemName: outputItem?.name || entry.outputItemCode || null,
      };
    });
    return { items, nextCursor: result.nextCursor || null };
  }

  async function brew(userId, requestId, rawRecipeCode) {
    validateRequestId(requestId);
    const recipeCode = String(rawRecipeCode || '').trim();
    if (!recipeCode) throw new DomainError('INVALID_RECIPE_CODE', 'Thiếu mã đan phương', 400);
    const recipe = catalog.getAlchemyRecipeByCode(recipeCode);
    if (!recipe) throw new DomainError('ALCHEMY_RECIPE_NOT_FOUND', 'Đan phương không tồn tại', 404);
    const rate = Number(recipe.craftSuccessRate || 0);
    if (!(rate > 0 && rate <= BALANCE.alchemy.maxCraftSuccessRate)) {
      throw new DomainError('INVALID_ALCHEMY_CONFIG', 'Tỷ lệ luyện đan vượt giới hạn cho phép', 500);
    }

    if (typeof store.replayAlchemy === 'function') {
      const replay = await store.replayAlchemy(userId, requestId, recipeCode);
      if (replay) {
        return { player: await players.snapshot(userId), result: replay.result, replayed: true };
      }
    }

    const mutation = await store.brewAlchemy(userId, requestId, {
      recipe,
      itemCatalog: catalog.listItems(),
      realmCatalog: catalog.listRealms(),
      decideOutcome: () => evaluateAlchemyOutcome(recipe, randomRate),
    });
    const updatedPlayer = mutation.replayed ? await players.snapshot(userId) : players.decorate(mutation.player);
    return { player: updatedPlayer, result: mutation.result, replayed: Boolean(mutation.replayed) };
  }

  return { listRecipes, listHistory, brew };
}

module.exports = { createAlchemyService, evaluateAlchemyOutcome };
