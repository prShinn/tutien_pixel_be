// ════════════════════════════════════════════════════════════════════════════════════════
// FILE: data/balance.js
// 1. DÙNG ĐỂ LÀM GÌ:
//    - Hệ thống công thức & cân bằng game (Game Balance Formulas): Quy định điểm số khởi tạo,
//      hệ số chuyển đổi thuộc tính gốc (str/agi/vit/ene) sang chỉ số chiến đấu (pAtk, mAtk, pDef,
//      mDef, maxHp, maxMp, crit, evasion), công thức giảm trừ sát thương theo phòng thủ,
//      tương khắc ngũ hành (advantage 1.12 / disadvantage 0.94), tính điểm lực chiến (Combat Power),
//      và lượng tu vi cần thiết để đột phá từng cảnh giới.
// 2. CẤU HÌNH LIÊN QUAN:
//    - BALANCE, AFFINITY_PAIRS.
// 3. XỬ LÝ VẤN ĐỀ NÀO:
//    - Giữ cân bằng toán học giữa các hệ linh căn và cảnh giới, ngăn chặn tình trạng số liệu
//      lạm phát hoặc quái vật quá mạnh/quá yếu, tạo quy chuẩn chung cho cả client và server.
// ════════════════════════════════════════════════════════════════════════════════════════

