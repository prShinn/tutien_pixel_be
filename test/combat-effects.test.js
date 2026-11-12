const test = require('node:test');
const assert = require('node:assert/strict');
const { BALANCE, deriveStats, describeEquipment } = require('../src/data/balance');
const { makeMap, makePlayer, fakeSocket, makeHarness, send } = require('./helpers/realtime-harness');

// Các test dưới đây chạy bằng đồng hồ thật của runtime (tick quái 500ms, tick hồi phục 1s) nên dùng waitFor
// thay vì sleep cố định; chúng kiểm các cơ chế authoritative của combat: khiên hấp thụ, curse, tương khắc,
// hồi MP tự nhiên, hồi theo giây và chặn hành động khi đã chết.

async function waitFor(predicate, { timeoutMs = 4000, stepMs = 25 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return predicate();
}

function monsterField(monster, spawn = {}) {
  const field = makeMap('field', {
    monsters: [monster],
    monsterSpawns: [{ packId: 'PACK', templateId: monster.code, centerX: 1, centerY: 1, count: 1, radius: 1, aggroRange: 40, ...spawn }],
  });
  field.rules = { monsterPacksOnly: true };
  return field;
}

function mob(overrides = {}) {
  return { id: 'MOB', code: 'MOB', name: 'Mob', level: 1, hp: 100000, maxHp: 100000, def: 0, atk: 40, speed: 1, ...overrides };
}

async function startFight(t, { monster, player, skills = [], spawn }) {
  const harness = makeHarness({
    maps: [['field', monsterField(monster, spawn)]],
    player: makePlayer(player),
    skills,
  });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_fight_01', 'world.join');
  return { harness, socket };
}

const firstMonsterHit = (harness) => harness.broadcastEvents.find((event) => event.name === 'player_combat_result');

const shieldSkill = { code: 'SHIELD', name: 'Shield', linhCan: 'KIM', satThuong: 0, effect: 'shield', effectVal: 15, thoiGianBuff: 10, mpTieuHao: 5, hoiChieu: 2 };
const curseSkill = { code: 'CURSE', name: 'Curse', linhCan: 'KIM', satThuong: 0.5, dienRong: 0, range: 5, effect: 'curse', effectVal: 50, thoiGianBuff: 10, mpTieuHao: 5, hoiChieu: 2 };

test('shield is an absorb pool sized from max HP: it soaks monster damage and is removed once spent', async (t) => {
  const { harness, socket } = await startFight(t, {
    monster: mob(),
    player: { hp: 200, maxHp: 200, learnedSkills: ['SHIELD'], equippedSkills: ['SHIELD'] },
    skills: [shieldSkill],
  });
  const cast = await send(harness.gameplay, socket, 'cast_shield_01', 'combat.skill', { skillCode: 'SHIELD' });
  assert.equal(cast.result.buffs.shield.absorb, 30, '15% of 200 max HP');

  assert.ok(await waitFor(() => firstMonsterHit(harness)), 'the monster should attack');
  const hit = firstMonsterHit(harness).payload;
  // atk 40..43 against pDef 15 mitigates to 35..38; the shield soaks exactly 30 of it.
  assert.equal(hit.absorbed, 30);
  assert.ok(hit.damage >= 5 && hit.damage <= 8, `damage after the shield was ${hit.damage}`);
  assert.equal(hit.hp, 200 - hit.damage);
  assert.equal(harness.current.hp, 200 - hit.damage, 'only the unabsorbed damage reaches the database');
  assert.equal(harness.gameplay.runtime.getPlayer('field', socket.id).buffs.shield, undefined, 'a spent shield is removed');
});

test('without a shield the same monster hit lands in full', async (t) => {
  const { harness } = await startFight(t, { monster: mob(), player: { hp: 200, maxHp: 200 } });
  assert.ok(await waitFor(() => firstMonsterHit(harness)));
  const hit = firstMonsterHit(harness).payload;
  assert.equal(hit.absorbed, 0);
  assert.ok(hit.damage >= 35 && hit.damage <= 38, `unshielded damage was ${hit.damage}`);
});

test('curse weakens a monster attack by its effect value and is recorded on the monster', async (t) => {
  const { harness, socket } = await startFight(t, {
    monster: mob({ atk: 100 }),
    player: { hp: 1000, maxHp: 1000, learnedSkills: ['CURSE'], equippedSkills: ['CURSE'] },
    skills: [curseSkill],
  });
  const attack = await send(harness.gameplay, socket, 'curse_attack_01', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field', skillCode: 'CURSE' });
  assert.equal(attack.result.hits[0].dead, false);
  const cursed = harness.gameplay.runtime.getMonster('field', 'PACK_0').statusEffects.find((effect) => effect.type === 'curse');
  assert.equal(cursed?.value, 50);

  assert.ok(await waitFor(() => firstMonsterHit(harness)));
  // Uncursed: atk 100..103 mitigates to 87..90. Cursed by 50%: 50..51 mitigates to 44..45.
  const { damage } = firstMonsterHit(harness).payload;
  assert.ok(damage >= 44 && damage <= 45, `cursed monster damage was ${damage}`);
});

test('an uncursed monster with the same attack stat deals the full damage (control for the curse test)', async (t) => {
  const { harness } = await startFight(t, { monster: mob({ atk: 100 }), player: { hp: 1000, maxHp: 1000 } });
  assert.ok(await waitFor(() => firstMonsterHit(harness)));
  const { damage } = firstMonsterHit(harness).payload;
  assert.ok(damage >= 87 && damage <= 90, `uncursed monster damage was ${damage}`);
});

test('player attacks apply the five-element relation and report it on every hit', async (t) => {
  const cases = [
    ['MOC', 'khac', BALANCE.affinity.advantage],
    ['HOA', 'bi_khac', BALANCE.affinity.disadvantage],
    ['KIM', 'dong_hanh', BALANCE.affinity.same],
    ['THUY', 'sinh', BALANCE.affinity.generation],
    ['THO', 'duoc_sinh', BALANCE.affinity.generatedBy],
    ['AM', 'neutral', BALANCE.affinity.neutral],
    [undefined, 'neutral', BALANCE.affinity.neutral],
  ];
  for (const [element, relation, multiplier] of cases) {
    const { harness, socket } = await startFight(t, {
      monster: mob({ linhCan: element, atk: 1 }),
      player: { linhCan: 'KIM' },
    });
    const result = await send(harness.gameplay, socket, 'affinity_attack_1', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field' });
    const hit = result.result.hits[0];
    assert.equal(hit.affinityRelation, relation, `KIM vs ${element}`);
    assert.ok(Math.abs(hit.affinityMultiplier - multiplier) < 1e-9, `KIM vs ${element} multiplier ${hit.affinityMultiplier}`);
    assert.ok(hit.damage >= 1);
  }
});

test('natural MP regeneration refills MP, is recorded as NATURAL_REGEN and notifies the player', async (t) => {
  const harness = makeHarness({ player: makePlayer({ mp: 49, maxMp: 50 }) });
  t.after(() => harness.gameplay.close());
  const actions = [];
  const original = harness.store.updateVitals;
  harness.store.updateVitals = async (...args) => { actions.push(args[2]); return original.apply(harness.store, args); };
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_regen_01', 'world.join');

  assert.ok(await waitFor(() => harness.current.mp === 50, { timeoutMs: 3500 }), `mp stayed at ${harness.current.mp}`);
  assert.deepEqual([...new Set(actions)], ['NATURAL_REGEN']);
  assert.ok(harness.broadcastEvents.some((event) => event.room === socket.id && event.name === 'player_state_update' && event.payload.mp === 50));
});

test('natural MP regeneration is batched instead of writing the database every second', async (t) => {
  const harness = makeHarness({ player: makePlayer({ mp: 0, maxMp: 50 }) });
  t.after(() => harness.gameplay.close());
  const actions = [];
  const original = harness.store.updateVitals;
  harness.store.updateVitals = async (...args) => { actions.push(args[2]); return original.apply(harness.store, args); };
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_batch_01', 'world.join');

  // 2% of 50 = 1 MP per second and a write needs ceil(5% of 50) = 3 MP, so the first second only accumulates.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(actions, [], 'no write yet');
  assert.ok(harness.gameplay.runtime.getPlayer('field', socket.id).regenCarryMp > 0, 'progress is carried between ticks');

  assert.ok(await waitFor(() => actions.includes('NATURAL_REGEN'), { timeoutMs: 4500 }), 'a batched write eventually happens');
  assert.ok(harness.current.mp >= 3, `batched write restored ${harness.current.mp} MP`);
});

test('buff_hp_regen heals every second and is recorded as BUFF_REGEN', async (t) => {
  const skill = { code: 'HPREGEN', name: 'Hp regen', linhCan: 'KIM', satThuong: 0, effect: 'buff_hp_regen', effectVal: 10, thoiGianBuff: 6, mpTieuHao: 5, hoiChieu: 2 };
  const harness = makeHarness({
    player: makePlayer({ hp: 50, maxHp: 100, learnedSkills: ['HPREGEN'], equippedSkills: ['HPREGEN'] }),
    skills: [skill],
  });
  t.after(() => harness.gameplay.close());
  const actions = [];
  const original = harness.store.updateVitals;
  harness.store.updateVitals = async (...args) => { actions.push(args[2]); return original.apply(harness.store, args); };
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_hpregen_1', 'world.join');
  await send(harness.gameplay, socket, 'cast_hpregen_1', 'combat.skill', { skillCode: 'HPREGEN' });

  assert.ok(await waitFor(() => harness.current.hp >= 60, { timeoutMs: 3000 }), `hp stayed at ${harness.current.hp}`);
  assert.ok(actions.includes('BUFF_REGEN'));
  assert.ok(harness.current.hp <= 100);
});

test('buff_vitals spreads its total over the buff duration for both HP and MP', async (t) => {
  // 20% of max over 4 seconds = 5% per second: +5 HP of 100 and +2.5 MP of 50 (plus 1 MP natural regen).
  const skill = { code: 'VITALS', name: 'Vitals', linhCan: 'KIM', satThuong: 0, effect: 'buff_vitals', effectVal: 20, thoiGianBuff: 4, mpTieuHao: 0, hoiChieu: 2 };
  const harness = makeHarness({
    player: makePlayer({ hp: 50, maxHp: 100, mp: 10, maxMp: 50, learnedSkills: ['VITALS'], equippedSkills: ['VITALS'] }),
    skills: [skill],
  });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_vitals_01', 'world.join');
  await send(harness.gameplay, socket, 'cast_vitals_01', 'combat.skill', { skillCode: 'VITALS' });

  assert.ok(await waitFor(() => harness.current.hp >= 55, { timeoutMs: 3000 }), `hp stayed at ${harness.current.hp}`);
  assert.ok(harness.current.hp < 60, 'a single tick must not apply the whole buff');
  assert.ok(harness.current.mp >= 13, `mp was ${harness.current.mp}`);
});

test('a dead player cannot act and is never regenerated back to life', async (t) => {
  const { harness, socket } = await startFight(t, {
    monster: mob({ atk: 10000 }),
    // 1 MP short of full so a living player would be regenerated (and written) on the very first tick.
    player: { hp: 1, maxHp: 100, mp: 49, maxMp: 50 },
  });
  assert.ok(await waitFor(() => harness.current.hp === 0, { timeoutMs: 4000 }), 'the lethal monster should kill the player');
  const hit = firstMonsterHit(harness).payload;
  assert.equal(hit.dead, true);
  assert.equal(hit.hp, 0);

  await assert.rejects(send(harness.gameplay, socket, 'dead_attack_01', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field' }), { code: 'PLAYER_DEAD' });
  await assert.rejects(send(harness.gameplay, socket, 'dead_move_01', 'movement.intent', { x: 3, y: 3 }), { code: 'PLAYER_DEAD' });

  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.equal(harness.current.hp, 0, 'regeneration must not revive the player');
  assert.equal([...harness.store.vitals.keys()].filter((key) => key.startsWith('user_test:regen_')).length, 0, 'no regen mutation for a dead player');
});

test('deriveStats and describeEquipment support both maxHp/maxMp and legacy maxHP/maxMP', () => {
  const derived = deriveStats(
    { str: 5, agi: 5, vit: 5, ene: 5 },
    {
      armor: { stats: { maxHp: 65, maxMp: 30 } },
      hat: { stats: { maxHP: 20, maxMP: 10 } },
    },
  );
  assert.equal(derived.maxHp, 245);
  assert.equal(derived.maxMp, 130);

  const camelInfo = describeEquipment({ stats: { maxHp: 70, maxMp: 25, crit: 2 } });
  assert.equal(camelInfo.bonuses.maxHp, 70);
  assert.equal(camelInfo.bonuses.maxMp, 25);
  assert.equal(camelInfo.ratingOnly.maxHp, undefined);
  assert.equal(camelInfo.ratingOnly.maxMp, undefined);
  assert.equal(camelInfo.ratingOnly.crit, 2);

  const legacyInfo = describeEquipment({ stats: { maxHP: 40, maxMP: 15 } });
  assert.equal(legacyInfo.bonuses.maxHp, 40);
  assert.equal(legacyInfo.bonuses.maxMp, 15);
  assert.equal(legacyInfo.ratingOnly.maxHP, undefined);
  assert.equal(legacyInfo.ratingOnly.maxMP, undefined);
});

test('effective maxHp/maxMp from equipment and passives synchronize on join, shield, and heal', async (t) => {
  const equipment = { armor: { stats: { maxHp: 60, maxMp: 40 } } };
  const stats = { str: 5, agi: 5, vit: 5, ene: 5 };
  const derivedStats = deriveStats(stats, equipment);
  const vitalsPassive = {
    code: 'P_VITALS',
    name: 'Vitals Passive',
    category: 'PASSIVE',
    linhCan: 'MOC',
    passiveModifiers: { maxHpPct: 0.1, maxMpPct: 0.2 },
  };
  const healSkill = {
    code: 'MOC_HEAL',
    name: 'Heal',
    linhCan: 'MOC',
    satThuong: 0,
    effect: 'heal',
    effectVal: 100,
    thoiGianBuff: 0,
    mpTieuHao: 5,
    hoiChieu: 1,
  };
  const harness = makeHarness({
    player: makePlayer({
      linhCan: 'MOC',
      stats,
      equipment,
      derivedStats,
      hp: 190,
      maxHp: 160,
      mp: 90,
      maxMp: 90,
      learnedSkills: ['P_VITALS', 'SHIELD', 'MOC_HEAL'],
      equippedSkills: ['SHIELD', 'MOC_HEAL'],
    }),
    skills: [vitalsPassive, { ...shieldSkill, linhCan: 'MOC' }, healSkill],
  });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  const joined = await send(harness.gameplay, socket, 'join_effective_01', 'world.join');
  assert.equal(joined.result.player.maxHp, 242);
  assert.equal(joined.result.player.maxMp, 156);

  const shieldCast = await send(harness.gameplay, socket, 'cast_shield_eff_01', 'combat.skill', { skillCode: 'SHIELD' });
  assert.equal(shieldCast.result.buffs.shield.absorb, 36);
  assert.equal(shieldCast.result.maxHp, 242);
  assert.equal(shieldCast.result.maxMp, 156);

  const healCast = await send(harness.gameplay, socket, 'cast_heal_eff_01', 'combat.skill', { skillCode: 'MOC_HEAL' });
  assert.equal(healCast.result.hp, 242);
  assert.equal(healCast.result.maxHp, 242);
});

test('passive hpRegenPct regenerates HP naturally without buff_hp_regen', async (t) => {
  const regenPassive = {
    code: 'P_HP_REGEN',
    name: 'HP Regen Passive',
    category: 'PASSIVE',
    linhCan: 'MOC',
    passiveModifiers: { hpRegenPct: 0.05 },
  };
  const harness = makeHarness({
    player: makePlayer({
      linhCan: 'MOC',
      hp: 80,
      maxHp: 100,
      mp: 50,
      maxMp: 50,
      learnedSkills: ['P_HP_REGEN'],
    }),
    skills: [regenPassive],
  });
  t.after(() => harness.gameplay.close());
  const socket = fakeSocket();
  await send(harness.gameplay, socket, 'join_passive_hpregen', 'world.join');
  assert.ok(await waitFor(() => harness.current.hp >= 85));
  const actions = [...harness.store.vitals.keys()]
    .filter((key) => key.startsWith('user_test:regen_'))
    .map(() => 'ok');
  assert.ok(actions.length >= 1);
});

test('passive speedPct raises movement speed budget', async (t) => {
  const wideMap = () => {
    const map = makeMap('field');
    map.w = 60;
    map.h = 10;
    map.jsonMap = Array.from({ length: 10 }, () => Array(60).fill(0));
    return map;
  };
  const speedPassive = {
    code: 'P_SPEED',
    name: 'Speed Passive',
    category: 'PASSIVE',
    linhCan: 'PHONG',
    passiveModifiers: { speedPct: 0.5 },
  };

  const baseHarness = makeHarness({ maps: [['field', wideMap()]], player: makePlayer({ linhCan: 'PHONG' }) });
  t.after(() => baseHarness.gameplay.close());
  const baseSocket = fakeSocket();
  await send(baseHarness.gameplay, baseSocket, 'join_spd_base', 'world.join');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const baseMove = await send(baseHarness.gameplay, baseSocket, 'move_spd_base', 'movement.intent', { x: 26.5, y: 1.5 });
  assert.equal(baseMove.result.corrected, true);

  const fastHarness = makeHarness({
    maps: [['field', wideMap()]],
    player: makePlayer({ linhCan: 'PHONG', learnedSkills: ['P_SPEED'] }),
    skills: [speedPassive],
  });
  t.after(() => fastHarness.gameplay.close());
  const fastSocket = fakeSocket();
  await send(fastHarness.gameplay, fastSocket, 'join_spd_fast', 'world.join');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const fastMove = await send(fastHarness.gameplay, fastSocket, 'move_spd_fast', 'movement.intent', { x: 26.5, y: 1.5 });
  assert.equal(fastMove.result.corrected, false);
  assert.equal(fastMove.result.x, 26.5);
});

test('monster debuffs are resisted by passive resistPct and slow reduces movement speed', async (t) => {
  const resistPassive = {
    code: 'P_RESIST',
    name: 'Resist Passive',
    category: 'PASSIVE',
    linhCan: 'QUANG',
    passiveModifiers: { resistPct: 1 },
  };
  const burnMob = mob({ atk: 10, debuff: { type: 'burn', value: 5, durationMs: 4000, chance: 1 } });
  const { harness: resistHarness, socket: resistSocket } = await startFight(t, {
    monster: burnMob,
    player: { linhCan: 'QUANG', hp: 500, maxHp: 500, learnedSkills: ['P_RESIST'] },
    skills: [resistPassive],
  });
  assert.ok(await waitFor(() => Boolean(firstMonsterHit(resistHarness))));
  const resistedHit = firstMonsterHit(resistHarness).payload;
  assert.equal(resistedHit.appliedDebuff?.resisted, true);
  assert.deepEqual(resistHarness.gameplay.runtime.getPlayer('field', resistSocket.id).debuffs, {});

  const wide = makeMap('field', {
    monsters: [mob({ atk: 10, debuff: { type: 'slow', value: 60, durationMs: 6000, chance: 1 } })],
    monsterSpawns: [{ packId: 'PACK', templateId: 'MOB', centerX: 1.5, centerY: 1.5, count: 1, radius: 1, aggroRange: 20 }],
  });
  wide.w = 60;
  wide.h = 10;
  wide.jsonMap = Array.from({ length: 10 }, () => Array(60).fill(0));
  const slowHarness = makeHarness({
    maps: [['field', wide]],
    player: makePlayer({ linhCan: 'QUANG', hp: 500, maxHp: 500 }),
  });
  t.after(() => slowHarness.gameplay.close());
  const slowSocket = fakeSocket();
  await send(slowHarness.gameplay, slowSocket, 'join_slow_01', 'world.join');
  assert.ok(await waitFor(() => Boolean(firstMonsterHit(slowHarness))));
  assert.ok(slowHarness.gameplay.runtime.getPlayer('field', slowSocket.id).debuffs.slow);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const slowedMove = await send(slowHarness.gameplay, slowSocket, 'move_slow_01', 'movement.intent', { x: 16.5, y: 1.5 });
  assert.equal(slowedMove.result.corrected, true);
});

test('cleanse clears player debuffs via both castSkill (THANH_TAM) and combatAttack (NHAT_DIEM)', async (t) => {
  const thanhTam = { code: 'THANH_TAM', name: 'Thanh Tâm', linhCan: 'QUANG', satThuong: 0, effect: 'cleanse', effectVal: 1, thoiGianBuff: 0, mpTieuHao: 5, hoiChieu: 1 };
  const nhatDiem = { code: 'NHAT_DIEM', name: 'Nhất Diện Quang', linhCan: 'QUANG', satThuong: 1.4, range: 6, effect: 'cleanse', effectVal: 1, thoiGianBuff: 0, mpTieuHao: 5, hoiChieu: 1 };

  const { harness, socket } = await startFight(t, {
    monster: mob({ atk: 10, debuff: { type: 'burn', value: 5, durationMs: 8000, chance: 1 } }),
    player: { linhCan: 'QUANG', hp: 500, maxHp: 500, learnedSkills: ['THANH_TAM', 'NHAT_DIEM'], equippedSkills: ['THANH_TAM', 'NHAT_DIEM'] },
    skills: [thanhTam, nhatDiem],
  });
  assert.ok(await waitFor(() => Boolean(firstMonsterHit(harness))));
  const session = harness.gameplay.runtime.getPlayer('field', socket.id);
  assert.ok(session.debuffs.burn, 'monster should apply burn debuff');

  const skillCleanse = await send(harness.gameplay, socket, 'cast_cleanse_01', 'combat.skill', { skillCode: 'THANH_TAM' });
  assert.deepEqual(skillCleanse.result.cleansed, ['burn']);
  assert.deepEqual(skillCleanse.result.debuffs, {});
  assert.deepEqual(session.debuffs, {});

  session.debuffs.curse = { type: 'curse', value: 20, expiresAt: Date.now() + 8000 };
  const attackCleanse = await send(harness.gameplay, socket, 'attack_cleanse_01', 'combat.attack', { targetId: 'PACK_0', mapCode: 'field', skillCode: 'NHAT_DIEM' });
  assert.ok(attackCleanse.result.hits[0].damage >= 1);
  assert.deepEqual(attackCleanse.result.cleansed, ['curse']);
  assert.deepEqual(attackCleanse.result.debuffs, {});
  assert.deepEqual(session.debuffs, {});
});
