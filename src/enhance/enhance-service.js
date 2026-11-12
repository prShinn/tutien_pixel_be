const crypto = require('node:crypto');
const { DomainError } = require('../domain');
const { BALANCE, enhanceStatMultiplier } = require('../data/balance');
const { validateRequestId } = require('../inventory/inventory-service');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultRandomRate() {
  return crypto.randomInt(0, 10_000) / 10_000;
}

function planEnhanceAttempt({ itemDef, instance, useProtection = false }) {
  const enhanceCfg = BALANCE.enhance;
  const fromLevel = Math.max(0, Math.floor(Number(instance?.enhanceLevel || 0)));
  if (fromLevel >= enhanceCfg.maxLevel) {
    throw new DomainError('ENHANCE_MAX_LEVEL', `Trang bị đã đạt cấp cường hóa tối đa (+${enhanceCfg.maxLevel})`, 409);
  }
  const targetLevel = fromLevel + 1;
  const tier = enhanceCfg.tiers.find((entry) => Number(entry.targetLevel) === targetLevel);
  if (!tier) {
    throw new DomainError('ENHANCE_CONFIG_INVALID', 'Không tìm thấy cấu hình cường hóa cho cấp kế tiếp', 500);
  }
  const hasLuck = Boolean(instance?.hasLuck ?? itemDef?.hasLuck);
  const luckBonus = hasLuck ? Number(enhanceCfg.luckRateBonus ?? enhanceCfg.luckSuccessBonus ?? 0.15) : 0;
  const baseRate = Number(tier.rate || 0);
  const successRate = Math.round(Math.min(1, Math.max(0.01, baseRate + luckBonus)) * 10_000) / 10_000;
  const consumedItems = {};
  for (const gem of tier.gems || []) {
    if (!gem?.itemCode) continue;
    consumedItems[gem.itemCode] = (consumedItems[gem.itemCode] || 0) + Math.max(1, Math.floor(Number(gem.quantity || 1)));
  }
  const effectiveProtection = Boolean(useProtection) && successRate < 1;
  if (effectiveProtection) {
    consumedItems.CHARM_BAO_VE = (consumedItems.CHARM_BAO_VE || 0) + 1;
  }
  return {
    fromLevel,
    toLevelSuccess: targetLevel,
    tier,
    baseRate,
    luckBonus,
    successRate,
    costXu: Math.max(0, Math.floor(Number(tier.xu || 0))),
    costLinhThach: Math.max(0, Math.floor(Number(tier.linhThach || 0))),
    consumedItems,
    useProtection: effectiveProtection,
    failOutcome: tier.failOutcome || 'FAIL_RESET_ZERO',
  };
}

function evaluateEnhanceOutcome(plan, nextRoll = defaultRandomRate) {
  const roll = Math.min(0.9999, Math.max(0, Number(nextRoll())));
  const succeeded = plan.successRate >= 1 || roll < plan.successRate;
  if (succeeded) {
    return { outcome: 'SUCCESS', fromLevel: plan.fromLevel, toLevel: plan.toLevelSuccess, roll };
  }
  if (plan.useProtection) {
    return { outcome: 'FAIL_PROTECTED', fromLevel: plan.fromLevel, toLevel: plan.fromLevel, roll };
  }
  if (plan.failOutcome === 'FAIL_DOWN') {
    return { outcome: 'FAIL_DOWN', fromLevel: plan.fromLevel, toLevel: Math.max(0, plan.fromLevel - 1), roll };
  }
  if (plan.failOutcome === 'FAIL_RESET_ZERO') {
    return { outcome: 'FAIL_RESET_ZERO', fromLevel: plan.fromLevel, toLevel: 0, roll };
  }
  return { outcome: 'FAIL_PROTECTED', fromLevel: plan.fromLevel, toLevel: plan.fromLevel, roll };
}

function createEnhanceService({
  store,
  catalog,
  players,
  randomRate = defaultRandomRate,
  onAnnouncement = null,
}) {
  async function getConfig(userId, query = {}) {
    await players.snapshot(userId);
    const logs = await store.listEnhanceLogs(userId, {
      limit: query.limit ?? 10,
      cursor: query.cursor || null,
    });
    const luckBonusRate = Number(BALANCE.enhance.luckRateBonus ?? BALANCE.enhance.luckSuccessBonus ?? 0.15);
    const enrichedLogs = (logs.items || []).map((entry) => {
      const def = catalog.getItemByCode?.(entry.itemCode);
      return {
        ...entry,
        itemName: entry.itemName || def?.name || def?.tenDo || entry.itemCode,
      };
    });
    return {
      maxLevel: BALANCE.enhance.maxLevel,
      luckRateBonus: luckBonusRate,
      luckSuccessBonus: luckBonusRate,
      protectionItemCode: 'CHARM_BAO_VE',
      statMultipliers: Array.from(
        { length: BALANCE.enhance.maxLevel + 1 },
        (_, lvl) => Math.round(enhanceStatMultiplier(lvl) * 100) / 100,
      ),
      tiers: BALANCE.enhance.tiers,
      logs: enrichedLogs,
      nextCursor: logs.nextCursor,
    };
  }

  async function enhance(userId, input) {
    validateRequestId(input?.requestId);
    const instanceId = String(input?.instanceId || '').trim();
    if (!UUID_RE.test(instanceId)) {
      throw new DomainError('INVALID_INSTANCE_ID', 'instanceId không hợp lệ', 400);
    }
    const useProtection = Boolean(input?.useProtection);
    const mutation = await store.enhanceEquipment(userId, input.requestId, {
      instanceId,
      useProtection,
      itemCatalog: catalog.listItems(),
      planAttempt: planEnhanceAttempt,
      decideOutcome: (plan) => evaluateEnhanceOutcome(plan, randomRate),
    });
    const player = players.decorate(mutation.player);
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      event: 'equipment_enhance',
      requestId: input.requestId,
      playerId: player.id,
      instanceId,
      fromLevel: mutation.result?.fromLevel ?? 0,
      toLevel: mutation.result?.toLevel ?? 0,
      outcome: mutation.result?.outcome || 'UNKNOWN',
      replayed: Boolean(mutation.replayed),
    })}\n`);

    if (!mutation.replayed && mutation.result?.outcome === 'SUCCESS' && Number(mutation.result.toLevel) >= 11 && typeof onAnnouncement === 'function') {
      try {
        onAnnouncement({
          type: 'ENHANCE_MILESTONE',
          playerName: player.name,
          itemCode: mutation.result.itemCode,
          itemName: mutation.result.itemName,
          level: mutation.result.toLevel,
          message: `Đạo hữu ${player.name} đã cường hóa thành công ${mutation.result.itemName} +${mutation.result.toLevel}!`,
        });
      } catch {
        // Announcement broadcast is best-effort.
      }
    }

    return {
      player,
      result: mutation.result,
      ...(mutation.replayed ? { replayed: true } : {}),
    };
  }

  return { getConfig, enhance };
}

module.exports = {
  createEnhanceService,
  planEnhanceAttempt,
  evaluateEnhanceOutcome,
  UUID_RE,
};
