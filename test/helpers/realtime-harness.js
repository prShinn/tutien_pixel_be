const { DomainError } = require('../../src/domain');
const { createGameplayService } = require('../../src/realtime/gameplay-service');

function makeMap(code, options = {}) {
  const jsonMap = Array.from({ length: 10 }, () => Array(10).fill(0));
  if (options.blocked) jsonMap[1][3] = 2;
  return {
    id: code,
    code,
    tenMap: code,
    type: 'PLAIN',
    status: 'PUBLISHED',
    version: 1,
    w: 10,
    h: 10,
    spawnX: 5,
    spawnY: 5,
    jsonMap,
    portals: options.portals || [],
    monsters: options.monsters || [],
    monsterSpawns: options.monsterSpawns || [],
  };
}

function makePlayer(overrides = {}) {
  return {
    id: 'plr_test',
    userId: 'user_test',
    name: 'Tester',
    gender: 'MALE',
    linhCan: 'KIM',
    realmCode: 'LUYEN_THE',
    realmStage: 1,
    mapCode: 'field',
    x: 1.5,
    y: 1.5,
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    positionVersion: 1,
    xu: 50,
    stats: { str: 10, agi: 5, vit: 5, ene: 5 },
    derivedStats: { pAtk: 50, mAtk: 30, pDef: 15, mDef: 10, crit: 0, evasion: 0 },
    equipment: {},
    learnedSkills: [],
    equippedSkills: [],
    inventory: [],
    ...overrides,
  };
}

function fakeSocket(id = 'socket_test') {
  const handlers = new Map();
  const events = [];
  return {
    id,
    auth: { sub: 'user_test', username: 'tester', role: 'PLAYER' },
    data: {},
    events,
    handlers,
    handshake: { auth: { token: 'valid' } },
    on(name, callback) { handlers.set(name, callback); },
    emit(name, payload) { events.push({ name, payload }); },
    to(room) { return { emit(name, payload) { events.push({ name, payload, room, except: id }); } }; },
    async join(room) { this.data.joinedRoom = room; },
    leave(room) { if (this.data.joinedRoom === room) this.data.joinedRoom = null; },
  };
}

function makeHarness({ player = makePlayer(), maps, skills = [], lootTables = {}, items = [] } = {}) {
  const current = structuredClone(player);
  const mapsByCode = new Map(maps || [['field', makeMap('field')], ['target', makeMap('target')]]);
  const broadcastEvents = [];
  const io = { to(room) { return { emit(name, payload) { broadcastEvents.push({ room, name, payload }); } }; } };
  const store = {
    saves: [],
    pickups: new Set(),
    vitals: new Map(),
    positionCompareCount: 0,
    stalePositionCompareAt: 0,
    async savePlayerPosition(userId, mapCode, x, y, options = {}) {
      if (options.expectedPosition) {
        this.positionCompareCount += 1;
        if (this.positionCompareCount === this.stalePositionCompareAt) {
          current.hp = 0;
          current.positionVersion += 1;
        }
        if (current.hp <= 0 || Number(options.expectedPosition.positionVersion) !== Number(current.positionVersion)) {
          return { saved: false, stale: true };
        }
      }
      current.positionVersion += 1;
      Object.assign(current, { mapCode, x, y });
      this.saves.push({ userId, mapCode, x, y });
      return options.includeSnapshot === false
        ? { saved: true, mapCode, x, y, positionVersion: current.positionVersion }
        : structuredClone(current);
    },
    async updateVitals(userId, requestId, action, changes) {
      const existing = this.vitals.get(`${userId}:${requestId}`);
      if (existing) return structuredClone(existing);
      const capMaxHp = Number.isFinite(Number(changes.maxHp)) && Number(changes.maxHp) > 0
        ? Math.floor(Number(changes.maxHp))
        : current.maxHp;
      const capMaxMp = changes.maxMp !== null && changes.maxMp !== undefined
        && Number.isFinite(Number(changes.maxMp)) && Number(changes.maxMp) >= 0
        ? Math.floor(Number(changes.maxMp))
        : current.maxMp;
      current.hp = Math.max(0, Math.min(capMaxHp, current.hp + Number(changes.hp || 0)));
      current.mp = Math.max(0, Math.min(capMaxMp, current.mp - Number(changes.mpCost || 0) + Number(changes.mp || 0)));
      const result = { player: structuredClone(current), result: { hp: current.hp, maxHp: capMaxHp, mp: current.mp, maxMp: capMaxMp } };
      this.vitals.set(`${userId}:${requestId}`, result);
      return structuredClone(result);
    },
    async pickupGroundItem(userId, requestId, dropId, itemCode, quantity) {
      if (this.pickups.has(dropId)) throw new DomainError('LOOT_ALREADY_CLAIMED', 'Already claimed', 409);
      this.pickups.add(dropId);
      const entry = current.inventory.find((item) => item.itemCode === itemCode);
      if (entry) entry.count += quantity;
      else current.inventory.push({ id: itemCode, itemCode, count: quantity, quantity, slot: current.inventory.length });
      return { player: structuredClone(current), result: { accepted: true, dropId, itemCode, quantity } };
    },
  };
  const players = {
    async snapshot() { return structuredClone(current); },
    decorate(value) { return structuredClone(value); },
  };
  let monsterCatalog = [];
  let monsterCatalogRevision = 0;
  const catalog = {
    listItems: () => structuredClone(items),
    listSkills: () => structuredClone(skills),
    listMonsters: () => structuredClone(monsterCatalog),
    getMonsterRevision: () => monsterCatalogRevision,
    getLootTableById: (id) => structuredClone(lootTables[id] || []),
  };
  const quests = { async applyEvent() { return { changed: false, revision: 0, quests: [] }; } };
  const world = {
    getByCode: (code) => mapsByCode.get(code) || null,
    getDefault: () => [...mapsByCode.values()][0] || null,
  };
  const gameplay = createGameplayService({ io, auth: {}, players, store, catalog, world, quests });
  return { gameplay, io, store, current, players, mapsByCode, broadcastEvents, quests,
    setMonsterCatalog(records) { monsterCatalog = structuredClone(records); monsterCatalogRevision += 1; } };
}

async function send(gameplay, socket, requestId, type, payload = {}) {
  return gameplay.command(socket, { requestId, type, payload });
}

module.exports = { makeMap, makePlayer, fakeSocket, makeHarness, send };
