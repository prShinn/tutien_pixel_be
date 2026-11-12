const { DomainError } = require('../domain');
const { validateRequestId } = require('../inventory/inventory-service');
const { MAX_ROOT_SKILL_SLOTS, autoCommonSkillCode } = require('./skill-loadout');

function createSkillService({ store, catalog, players }) {
  async function learn(userId, input) {
    validateRequestId(input?.requestId);
    const skillCode = String(input?.skillCode || '').trim();
    const skill = catalog.listSkills().find((entry) => entry.code === skillCode);
    if (!skill) throw new DomainError('SKILL_NOT_FOUND', 'Kỹ năng không tồn tại', 404);
    // Kỹ năng common do hệ thống tự gán theo vũ khí; người chơi chỉ lĩnh hội kỹ năng của linh căn mình.
    if (skill.linhCan === 'COMMON') throw new DomainError('SKILL_AUTO_ASSIGNED', 'Kỹ năng common được tự gán theo vũ khí, không cần lĩnh hội', 409);
    const player = await players.snapshot(userId);
    if (skill.linhCan !== player.linhCan) throw new DomainError('SKILL_ROOT_MISMATCH', 'Kỹ năng không thuộc linh căn nhân vật', 403);
    const requiredRealmStt = Math.max(1, Number(skill.tier || 1));
    const playerRealmStt = Number(player.canhGioi?.stt || 1);
    if (playerRealmStt < requiredRealmStt) throw new DomainError('REALM_TOO_LOW', 'Cảnh giới chưa đủ để lĩnh hội kỹ năng', 409);
    const mutation = await store.learnSkill(userId, input.requestId, skillCode, player.realmCode, player.linhCan, playerRealmStt, requiredRealmStt);
    const updatedPlayer = players.decorate(mutation.player);
    return {
      learnedSkills: mutation.result.learnedSkills,
      equippedSkills: updatedPlayer.equippedSkills,
      autoSkill: updatedPlayer.autoSkill,
      skills: updatedPlayer.skills,
      skill,
      combatPower: updatedPlayer.combatPower,
      maxHp: updatedPlayer.maxHp,
      maxMp: updatedPlayer.maxMp,
      derivedStats: updatedPlayer.derivedStats,
    };
  }

  async function equip(userId, input) {
    validateRequestId(input?.requestId);
    if (!Array.isArray(input?.skillCodes) || input.skillCodes.length > MAX_ROOT_SKILL_SLOTS
        || input.skillCodes.some((code) => typeof code !== 'string' || !code.trim())) {
      throw new DomainError('INVALID_SKILL_LOADOUT', `Loadout chỉ nhận tối đa ${MAX_ROOT_SKILL_SLOTS} mã kỹ năng hợp lệ`);
    }
    const skillCodes = [...new Set(input.skillCodes.map((code) => code.trim()))];
    const skills = catalog.listSkills();
    const selected = skillCodes.map((code) => skills.find((skill) => skill.code === code));
    if (selected.some((skill) => !skill)) throw new DomainError('SKILL_NOT_FOUND', 'Kỹ năng không tồn tại', 404);
    if (selected.some((skill) => String(skill.category || 'ACTIVE').toUpperCase() === 'PASSIVE')) {
      throw new DomainError('PASSIVE_SKILL_NOT_EQUIPPABLE', 'Kỹ năng nội tại không nằm trong loadout chủ động', 409);
    }
    if (selected.some((skill) => skill.linhCan === 'COMMON')) {
      throw new DomainError('SKILL_AUTO_ASSIGNED', 'Ô kỹ năng common được tự gán theo vũ khí; chỉ chọn kỹ năng linh căn', 409);
    }
    const player = await players.snapshot(userId);
    if (selected.some((skill) => skill.linhCan !== player.linhCan)) {
      throw new DomainError('SKILL_ROOT_MISMATCH', 'Chỉ được trang bị kỹ năng thuộc linh căn nhân vật', 403);
    }
    const mutation = await store.equipSkills(userId, input.requestId, skillCodes);
    const autoSkill = autoCommonSkillCode(player.equipment, skills);
    return {
      equippedSkills: mutation.result.equippedSkills,
      autoSkill,
      // Cùng thứ tự ô trên HUD với PlayerDTO.skills: ô 1 tự gán, sau đó các kỹ năng linh căn.
      skills: [autoSkill, ...mutation.result.equippedSkills]
        .map((code) => skills.find((skill) => skill.code === code))
        .filter(Boolean)
        .map((skill, index) => (index === 0 && skill.code === autoSkill ? { ...skill, autoAssigned: true } : skill)),
    };
  }

  return { learn, equip };
}

module.exports = { createSkillService };
