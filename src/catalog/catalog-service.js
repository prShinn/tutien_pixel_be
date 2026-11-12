const seed = require('../data/mock-data');
const { BALANCE, deriveStats, resolvePassiveModifiers, effectiveMaxVitals, describeEquipment, combatPower } = require('../data/balance');

const clone = (value) => structuredClone(value);

// Existing item overrides predate weapon roles, so classify legacy catalog IDs explicitly.
const legacyStaves = new Set([
  'MOC_WEAPON_NGOC_TRUC_TRUONG', 'THUY_WEAPON_THUY_LONG_TRUONG', 'HOA_WEAPON_HOA_LINH_TRUONG',
  'QUANG_WEAPON_QUANG_MINH_TRUONG', 'LOI_WEAPON_THIEN_LOI_TRUONG',
]);
const legacySwords = new Set([
  'WEAPON_KIEM_GO', 'WEAPON_TRUC_KIEM', 'SWORD_BAO_KHI_1', 'KIM_WEAPON_THIET_KIEM',
  'KIM_WEAPON_BACH_KIM_KIEM', 'THUY_WEAPON_HAI_TRIEU_KIEM', 'HOA_WEAPON_THIEN_VIEM_KIEM',
  'THO_WEAPON_SON_HA_TRUC_KIEM', 'QUANG_WEAPON_THIEN_QUANG_KIEM', 'AM_WEAPON_U_MINH_KIEM',
  'PHONG_WEAPON_THANH_PHONG_KIEM', 'PHONG_WEAPON_CUONG_PHONG_KIEM', 'LOI_WEAPON_THIEN_LOI_KIEM',
  'COM_WEAPON_BACH_TINH_KIEM', 'COM_WEAPON_NGUY_NGUYEN_KIEM',
]);
const legacyWeaponKinds = new Map([
  ['WEAPON_DAO_SAT', 'blade'],
  ['AM_WEAPON_AM_DA_DAO', 'blade'],
  ['THO_WEAPON_DIA_CUI_THUONG', 'hammer'],
]);
const weaponProfiles = {
  sword: { style: 'sword', range: 26, damageType: 'PHYS', scalingStat: 'str', cooldownMs: 700, damageMultiplier: 1 },
  blade: { style: 'blade', range: 26, damageType: 'PHYS', scalingStat: 'agi', cooldownMs: 570, damageMultiplier: 0.9 },
  mace: { style: 'mace', range: 26, damageType: 'PHYS', cooldownMs: 880, damageMultiplier: 1.2 },
  hammer: { style: 'hammer', range: 24, damageType: 'PHYS', cooldownMs: 1050, damageMultiplier: 1.4 },
  spear: { style: 'spear', range: 36, damageType: 'PHYS', scalingStat: 'str', cooldownMs: 760, damageMultiplier: 1.05 },
  staff: { style: 'staff', range: 56, damageType: 'MAGIC', scalingStat: 'ene', cooldownMs: 850, damageMultiplier: 1 },
  bow: { style: 'bow', range: 72, damageType: 'PHYS', scalingStat: 'agi', cooldownMs: 760, damageMultiplier: 1 },
  crossbow: { style: 'crossbow', range: 70, damageType: 'PHYS', scalingStat: 'str', cooldownMs: 1000, damageMultiplier: 1.3 },
  melee: { style: 'melee', range: 26, damageType: 'PHYS' },
};

function weaponAttack(item) {
  const kind = item.weaponKind || legacyWeaponKinds.get(item.id)
    || (legacyStaves.has(item.id) ? 'staff' : legacySwords.has(item.id) ? 'sword' : 'melee');
  return clone(weaponProfiles[Object.hasOwn(weaponProfiles, kind) ? kind : 'melee']);
}

