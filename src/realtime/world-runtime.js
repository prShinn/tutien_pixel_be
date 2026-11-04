const crypto = require('node:crypto');

function createWorldRuntime({ world }) {
  const rooms = new Map();

  function makeMonster(definition, id, x, y, pack = {}) {
    const maxHp = Math.max(1, Number(definition.maxHp || definition.hp || 1));
    return {
      ...structuredClone(definition),
      id,
      templateId: definition.code || definition.id,
      x,
      y,
      spawnX: x,
      spawnY: y,
      packId: pack.packId || null,
      packCenterX: pack.packCenterX ?? x,
      packCenterY: pack.packCenterY ?? y,
      aggroRange: Number(pack.aggroRange || definition.aggroRange || 40),
      leashDistance: Number(pack.leashDistance || definition.leashDistance || 72),
      chaseDurationMs: Number(pack.chaseDurationMs || definition.chaseDurationMs || 8000),
      nextAttackAt: 0,
      hp: maxHp,
      maxHp,
      state: 'idle',
      targetId: null,
      dead: false,
      respawnAt: 0,
    };
  }

  function monstersFor(map) {
    if (String(map.type || '').toUpperCase() === 'CITY' || map.rules?.noMonsters) return [];
    const definitions = map.monsters || [];
    const monsters = [];
    if (Array.isArray(map.monsterSpawns) && map.monsterSpawns.length) {
      for (const pack of map.monsterSpawns) {
        const definition = definitions.find((entry) => entry.id === pack.templateId || entry.code === pack.templateId)
          || definitions[0] || pack;
        const count = Math.max(3, Math.min(5, Number(pack.count || 4)));
        const radius = Number(pack.radius || 24);
        const centerX = Number(pack.centerX || map.w / 2);
        const centerY = Number(pack.centerY || map.h / 2);
        for (let index = 0; index < count; index += 1) {
          const angle = (index / count) * Math.PI * 2;
          const distance = radius * (0.35 + 0.55 * (index % 2));
          const x = Math.round(centerX + Math.cos(angle) * distance);
          const y = Math.round(centerY + Math.sin(angle) * distance);
          monsters.push(makeMonster(definition, `${pack.packId || 'pack'}_${index}`, x, y, {
            packId: pack.packId,
            packCenterX: centerX,
            packCenterY: centerY,
            aggroRange: pack.aggroRange,
            leashDistance: pack.leashDistance,
            chaseDurationMs: pack.chaseDurationMs,
          }));
        }
      }
      return monsters;
    }

    let monsterIndex = 0;
    for (const definition of definitions) {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2;
        const distance = 24 * (0.35 + 0.55 * (index % 2));
        const centerX = Number(definition.spawnX || Math.floor(map.w / 2));
        const centerY = Number(definition.spawnY || Math.floor(map.h / 2));
        const x = Math.round(centerX + Math.cos(angle) * distance);
        const y = Math.round(centerY + Math.sin(angle) * distance);
        monsters.push(makeMonster(definition, `mon_${map.code}_${monsterIndex}_${index}`, x, y, {
          packId: `PACK_${definition.code || definition.id || monsterIndex}`,
          packCenterX: centerX,
          packCenterY: centerY,
        }));
      }
      monsterIndex += 1;
    }
    return monsters;
  }

  function roomFor(mapCode) {
    let room = rooms.get(mapCode);
    const map = world.getByCode(mapCode);
    if (!map) return null;
    if (room && room.mapVersion === Number(map.version || 0)) return room;
    room = {
      mapCode,
      mapVersion: Number(map.version || 0),
      players: new Map(),
      monsters: new Map(monstersFor(map).map((monster) => [monster.id, monster])),
      groundItems: new Map(),
    };
    rooms.set(mapCode, room);
    return room;
  }

  function refreshMonsters(room) {
    const now = Date.now();
    const respawned = [];
    for (const monster of room.monsters.values()) {
      if (monster.dead && monster.respawnAt && monster.respawnAt <= now) {
        monster.dead = false;
        monster.hp = monster.maxHp;
        monster.x = monster.spawnX;
        monster.y = monster.spawnY;
        monster.state = 'idle';
        monster.targetId = null;
        monster.respawnAt = 0;
        respawned.push(publicMonster(monster));
      }
    }
    return respawned;
  }

  function publicMonster(monster) {
    const { respawnAt, ...dto } = monster;
    return { ...dto, respawnAt: undefined };
  }

  return {
    getRoom: roomFor,
    enter(mapCode, player, socketId) {
      const room = roomFor(mapCode);
      if (!room) return null;
      const session = {
        ...player,
        id: socketId,
        playerId: player.id,
        socketId,
        mapCode,
        movementBudget: 2.2,
        lastMovementAt: Date.now(),
        lastPersistAt: 0,
        persistPromise: Promise.resolve(),
        cooldowns: player.cooldowns instanceof Map ? player.cooldowns : new Map(),
        buffs: player.buffs && typeof player.buffs === 'object' ? player.buffs : {},
        portalLockId: null,
      };
      room.players.set(socketId, session);
      refreshMonsters(room);
      return { room, session };
    },
    leave(mapCode, socketId) {
      const room = rooms.get(mapCode);
      if (!room) return null;
      const player = room.players.get(socketId) || null;
      room.players.delete(socketId);
      return { room, player };
    },
    getPlayer(mapCode, socketId) { return rooms.get(mapCode)?.players.get(socketId) || null; },
    updatePlayer(mapCode, socketId, patch) {
      const room = rooms.get(mapCode);
      const player = room?.players.get(socketId);
      if (!player) return null;
      Object.assign(player, patch);
      return player;
    },
    listPlayers(mapCode) { return [...(rooms.get(mapCode)?.players.values() || [])]; },
    listMonsters(mapCode) {
      const room = roomFor(mapCode);
      if (!room) return [];
      refreshMonsters(room);
      return [...room.monsters.values()].map(publicMonster);
    },
    refreshAll() {
      const changes = [];
      for (const room of rooms.values()) {
        for (const monster of refreshMonsters(room)) changes.push({ mapCode: room.mapCode, monster });
      }
      return changes;
    },
    activeRooms() { return [...rooms.values()]; },
    getMonster(mapCode, monsterId) {
      const room = rooms.get(mapCode);
      if (!room) return null;
      refreshMonsters(room);
      return room.monsters.get(monsterId) || null;
    },
    damageMonster(mapCode, monsterId, damage) {
      const monster = this.getMonster(mapCode, monsterId);
      if (!monster || monster.dead) return null;
      monster.hp = Math.max(0, monster.hp - damage);
      monster.dead = monster.hp <= 0;
      monster.state = monster.dead ? 'dead' : 'hit';
      if (monster.dead) {
        monster.respawnAt = Date.now() + Math.max(1000, Number(monster.respawnMs || 10000));
        monster.targetId = null;
      }
      return publicMonster(monster);
    },
    addDrop(mapCode, drop) {
      const room = roomFor(mapCode);
      if (!room) return null;
      const item = { ...drop, id: drop.id || `drop_${crypto.randomUUID()}` };
      room.groundItems.set(item.id, item);
      return item;
    },
    getDrop(mapCode, dropId) { return rooms.get(mapCode)?.groundItems.get(dropId) || null; },
    removeDrop(mapCode, dropId) { return rooms.get(mapCode)?.groundItems.delete(dropId) || false; },
    listDrops(mapCode) {
      const room = rooms.get(mapCode);
      if (!room) return [];
      const now = Date.now();
      for (const [id, drop] of room.groundItems) if (drop.expiresAt <= now) room.groundItems.delete(id);
      return [...room.groundItems.values()];
    },
  };
}

module.exports = { createWorldRuntime };
