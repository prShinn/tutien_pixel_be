'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogService } = require('../src/catalog/catalog-service');
const { createSkillService } = require('../src/skills/skill-service');
const { autoCommonSkillCode, rootLoadout, MAX_ROOT_SKILL_SLOTS } = require('../src/skills/skill-loadout');
const { makeMap, makePlayer, fakeSocket, makeHarness, send } = require('./helpers/realtime-harness');

// Bộ kỹ năng: ô 1 tự gán kỹ năng common theo vũ khí, ô 2..5 tối đa 4 kỹ năng chủ động đúng linh căn nhân vật.

const catalog = createCatalogService();
const allSkills = catalog.listSkills();
const kimActives = allSkills.filter((skill) => skill.linhCan === 'KIM' && String(skill.category || 'ACTIVE') !== 'PASSIVE').map((skill) => skill.code);
const mocActive = allSkills.find((skill) => skill.linhCan === 'MOC' && String(skill.category || 'ACTIVE') !== 'PASSIVE').code;
const kimPassive = allSkills.find((skill) => skill.linhCan === 'KIM' && skill.category === 'PASSIVE').code;

test('the auto-assigned common skill follows the equipped weapon kind', () => {
  const cases = [
    ['bow', 'CUNG_LIEN_CHAU'], ['blade', 'DAO_LIET_NGUYET'], ['spear', 'THUONG_BACH_BO'], ['hammer', 'BUA_SON_TACH'],
    ['mace', 'CHUY_THIET_COT'], ['crossbow', 'NO_PHA_GIAP'], ['sword', 'NGU_HANH_KICH'], ['staff', 'NGU_HANH_KICH'],
  ];
  for (const [kind, code] of cases) {
    assert.equal(autoCommonSkillCode({ weapon: { weaponKind: kind } }, allSkills), code, kind);
    assert.equal(autoCommonSkillCode({ weapon: { basicAttack: { style: kind } } }, allSkills), code, `${kind} via basicAttack`);
  }
  assert.equal(autoCommonSkillCode({}, allSkills), 'NGU_HANH_KICH', 'bare hands');
  assert.equal(autoCommonSkillCode({ weapon: { weaponKind: 'bow' } }, allSkills.filter((skill) => skill.code !== 'CUNG_LIEN_CHAU')), 'NGU_HANH_KICH', 'falls back when the mapped skill was removed');
});

test('the saved loadout is filtered to at most four active skills of the character root', () => {
  const stored = ['NGU_HANH_KICH', kimActives[0], mocActive, kimPassive, kimActives[0], ...kimActives.slice(1)];
  const loadout = rootLoadout(stored, allSkills, 'KIM');
  assert.deepEqual(loadout, kimActives.slice(0, MAX_ROOT_SKILL_SLOTS));
  assert.equal(MAX_ROOT_SKILL_SLOTS, 4);
});

test('PlayerDTO puts the weapon-based common skill in slot 1 followed by the root skills', () => {
  const player = catalog.decoratePlayer({
    linhCan: 'KIM',
    learnedSkills: ['NGU_HANH_KICH', ...kimActives],
    equippedSkills: ['NGU_HANH_KICH', kimActives[0], mocActive, kimActives[1]],
    equipment: { weapon: 'WEAPON_CUNG_GO' },
    stats: { str: 5, agi: 5, vit: 5, ene: 5 },
  });
  assert.equal(player.autoSkill, 'CUNG_LIEN_CHAU');
  assert.deepEqual(player.equippedSkills, [kimActives[0], kimActives[1]], 'common and other-root skills are dropped from the root slots');
  assert.deepEqual(player.skills.map((skill) => skill.code), ['CUNG_LIEN_CHAU', kimActives[0], kimActives[1]]);
  assert.equal(player.skills[0].autoAssigned, true);
  assert.equal(player.skills[1].autoAssigned, undefined);

  const unarmed = catalog.decoratePlayer({ linhCan: 'KIM', equippedSkills: [], equipment: {} });
  assert.deepEqual(unarmed.skills.map((skill) => skill.code), ['NGU_HANH_KICH']);
});

function skillService({ linhCan = 'KIM', weaponKind = 'bow' } = {}) {
  const calls = [];
  const store = {
    async equipSkills(userId, requestId, skillCodes) { calls.push(skillCodes); return { result: { equippedSkills: skillCodes } }; },
    async learnSkill() { throw new Error('learn must not reach storage in these tests'); },
  };
  const players = { snapshot: async () => ({ linhCan, canhGioi: { stt: 1 }, equipment: { weapon: { weaponKind } } }), decorate: (value) => value };
  return { service: createSkillService({ store, catalog, players }), calls };
}

test('equipping skills accepts up to four root skills and returns the HUD order with the auto slot first', async () => {
  const { service, calls } = skillService();
  const picked = kimActives.slice(0, 4);
  const result = await service.equip('u1', { requestId: 'loadout-ok-01', skillCodes: picked });
  assert.deepEqual(calls, [picked]);
  assert.equal(result.autoSkill, 'CUNG_LIEN_CHAU');
  assert.deepEqual(result.skills.map((skill) => skill.code), ['CUNG_LIEN_CHAU', ...picked]);
});