function createCatalogService() {
  let items = clone(seed.items);
  let skills = clone(seed.skills);
  let monsters = clone(seed.monsterDefs || []);
  let alchemyRecipes = clone(seed.alchemyRecipes || []);
  for (const recipe of alchemyRecipes) {
    if (!(Number(recipe.craftSuccessRate) > 0 && Number(recipe.craftSuccessRate) <= BALANCE.alchemy.maxCraftSuccessRate)) {
      throw new Error(`Invalid craftSuccessRate on recipe ${recipe.code}: must be in (0, ${BALANCE.alchemy.maxCraftSuccessRate}]`);
    }
  }
  let monsterRevision = 0;
  const recordVersions = new Map();
  let skillVfxProfiles = {};
  function describeItem(item) {
    if (!item) return null;
    const result = clone(item);
    result.rarity = String(result.rarity || 'NORMAL').toUpperCase();
    result.itemLevel = Math.max(1, Math.floor(Number(result.itemLevel || ((Number(result.requiredRealmStt || 1)) * 10))));
    if (String(item.type || item.loai).toUpperCase() === 'EQUIPMENT') result.equipmentInfo = describeEquipment(result);
    if (item.slot === 'weapon') result.basicAttack = weaponAttack(item);
    return result;
  }
  return {
    listRealms: () => clone(seed.realms),
    getRealmByStt: (stt) => clone(seed.realms.find((realm) => realm.stt === Number(stt)) || null),
    getRealmById: (id) => clone(seed.realms.find((realm) => realm.id === Number(id)) || null),
    getRealmByCode: (code) => clone(seed.realms.find((realm) => realm.code === code) || null),
    listRoots: () => clone(seed.roots),
    getRootByCode: (code) => clone(seed.roots.find((root) => root.id === code || root.maLinhCan === code) || null),
    listItems: () => items.map(describeItem),
    listPremiumItems: () => items.filter((item) => String(item.currency || 'XU').toUpperCase() === 'LINH_THACH').map(describeItem),
    getItemByCode: (code) => describeItem(items.find((item) => item.id === code || item.maDo === code) || null),
    listAlchemyRecipes: () => clone(alchemyRecipes),
    getAlchemyRecipeByCode: (code) => clone(alchemyRecipes.find((recipe) => recipe.code === code) || null),
    listPillQualities: () => clone(Object.values(BALANCE.breakthrough.qualities)),
    listSkills: () => clone(skills),
    listMonsters: () => clone(monsters),
    getMonsterRevision: () => monsterRevision,
    getLootTableById: (id) => clone(seed.lootTables[id] || []),
    getBalance: () => clone(BALANCE),
    getSkillsForPlayer: async (playerService, userId) => {
      const player = await playerService.snapshot(userId);
      return { skills: clone(skills), learnedSkills: player.learnedSkills || [], equippedSkills: player.equippedSkills || [], playerVersion: player.version };
    },
    listSkillVfxProfiles: () => clone(skillVfxProfiles),
    setSkillVfxProfile: (skillCode, profile) => { skillVfxProfiles[skillCode] = clone(profile); },
    removeSkillVfxProfile: (skillCode) => { delete skillVfxProfiles[skillCode]; },
    replaceItems: (nextItems) => { items = clone(nextItems); },
    replaceSkills: (nextSkills) => { skills = clone(nextSkills); },
    getAdminCollection: (collection) => collection === 'items' ? clone(items) : collection === 'skills' ? clone(skills) : collection === 'monsters' ? clone(monsters) : [],
    applyAdminRecord(collection, id, { data, deleted, version }) {
      const key = collection + ":" + id;
      if (Number(version) <= (recordVersions.get(key) || 0)) return false;
      const records = collection === "items" ? items : monsters;
      const index = records.findIndex((record) => String(record.id || record.code || record.maDo) === id);
      if (deleted) {
        if (index !== -1) records.splice(index, 1);
      } else if (index === -1) records.push(clone(data));
      else records[index] = clone(data);
      recordVersions.set(key, Number(version));
      if (collection === "monsters") monsterRevision += 1;
      return true;
    },
    applyAdminCollection(collection, records) {
      if (collection === 'items') items = clone(records);
      if (collection === 'skills') skills = clone(records);
      if (collection === 'monsters') { monsters = clone(records); monsterRevision += 1; }
    },
    decoratePlayer(player) {
      const inventory = (player.inventory || []).map((entry) => {
        const code = entry.itemCode || entry.id;
        const catalogItem = items.find((item) => item.id === code || item.maDo === code) || {};
        const rarity = entry.rarity || catalogItem.rarity || 'NORMAL';
        const enhanceLevel = Math.max(0, Math.floor(Number(entry.enhanceLevel || 0)));
        const hasLuck = Boolean(entry.hasLuck ?? catalogItem.hasLuck);
        const exlOptions = Array.isArray(entry.exlOptions) ? entry.exlOptions : [];
        const merged = {
          ...catalogItem,
          ...entry,
          id: code,
          itemCode: code,
          rarity,
          enhanceLevel,
          hasLuck,
          exlOptions,
        };
        if (String(merged.type || merged.loai || '').toUpperCase() === 'EQUIPMENT') {
          merged.equipmentInfo = describeEquipment(merged);
        }
        return merged;
      });
      const slots = ['weapon', 'armor', 'pants', 'boots', 'hat', 'gloves', 'ring', 'amulet', 'belt', 'gem'];
      const equipment = Object.fromEntries(slots.map((slot) => {
        const stored = player.equipment?.[slot];
        const code = typeof stored === 'string' ? stored : stored?.itemCode || stored?.id;
        const item = code ? items.find((entry) => entry.id === code || entry.maDo === code) : null;
        if (!code) return [slot, null];
        const instanceMeta = typeof stored === 'object' && stored ? stored : {};
        const isInstance = Boolean(instanceMeta.isInstance ?? instanceMeta.instanceId);
        const rarity = instanceMeta.rarity || item?.rarity || 'NORMAL';
        const enhanceLevel = Math.max(0, Math.floor(Number(instanceMeta.enhanceLevel || 0)));
        const hasLuck = Boolean(instanceMeta.hasLuck ?? item?.hasLuck);
        const exlOptions = Array.isArray(instanceMeta.exlOptions) ? instanceMeta.exlOptions : [];
        const merged = {
          ...(item || {}),
          ...instanceMeta,
          id: code,
          itemCode: code,
          ...(isInstance && instanceMeta.instanceId ? { instanceId: instanceMeta.instanceId } : {}),
          isInstance,
          rarity,
          enhanceLevel,
          hasLuck,
          exlOptions,
        };
        if (item && slot === 'weapon') merged.basicAttack = weaponAttack(item);
        if (item) merged.equipmentInfo = describeEquipment(merged);
        return [slot, merged];
      }));
      const learnedSkills = player.learnedSkills || [];
      const equippedSkills = player.equippedSkills || [];
      const equippedSkillDefinitions = equippedSkills.map((code) => skills.find((skill) => skill.code === code)).filter(Boolean);
      const derivedStats = deriveStats(player.stats || {}, equipment);
      const passive = resolvePassiveModifiers(skills, learnedSkills, player.linhCan);
      const effectiveVitals = effectiveMaxVitals(player, derivedStats, passive);
      const hasVitalsContext = player.maxHp != null || player.maxMp != null || player.stats != null
        || Object.values(equipment).some(Boolean) || learnedSkills.length > 0;
      const combat = combatPower({
        ...player,
        realm: player.canhGioi?.stt || 1,
        canhGioi: player.canhGioi,
        tangTuVi: player.realmStage || player.tangTuVi || 1,
        tuViHienTai: player.tuVi ?? player.tuViHienTai,
        tuViLenCap: player.tuViLenCap || player.canhGioi?.tuViTienCap || 1,
        stats: player.stats || {},
        equipment,
        learnedSkills,
      });
      const legacyEquipment = {
        vuKhi: equipment.weapon,
        ao: equipment.armor,
        quan: equipment.pants,
        giay: equipment.boots,
        mu: equipment.hat,
        tay: equipment.gloves,
        nhan: equipment.ring,
        vong: equipment.amulet,
      };
      return {
        ...player,
        inventory,
        jsonIventory: JSON.stringify(inventory),
        equipment,
        trangBi: legacyEquipment,
        equip_slot: legacyEquipment,
        learnedSkills,
        equippedSkills,
        skills: equippedSkillDefinitions,
        derivedStats,
        ...(hasVitalsContext ? {
          maxHp: effectiveVitals.maxHp,
          maxMp: effectiveVitals.maxMp,
          ...(player.hp != null ? { hp: Math.min(Math.max(0, Number(player.hp)), effectiveVitals.maxHp) } : {}),
          ...(player.mp != null ? { mp: Math.min(Math.max(0, Number(player.mp)), effectiveVitals.maxMp) } : {}),
        } : {}),
        combatPower: combat,
        tuViLinhCan: Number(player.tuViLinhCan || 0),
        unspentStatPoints: Number(player.unspentStatPoints ?? player.stats?.unspentPoints ?? 0),
      };
    },
  };
}

module.exports = { createCatalogService };