const BALANCE = {
  creation: { minStat: 5, bonusPoints: 10 },
  stats: {
    str: { pAtk: 4 },
    agi: { pAtk: 0.5, crit: 0.003, evasion: 0.004, speed: 0.25 },
    vit: { pDef: 2, maxHp: 12 },
    ene: { mAtk: 4, mDef: 1.5, maxMp: 8 },
  },
  base: { pAtk: 8, mAtk: 8, pDef: 3, mDef: 3, hp: 100, mp: 50 },
  // Hồi MP tự nhiên khi còn sống: % maxMP mỗi giây. Gom đủ mpFlushPct maxMP (hoặc tới khi đầy)
  // mới ghi DB một lần để không phát sinh mutation mỗi giây.
  regen: { mpPctPerSec: 0.02, mpFlushPct: 0.05 },
  death: { xuPerRealmStt: 20, maxXuLoss: 500 },
  alchemy: {
    maxCraftSuccessRate: 0.7,
    mutationChance: 0.05,
  },
  breakthrough: {
    qualities: {
      HA_PHAM: { key: 'HA_PHAM', tier: 1, label: 'Hạ phẩm', breakthroughRate: 0.7 },
      TRUNG_PHAM: { key: 'TRUNG_PHAM', tier: 2, label: 'Trung phẩm', breakthroughRate: 0.8 },
      THUONG_PHAM: { key: 'THUONG_PHAM', tier: 3, label: 'Thượng phẩm', breakthroughRate: 0.9 },
      CUC_PHAM: { key: 'CUC_PHAM', tier: 4, label: 'Cực phẩm', breakthroughRate: 1.0 },
    },
    failurePenalty: {
      xuBase: 50,
      xuPerRealmStt: 50,
      linhThachBase: 1,
      linhThachPerRealmStt: 1,
      tuViRetainRatio: 0.5,
    },
  },
  inventory: { baseCapacity: 40, maxCapacity: 80 },
  itemTaxonomy: {
    rarities: {
      NORMAL: { key: 'NORMAL', tier: 1, label: 'Thường', color: '#e6edf3', glow: 'NONE', maxExl: 0, sellMult: 1 },
      MAGIC: { key: 'MAGIC', tier: 2, label: 'Tinh Luyện', color: '#69b8ff', glow: 'DEWDROP', maxExl: 1, sellMult: 1.35 },
      EXL: { key: 'EXL', tier: 3, label: 'Hoàn Hảo', color: '#5ef2a8', glow: 'SHIMMER', maxExl: 3, sellMult: 2.0 },
      ANCIENT: { key: 'ANCIENT', tier: 4, label: 'Thần Khí', color: '#ffd369', glow: 'MYTHIC_PRISM', maxExl: 4, sellMult: 3.0 },
    },
    categories: ['EQUIPMENT', 'ENHANCE_GEM', 'PROTECT_CHARM', 'POTION', 'CONSUME', 'STONE', 'ELEMSTONE', 'LINDAN', 'BREAKTHROUGH_PILL', 'MATERIAL', 'MAT', 'BAG_EXPAND', 'STAT_RESET', 'EXCHANGE_XU'],
    types: ['EQUIPMENT', 'ENHANCE_GEM', 'PROTECT_CHARM', 'POTION', 'CONSUME', 'STONE', 'ELEMSTONE', 'LINDAN', 'BREAKTHROUGH_PILL', 'MATERIAL', 'MAT', 'BAG_EXPAND', 'STAT_RESET', 'EXCHANGE_XU'],
    sparklePresets: ['NONE', 'DEWDROP', 'SHIMMER', 'MYTHIC_PRISM', 'ELEMENTAL'],
  },
  exlOptions: {
    DMG_PCT: { code: 'DMG_PCT', group: 'OFFENSE', label: 'Sát thương +{val}%', val: 3, slots: ['weapon', 'ring', 'amulet'] },
    EXL_CRIT_DMG: { code: 'EXL_CRIT_DMG', group: 'OFFENSE', label: 'Đòn Hoàn Hảo +{val}%', val: 5, slots: ['weapon', 'ring', 'amulet'] },
    HP_ON_KILL_PCT: { code: 'HP_ON_KILL_PCT', group: 'OFFENSE', label: 'Hồi {val}% HP khi hạ quái', val: 3, slots: ['weapon', 'amulet'] },
    MP_ON_KILL_PCT: { code: 'MP_ON_KILL_PCT', group: 'OFFENSE', label: 'Hồi {val}% MP khi hạ quái', val: 3, slots: ['weapon', 'ring'] },
    ARMOR_PIERCE_PCT: { code: 'ARMOR_PIERCE_PCT', group: 'OFFENSE', label: 'Xuyên giáp +{val}%', val: 5, slots: ['weapon', 'gloves', 'ring'] },
    DMG_REDUCE_PCT: { code: 'DMG_REDUCE_PCT', group: 'DEFENSE', label: 'Giảm sát thương -{val}%', val: 4, slots: ['hat', 'armor', 'pants', 'boots', 'belt', 'gloves'] },
    REFLECT_PCT: { code: 'REFLECT_PCT', group: 'DEFENSE', label: 'Phản sát thương {val}%', val: 4, slots: ['armor', 'pants', 'belt'] },
    MAX_HP_PCT: { code: 'MAX_HP_PCT', group: 'DEFENSE', label: 'Sinh lực tối đa +{val}%', val: 5, slots: ['hat', 'armor', 'pants', 'boots', 'ring', 'amulet'] },
    EVASION_PCT: { code: 'EVASION_PCT', group: 'DEFENSE', label: 'Né tránh +{val}%', val: 3, slots: ['hat', 'boots', 'gloves', 'belt'] },
  },
  enhance: {
    maxLevel: 15,
    luckRateBonus: 0.15,
    luckCombatCritBonus: 0.05,
    protectionItemCode: 'CHARM_BAO_VE',
    broadcastMinLevel: 11,
    tiers: [
      { targetLevel: 1, rate: 1.00, xu: 200, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 2, rate: 1.00, xu: 400, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 3, rate: 1.00, xu: 700, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 4, rate: 0.85, xu: 1000, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 5, rate: 0.75, xu: 1500, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 6, rate: 0.65, xu: 2200, linhThach: 0, gems: [{ itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 7, rate: 0.55, xu: 3200, linhThach: 0, gems: [{ itemCode: 'GEM_SOUL', quantity: 1 }, { itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_DOWN' },
      { targetLevel: 8, rate: 0.50, xu: 4500, linhThach: 0, gems: [{ itemCode: 'GEM_SOUL', quantity: 1 }, { itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 9, rate: 0.45, xu: 6000, linhThach: 0, gems: [{ itemCode: 'GEM_SOUL', quantity: 2 }, { itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 10, rate: 0.40, xu: 8500, linhThach: 2, gems: [{ itemCode: 'GEM_CHAOS', quantity: 1 }, { itemCode: 'GEM_SOUL', quantity: 1 }, { itemCode: 'GEM_BLESS', quantity: 1 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 11, rate: 0.35, xu: 11000, linhThach: 3, gems: [{ itemCode: 'GEM_CHAOS', quantity: 1 }, { itemCode: 'GEM_SOUL', quantity: 1 }, { itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 12, rate: 0.30, xu: 14500, linhThach: 5, gems: [{ itemCode: 'GEM_CHAOS', quantity: 1 }, { itemCode: 'GEM_SOUL', quantity: 2 }, { itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 13, rate: 0.25, xu: 19000, linhThach: 7, gems: [{ itemCode: 'GEM_CHAOS', quantity: 2 }, { itemCode: 'GEM_SOUL', quantity: 2 }, { itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 14, rate: 0.22, xu: 24000, linhThach: 10, gems: [{ itemCode: 'GEM_CHAOS', quantity: 2 }, { itemCode: 'GEM_SOUL', quantity: 2 }, { itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_RESET_ZERO' },
      { targetLevel: 15, rate: 0.20, xu: 30000, linhThach: 15, gems: [{ itemCode: 'GEM_CHAOS', quantity: 2 }, { itemCode: 'GEM_SOUL', quantity: 2 }, { itemCode: 'GEM_BLESS', quantity: 2 }], failOutcome: 'FAIL_RESET_ZERO' },
    ],
  },
  retention: {
    timezoneOffsetMinutes: 420,
    checkinRewards: [
      { day: 1, label: '80 Xu', xu: 80, linhThach: 0, tuVi: 0, items: [] },
      { day: 2, label: '100 Xu + 2 Huyết Ngọc', xu: 100, linhThach: 0, tuVi: 0, items: [{ itemCode: 'HUYET_NGOC_NHO', quantity: 2 }] },
      { day: 3, label: '10 Linh Thạch + 100 Xu', xu: 100, linhThach: 10, tuVi: 0, items: [] },
      { day: 4, label: '140 Xu + 2 Linh Thạch Nhỏ', xu: 140, linhThach: 0, tuVi: 0, items: [{ itemCode: 'STONE_LINH_NHO', quantity: 2 }] },
      { day: 5, label: '15 Linh Thạch + 200 Tu Vi', xu: 0, linhThach: 15, tuVi: 200, items: [] },
      { day: 6, label: '220 Xu + 3 Tiểu Hoàn Đan', xu: 220, linhThach: 0, tuVi: 0, items: [{ itemCode: 'POTION_TIEU_HOAN', quantity: 3 }] },
      { day: 7, label: '50 Linh Thạch + 300 Xu', xu: 300, linhThach: 50, tuVi: 0, items: [] },
    ],
  },
  damage: {
    defenseBase: 100,
    critMultiplier: 1.5,
    variance: 0.08,
    min: 1,
    // Basic = sustained damage miễn phí; skill = burst damage có MP/cooldown.
    basicMultiplier: 0.5,
    basicStatScale: 0.5,
    skillMultiplier: 1.25,
    skillStatScale: 1.5,
    areaSecondaryMultiplier: 0.72,
  },
  affinity: {
    neutral: 1,
    advantage: 1.12,
    disadvantage: 0.94,
    generation: 0.98,
    generatedBy: 1.02,
    same: 0.92,
    strengthImpact: 0.08,
    min: 0.82,
    max: 1.18,
    critBonusWhenCounter: 0.02,
    critBonusStrengthImpact: 0.02,
    critBonusMax: 0.04,
  },
  generationCycle: ["KIM", "THUY", "MOC", "HOA", "THO"],
  controlCycle: ["KIM", "MOC", "THO", "THUY", "HOA"],
  polarity: { KIM: "YANG", MOC: "YIN", THUY: "YIN", HOA: "YANG", THO: "BALANCED", QUANG: "YANG", AM: "YIN", PHONG: "YANG", LOI: "YANG" },
  special: { QUANG: { AM: 1.1 }, AM: { QUANG: 0.9 }, LOI: { PHONG: 1.08 }, PHONG: { LOI: 0.92 } },
  progression: {
    realmWeight: 1000, stageWeight: 90, masteryWeight: 70, statWeight: 1, equipmentWeight: 1, skillWeight: 18,
    linhCan: { itemCap: 1000, itemScale: 0.00008, maxItemBonus: 0.08, realmBonus: 0.012, stageBonus: 0.002, ovrItemWeight: 0.04 },
    // Linh lực dư có giá trị, nhưng không được lấn át chênh lệch đại cảnh giới.
    cultivation: { overcapOvrWeight: 180, maxOvercapOvr: 360, elementalPerCap: 0.04, maxElementalBonus: 0.08 },
  },
};

function affinityMultiplier(attacker, defender, attackerStrength = 1, defenderStrength = 1) {
  return affinityProfile(attacker, defender, attackerStrength, defenderStrength).multiplier;
}

function affinityCritBonus(profile = {}) {
  if (profile.relation !== "khac") return 0;
  return Math.max(0, Math.min(BALANCE.affinity.critBonusMax, BALANCE.affinity.critBonusWhenCounter + Number(profile.strengthGap || 0) * BALANCE.affinity.critBonusStrengthImpact));
}

function elementalStrength(entity = {}) {
  const linhCan = BALANCE.progression.linhCan;
  const cultivation = Math.min(linhCan.maxItemBonus, Math.min(linhCan.itemCap, Math.max(0, Number(entity.tuViLinhCan || 0))) * linhCan.itemScale);
  const cap = Math.max(1, Number(entity.tuViLenCap || 1));
  const bodyLinhLuc = Math.min(BALANCE.progression.cultivation.maxElementalBonus, Math.max(0, Number(entity.tuViHienTai || 0)) / cap * BALANCE.progression.cultivation.elementalPerCap);
  const realm = Math.max(0, Number(entity.canhGioi?.stt || entity.realm || 1) - 1) * linhCan.realmBonus;
  const stage = Math.max(0, Number(entity.tangTuVi || entity.stage || 1) - 1) * linhCan.stageBonus;
  const level = Math.max(0, Number(entity.level || 1) - 1) * 0.06;
  return Math.max(1, 1 + cultivation + bodyLinhLuc + realm + stage + level);
}

function affinityProfile(attacker, defender, attackerStrength = 1, defenderStrength = 1) {
  const base = {
    attacker,
    defender,
    attackerPolarity: BALANCE.polarity[attacker] || "BALANCED",
    defenderPolarity: BALANCE.polarity[defender] || "BALANCED",
    relation: "neutral",
    pressure: null,
    multiplier: BALANCE.affinity.neutral,
    strengthGap: 0,
  };
  if (!attacker || !defender) return base;
  if (attacker === defender) return { ...base, relation: "dong_hanh", multiplier: BALANCE.affinity.same };
  const strengthGap = Math.max(-1, Math.min(1, (Number(attackerStrength || 1) - Number(defenderStrength || 1)) / Math.max(Number(attackerStrength || 1), Number(defenderStrength || 1), 1)));
  const adjust = (value) => Math.max(BALANCE.affinity.min, Math.min(BALANCE.affinity.max, value + strengthGap * BALANCE.affinity.strengthImpact));
  if (BALANCE.special[attacker]?.[defender]) return { ...base, relation: "dac_biet", multiplier: adjust(BALANCE.special[attacker][defender]), strengthGap };
  const generation = BALANCE.generationCycle;
  const control = BALANCE.controlCycle;
  const gi = generation.indexOf(attacker), gd = generation.indexOf(defender);
  const ci = control.indexOf(attacker), cd = control.indexOf(defender);
  if (ci >= 0 && cd >= 0) {
    if ((ci + 1) % control.length === cd) return { ...base, relation: "khac", multiplier: adjust(BALANCE.affinity.advantage), strengthGap };
    if ((ci + control.length - 1) % control.length === cd) return { ...base, relation: "bi_khac", multiplier: adjust(BALANCE.affinity.disadvantage), strengthGap };
  }
  if (gi >= 0 && gd >= 0) {
    if ((gi + 1) % generation.length === gd) return { ...base, relation: "sinh", multiplier: adjust(BALANCE.affinity.generation), strengthGap };
    if ((gi + generation.length - 1) % generation.length === gd) return { ...base, relation: "duoc_sinh", multiplier: adjust(BALANCE.affinity.generatedBy), strengthGap };
  }
  return base;
}

const PASSIVE_MODIFIER_KEYS = [
  'defensePct',
  'shieldPct',
  'skillDamagePct',
  'critPct',
  'cooldownPct',
  'pDefPenPct',
  'statusEffectPct',
  'maxHpPct',
  'hpRegenPct',
  'maxMpPct',
  'speedPct',
  'resistPct',
];

function readEquipmentStat(item, ...keys) {
  for (const key of keys) {
    const direct = Number(item?.[key]);
    if (Number.isFinite(direct) && direct !== 0) return direct;
    const nested = Number(item?.stats?.[key]);
    if (Number.isFinite(nested) && nested !== 0) return nested;
  }
  return 0;
}

function enhanceStatMultiplier(level = 0) {
  const safe = Math.max(0, Math.min(15, Math.floor(Number(level) || 0)));
  if (safe <= 0) return 1;
  return 1 + safe * 0.08 + (safe >= 10 ? (safe - 9) * 0.04 : 0);
}

function scaledEquipmentStats(item = {}) {
  const mult = enhanceStatMultiplier(item?.enhanceLevel || 0);
  const scaleInt = (value) => (value ? Math.round(value * mult) : 0);
  return {
    pAtk: scaleInt(readEquipmentStat(item, 'pAtk')),
    mAtk: scaleInt(readEquipmentStat(item, 'mAtk')),
    pDef: scaleInt(readEquipmentStat(item, 'pDef')),
    mDef: scaleInt(readEquipmentStat(item, 'mDef')),
    maxHp: scaleInt(readEquipmentStat(item, 'maxHp', 'maxHP')),
    maxMp: scaleInt(readEquipmentStat(item, 'maxMp', 'maxMP')),
    spd: scaleInt(readEquipmentStat(item, 'spd')),
    str: scaleInt(readEquipmentStat(item, 'str')),
    agi: scaleInt(readEquipmentStat(item, 'agi')),
    vit: scaleInt(readEquipmentStat(item, 'vit')),
    ene: scaleInt(readEquipmentStat(item, 'ene')),
    crit: Number(readEquipmentStat(item, 'crit')) || 0,
  };
}

function resolveEquipmentModifiers(equipment = {}) {
  const exl = {
    dmgPct: 0,
    exlCritChance: 0,
    hpOnKillPct: 0,
    mpOnKillPct: 0,
    armorPiercePct: 0,
    dmgReducePct: 0,
    reflectPct: 0,
    maxHpPct: 0,
    evasionPct: 0,
  };
  let luckCritBonus = 0;
  let enhanceMaxLevel = 0;
  let weaponEnhanceLevel = 0;
  let armorSum = 0;
  let armorCount = 0;
  for (const [slot, item] of Object.entries(equipment || {})) {
    if (!item) continue;
    const lvl = Math.max(0, Math.min(15, Math.floor(Number(item.enhanceLevel || 0))));
    if (lvl > enhanceMaxLevel) enhanceMaxLevel = lvl;
    if (slot === 'weapon') weaponEnhanceLevel = lvl;
    else if (['hat', 'armor', 'pants', 'boots', 'gloves'].includes(slot)) {
      armorSum += lvl;
      armorCount += 1;
    }
    if (item.hasLuck) luckCritBonus += BALANCE.enhance.luckCombatCritBonus;
    const options = Array.isArray(item.exlOptions) ? item.exlOptions : [];
    for (const opt of options) {
      const code = String(opt?.code || '').toUpperCase();
      const val = Math.max(0, Number(opt?.val || BALANCE.exlOptions[code]?.val || 0)) / 100;
      if (code === 'DMG_PCT') exl.dmgPct += val;
      else if (code === 'EXL_CRIT_DMG') exl.exlCritChance += val;
      else if (code === 'HP_ON_KILL_PCT') exl.hpOnKillPct += val;
      else if (code === 'MP_ON_KILL_PCT') exl.mpOnKillPct += val;
      else if (code === 'ARMOR_PIERCE_PCT') exl.armorPiercePct += val;
      else if (code === 'DMG_REDUCE_PCT') exl.dmgReducePct += val;
      else if (code === 'REFLECT_PCT') exl.reflectPct += val;
      else if (code === 'MAX_HP_PCT') exl.maxHpPct += val;
      else if (code === 'EVASION_PCT') exl.evasionPct += val;
    }
  }
  const avgArmor = armorCount > 0 ? Math.floor(armorSum / armorCount) : 0;
  const glowLevel = Math.max(weaponEnhanceLevel, avgArmor);
  const glowTier = glowLevel >= 13 ? 4 : glowLevel >= 11 ? 3 : glowLevel >= 9 ? 2 : glowLevel >= 7 ? 1 : 0;
  return {
    exl: {
      ...exl,
      dmgPct: Math.min(0.6, exl.dmgPct),
      exlCritChance: Math.min(0.4, exl.exlCritChance),
      hpOnKillPct: Math.min(0.25, exl.hpOnKillPct),
      mpOnKillPct: Math.min(0.25, exl.mpOnKillPct),
      armorPiercePct: Math.min(0.5, exl.armorPiercePct),
      dmgReducePct: Math.min(0.45, exl.dmgReducePct),
      reflectPct: Math.min(0.35, exl.reflectPct),
      maxHpPct: Math.min(0.6, exl.maxHpPct),
      evasionPct: Math.min(0.25, exl.evasionPct),
    },
    luckCritBonus: Math.min(0.25, luckCritBonus),
    enhanceMaxLevel,
    weaponEnhanceLevel,
    glowTier,
  };
}

function calcEquipmentSellPrice(baseSellPrice = 0, enhanceLevel = 0, rarity = 'NORMAL') {
  const safeBase = Math.max(0, Math.floor(Number(baseSellPrice) || 0));
  if (safeBase <= 0) return 0;
  const lvl = Math.max(0, Math.min(15, Math.floor(Number(enhanceLevel) || 0)));
  const rarityInfo = BALANCE.itemTaxonomy.rarities[String(rarity || 'NORMAL').toUpperCase()] || BALANCE.itemTaxonomy.rarities.NORMAL;
  return Math.floor(safeBase * rarityInfo.sellMult * (1 + lvl * 0.15));
}

function deriveStats(stats = {}, equipment = {}) {
  const e = Object.values(equipment || {}).reduce((out, item) => {
    const scaled = scaledEquipmentStats(item);
    out.pAtk += scaled.pAtk;
    out.mAtk += scaled.mAtk;
    out.pDef += scaled.pDef;
    out.mDef += scaled.mDef;
    out.maxHp += scaled.maxHp;
    out.maxMp += scaled.maxMp;
    out.spd += scaled.spd;
    out.str += scaled.str;
    out.agi += scaled.agi;
    out.vit += scaled.vit;
    out.ene += scaled.ene;
    out.crit += scaled.crit;
    return out;
  }, { pAtk: 0, mAtk: 0, pDef: 0, mDef: 0, maxHp: 0, maxMp: 0, spd: 0, str: 0, agi: 0, vit: 0, ene: 0, crit: 0 });
  const s = {
    str: (Number(stats.str) || 0) + e.str,
    agi: (Number(stats.agi) || 0) + e.agi,
    vit: (Number(stats.vit) || 0) + e.vit,
    ene: (Number(stats.ene) || 0) + e.ene,
  };
  const mods = resolveEquipmentModifiers(equipment);
  const rawMaxHp = BALANCE.base.hp + s.vit * 12 + e.maxHp;
  const maxHp = Math.round(rawMaxHp * (1 + mods.exl.maxHpPct));
  return {
    pAtk: BALANCE.base.pAtk + s.str * 4 + s.agi * 0.5 + e.pAtk,
    mAtk: BALANCE.base.mAtk + s.ene * 4 + s.agi * 0.5 + e.mAtk,
    pDef: BALANCE.base.pDef + s.vit * 2 + s.agi * 0.25 + e.pDef,
    mDef: BALANCE.base.mDef + s.ene * 1.5 + s.vit * 0.25 + e.mDef,
    maxHp,
    maxMp: BALANCE.base.mp + s.ene * 8 + e.maxMp,
    spd: e.spd,
    crit: Math.min(0.6, 0.05 + s.agi * 0.003 + e.crit + mods.luckCritBonus),
    evasion: Math.min(0.45, 0.03 + s.agi * 0.004 + mods.exl.evasionPct),
    exl: mods.exl,
    glowTier: mods.glowTier,
  };
}

function resolvePassiveModifiers(skills = [], learnedSkills = [], linhCan = null) {
  const modifiers = Object.fromEntries(PASSIVE_MODIFIER_KEYS.map((key) => [key, 0]));
  const learned = new Set(learnedSkills || []);
  if (!learned.size) return modifiers;
  for (const skill of skills || []) {
    if (!learned.has(skill.code) || skill.category !== 'PASSIVE') continue;
    if (linhCan && skill.linhCan !== linhCan && skill.linhCan !== 'COMMON') continue;
    for (const key of PASSIVE_MODIFIER_KEYS) {
      const value = Number(skill.passiveModifiers?.[key] || 0);
      if (Number.isFinite(value) && value > 0) modifiers[key] += value;
    }
  }
  return modifiers;
}

function effectiveMaxVitals(player = {}, derivedStats = null, passive = null) {
  const derived = derivedStats || player.derivedStats;
  const hasDerivedHp = derived?.maxHp !== null && derived?.maxHp !== undefined && Number.isFinite(Number(derived.maxHp));
  const hasDerivedMp = derived?.maxMp !== null && derived?.maxMp !== undefined && Number.isFinite(Number(derived.maxMp));
  const baseMaxHp = hasDerivedHp
    ? Math.max(1, Number(derived.maxHp))
    : Math.max(1, Number(player.maxHp || BALANCE.base.hp));
  const baseMaxMp = hasDerivedMp
    ? Math.max(0, Number(derived.maxMp))
    : Math.max(0, Number(player.maxMp ?? BALANCE.base.mp));
  const maxHpPct = Math.max(0, Number(passive?.maxHpPct || 0));
  const maxMpPct = Math.max(0, Number(passive?.maxMpPct || 0));
  return {
    maxHp: Math.max(1, Math.round(baseMaxHp * (1 + maxHpPct))),
    maxMp: Math.max(0, Math.round(baseMaxMp * (1 + maxMpPct))),
  };
}

function mitigateDamage(raw, defense) {
  return Math.max(BALANCE.damage.min, raw * BALANCE.damage.defenseBase / (BALANCE.damage.defenseBase + Math.max(0, defense || 0)));
}

function combatTier(entity = {}) {
  const realm = Math.max(1, Number(entity.canhGioi?.stt || entity.realm || 1));
  const stage = Math.max(1, Number(entity.tangTuVi || entity.stage || 1));
  return (realm - 1) * 9 + stage;
}

// Áp lực mối đe dọa dùng chung cho quái: level là trục chính, chỉ số thực tế là phần hiệu chỉnh.
function monsterPressure(player = {}, monster = {}, derived = deriveStats(player.stats, player.equipment)) {
  const levelGap = Math.max(-8, Math.min(12, Number(monster.level || 1) - combatTier(player)));
  const monsterThreat = Number(monster.atk || 0) * 1.8 + Number(monster.def || 0) * 1.2 + Number(monster.maxHp || monster.hp || 0) * 0.04;
  const playerThreat = Number(derived.pAtk || 0) * 0.9 + Number(derived.pDef || 0) * 0.8 + Number(derived.maxHp || 100) * 0.03;
  return Math.max(-0.35, Math.min(1.5, levelGap * 0.12 + (monsterThreat / Math.max(1, playerThreat) - 1) * 0.35));
}

function combatStatPower(derived) {
  return derived.pAtk + derived.mAtk + (derived.pDef + derived.mDef) * 1.5 + derived.maxHp * 0.1 + derived.maxMp * 0.1;
}

function equipmentStatPower(equipment = {}) {
  return Object.values(equipment || {}).reduce((sum, item) => {
    if (!item) return sum;
    const baseStats = Object.values(item.stats || {}).reduce((n, value) => n + Number(value || 0), 0);
    const enhanceLevel = Math.max(0, Math.floor(Number(item.enhanceLevel || 0)));
    const exlBonus = (Array.isArray(item.exlOptions) ? item.exlOptions.length : 0) * 18;
    const luckBonus = item.hasLuck ? 12 : 0;
    return sum + Math.round(baseStats * enhanceStatMultiplier(enhanceLevel)) + enhanceLevel * 8 + exlBonus + luckBonus;
  }, 0);
}

function describeEquipment(item) {
  const base = deriveStats();
  const equipped = deriveStats({}, { preview: item });
  const bonuses = {};
  for (const key of ['pAtk', 'mAtk', 'pDef', 'mDef', 'maxHp', 'maxMp', 'spd']) {
    const delta = equipped[key] - base[key];
    if (delta !== 0) bonuses[key] = delta;
  }
  const appliedKeys = new Set(['pAtk', 'mAtk', 'pDef', 'mDef', 'maxHp', 'maxHP', 'maxMp', 'maxMP', 'spd']);
  const mult = enhanceStatMultiplier(item?.enhanceLevel || 0);
  const ratingOnly = Object.fromEntries(
    Object.entries(item.stats || {})
      .filter(([key, value]) => !appliedKeys.has(key) && Number(value) !== 0)
      .map(([key, value]) => [key, key === 'crit' ? Number(value) : Math.round(Number(value) * mult)]),
  );
  const combatOvr = (combatStatPower(equipped) - combatStatPower(base)) * BALANCE.progression.statWeight;
  const itemOvr = equipmentStatPower({ preview: item }) * BALANCE.progression.equipmentWeight;
  return {
    bonuses,
    ratingOnly,
    combatOvr,
    itemOvr,
    ovr: combatOvr + itemOvr,
    enhanceLevel: Math.max(0, Math.floor(Number(item?.enhanceLevel || 0))),
    rarity: String(item?.rarity || 'NORMAL').toUpperCase(),
    hasLuck: Boolean(item?.hasLuck),
    exlOptions: Array.isArray(item?.exlOptions) ? item.exlOptions : [],
  };
}

function combatPower(player = {}) {
  const derived = deriveStats(player.stats, player.equipment);
  const realm = Number(player.canhGioi?.stt || player.realm || 1);
  const stage = Number(player.tangTuVi || player.stage || 1);
  const cap = Math.max(1, Number(player.tuViLenCap || 1));
  const mastery = Math.max(0, Math.min(1, Number(player.tuViHienTai || 0) / cap));
  const overflowRatio = Math.max(0, Number(player.tuViHienTai || 0) / cap - 1);
  const overflowPower = Math.min(BALANCE.progression.cultivation.maxOvercapOvr, overflowRatio * BALANCE.progression.cultivation.overcapOvrWeight);
  const statPower = combatStatPower(derived);
  const equipmentPower = equipmentStatPower(player.equipment);
  const skillPower = Array.isArray(player.learnedSkills || player.skills) ? (player.learnedSkills || player.skills).length * BALANCE.progression.skillWeight : 0;
  const linhCanPower = Math.min(BALANCE.progression.linhCan.itemCap * BALANCE.progression.linhCan.ovrItemWeight, Math.max(0, Number(player.tuViLinhCan || 0)) * BALANCE.progression.linhCan.ovrItemWeight);
  return Math.floor(realm * BALANCE.progression.realmWeight + stage * BALANCE.progression.stageWeight + mastery * BALANCE.progression.masteryWeight + overflowPower + statPower * BALANCE.progression.statWeight + equipmentPower * BALANCE.progression.equipmentWeight + skillPower + linhCanPower);
}

function calcTuViNeeded(realm = {}, stage = 1) {
  const safeRealm = Math.max(1, Number(realm.stt) || 1);
  const safeStage = Math.max(1, Math.min(Number(realm.soTang || 9), Number(stage) || 1));
  // Dành thêm một nấc tăng trưởng cho mỗi lần vượt đại cảnh giới.
  // Vì vậy tầng 1 cảnh giới mới luôn cao hơn ngưỡng phá tầng cuối cảnh giới cũ.
  const globalStep = (safeRealm - 1) * 10 + (safeStage - 1);
  return Math.floor(1000 * Math.pow(1.24, globalStep));
}

function breakthroughThreshold(realm = {}, stage = 1) {
  const safeStage = Math.max(1, Number(stage) || 1);
  const normal = calcTuViNeeded(realm, safeStage);
  return Math.floor(normal * (safeStage >= Number(realm.soTang || 9) ? 1.5 : 1));
}

function minimumBreakthroughOvr(realm = {}, stage = 1, major = false) {
  const realmIndex = Math.max(1, Number(realm.stt) || 1) - 1;
  const rank = realmIndex * 10 + Math.max(1, Number(stage) || 1);
  // Bonus đại cảnh giới được cộng dồn, tránh OVR tầng 1 cảnh giới mới tụt xuống.
  return Math.floor(1000 + rank * 180 + realmIndex * 500 + (major ? 500 : 0));
}

function breakthroughGain(realm = {}, stage = 1, major = false) {
  const budget = (major ? 10 : 4) + Math.floor((Number(realm.stt) || 0) * 0.75) + Math.floor((Number(stage) || 1) * 0.25);
  const base = Math.floor(budget / 4), remainder = budget % 4;
  return { str: base + (remainder > 0 ? 1 : 0), agi: base + (remainder > 1 ? 1 : 0), vit: base + (remainder > 2 ? 1 : 0), ene: base };
}

function calcDeathXuPenalty(currentXu = 0, realmStt = 1) {
  const safeXu = Math.max(0, Math.floor(Number(currentXu) || 0));
  const safeRealmStt = Math.max(1, Math.floor(Number(realmStt) || 1));
  const rawFee = Math.min(BALANCE.death.maxXuLoss, BALANCE.death.xuPerRealmStt * safeRealmStt);
  return Math.min(safeXu, rawFee);
}

function resolveBreakthroughPillRate(pill) {
  const explicit = Number(pill?.breakthroughRate);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(1, Math.max(0.01, explicit));
  }
  const qualityKey = String(pill?.quality || '').toUpperCase();
  const preset = BALANCE.breakthrough.qualities[qualityKey];
  if (preset) return preset.breakthroughRate;
  return BALANCE.breakthrough.qualities.HA_PHAM.breakthroughRate;
}

function calcBreakthroughFailurePenalty(realmStt = 1) {
  const safeStt = Math.max(1, Math.floor(Number(realmStt) || 1));
  const cfg = BALANCE.breakthrough.failurePenalty;
  return {
    xuPenalty: Math.max(0, Math.floor(cfg.xuBase + safeStt * cfg.xuPerRealmStt)),
    linhThachPenalty: Math.max(0, Math.floor(cfg.linhThachBase + (safeStt - 1) * cfg.linhThachPerRealmStt)),
  };
}

function calcBreakthroughRegression({
  realm,
  prevRealm = null,
  stage = 1,
  stats = {},
  currentTuVi = 0,
}) {
  const safeStage = Math.max(1, Math.floor(Number(stage) || 1));
  const minStat = BALANCE.creation.minStat;
  let nextRealm = realm;
  let nextStage = safeStage;
  if (safeStage > 1) {
    nextStage = safeStage - 1;
  } else if (Number(realm?.stt || 1) > 1 && prevRealm) {
    nextRealm = prevRealm;
    nextStage = Math.max(1, Number(prevRealm.soTang || 9));
  }

  const droppedStageForGain = safeStage > 1 ? safeStage - 1 : nextStage;
  const droppedFromPrevRealm = safeStage === 1 && Number(realm?.stt || 1) > 1 && prevRealm;
  const deltaGain = (safeStage === 1 && Number(realm?.stt || 1) <= 1)
    ? { str: 0, agi: 0, vit: 0, ene: 0 }
    : breakthroughGain(droppedFromPrevRealm ? prevRealm : realm, droppedStageForGain, Boolean(droppedFromPrevRealm));

  const nextStats = {
    str: Math.max(minStat, Math.floor(Number(stats.str || minStat)) - deltaGain.str),
    agi: Math.max(minStat, Math.floor(Number(stats.agi || minStat)) - deltaGain.agi),
    vit: Math.max(minStat, Math.floor(Number(stats.vit || minStat)) - deltaGain.vit),
    ene: Math.max(minStat, Math.floor(Number(stats.ene || minStat)) - deltaGain.ene),
  };
  const nextThreshold = Math.max(1, breakthroughThreshold(nextRealm, nextStage));
  const retainedTuVi = Math.min(
    Math.max(0, Math.floor(Number(currentTuVi) || 0)),
    Math.floor(nextThreshold * BALANCE.breakthrough.failurePenalty.tuViRetainRatio),
  );
  return {
    nextRealm,
    nextStage,
    nextStats,
    statLoss: {
      str: Math.max(0, Math.floor(Number(stats.str || minStat)) - nextStats.str),
      agi: Math.max(0, Math.floor(Number(stats.agi || minStat)) - nextStats.agi),
      vit: Math.max(0, Math.floor(Number(stats.vit || minStat)) - nextStats.vit),
      ene: Math.max(0, Math.floor(Number(stats.ene || minStat)) - nextStats.ene),
    },
    tuViAfter: retainedTuVi,
    nextThreshold,
  };
}

function getVnDateString(timestampMs = Date.now()) {
  const vnTime = new Date(Number(timestampMs) + BALANCE.retention.timezoneOffsetMinutes * 60_000);
  return vnTime.toISOString().slice(0, 10);
}

module.exports = {
  BALANCE,
  PASSIVE_MODIFIER_KEYS,
  enhanceStatMultiplier,
  scaledEquipmentStats,
  resolveEquipmentModifiers,
  calcEquipmentSellPrice,
  affinityMultiplier,
  affinityCritBonus,
  affinityProfile,
  elementalStrength,
  deriveStats,
  resolvePassiveModifiers,
  effectiveMaxVitals,
  describeEquipment,
  mitigateDamage,
  combatTier,
  monsterPressure,
  combatPower,
  calcTuViNeeded,
  breakthroughThreshold,
  minimumBreakthroughOvr,
  breakthroughGain,
  calcDeathXuPenalty,
  resolveBreakthroughPillRate,
  calcBreakthroughFailurePenalty,
  calcBreakthroughRegression,
  getVnDateString,
};
