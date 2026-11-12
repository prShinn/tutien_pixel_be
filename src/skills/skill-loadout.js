'use strict';

// Bộ kỹ năng của người chơi:
// - Ô 1: kỹ năng common do hệ thống tự gán theo loại vũ khí đang cầm (người chơi không học/không chọn).
//   Sát thương của nó vẫn tính tương khắc theo linh căn người chơi (damageFor dùng session.linhCan).
// - Ô 2..5: tối đa 4 kỹ năng chủ động thuộc đúng linh căn của nhân vật, người chơi tự chọn.
// Các kỹ năng common khác (hỗ trợ/phép) giữ trong catalog cho Admin nhưng người chơi không dùng.

const AUTO_COMMON_BY_WEAPON = Object.freeze({
  bow: 'CUNG_LIEN_CHAU',
  blade: 'DAO_LIET_NGUYET',
  spear: 'THUONG_BACH_BO',
  hammer: 'BUA_SON_TACH',
  mace: 'CHUY_THIET_COT',
  crossbow: 'NO_PHA_GIAP',
});
const DEFAULT_AUTO_COMMON = 'NGU_HANH_KICH';
const MAX_ROOT_SKILL_SLOTS = 4;

function weaponKindOf(equipment) {
  const weapon = equipment?.weapon;
  return String(weapon?.weaponKind || weapon?.basicAttack?.style || '').trim().toLowerCase();
}

function isActive(skill) {
  return String(skill?.category || 'ACTIVE').toUpperCase() !== 'PASSIVE';
}

// Mã kỹ năng tự gán cho ô 1; null nếu catalog không còn kỹ năng phù hợp.
function autoCommonSkillCode(equipment, skills) {
  const exists = (code) => skills.some((skill) => skill.code === code && skill.linhCan === 'COMMON');
  const preferred = AUTO_COMMON_BY_WEAPON[weaponKindOf(equipment)];
  if (preferred && exists(preferred)) return preferred;
  return exists(DEFAULT_AUTO_COMMON) ? DEFAULT_AUTO_COMMON : null;
}

// Kỹ năng người chơi được tự chọn vào ô 2..5: chủ động và đúng linh căn nhân vật.
function isSelectableRootSkill(skill, linhCan) {
  return Boolean(skill) && skill.linhCan === linhCan && isActive(skill);
}

// Lọc loadout đã lưu về đúng luật mới (dữ liệu cũ có thể còn kỹ năng common hoặc khác linh căn).
function rootLoadout(equippedCodes, skills, linhCan) {
  const seen = new Set();
  const result = [];
  for (const code of equippedCodes || []) {
    if (seen.has(code)) continue;
    const skill = skills.find((entry) => entry.code === code);
    if (!isSelectableRootSkill(skill, linhCan)) continue;
    seen.add(code);
    result.push(code);
    if (result.length >= MAX_ROOT_SKILL_SLOTS) break;
  }
  return result;
}

module.exports = {
  AUTO_COMMON_BY_WEAPON,
  DEFAULT_AUTO_COMMON,
  MAX_ROOT_SKILL_SLOTS,
  weaponKindOf,
  autoCommonSkillCode,
  isSelectableRootSkill,
  rootLoadout,
};
