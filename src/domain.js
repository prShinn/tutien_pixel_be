class DomainError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function publicPlayer(player, wallet, inventory, equipment = {}, learnedSkills = [], equippedSkills = []) {
  const safeInventory = inventory.map((entry) => {
    const itemCode = entry.itemCode || entry.id;
    const quantity = Number(entry.quantity ?? entry.count ?? 1);
    const base = {
      id: itemCode,
      itemCode,
      count: quantity,
      quantity,
      slot: entry.slot,
    };
    if (entry.isInstance) {
      base.isInstance = true;
      if (entry.instanceId) base.instanceId = entry.instanceId;
      base.rarity = entry.rarity || 'NORMAL';
      base.enhanceLevel = Math.max(0, Math.floor(Number(entry.enhanceLevel || 0)));
      base.hasLuck = Boolean(entry.hasLuck);
      base.exlOptions = Array.isArray(entry.exlOptions) ? entry.exlOptions : [];
    }
    return base;
  });
  const safeEquipment = Object.fromEntries(
    Object.entries(equipment || {}).map(([slot, entry]) => {
      if (!entry) return [slot, null];
      if (typeof entry === 'string') return [slot, entry];
      const itemCode = entry.itemCode || entry.id;
      const isInstance = Boolean(entry.isInstance ?? entry.instanceId);
      return [slot, {
        id: itemCode,
        itemCode,
        ...(isInstance && entry.instanceId ? { instanceId: entry.instanceId } : {}),
        isInstance,
        rarity: entry.rarity || 'NORMAL',
        enhanceLevel: Math.max(0, Math.floor(Number(entry.enhanceLevel || 0))),
        hasLuck: Boolean(entry.hasLuck),
        exlOptions: Array.isArray(entry.exlOptions) ? entry.exlOptions : [],
      }];
    }),
  );
  return {
    id: player.id, userId: player.userId, name: player.name, gender: player.gender, linhCan: player.linhCan,
    realmCode: player.realmCode,
    realmStage: player.realmStage, tuVi: player.tuVi, tuViLinhCan: player.tuViLinhCan || 0,
    hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp, mapCode: player.mapCode,
    mapId: player.mapCode, maCanhGioi: player.realmCode, tangTuVi: player.realmStage,
    tuViHienTai: player.tuVi,
    x: player.x, y: player.y, positionVersion: player.positionVersion, version: player.version, stats: player.stats,
    unspentStatPoints: player.unspentPoints || 0,
    derivedStats: player.derivedStats,
    wallet: { xu: wallet?.xu || 0, linhThach: wallet?.linhThach || 0 },
    xu: wallet?.xu || 0,
    linhThach: wallet?.linhThach || 0,
    inventoryCapacity: Math.min(80, Math.max(40, Number(player.inventoryCapacity || 40))),
    inventory: safeInventory,
    jsonIventory: JSON.stringify(safeInventory),
    equipment: safeEquipment,
    trangBi: safeEquipment,
    equip_slot: safeEquipment,
    learnedSkills,
    equippedSkills,
    skills: player.skills || [],
    combatPower: player.combatPower,
  };
}

module.exports = { DomainError, publicUser, publicPlayer };