test('equipping skills rejects common skills, other roots and more than four slots', async () => {
  const { service, calls } = skillService();
  await assert.rejects(service.equip('u1', { requestId: 'loadout-common-1', skillCodes: ['NGU_HANH_KICH'] }), { code: 'SKILL_AUTO_ASSIGNED' });
  await assert.rejects(service.equip('u1', { requestId: 'loadout-common-2', skillCodes: [kimActives[0], 'THIEN_CANH'] }), { code: 'SKILL_AUTO_ASSIGNED' });
  await assert.rejects(service.equip('u1', { requestId: 'loadout-root-01', skillCodes: [mocActive] }), { code: 'SKILL_ROOT_MISMATCH' });
  await assert.rejects(service.equip('u1', { requestId: 'loadout-five-01', skillCodes: kimActives.slice(0, 5) }), { code: 'INVALID_SKILL_LOADOUT' });
  await assert.rejects(service.equip('u1', { requestId: 'loadout-passive', skillCodes: [kimPassive] }), { code: 'PASSIVE_SKILL_NOT_EQUIPPABLE' });
  assert.deepEqual(calls, []);
});

test('common skills cannot be learned; they come from the weapon slot', async () => {
  const { service } = skillService();
  await assert.rejects(service.learn('u1', { requestId: 'learn-common-01', skillCode: 'THIEN_CANH' }), { code: 'SKILL_AUTO_ASSIGNED' });
  await assert.rejects(service.learn('u1', { requestId: 'learn-common-02', skillCode: 'CUNG_LIEN_CHAU' }), { code: 'SKILL_AUTO_ASSIGNED' });
});

test('in combat the auto common skill works without being learned, other common skills do not', async (t) => {
  const commons = allSkills.filter((skill) => ['NGU_HANH_KICH', 'CUNG_LIEN_CHAU'].includes(skill.code));
  const field = makeMap('field', {
    monsters: [{ id: 'MOB', code: 'MOB', name: 'Mob', hp: 100000, maxHp: 100000, def: 0, atk: 1, speed: 0.5 }],
    monsterSpawns: [{ packId: 'PACK', templateId: 'MOB', centerX: 2, centerY: 1, count: 1, radius: 1, aggroRange: 1 }],
  });
  field.rules = { monsterPacksOnly: true };
  const harness = makeHarness({ maps: [['field', field]], player: makePlayer({ mp: 50, learnedSkills: [], equippedSkills: [] }), skills: commons });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'auto_join_01', 'world.join');

  const hit = await send(harness.gameplay, socket, 'auto_attack_01', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field', skillCode: 'NGU_HANH_KICH' });
  assert.equal(hit.result.skillCode, 'NGU_HANH_KICH');
  assert.equal(hit.result.hits.length, 1);
  await assert.rejects(
    send(harness.gameplay, socket, 'auto_attack_02', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field', skillCode: 'CUNG_LIEN_CHAU' }),
    { code: 'SKILL_AUTO_ASSIGNED' },
    'a common skill for another weapon is not usable while unarmed',
  );
});

test('new characters learn and equip only skills of their own root', async () => {
  for (const root of ['KIM', 'HOA', 'AM']) {
    const roots = allSkills.filter((skill) => skill.linhCan === root);
    assert.ok(roots.length >= 6, `${root} should have root skills`);
  }
  const { createPlayerService } = require('../src/player');
  let created;
  const store = { async createPlayer(_userId, player) { created = player; return { ...player, inventory: [], equipment: {} }; } };
  const world = { getDefault: () => ({ code: 'start', spawnX: 1, spawnY: 1, jsonMap: [[0, 0], [0, 0]] }), getByCode: () => null };
  const players = createPlayerService({ store, catalog, world });
  await players.create('u1', { name: 'Thu Kiem', gender: 'MALE', linhCan: 'HOA', stats: { str: 10, agi: 5, vit: 10, ene: 5 } }).catch(() => {});
  assert.ok(created, 'createPlayer should be called');
  const byCode = new Map(allSkills.map((skill) => [skill.code, skill]));
  assert.ok(created.initialLearnedSkills.every((code) => byCode.get(code).linhCan === 'HOA'), 'no common skills are learned');
  assert.ok(created.initialEquippedSkills.length >= 1 && created.initialEquippedSkills.every((code) => byCode.get(code).linhCan === 'HOA'));
});

test('playerChangedLocal pushes updated autoSkill and skills over player_state_update', async (t) => {
  const field = makeMap('field');
  const commons = allSkills.filter((skill) => ['NGU_HANH_KICH', 'CUNG_LIEN_CHAU', kimActives[0]].includes(skill.code));
  const initialPlayer = makePlayer({
    linhCan: 'KIM',
    learnedSkills: [kimActives[0]],
    equippedSkills: [kimActives[0]],
    equipment: {},
  });
  const harness = makeHarness({ maps: [['field', field]], player: initialPlayer, skills: commons });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'sync_join_01', 'world.join');

  Object.assign(harness.current, catalog.decoratePlayer({
    ...initialPlayer,
    equipment: { weapon: 'WEAPON_CUNG_GO' },
  }));
  const changed = await harness.gameplay.playerChangedLocal('user_test');
  assert.equal(changed, true);
  const stateUpdate = [...harness.broadcastEvents].reverse()
    .find((event) => event.room === socket.id && event.name === 'player_state_update');
  assert.ok(stateUpdate, 'playerChangedLocal should emit player_state_update');
  assert.equal(stateUpdate.payload.autoSkill, 'CUNG_LIEN_CHAU');
  assert.deepEqual(stateUpdate.payload.skills.map((skill) => skill.code), ['CUNG_LIEN_CHAU', kimActives[0]]);
  assert.deepEqual(stateUpdate.payload.equippedSkills, [kimActives[0]]);
});
