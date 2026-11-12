const crypto = require('node:crypto');
const { DomainError } = require('../domain');
const { validateRequestId } = require('../inventory/inventory-service');
const { BALANCE, deriveStats, resolveEquipmentModifiers, resolvePassiveModifiers, effectiveMaxVitals, mitigateDamage, affinityProfile, affinityCritBonus, elementalStrength } = require('../data/balance');
const { createWorldRuntime } = require('./world-runtime');
const { findMonsterRoute, clearMonsterSegment } = require('./monster-route');
const { autoCommonSkillCode } = require('../skills/skill-loadout');

const BASE_MOVEMENT_SPEED = 44;
const PICKUP_RANGE = 22;
const PORTAL_RANGE = 14;
const BASIC_ATTACK_RANGE = 26;
const SKILL_RANGE_SCALE = 6;
const DROP_TTL_MS = 120000;
const POSITION_PERSIST_INTERVAL_MS = 2000;
const POSITION_PERSIST_RETRY_BASE_MS = 1000;
const POSITION_PERSIST_RETRY_MAX_MS = 30000;
const MONSTER_UPDATE_BATCH_SIZE = 100;
const MAX_AREA_TARGETS = 12;
const MONSTER_EFFECTS = new Set(['armor_break', 'burn', 'curse', 'freeze', 'root', 'slow', 'stun']);
const MONSTER_ELEMENT_DEBUFFS = {
  HOA: { type: 'burn', value: 2, durationMs: 4000, chance: 0.35 },
  MOC: { type: 'poison', value: 2, durationMs: 4000, chance: 0.35 },
  AM: { type: 'curse', value: 15, durationMs: 5000, chance: 0.4 },
  KIM: { type: 'armor_break', value: 15, durationMs: 4000, chance: 0.35 },
  THO: { type: 'slow', value: 25, durationMs: 4000, chance: 0.35 },
  THUY: { type: 'slow', value: 25, durationMs: 4000, chance: 0.35 },
  LOI: { type: 'slow', value: 25, durationMs: 4000, chance: 0.35 },
};

function createGameplayService({ io, auth, players, store, catalog, world, quests, cluster = null }) {
  const runtime = createWorldRuntime({ world, catalog });
  const commandResults = new Map();
  const monsterLocks = new Map();
  const pendingOperations = new Set();
  const burnSources = new WeakMap();
  const monsterRoutes = new WeakMap();
  let stopping = false;
  let lastDropCleanupAt = 0;
  let monsterCatalogRevision = catalog.getMonsterRevision?.();
  const runtimeTimer = setInterval(() => {
    track(runRuntimeTick().catch((error) => {
      process.stderr.write(`${JSON.stringify({ level: 'error', event: 'runtime_tick_failed', code: error?.code || 'INTERNAL_ERROR' })}\n`);
    }));
  }, 500);
  runtimeTimer.unref?.();
  let monsterTickRunning = false;

  async function runRuntimeTick() {
    const now = Date.now();
    const nextMonsterRevision = catalog.getMonsterRevision?.();
    if (nextMonsterRevision !== undefined && nextMonsterRevision !== monsterCatalogRevision) {
      monsterCatalogRevision = nextMonsterRevision;
      broadcastMonsterCatalog();
    }
    if (now - lastDropCleanupAt >= 5000) {
      for (const room of runtime.activeRooms()) {
        if (cluster && !await cluster.owns(room.mapCode)) continue;
        runtime.cleanupExpiredDropsInRoom(room.mapCode, now);
        cluster?.markDirty(room.mapCode);
      }
      lastDropCleanupAt = now;
    }
    for (const room of runtime.activeRooms()) {
      if (cluster && !await cluster.owns(room.mapCode)) continue;
      for (const change of runtime.refreshRoom(room.mapCode)) {
        io.to(roomName(change.mapCode)).emit('monster_spawn', { monster: change.monster });
        cluster?.markDirty(room.mapCode);
      }
    }
    await tickMonsters();
    if (now - lastRegenAt >= 1000) {
      lastRegenAt = now;
      await tickRegen();
    }
  }

  let regenTickRunning = false;
  let lastRegenAt = 0;

  // buff_hp_regen / buff_mp_regen: hồi effectVal% maxHP/MP mỗi giây.
  // buff_vitals: tổng effectVal% maxHP và maxMP, chia đều theo số giây của buff.
  // Hồi MP tự nhiên (BALANCE.regen.mpPctPerSec) cộng thêm cho mọi người chơi còn sống.
  async function tickRegen() {
    if (regenTickRunning) return;
    regenTickRunning = true;
    try {
      for (const room of runtime.activeRooms()) {
        if (cluster && !await cluster.owns(room.mapCode)) continue;
        for (const session of room.players.values()) {
          if (!(Number(session.hp) > 0)) continue;
          const now = Date.now();
          const { passive } = syncEffectiveVitals(session);
          const beforeDebuffKeys = Object.keys(session.debuffs || {});
          const debuffs = currentDebuffs(session, now);
          const debuffsExpired = Object.keys(debuffs).length !== beforeDebuffKeys.length;
          let debuffTicked = false;
          const dotRate = debuffPercent(debuffs, 'burn') + debuffPercent(debuffs, 'poison');
          if (dotRate > 0) {
            const dotDamage = Math.min(
              Math.max(0, Number(session.hp || 0)),
              Math.max(1, Math.round(Number(session.maxHp || 0) * dotRate)),
            );
            if (dotDamage > 0) {
              try {
                const mutation = await store.updateVitals(
                  session.userId,
                  `dot_${crypto.randomUUID()}`,
                  'MONSTER_DEBUFF_DOT',
                  { hp: -dotDamage, maxHp: session.maxHp, maxMp: session.maxMp },
                );
                if (!(Number(session.hp) > 0)) continue;
                session.hp = Number(mutation.result.hp);
                if (Number.isFinite(Number(mutation.result.maxHp))) session.maxHp = Number(mutation.result.maxHp);
                if (Number.isFinite(Number(mutation.result.maxMp))) session.maxMp = Number(mutation.result.maxMp);
                debuffTicked = true;
                if (!(Number(session.hp) > 0)) {
                  session.hp = 0;
                  session.buffs = {};
                  session.debuffs = {};
                  emitPlayerState(session);
                  continue;
                }
              } catch { /* tick sau sẽ thử lại */ }
            }
          }
          const buffs = currentBuffs(session);
          const vitals = buffs.buff_vitals;
          const vitalsPerSecond = vitals ? buffPercent(buffs, 'buff_vitals') / Math.max(1, Number(vitals.durationSec || 1)) : 0;
          const buffHpRate = buffPercent(buffs, 'buff_hp_regen') + vitalsPerSecond;
          const buffMpRate = buffPercent(buffs, 'buff_mp_regen') + vitalsPerSecond;
          const hpRate = buffHpRate + Math.max(0, Number(passive.hpRegenPct || 0));
          const buffActive = buffHpRate > 0 || buffMpRate > 0;
          const mpRate = buffMpRate + Math.max(0, Number(BALANCE.regen?.mpPctPerSec) || 0);
          if (hpRate <= 0 && mpRate <= 0) {
            session.regenCarryHp = 0;
            session.regenCarryMp = 0;
            if (debuffsExpired || debuffTicked) emitPlayerState(session);
            continue;
          }
          const hpGain = Math.min(Math.max(0, Number(session.maxHp || 0) - Number(session.hp || 0)),
            Number(session.maxHp || 0) * hpRate + Number(session.regenCarryHp || 0));
          const mpGain = Math.min(Math.max(0, Number(session.maxMp || 0) - Number(session.mp || 0)),
            Number(session.maxMp || 0) * mpRate + Number(session.regenCarryMp || 0));
          const hp = Math.floor(hpGain);
          const mp = Math.floor(mpGain);
          session.regenCarryHp = hpGain - hp;
          session.regenCarryMp = mpGain - mp;
          if (hp <= 0 && mp <= 0) {
            if (debuffsExpired || debuffTicked) emitPlayerState(session);
            continue;
          }
          if (!buffActive && hp <= 0) {
            // Chỉ có hồi MP tự nhiên: gom tới một đợt (hoặc tới khi đầy MP) rồi mới ghi DB.
            const missingMp = Math.max(0, Number(session.maxMp || 0) - Number(session.mp || 0));
            const batch = Math.max(1, Math.ceil(Number(session.maxMp || 0) * (Number(BALANCE.regen?.mpFlushPct) || 0)));
            if (mp < batch && mp < missingMp) {
              session.regenCarryMp = mpGain;
              if (debuffsExpired || debuffTicked) emitPlayerState(session);
              continue;
            }
          }
          try {
            const mutation = await store.updateVitals(
              session.userId,
              `regen_${crypto.randomUUID()}`,
              buffActive ? 'BUFF_REGEN' : 'NATURAL_REGEN',
              { hp, mp, maxHp: session.maxHp, maxMp: session.maxMp },
            );
            if (!(Number(session.hp) > 0)) continue; // chết trong lúc chờ DB: không hồi sinh qua regen
            session.hp = Number(mutation.result.hp);
            session.mp = Number(mutation.result.mp);
            if (Number.isFinite(Number(mutation.result.maxHp))) session.maxHp = Number(mutation.result.maxHp);
            if (Number.isFinite(Number(mutation.result.maxMp))) session.maxMp = Number(mutation.result.maxMp);
            emitPlayerState(session);
          } catch { /* tick sau sẽ thử lại */ }
        }
        cluster?.markDirty(room.mapCode);
      }
    } finally {
      regenTickRunning = false;
    }
  }

  function requirePayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_PAYLOAD', 'Payload phải là object JSON');
    return value;
  }

  function roomName(mapCode) { return mapCode; }
  function track(operation) {
    pendingOperations.add(operation);
    operation.then(() => pendingOperations.delete(operation), () => pendingOperations.delete(operation));
    return operation;
  }
  async function drain() {
    while (pendingOperations.size) await Promise.allSettled([...pendingOperations]);
  }
  function sessionDto(session) {
    const mods = resolveEquipmentModifiers(session.equipment || {});
    return {
      id: session.socketId,
      name: session.name,
      username: session.username,
      x: session.x,
      y: session.y,
      mapCode: session.mapCode,
      hp: session.hp,
      maxHp: session.maxHp,
      glowTier: mods.glowTier || 0,
      enhanceMaxLevel: mods.enhanceMaxLevel || 0,
    };
  }

  function walkable(map, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= Number(map.w) || y >= Number(map.h)) return false;
    return Number(map.jsonMap?.[Math.floor(y)]?.[Math.floor(x)] ?? 0) !== 2;
  }

  function safeSpawn(map, x, y) {
    if (walkable(map, x, y)) return { x, y };
    if (walkable(map, Number(map.spawnX), Number(map.spawnY))) return { x: Number(map.spawnX), y: Number(map.spawnY) };
    for (let radius = 1; radius <= 12; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const candidateX = Math.floor(Number(map.spawnX) + dx) + 0.5;
          const candidateY = Math.floor(Number(map.spawnY) + dy) + 0.5;
          if (walkable(map, candidateX, candidateY)) return { x: candidateX, y: candidateY };
        }
      }
    }
    throw new DomainError('WORLD_NO_WALKABLE_SPAWN', 'Bản đồ không có ô đi được gần điểm hồi sinh', 503);
  }

  async function persistPosition(session, force = false) {
    if (session.positionStale) return;
    const now = Date.now();
    if (!force && now < session.persistRetryAt) return;
    if (!force && now - session.lastPersistAt < POSITION_PERSIST_INTERVAL_MS) return;
    session.lastPersistAt = now;
    const value = { mapCode: session.mapCode, x: session.x, y: session.y };
    session.persistPromise = track(session.persistPromise
      .catch(() => {})
      .then(async () => {
        const expectedPosition = session.persistedPosition || { mapCode: value.mapCode, x: value.x, y: value.y };
        const saved = await store.savePlayerPosition(session.userId, value.mapCode, value.x, value.y, {
          includeSnapshot: false,
          expectedPosition,
        });
        if (saved?.stale) {
          session.positionStale = true;
          return saved;
        }
        session.persistedPosition = { ...value, positionVersion: Number(saved.positionVersion || expectedPosition.positionVersion + 1) };
        return saved;
      }));
    try {
      await session.persistPromise;
      session.persistFailureCount = 0;
      session.persistRetryAt = 0;
    }
    catch (error) {
      session.persistFailureCount = Math.min(Number(session.persistFailureCount || 0) + 1, 6);
      const retryMs = Math.min(POSITION_PERSIST_RETRY_MAX_MS,
        POSITION_PERSIST_RETRY_BASE_MS * (2 ** (session.persistFailureCount - 1)));
      session.persistRetryAt = Date.now() + retryMs;
      process.stderr.write(`${JSON.stringify({ level: 'error', event: 'player_position_persist_failed', retryMs })}\n`);
      throw error;
    }
  }

  function worldInit(session, player) {
    const map = world.getByCode(session.mapCode);
    if (!map) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ không tồn tại hoặc chưa publish', 404);
    const others = runtime.listPlayers(session.mapCode).filter((entry) => entry.socketId !== session.socketId).map(sessionDto);
    return {
      mapCode: session.mapCode,
      mapVersion: Number(map.version || 0),
      player: {
        ...player,
        hp: session.hp,
        maxHp: session.maxHp,
        mp: session.mp,
        maxMp: session.maxMp,
        debuffs: currentDebuffs(session),
        x: session.x,
        y: session.y,
        mapCode: session.mapCode,
        mapId: session.mapCode,
      },
      players: others,
      monsters: runtime.listMonsters(session.mapCode),
      groundItems: runtime.listDrops(session.mapCode),
    };
  }

  function emitWorldInit(socket, session, player) {
    const result = worldInit(session, player);
    socket.emit('world_init', result);
    socket.emit('ground_loot_state', { items: result.groundItems });
    return result;
  }

  async function join(socket, payload, isResync = false) {
    const now = Date.now();
    const existingSession = runtime.getPlayer(socket.data.mapCode, socket.id);
    if (now - Number(socket.data.lastJoinAt || 0) < 250 && Number(existingSession?.hp) > 0) {
      throw new DomainError('COMMAND_RATE_LIMITED', 'Đồng bộ bản đồ quá thường xuyên', 429);
    }
    socket.data.lastJoinAt = now;
    let session = existingSession;
    if (session && isResync && Number(session.hp) > 0) {
      const player = await players.snapshot(socket.auth.sub);
      const map = world.getByCode(session.mapCode);
      if (!map) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ không tồn tại hoặc chưa publish', 404);
      runtime.updatePlayer(session.mapCode, socket.id, {
        ...player,
        userId: socket.auth.sub,
        username: socket.auth.username,
        x: session.x,
        y: session.y,
        mapCode: session.mapCode,
        buffs: session.buffs,
        debuffs: session.debuffs,
        cooldowns: session.cooldowns,
        socketId: socket.id,
      });
      session = runtime.getPlayer(session.mapCode, socket.id);
      syncEffectiveVitals(session, player);
      await socket.join(roomName(session.mapCode));
      return emitWorldInit(socket, session, players.decorate({ ...player, x: session.x, y: session.y, mapCode: session.mapCode }));
    }

    for (const room of runtime.activeRooms()) {
      const previous = [...room.players.values()].find((entry) => entry.userId === socket.auth.sub && entry.socketId !== socket.id);
      if (!previous) continue;
      if (Number(previous.hp) > 0) await persistPosition(previous, true);
      runtime.leave(previous.mapCode, previous.socketId);
      io.to(roomName(previous.mapCode)).emit('player_leave', { id: previous.socketId });
      const previousSocket = io.sockets?.sockets?.get(previous.socketId);
      if (previousSocket) {
        previousSocket.data.mapCode = null;
        previousSocket.emit('server_msg', { text: 'Tài khoản đã kết nối từ một thiết bị khác.' });
        previousSocket.disconnect(true);
      }
    }

    if (session) {
      if (Number(session.hp) > 0) await persistPosition(session, true);
      runtime.leave(session.mapCode, socket.id);
      socket.leave(roomName(session.mapCode));
      socket.to(roomName(session.mapCode)).emit('player_leave', { id: socket.id });
    }

    let player = await players.snapshot(socket.auth.sub);
    const map = world.getByCode(player.mapCode) || world.getDefault();
    if (!map) throw new DomainError('WORLD_NOT_FOUND', 'Chưa có bản đồ published', 503);
    const point = safeSpawn(map, Number(player.x), Number(player.y));
    if (map.code !== player.mapCode || point.x !== Number(player.x) || point.y !== Number(player.y)) {
      player = await store.savePlayerPosition(socket.auth.sub, map.code, point.x, point.y);
      player = players.decorate(player);
    }
    const transferredOnlineState = cluster?.enabled ? await cluster.takeTransfer(socket.id, map.code) : null;
    const restoredOnlineState = transferredOnlineState || runtime.takeOrphanedPlayer(map.code, socket.auth.sub);
    const entered = runtime.enter(map.code, {
      ...player,
      userId: socket.auth.sub,
      username: socket.auth.username,
      x: point.x,
      y: point.y,
      mapCode: map.code,
      buffs: restoredOnlineState?.buffs || {},
      debuffs: restoredOnlineState?.debuffs || {},
      cooldowns: restoredOnlineState?.cooldowns || new Map(),
    }, socket.id);
    if (!entered) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ không tồn tại hoặc chưa publish', 404);
    session = entered.session;
    syncEffectiveVitals(session, player);
    socket.data.mapCode = map.code;
    await socket.join(roomName(map.code));
    const result = emitWorldInit(socket, session, player);
    socket.to(roomName(map.code)).emit('player_join', sessionDto(session));
    return result;
  }

  function requireSession(socket) {
    const session = runtime.getPlayer(socket.data.mapCode, socket.id);
    if (!session) throw new DomainError('WORLD_NOT_JOINED', 'Hãy vào thế giới trước khi gửi thao tác', 409);
    if (Number(session.hp) <= 0) throw new DomainError('PLAYER_DEAD', 'Hãy hồi sinh trước khi tiếp tục thao tác', 409);
    return session;
  }

  function requireAlive(session) {
    if (!(Number(session.hp) > 0)) throw new DomainError('PLAYER_DEAD', 'Nhân vật đã tử vong, hãy hồi sinh trước', 409);
  }

  async function syncPlayerState(session) {
    const fresh = await players.snapshot(session.userId);
    const freshRealm = fresh.canhGioi || catalog.getRealmByCode?.(fresh.realmCode) || null;
    Object.assign(session, {
      name: fresh.name,
      gender: fresh.gender,
      linhCan: fresh.linhCan,
      realmCode: fresh.realmCode,
      realmStage: fresh.realmStage,
      tangTuVi: fresh.realmStage,
      realm: Number(fresh.realm ?? freshRealm?.stt ?? 1),
      canhGioi: freshRealm,
      tenCanhGioi: fresh.tenCanhGioi || freshRealm?.tenCanhGioi || null,
      stats: fresh.stats,
      derivedStats: fresh.derivedStats,
      equipment: fresh.equipment,
      learnedSkills: fresh.learnedSkills,
      equippedSkills: fresh.equippedSkills,
      autoSkill: fresh.autoSkill,
      skills: fresh.skills,
      hp: fresh.hp,
      mp: fresh.mp,
      xu: fresh.xu,
      linhThach: fresh.linhThach,
      inventoryCapacity: fresh.inventoryCapacity,
      tuVi: fresh.tuVi,
      tuViHienTai: fresh.tuViHienTai,
      tuViLenCap: fresh.tuViLenCap,
      tuViLinhCan: fresh.tuViLinhCan,
      unspentStatPoints: fresh.unspentStatPoints,
      combatPower: fresh.combatPower,
      x: session.x,
      y: session.y,
      mapCode: session.mapCode,
    });
    syncEffectiveVitals(session, fresh);
    return session;
  }

  async function movement(socket, payload) {
    const session = requireSession(socket);
    requireAlive(session);
    const map = world.getByCode(session.mapCode);
    const x = payload.x;
    const y = payload.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100000 || Math.abs(y) > 100000) {
      throw new DomainError('INVALID_POSITION', 'Tọa độ không hợp lệ');
    }
    if (payload.mapCode != null && String(payload.mapCode).toLowerCase() !== session.mapCode) {
      socket.emit('movement_corrected', { x: session.x, y: session.y, reason: 'Bản đồ hiện tại không khớp.' });
      return { x: session.x, y: session.y, mapCode: session.mapCode, corrected: true };
    }

    const now = Date.now();
    if (now - session.lastMovementAt < 15) throw new DomainError('COMMAND_RATE_LIMITED', 'Gói di chuyển gửi quá thường xuyên', 429);
    const elapsed = Math.max(0, Math.min(0.5, (now - session.lastMovementAt) / 1000));
    const buffs = currentBuffs(session);
    const debuffs = currentDebuffs(session, now);
    const passive = combatModifiers(session);
    const speedBuff = buffs.buff_spd || buffs.speed;
    const speedBonus = Number(session.stats?.agi || 0) * 0.08;
    const speedPercent = speedBuff && speedBuff.expiresAt > now ? Math.max(0, Number(speedBuff.value || 0)) : 0;
    const slowPenalty = Math.min(0.75, debuffPercent(debuffs, 'slow'));
    const movementSpeed = (BASE_MOVEMENT_SPEED + speedBonus) * Math.max(0.25, 1 + speedPercent / 100 + passive.speedPct - slowPenalty);
    const maxBudget = movementSpeed * 0.45;
    session.movementBudget = Math.min(maxBudget, (session.movementBudget || 0) + elapsed * movementSpeed);
    session.lastMovementAt = now;
    const dx = x - session.x;
    const dy = y - session.y;
    const requestedDistance = Math.hypot(dx, dy);
    const budget = session.movementBudget;
    const burstTolerance = 1.2;
    const clamped = requestedDistance > budget + burstTolerance;
    const distance = clamped ? Math.min(requestedDistance, budget) : requestedDistance;
    const ratio = requestedDistance > 0 ? distance / requestedDistance : 0;
    const targetX = session.x + dx * ratio;
    const targetY = session.y + dy * ratio;
    const steps = Math.max(1, Math.ceil(Math.hypot(targetX - session.x, targetY - session.y) / 0.2));
    let acceptedX = session.x;
    let acceptedY = session.y;
    let blocked = false;
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      const nextX = session.x + (targetX - session.x) * progress;
      const nextY = session.y + (targetY - session.y) * progress;
      if (!walkable(map, nextX, nextY)) { blocked = true; break; }
      acceptedX = nextX;
      acceptedY = nextY;
    }
    const moved = Math.hypot(acceptedX - session.x, acceptedY - session.y);
    session.movementBudget = Math.max(0, budget - moved);
    session.x = acceptedX;
    session.y = acceptedY;
    runtime.updatePlayer(session.mapCode, socket.id, { x: acceptedX, y: acceptedY });

    if (blocked || clamped) socket.emit('movement_corrected', {
      x: acceptedX,
      y: acceptedY,
      reason: blocked ? 'Đường đi bị địa hình chặn.' : 'Tốc độ di chuyển vượt giới hạn.',
    });
    if (moved > 0.01) {
      socket.to(roomName(session.mapCode)).emit('player_move', sessionDto(session));
      void persistPosition(session).catch(() => {});
    }
    return { x: acceptedX, y: acceptedY, mapCode: session.mapCode, corrected: blocked || clamped };
  }

  async function changeMap(socket, payload) {
    let session = requireSession(socket);
    requireAlive(session);
    const source = world.getByCode(session.mapCode);
    if (!source) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ hiện tại không tồn tại hoặc chưa publish', 404);
    const targetCode = typeof payload.mapCode === 'string' ? payload.mapCode.trim().toLowerCase() : '';
    if (!targetCode) throw new DomainError('INVALID_MAP_CODE', 'Mã bản đồ đích không hợp lệ');
    const portal = (source.portals || []).find((entry) => (entry.toMap || entry.denMap) === targetCode
      && Math.hypot(session.x - Number(entry.x), session.y - Number(entry.y)) <= PORTAL_RANGE);
    if (!portal) throw new DomainError('PORTAL_NOT_FOUND_OR_OUT_OF_RANGE', 'Hãy đứng gần cổng hợp lệ để chuyển bản đồ', 409);
    const target = world.getByCode(targetCode);
    if (!target) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ đích không tồn tại hoặc chưa publish', 404);
    const progressionGate = target.code === 'thanh_van_son_coc'
      ? { questId: 'novice-06-forest-herbs', statuses: ['completed'], message: 'Hãy hoàn thành hành trình hái linh thảo ở Rừng Rậm trước.' }
      : target.code === 'bach_van_son'
        ? { questId: 'novice-12-gate-boss', statuses: ['ready', 'completed'], message: 'Cửa ải chưa mở. Hãy đánh bại Trấn Quan Tân Thủ trước.' }
        : null;
    // Điều kiện do Admin cấu hình trên chính portal luôn thắng; luật cứng ở trên chỉ là mặc định cho hai map gốc.
    const gate = portal.requiredQuestId
      ? { questId: portal.requiredQuestId, statuses: ['ready', 'completed'], message: portal.lockedMessage }
      : progressionGate;
    if (gate?.questId) {
      const snapshot = await quests.snapshot(socket.auth.sub);
      const requiredQuest = snapshot.quests.find((entry) => entry.id === gate.questId);
      if (!requiredQuest || !gate.statuses.includes(requiredQuest.status)) {
        throw new DomainError('PORTAL_LOCKED', portal.lockedMessage || gate.message || 'Hoàn thành nhiệm vụ yêu cầu để mở cổng', 409);
      }
    }
    const destination = { x: Number(portal.toX), y: Number(portal.toY) };
    if (!walkable(target, destination.x, destination.y)) throw new DomainError('PORTAL_DESTINATION_BLOCKED', 'Điểm đến của cổng không thể đi được', 409);

    await persistPosition(session, true);
    if (session.positionStale) throw new DomainError('PLAYER_STATE_CHANGED', 'Trạng thái nhân vật vừa thay đổi, hãy đồng bộ lại trước khi chuyển bản đồ', 409);
    const savedPosition = await store.savePlayerPosition(socket.auth.sub, target.code, destination.x, destination.y, {
      expectedPosition: session.persistedPosition,
    });
    if (savedPosition?.stale) {
      session.positionStale = true;
      throw new DomainError('PLAYER_STATE_CHANGED', 'Trạng thái nhân vật vừa thay đổi, hãy đồng bộ lại trước khi chuyển bản đồ', 409);
    }
    const persisted = players.decorate(savedPosition);
    if (cluster?.enabled) await cluster.saveTransfer(socket.id, target.code, { buffs: session.buffs, cooldowns: session.cooldowns });
    const oldCode = session.mapCode;
    const oldRoom = roomName(oldCode);
    runtime.leave(oldCode, socket.id);
    socket.leave(oldRoom);
    socket.to(oldRoom).emit('player_leave', { id: socket.id });
    if (cluster?.enabled) {
      const transferEnvelope = { requestId: `map_${crypto.randomUUID()}`, type: 'world.join', payload: {} };
      const joined = await cluster.executeOnMap(socket, target.code, transferEnvelope, async () => ({
        requestId: transferEnvelope.requestId,
        command: transferEnvelope.type,
        result: await join(socket, {}),
      }));
      return {
        mapCode: target.code,
        x: destination.x,
        y: destination.y,
        mapVersion: target.version,
        player: persisted,
        ...(joined?.result || {}),
      };
    }
    const entered = runtime.enter(target.code, {
      ...persisted,
      userId: socket.auth.sub,
      username: socket.auth.username,
      x: destination.x,
      y: destination.y,
      mapCode: target.code,
      buffs: session.buffs,
      debuffs: session.debuffs,
      cooldowns: session.cooldowns,
    }, socket.id);
    if (!entered) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ đích không tồn tại hoặc chưa publish', 404);
    session = entered.session;
    syncEffectiveVitals(session, persisted);
    socket.data.mapCode = target.code;
    await socket.join(roomName(target.code));
    const result = emitWorldInit(socket, session, persisted);
    socket.to(roomName(target.code)).emit('player_join', sessionDto(session));
    try { await publishQuestEvent(socket, { type: 'map_enter', mapCode: target.code, count: 1 }); }
    catch { /* The map transition is already committed; re-entry can retry quest progress. */ }
    return { mapCode: target.code, x: destination.x, y: destination.y, mapVersion: target.version, player: persisted, ...result };
  }

  async function publishQuestEvent(socket, event) {
    const snapshot = await quests.applyEvent(socket.auth.sub, `evt_${crypto.randomUUID()}`, event);
    if (snapshot.changed) socket.emit('quest_state_update', snapshot);
    return snapshot;
  }

  function moveMonster(map, monster, goal, speed, leash) {
    const canWalk = (x, y) => walkable(map, x, y)
      && Math.hypot(x - monster.spawnX, y - monster.spawnY) <= leash;
    const distance = Math.hypot(goal.x - monster.x, goal.y - monster.y);
    if (distance <= 0.001) return;
    let waypoint = goal;
    const now = Date.now();
    if (!clearMonsterSegment(monster, goal, canWalk)) {
      const goalKey = `${Math.floor(goal.x)}:${Math.floor(goal.y)}`;
      let cached = monsterRoutes.get(monster);
      if (!cached || cached.goalKey !== goalKey || cached.expiresAt <= now) {
        cached = {
          goalKey,
          expiresAt: now + 1500,
          points: findMonsterRoute(monster, goal, canWalk),
        };
        monsterRoutes.set(monster, cached);
      }
      while (cached.points.length && Math.hypot(cached.points[0].x - monster.x, cached.points[0].y - monster.y) <= 0.05) cached.points.shift();
      waypoint = cached.points[0];
      if (!waypoint) return;
    } else {
      monsterRoutes.delete(monster);
    }

    const remaining = Math.hypot(waypoint.x - monster.x, waypoint.y - monster.y);
    if (remaining <= 0.001) return;
    const ratio = Math.min(1, speed / remaining);
    const next = {
      x: monster.x + (waypoint.x - monster.x) * ratio,
      y: monster.y + (waypoint.y - monster.y) * ratio,
    };
    if (clearMonsterSegment(monster, next, canWalk)) {
      monster.x = next.x;
      monster.y = next.y;
    }
  }

  async function tickMonsters() {
    if (monsterTickRunning) return;
    monsterTickRunning = true;
    try {
      const now = Date.now();
      for (const room of runtime.activeRooms()) {
        if (cluster && !await cluster.owns(room.mapCode)) continue;
        const map = world.getByCode(room.mapCode);
        if (!map) continue;
        const movementUpdates = [];
        for (const monster of room.monsters.values()) {
          if (monster.dead) continue;
          const statuses = monster.statusEffects || [];
          monster.statusEffects = statuses.filter((effect) => effect.expiresAt > now);
          if (statuses.length !== monster.statusEffects.length) movementUpdates.push({ ...monster });
          const burn = activeStatus(monster, 'burn', now);
          if (burn && burn.nextTickAt <= now) {
            await withMonsterLock(`combat:${room.mapCode}`, async () => {
              if (monster.dead || activeStatus(monster, 'burn') !== burn) return;
              burn.nextTickAt = Date.now() + 1000;
              const updated = runtime.damageMonster(room.mapCode, monster.id, Math.max(1, Math.floor(burn.value)));
              if (!updated) return;
              io.to(roomName(room.mapCode)).emit('monster_update', { monsters: [updated] });
              const source = burnSources.get(burn);
              if (updated.dead && source) await rewardKill(room.mapCode, monster, source.userId, source.socketId);
            });
          }
          if (monster.dead || activeStatus(monster, 'stun', now) || activeStatus(monster, 'freeze', now)) continue;
          const aggroRange = Number(monster.aggroRange || 40);
          const leash = Number(monster.leashDistance || 72);
          const rooted = activeStatus(monster, 'root', now);
          const slow = activeStatus(monster, 'slow', now);
          const speedMultiplier = slow ? 1 - Math.min(0.75, Math.max(0, slow.value / 100)) : 1;
          const speed = Math.max(0.2, Number(monster.speed || 1) * 0.5) * speedMultiplier;
          let nearestPlayer = null;
          let nearestDistance = Number.POSITIVE_INFINITY;
          for (const player of room.players.values()) {
            const distance = Math.hypot(monster.x - player.x, monster.y - player.y);
            const distanceFromHome = Math.hypot(player.x - monster.spawnX, player.y - monster.spawnY);
            if (player.hp > 0 && distanceFromHome <= leash && distance <= aggroRange && distance < nearestDistance) {
              nearestPlayer = player;
              nearestDistance = distance;
            }
          }
          if (!nearestPlayer) {
            const home = { x: monster.spawnX, y: monster.spawnY };
            const needsReturn = Math.hypot(monster.x - home.x, monster.y - home.y) > 0.05;
            if (needsReturn || monster.targetId || monster.state !== 'idle') {
              monster.targetId = null;
              monster.state = needsReturn ? 'return' : 'idle';
              if (needsReturn && !rooted) moveMonster(map, monster, home, speed, leash);
              movementUpdates.push({ ...monster });
            }
            continue;
          }

          const target = nearestPlayer;
          monster.targetId = target.socketId;
          const attackRange = 18;
          const hasLineOfSight = clearMonsterSegment(monster, target, (x, y) => walkable(map, x, y));
          if (nearestDistance > attackRange || !hasLineOfSight) {
            if (rooted) continue;
            moveMonster(map, monster, target, speed, leash);
            monster.state = 'chase';
            movementUpdates.push({ ...monster });
            continue;
          }
          if (monster.nextAttackAt > now) continue;

          monster.state = 'attack';
          monster.nextAttackAt = now + Math.max(800, 1300 / Math.max(0.5, Number(monster.speed || 1)));
          const { derived, passive } = syncEffectiveVitals(target);
          const miss = Math.random() < Math.max(0, Math.min(0.35, Number(derived.evasion || 0)));
          const magic = String(monster.attackType || '').toUpperCase() === 'MAGIC';
          const attack = magic ? (monster.mAtk ?? monster.atk) : monster.atk;
          // Nguyền rủa: quái bị curse giảm effectVal% lực tấn công (tối đa 75%).
          const curse = activeStatus(monster, 'curse', now);
          const curseFactor = curse ? 1 - Math.min(0.75, Math.max(0, Number(curse.value || 0)) / 100) : 1;
          const rawDamage = Math.max(1, Math.floor((Number(attack || 1) + crypto.randomInt(0, 4)) * curseFactor));
          const buffs = currentBuffs(target);
          const debuffs = currentDebuffs(target, now);
          const armorBreakPenalty = Math.min(0.7, debuffPercent(debuffs, 'armor_break'));
          const defense = (magic ? derived.mDef : derived.pDef) * Math.max(0.2, 1 + buffPercent(buffs, 'buff_def') + passive.defensePct - armorBreakPenalty);
          const rawMitigated = miss ? 0 : Math.ceil(mitigateDamage(rawDamage, defense));
          const exlReduce = Math.min(0.45, Number(derived.exl?.dmgReducePct || 0));
          const mitigated = rawMitigated > 0 ? Math.max(1, Math.ceil(rawMitigated * (1 - exlReduce))) : 0;
          // Khiên hộ thể là lớp hấp thụ (castSkill gán buffs.shield.absorb): đỡ sát thương tới khi cạn hoặc hết giờ.
          const shield = buffs.shield;
          const absorbed = shield ? Math.min(Math.max(0, Math.floor(Number(shield.absorb || 0))), mitigated) : 0;
          const damage = Math.min(Math.max(0, Number(target.hp || 0)), mitigated - absorbed);
          try {
            if (damage > 0) {
              const mutation = await store.updateVitals(
                target.userId,
                `mob_${crypto.randomUUID()}`,
                'MONSTER_ATTACK',
                { hp: -damage, maxHp: target.maxHp, maxMp: target.maxMp },
              );
              target.hp = Number(mutation.result.hp);
            }
            const reflectPct = Math.min(0.35, Number(derived.exl?.reflectPct || 0));
            const reflectDmg = (!miss && damage > 0 && reflectPct > 0 && Number(monster.hp || 0) > 1)
              ? Math.min(Math.max(0, Number(monster.hp) - 1), Math.floor(damage * reflectPct))
              : 0;
            if (reflectDmg > 0) {
              runtime.damageMonster(room.mapCode, monster.id, reflectDmg);
            }
            if (shield && absorbed > 0) {
              shield.absorb = Math.max(0, Number(shield.absorb || 0) - absorbed);
              if (shield.absorb <= 0) delete buffs.shield;
            }
            const died = !(Number(target.hp) > 0);
            let appliedDebuff = null;
            if (died) {
              target.hp = 0;
              target.buffs = {};
              target.debuffs = {};
              monster.targetId = null;
            } else if (!miss) {
              appliedDebuff = applyPlayerDebuff(target, monster, passive, now);
            }
            const dto = { ...monster, x: monster.x, y: monster.y, state: 'attack', targetId: target.socketId };
            io.to(roomName(room.mapCode)).emit('monster_update', { monsters: [dto] });
            io.to(roomName(room.mapCode)).emit('player_combat_result', {
              targetId: target.socketId,
              attackerId: monster.id,
              damage,
              absorbed,
              miss,
              dead: died,
              hp: target.hp,
              maxHp: target.maxHp,
              appliedDebuff,
              debuffs: currentDebuffs(target, now),
            });
            emitPlayerState(target);
          } catch {
            monster.nextAttackAt = Date.now() + 1000;
          }
        }
        for (let offset = 0; offset < movementUpdates.length; offset += MONSTER_UPDATE_BATCH_SIZE) {
          io.to(roomName(room.mapCode)).emit('monster_update', {
            monsters: movementUpdates.slice(offset, offset + MONSTER_UPDATE_BATCH_SIZE),
          });
        }
        cluster?.markDirty(room.mapCode);
      }
    } finally {
      monsterTickRunning = false;
    }
  }

  function currentBuffs(session) {
    const now = Date.now();
    for (const [key, buff] of Object.entries(session.buffs || {})) if (buff.expiresAt <= now) delete session.buffs[key];
    return session.buffs || {};
  }

  function buffPercent(buffs, key) {
    return Math.max(0, Number(buffs[key]?.value || 0)) / 100;
  }

  function currentDebuffs(session, now = Date.now()) {
    if (!session.debuffs || typeof session.debuffs !== 'object') session.debuffs = {};
    for (const [key, debuff] of Object.entries(session.debuffs)) {
      if (!debuff || Number(debuff.expiresAt || 0) <= now) delete session.debuffs[key];
    }
    return session.debuffs;
  }

  function debuffPercent(debuffs, key) {
    return Math.max(0, Number(debuffs?.[key]?.value || 0)) / 100;
  }

  function cleanseSessionDebuffs(session) {
    const removed = Object.keys(currentDebuffs(session));
    session.debuffs = {};
    return removed;
  }

  function emitPlayerState(session, { includeSkills = false } = {}) {
    const mods = resolveEquipmentModifiers(session.equipment || {});
    io.to(session.socketId).emit('player_state_update', {
      hp: session.hp,
      maxHp: session.maxHp,
      mp: session.mp,
      maxMp: session.maxMp,
      buffs: session.buffs,
      debuffs: currentDebuffs(session),
      ...(session.stats !== undefined ? { stats: session.stats } : {}),
      ...(session.derivedStats !== undefined ? { derivedStats: session.derivedStats } : {}),
      ...(includeSkills && Array.isArray(session.learnedSkills) ? { learnedSkills: session.learnedSkills } : {}),
      ...(includeSkills && Array.isArray(session.equippedSkills) ? { equippedSkills: session.equippedSkills } : {}),
      ...(includeSkills && session.autoSkill !== undefined ? { autoSkill: session.autoSkill } : {}),
      ...(includeSkills && Array.isArray(session.skills) ? { skills: session.skills } : {}),
      glowTier: mods.glowTier || 0,
      enhanceMaxLevel: mods.enhanceMaxLevel || 0,
      ...(session.unspentStatPoints !== undefined ? { unspentStatPoints: session.unspentStatPoints } : {}),
      ...(session.xu !== undefined ? { xu: session.xu } : {}),
      ...(session.linhThach !== undefined ? { linhThach: session.linhThach } : {}),
      ...(session.inventoryCapacity !== undefined ? { inventoryCapacity: session.inventoryCapacity } : {}),
      ...(session.tuVi !== undefined ? { tuVi: session.tuVi } : {}),
      ...(session.tuViHienTai !== undefined ? { tuViHienTai: session.tuViHienTai } : {}),
      ...(session.tuViLenCap !== undefined ? { tuViLenCap: session.tuViLenCap } : {}),
      ...(session.tuViLinhCan !== undefined ? { tuViLinhCan: session.tuViLinhCan } : {}),
      ...(session.combatPower !== undefined ? { combatPower: session.combatPower } : {}),
      ...(session.realmCode !== undefined ? { realmCode: session.realmCode } : {}),
      ...(session.realmStage !== undefined ? { realmStage: session.realmStage, tangTuVi: session.realmStage } : {}),
      ...(session.realm !== undefined ? { realm: session.realm } : {}),
      ...(session.canhGioi !== undefined ? { canhGioi: session.canhGioi } : {}),
      ...(session.tenCanhGioi !== undefined ? { tenCanhGioi: session.tenCanhGioi } : {}),
    });
  }

  function combatModifiers(session) {
    return resolvePassiveModifiers(catalog.listSkills(), session.learnedSkills, session.linhCan);
  }

  function syncEffectiveVitals(session, baseSnapshot = null) {
    const derived = session.derivedStats || deriveStats(session.stats || {}, session.equipment || {});
    if (baseSnapshot) {
      session.baseMaxHp = baseSnapshot.maxHp;
      session.baseMaxMp = baseSnapshot.maxMp;
    } else if (session.baseMaxHp == null) {
      session.baseMaxHp = session.maxHp;
      session.baseMaxMp = session.maxMp;
    }
    const passive = combatModifiers(session);
    const effective = effectiveMaxVitals({ maxHp: session.baseMaxHp, maxMp: session.baseMaxMp }, derived, passive);
    session.maxHp = effective.maxHp;
    session.maxMp = effective.maxMp;
    if (Number(session.hp) > session.maxHp) session.hp = session.maxHp;
    if (Number(session.mp) > session.maxMp) session.mp = session.maxMp;
    return { derived, passive, effective };
  }

  function resolveMonsterDebuff(monster) {
    if (monster?.debuff && typeof monster.debuff === 'object' && monster.debuff.type) {
      return {
        type: String(monster.debuff.type).toLowerCase(),
        value: Math.max(0, Number(monster.debuff.value ?? 5)),
        durationMs: Math.max(500, Number(monster.debuff.durationMs ?? 4000)),
        chance: Number(monster.debuff.chance ?? 1),
      };
    }
    if (!['ELITE', 'BOSS'].includes(String(monster?.type || '').toUpperCase())) return null;
    const element = String(
      monster.linhCan || monster.element || (Array.isArray(monster.nguHanh) ? monster.nguHanh[0] : monster.nguHanh) || '',
    ).toUpperCase();
    return MONSTER_ELEMENT_DEBUFFS[element] || null;
  }

  function applyPlayerDebuff(target, monster, passive, now = Date.now()) {
    const spec = resolveMonsterDebuff(monster);
    if (!spec) return null;
    const baseChance = Math.min(1, Math.max(0, Number(spec.chance ?? 0.35)));
    if (baseChance <= 0 || Math.random() >= baseChance) return null;
    const resist = Math.min(1, Math.max(0, Number(passive?.resistPct || 0)));
    if (resist >= 1 || (resist > 0 && Math.random() < resist)) {
      return { type: spec.type, resisted: true };
    }
    const durationMs = Math.max(500, Math.round(Number(spec.durationMs || 4000) * Math.max(0.25, 1 - resist * 0.5)));
    const debuffs = currentDebuffs(target, now);
    debuffs[spec.type] = {
      type: spec.type,
      value: Math.max(0, Number(spec.value || 0)),
      durationMs,
      appliedAt: now,
      expiresAt: now + durationMs,
      sourceId: monster.id,
    };
    return { type: spec.type, value: debuffs[spec.type].value, durationMs, expiresAt: debuffs[spec.type].expiresAt, resisted: false };
  }

  function skillCooldownMs(session, skill, passive) {
    const reduction = Math.min(0.6, passive.cooldownPct + buffPercent(currentBuffs(session), 'buff_cast'));
    return Math.max(500, Math.round(Number(skill.hoiChieu || 0) * 1000 * (1 - reduction)));
  }

  function activeStatus(monster, type, now = Date.now()) {
    return (monster.statusEffects || []).find((effect) => effect.type === type && effect.expiresAt > now);
  }

  function applyMonsterStatus(monster, skill, passive, socket) {
    const type = String(skill?.effect || '').toLowerCase();
    if (!MONSTER_EFFECTS.has(type) || monster.dead) return;
    const now = Date.now();
    const duration = Number(skill.thoiGianBuff ?? 4);
    const value = Number(skill.effectVal || 0);
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(value)) return;
    const effect = {
      type,
      value: Math.max(0, value) * (1 + passive.statusEffectPct),
      expiresAt: now + duration * 1000,
      nextTickAt: now + 1000,
    };
    if (type === 'burn') burnSources.set(effect, { userId: socket.auth.sub, socketId: socket.id });
    monster.statusEffects = (monster.statusEffects || []).filter((entry) => entry.type !== type && entry.expiresAt > now);
    monster.statusEffects.push(effect);
  }

  function cooldown(session, key, duration) {
    const now = Date.now();
    const expiresAt = Number(session.cooldowns.get(key) || 0);
    if (expiresAt > now) throw new DomainError('COOLDOWN_ACTIVE', 'Kỹ năng đang hồi chiêu', 409, { remainingMs: expiresAt - now });
    const claimedUntil = now + duration;
    session.cooldowns.set(key, claimedUntil);
    return () => {
      if (session.cooldowns.get(key) === claimedUntil) session.cooldowns.delete(key);
    };
  }

  function skillByCode(skillCode) {
    const skill = catalog.listSkills().find((entry) => entry.code === skillCode);
    if (!skill) throw new DomainError('SKILL_NOT_FOUND', 'Kỹ năng không tồn tại', 404);
    return skill;
  }

  function requirePlayerSkill(session, skillCode) {
    const skill = skillByCode(skillCode);
    // Ô 1: kỹ năng common hệ thống tự gán theo vũ khí đang cầm, không cần học hay chọn.
    const autoAssigned = skillCode === autoCommonSkillCode(session.equipment, catalog.listSkills());
    if (!autoAssigned) {
      if (skill.linhCan === 'COMMON') throw new DomainError('SKILL_AUTO_ASSIGNED', 'Kỹ năng common chỉ dùng qua ô tự gán theo vũ khí', 409);
      if (skill.linhCan !== session.linhCan) throw new DomainError('SKILL_ROOT_MISMATCH', 'Kỹ năng không thuộc linh căn nhân vật', 403);
      if (!(session.learnedSkills || []).includes(skillCode)) throw new DomainError('SKILL_NOT_LEARNED', 'Nhân vật chưa học kỹ năng này', 409);
      if (!(session.equippedSkills || []).includes(skillCode)) throw new DomainError('SKILL_NOT_EQUIPPED', 'Kỹ năng chưa được trang bị', 409);
    }
    if (Array.isArray(skill.weaponKinds) && skill.weaponKinds.length) {
      const weaponKind = session.equipment?.weapon?.weaponKind || session.equipment?.weapon?.basicAttack?.style;
      if (!weaponKind || !skill.weaponKinds.includes(weaponKind)) {
        throw new DomainError('WEAPON_REQUIRED', 'Kỹ năng yêu cầu trang bị đúng loại vũ khí', 409);
      }
    }
    return skill;
  }

  function rollEquipmentDropTraits(definition, monster) {
    if (String(definition?.type || definition?.loai || '').toUpperCase() !== 'EQUIPMENT') {
      return { rarity: definition?.rarity || 'NORMAL', hasLuck: false, exlOptions: [] };
    }
    const baseRarity = String(definition.rarity || 'NORMAL').toUpperCase();
    const monsterType = String(monster?.type || 'NORMAL').toUpperCase();
    const exlChance = monsterType === 'BOSS' ? 0.35 : monsterType === 'ELITE' ? 0.15 : 0.04;
    const magicChance = monsterType === 'BOSS' ? 0.45 : monsterType === 'ELITE' ? 0.35 : 0.2;
    const luckChance = monsterType === 'BOSS' ? 0.4 : monsterType === 'ELITE' ? 0.28 : 0.15;
    let rarity = baseRarity;
    const rarityRoll = crypto.randomInt(0, 10_000) / 10_000;
    if (baseRarity !== 'ANCIENT') {
      if (baseRarity === 'EXL' || rarityRoll < exlChance) rarity = 'EXL';
      else if (baseRarity === 'MAGIC' || rarityRoll < exlChance + magicChance) rarity = 'MAGIC';
    }
    const hasLuck = Boolean(definition.hasLuck) || (crypto.randomInt(0, 10_000) / 10_000) < luckChance;
    const exlOptions = [];
    if (rarity === 'EXL' || rarity === 'ANCIENT') {
      const equipSlot = String(definition?.slot || '').toLowerCase().replace(/^helmet$/, 'hat');
      const pool = Object.values(BALANCE.exlOptions || {}).filter((opt) =>
        !Array.isArray(opt.slots) || !opt.slots.length || (equipSlot && opt.slots.includes(equipSlot)),
      );
      if (pool.length) {
        const optCount = monsterType === 'BOSS' || rarity === 'ANCIENT' ? 2 : (crypto.randomInt(0, 100) < 30 ? 2 : 1);
        const remaining = [...pool];
        for (let i = 0; i < Math.min(optCount, remaining.length); i += 1) {
          const pickedIdx = crypto.randomInt(0, remaining.length);
          const [picked] = remaining.splice(pickedIdx, 1);
          exlOptions.push({ code: picked.code, label: picked.label, val: picked.val });
        }
      }
    }
    return { rarity, hasLuck, exlOptions };
  }

  function damageFor(session, monster, skill, passive, secondary, basicAttack) {
    const derived = session.derivedStats || deriveStats(session.stats || {}, session.equipment || {});
    const exl = derived.exl || {};
    const magic = String(skill ? skill.type : basicAttack?.damageType).toUpperCase() === 'MAGIC';
    const attack = magic ? derived.mAtk : derived.pAtk;
    const scalingKey = skill?.scalingStat || basicAttack?.scalingStat || (magic ? 'ene' : 'str');
    const scaling = Number(session.stats?.[scalingKey] || 0);
    const buffs = currentBuffs(session);
    const rootDamageBonus = skill?.linhCan === session.linhCan ? passive.skillDamagePct : 0;
    const multiplier = skill ? Math.max(0.1, Number(skill.satThuong || 0)) * (1 + rootDamageBonus) : 1;
    const defense = Math.max(0, Number(monster.def || 0) * 2)
      * (activeStatus(monster, 'armor_break') ? 0.75 : 1)
      * (magic ? 1 : 1 - Math.min(0.75, passive.pDefPenPct))
      * (1 - Math.min(0.5, Number(exl.armorPiercePct || 0)));
    const weaponMultiplier = skill ? 1 : Number(basicAttack?.damageMultiplier || 1);
    const raw = (attack * (skill ? 1.25 : 0.5) + scaling * (skill ? 1.5 : 0.5))
      * multiplier
      * weaponMultiplier
      * (1 + Math.min(0.6, Number(exl.dmgPct || 0)));
    const curseBonus = session.linhCan === 'AM' && activeStatus(monster, 'curse') ? 1.08 : 1;
    const areaMultiplier = secondary ? BALANCE.damage.areaSecondaryMultiplier : 1;
    const attackBuff = 1 + buffPercent(buffs, 'buff_atk');
    const cursePenalty = Math.min(0.6, debuffPercent(currentDebuffs(session), 'curse'));
    // Ngũ hành sinh khắc: linh căn người đánh vs linh căn quái, điều chỉnh theo chênh lệch cường độ (cùng công thức FE balance.js).
    const monsterElement = monster.linhCan || monster.element || (Array.isArray(monster.nguHanh) ? monster.nguHanh[0] : monster.nguHanh);
    const affinity = affinityProfile(session.linhCan, monsterElement, elementalStrength(session), elementalStrength(monster));
    const affinityMultiplier = Number.isFinite(affinity.multiplier) ? affinity.multiplier : 1;
    let damage = Math.floor(mitigateDamage(raw * curseBonus * attackBuff * (1 - cursePenalty) * areaMultiplier * affinityMultiplier, defense));
    const critChance = Number(derived.crit || 0) + buffPercent(buffs, 'buff_crit') + passive.critPct + affinityCritBonus(affinity) + Number(exl.exlCritChance || 0);
    const critical = Math.random() < Math.max(0, Math.min(0.6, critChance));
    if (critical) damage = Math.floor(damage * 1.5);
    return { damage: Math.max(1, damage), critical, affinityRelation: affinity.relation, affinityMultiplier };
  }

  function spawnLoot(mapCode, monster) {
    const table = catalog.getLootTableById(monster.lootTableId);
    const items = catalog.listItems();
    const drops = [];
    for (const entry of table) {
      if (Math.random() > Number(entry.chance || 0)) continue;
      const definition = items.find((item) => item.id === entry.itemId || item.maDo === entry.itemId);
      if (!definition) continue;
      const minimum = Math.max(1, Math.floor(Number(entry.min || 1)));
      const maximum = Math.max(minimum, Math.floor(Number(entry.max || minimum)));
      const count = crypto.randomInt(minimum, maximum + 1);
      const traits = rollEquipmentDropTraits(definition, monster);
      const drop = runtime.addDrop(mapCode, {
        kind: 'item',
        itemCode: definition.id,
        item: { ...definition, id: definition.id, itemCode: definition.id, ...traits },
        count,
        x: monster.x,
        y: monster.y,
        expiresAt: Date.now() + DROP_TTL_MS,
      });
      if (drop) drops.push(drop);
    }
    if (drops.length) io.to(roomName(mapCode)).emit('ground_loot_spawn', { drops });
    return drops;
  }

  async function rewardKill(mapCode, monster, userId, socketId, session = null) {
    io.to(roomName(mapCode)).emit('monster_death', { id: monster.id });
    const drops = spawnLoot(mapCode, monster);
    if (session && Number(session.hp || 0) > 0) {
      const exl = session.derivedStats?.exl || {};
      const hpGain = Math.floor(Number(session.maxHp || 100) * Math.min(0.25, Number(exl.hpOnKillPct || 0)));
      const mpGain = Math.floor(Number(session.maxMp || 50) * Math.min(0.25, Number(exl.mpOnKillPct || 0)));
      if (hpGain > 0 || mpGain > 0) {
        try {
          const mutation = await store.updateVitals(
            userId,
            `kill_${crypto.randomUUID()}`,
            'EXL_KILL_LEECH',
            { hp: hpGain, mp: mpGain, maxHp: session.maxHp, maxMp: session.maxMp },
          );
          session.hp = Number(mutation.result.hp);
          session.mp = Number(mutation.result.mp);
          emitPlayerState(session);
        } catch {
          // Best-effort Exl kill leech; loot and quest progression remain authoritative.
        }
      }
    }
    let questState = null;
    try {
      questState = await quests.applyEvent(userId, `evt_${crypto.randomUUID()}`, { type: 'monster_kill', monsterId: monster.templateId, mapCode, count: 1 });
      if (questState.changed) io.to(socketId).emit('quest_state_update', questState);
    } catch { questState = null; }
    return { drops, questState };
  }

  async function withMonsterLock(key, action) {
    const previous = monsterLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const queued = previous.catch(() => {}).then(() => gate);
    monsterLocks.set(key, queued);
    await previous.catch(() => {});
    try { return await action(); }
    finally {
      release();
      if (monsterLocks.get(key) === queued) monsterLocks.delete(key);
    }
  }

  async function combatAttack(socket, payload, requestId) {
    const session = requireSession(socket);
    await syncPlayerState(session);
    if (payload.mapCode != null && String(payload.mapCode).toLowerCase() !== session.mapCode) throw new DomainError('PLAYER_STATE_CHANGED', 'Bản đồ hiện tại không khớp', 409);
    const targetId = typeof payload.targetId === 'string' ? payload.targetId : '';
    if (!targetId || targetId.length > 100) throw new DomainError('INVALID_TARGET', 'Mục tiêu không hợp lệ');
    requireAlive(session);
    const skill = payload.skillCode ? requirePlayerSkill(session, String(payload.skillCode)) : null;
    if (skill && Number(skill.satThuong || 0) <= 0) throw new DomainError('SKILL_REQUIRES_NO_TARGET', 'Kỹ năng này không dùng để tấn công mục tiêu', 409);
    const actionKey = skill ? `skill:${skill.code}` : 'basic';
    const passive = combatModifiers(session);
    const cooldownMs = skill ? skillCooldownMs(session, skill, passive)
      : Number(session.equipment?.weapon?.basicAttack?.cooldownMs || 700);
    const mapCode = session.mapCode;
    return withMonsterLock(`combat:${mapCode}`, async () => {
      if (requireSession(socket) !== session) throw new DomainError('PLAYER_STATE_CHANGED', 'Phiên chơi đã đổi bản đồ', 409);
      const monster = runtime.getMonster(mapCode, targetId);
      if (!monster || monster.dead) throw new DomainError('TARGET_NOT_FOUND', 'Mục tiêu không tồn tại hoặc đã bị hạ', 404);
      const basicAttack = skill ? null : session.equipment?.weapon?.basicAttack;
      const range = skill ? Math.max(1, Number(skill.range || 5)) * SKILL_RANGE_SCALE : (basicAttack?.range ?? BASIC_ATTACK_RANGE);
      if (Math.hypot(monster.x - session.x, monster.y - session.y) > range) throw new DomainError('TARGET_OUT_OF_RANGE', 'Mục tiêu nằm ngoài tầm đánh', 409);
      const needsLineOfSight = skill?.requiresLineOfSight || ['staff', 'spear', 'bow', 'crossbow'].includes(basicAttack?.style);
      const map = needsLineOfSight ? world.getByCode(mapCode) : null;
      if (needsLineOfSight && (!map || !clearMonsterSegment(session, monster, (x, y) => walkable(map, x, y)))) {
        throw new DomainError('TARGET_OBSTRUCTED', 'Có vật cản giữa nhân vật và mục tiêu', 409);
      }
      const releaseCooldown = cooldown(session, actionKey, cooldownMs);

      let mp = Number(session.mp || 0);
      if (skill) {
        const mpCost = Math.max(0, Math.floor(Number(skill.mpTieuHao || 0)));
        try {
          const mutation = await store.updateVitals(
            socket.auth.sub,
            requestId,
            'REALTIME_SKILL_ATTACK',
            { mpCost, maxHp: session.maxHp, maxMp: session.maxMp },
          );
          session.mp = Number(mutation.result.mp);
          session.hp = Number(mutation.result.hp);
          mp = session.mp;
        } catch (error) {
          releaseCooldown();
          throw error;
        }
      }
      const targets = [monster];
      const areaRadius = Number(skill?.dienRong || 0) * SKILL_RANGE_SCALE;
      if (Number.isFinite(areaRadius) && areaRadius > 0) {
        const distance = (candidate) => Math.hypot(candidate.x - monster.x, candidate.y - monster.y);
        const nearby = runtime.listMonsters(mapCode)
          .filter((candidate) => candidate.id !== targetId && !candidate.dead && distance(candidate) <= areaRadius)
          .sort((left, right) => distance(left) - distance(right) || left.id.localeCompare(right.id))
          .slice(0, MAX_AREA_TARGETS - 1);
        for (const candidate of nearby) targets.push(runtime.getMonster(mapCode, candidate.id));
      }

      const hits = [];
      const updates = [];
      const killed = [];
      for (const [index, target] of targets.entries()) {
        if (!target || target.dead) continue;
        const hit = damageFor(session, target, skill, passive, index > 0, basicAttack);
        const updated = runtime.damageMonster(mapCode, target.id, hit.damage);
        if (!updated) continue;
        applyMonsterStatus(target, skill, passive, socket);
        updates.push({ ...updated, statusEffects: target.statusEffects || [] });
        hits.push({ targetId: target.id, ...hit, hp: updated.hp, maxHp: updated.maxHp, dead: updated.dead, miss: false });
        if (updated.dead) killed.push(target);
      }
      const attackEffect = String(skill?.effect || '').toLowerCase();
      const cleansed = attackEffect === 'cleanse' ? cleanseSessionDebuffs(session) : null;
      if (cleansed) emitPlayerState(session);
      const combatPayload = {
        attackerId: socket.id,
        targetId,
        skillCode: skill?.code,
        skillName: skill?.name,
        attackStyle: skill ? undefined : (basicAttack?.style || 'melee'),
        mp,
        cooldownMs,
        gcdMs: 350,
        hits,
        ...(cleansed ? { cleansed, debuffs: {} } : {}),
      };
      io.to(roomName(mapCode)).emit('combat_result', combatPayload);
      io.to(roomName(mapCode)).emit('monster_update', { monsters: updates });
      const drops = [];
      let questState = null;
      for (const target of killed) {
        const reward = await rewardKill(mapCode, target, socket.auth.sub, socket.id, session);
        drops.push(...reward.drops);
        if (reward.questState) questState = reward.questState;
      }
      return { ...combatPayload, drops, questState };
    });
  }

  async function castSkill(socket, payload, requestId) {
    const session = requireSession(socket);
    await syncPlayerState(session);
    const skillCode = typeof payload.skillCode === 'string' ? payload.skillCode.trim() : '';
    const skill = requirePlayerSkill(session, skillCode);
    if (Number(skill.satThuong || 0) > 0) throw new DomainError('SKILL_REQUIRES_TARGET', 'Kỹ năng tấn công cần chọn mục tiêu', 409);
    requireAlive(session);
    const actionKey = `skill:${skill.code}`;
    const passive = combatModifiers(session);
    const cooldownMs = skillCooldownMs(session, skill, passive);
    const mpCost = Math.max(0, Math.floor(Number(skill.mpTieuHao || 0)));
    const effect = String(skill.effect || '').toLowerCase();
    const effectValue = Math.max(0, Number(skill.effectVal || 0));
    const durationMs = Math.max(0, Number(skill.thoiGianBuff || 0) * 1000);
    const before = { hp: session.hp, mp: session.mp };
    const changes = {
      mpCost,
      hp: effect === 'heal' ? effectValue : 0,
      mp: effect === 'restore_mp' ? effectValue : 0,
      maxHp: session.maxHp,
      maxMp: session.maxMp,
    };
    return withMonsterLock(`cooldown:${socket.id}:${actionKey}`, async () => {
      const releaseCooldown = cooldown(session, actionKey, cooldownMs);
      let mutation;
      try { mutation = await store.updateVitals(socket.auth.sub, requestId, 'REALTIME_SKILL_CAST', changes); }
      catch (error) { releaseCooldown(); throw error; }
      session.hp = Number(mutation.result.hp);
      session.mp = Number(mutation.result.mp);
      const buffs = currentBuffs(session);
      const heal = Math.max(0, session.hp - before.hp);
      const mpRestore = Math.max(0, session.mp - (before.mp - mpCost));
      const cleansed = effect === 'cleanse' ? cleanseSessionDebuffs(session) : null;
      if (effect.startsWith('buff_') || ['shield', 'buff_def', 'buff_atk', 'buff_crit', 'buff_spd', 'buff_cast', 'buff_hp_regen', 'buff_mp_regen', 'buff_vitals'].includes(effect)) {
        buffs[effect] = { value: effectValue, expiresAt: Date.now() + durationMs, durationSec: durationMs / 1000 };
        if (effect === 'shield') {
          buffs.shield.absorb = Math.max(1, Math.floor(Number(session.maxHp || 0) * effectValue / 100 * (1 + passive.shieldPct)));
        }
      }
      if (cleansed) emitPlayerState(session);
      const result = {
        skillCode,
        skillName: skill.name,
        effect,
        effectVal: effectValue,
        effectDurationMs: durationMs,
        hp: session.hp,
        maxHp: session.maxHp,
        mp: session.mp,
        maxMp: session.maxMp,
        heal,
        mpRestore,
        buffs: { ...buffs },
        debuffs: { ...currentDebuffs(session) },
        ...(cleansed ? { cleansed } : {}),
        cooldownMs,
        gcdMs: 350,
      };
      socket.emit('skill_result', result);
      socket.to(roomName(session.mapCode)).emit('player_skill_cast', { playerId: socket.id, skillCode, skillName: skill.name, effect });
      return result;
    });
  }

  async function pickup(socket, payload, requestId) {
    const session = requireSession(socket);
    requireAlive(session);
    const dropId = typeof payload.itemId === 'string' ? payload.itemId.trim() : '';
    if (!dropId || dropId.length > 100) throw new DomainError('INVALID_DROP_ID', 'Mã vật phẩm rơi không hợp lệ');
    const drop = runtime.getDrop(session.mapCode, dropId);
    if (!drop || drop.expiresAt <= Date.now()) throw new DomainError('LOOT_NOT_FOUND', 'Vật phẩm rơi không còn tồn tại', 404);
    if (Math.hypot(drop.x - session.x, drop.y - session.y) > PICKUP_RANGE) throw new DomainError('LOOT_OUT_OF_RANGE', 'Vật phẩm rơi nằm ngoài tầm nhặt', 409);
    const dropMeta = drop.item ? {
      rarity: drop.item.rarity,
      hasLuck: Boolean(drop.item.hasLuck),
      exlOptions: Array.isArray(drop.item.exlOptions) ? drop.item.exlOptions : [],
      enhanceLevel: Number(drop.item.enhanceLevel || 0),
    } : {};
    const mutation = await store.pickupGroundItem(socket.auth.sub, requestId, drop.id, drop.itemCode, drop.count, dropMeta);
    const player = players.decorate(mutation.player);
    if (!runtime.removeDrop(session.mapCode, drop.id)) throw new DomainError('LOOT_ALREADY_CLAIMED', 'Vật phẩm rơi đã được nhặt', 409);
    const item = { ...drop, item: { ...drop.item } };
    io.to(roomName(session.mapCode)).emit('ground_loot_removed', { itemId: drop.id });
    socket.emit('ground_loot_picked', { item, player, loot: { items: [{ ...drop.item, count: drop.count }] } });
    let questState = null;
    try { questState = await publishQuestEvent(socket, { type: 'collect_item', itemId: drop.itemCode, mapCode: session.mapCode, count: drop.count }); }
    catch { /* The inventory commit is authoritative even if quest progress needs a retry. */ }
    runtime.updatePlayer(session.mapCode, socket.id, { ...player, x: session.x, y: session.y, mapCode: session.mapCode, buffs: session.buffs, cooldowns: session.cooldowns });
    return { accepted: true, dropId: drop.id, player, questState };
  }

  function sendChat(socket, payload) {
    const session = requireSession(socket);
    if (typeof payload.message !== 'string') throw new DomainError('INVALID_CHAT_MESSAGE', 'Tin nhắn phải là chuỗi văn bản');
    const message = [...payload.message.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 100).join('');
    if (!message) throw new DomainError('INVALID_CHAT_MESSAGE', 'Tin nhắn không được để trống');
    const now = Date.now();
    if (now - Number(session.lastChatAt || 0) < 750) throw new DomainError('CHAT_RATE_LIMITED', 'Bạn gửi tin nhắn quá nhanh', 429);
    session.lastChatAt = now;
    const chat = { id: socket.id, username: session.name || socket.auth.username, message, mapCode: session.mapCode, time: now };
    io.to(roomName(session.mapCode)).emit('chat_message', chat);
    return chat;
  }

  async function dispatch(socket, command, payload, requestId) {
    if (command === 'world.join') return join(socket, payload);
    if (command === 'world.resync') return join(socket, payload, true);
    if (command === 'movement.intent') return movement(socket, payload);
    if (command === 'map.change') return changeMap(socket, payload);
    if (command === 'combat.attack') return combatAttack(socket, payload, requestId);
    if (command === 'combat.skill') return castSkill(socket, payload, requestId);
    if (command === 'loot.pickup') return pickup(socket, payload, requestId);
    if (command === 'chat.send') return sendChat(socket, payload);
    throw new DomainError('INVALID_COMMAND', 'Command không được hỗ trợ');
  }

  async function commandLocal(socket, envelope) {
    if (stopping) throw new DomainError('SERVER_SHUTTING_DOWN', 'Máy chủ đang tắt, hãy kết nối lại sau', 503);
    const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId.trim() : '';
    const commandName = typeof envelope?.type === 'string' ? envelope.type : '';
    validateRequestId(requestId);
    const payload = requirePayload(envelope?.payload ?? {});
    const run = () => dispatch(socket, commandName, payload, requestId);
    const changesSession = ['world.join', 'world.resync', 'map.change', 'combat.attack', 'combat.skill', 'loot.pickup'].includes(commandName);
    const execute = () => track(changesSession ? withMonsterLock(`session:${socket.id}`, run) : run());
    const shouldCache = ['map.change', 'combat.attack', 'combat.skill', 'loot.pickup', 'chat.send'].includes(commandName);
    if (!shouldCache) return { requestId, command: commandName, result: await execute() };

    const cacheKey = `${socket.auth.sub}:${requestId}`;
    const signature = JSON.stringify({ command: commandName, payload });
    const prior = commandResults.get(cacheKey);
    if (prior) {
      if (prior.signature !== signature) throw new DomainError('IDEMPOTENCY_CONFLICT', 'requestId đã được dùng cho một yêu cầu khác', 409);
      return { requestId, command: commandName, result: await prior.promise };
    }
    const promise = execute();
    commandResults.set(cacheKey, { signature, promise });
    if (commandResults.size > 5000) commandResults.delete(commandResults.keys().next().value);
    try { return { requestId, command: commandName, result: await promise }; }
    catch (error) { commandResults.delete(cacheKey); throw error; }
  }

  async function commandMap(socket, commandName) {
    if (commandName === 'world.join') {
      const player = await players.snapshot(socket.auth.sub);
      const map = world.getByCode(player.mapCode) || world.getDefault();
      if (!map) throw new DomainError('WORLD_NOT_FOUND', 'Chưa có bản đồ published', 503);
      return map.code;
    }
    let mapCode = cluster?.enabled ? await cluster.mapForSocket(socket.id, socket.data.mapCode) : socket.data.mapCode;
    if (!mapCode && commandName === 'world.resync') {
      const player = await players.snapshot(socket.auth.sub);
      mapCode = world.getByCode(player.mapCode)?.code || world.getDefault()?.code;
    }
    if (!mapCode) throw new DomainError('WORLD_NOT_JOINED', 'Hãy vào thế giới trước khi gửi thao tác', 409);
    return mapCode;
  }

  async function command(socket, envelope) {
    if (stopping) throw new DomainError('SERVER_SHUTTING_DOWN', 'Máy chủ đang tắt, hãy kết nối lại sau', 503);
    if (!cluster?.enabled) return commandLocal(socket, envelope);
    const commandName = typeof envelope?.type === 'string' ? envelope.type : '';
    const mapCode = await commandMap(socket, commandName);
    return cluster.command(socket, envelope, mapCode, () => commandLocal(socket, envelope));
  }

  async function disconnectSession(socket) {
    const mapCode = socket.data.mapCode;
    if (!mapCode) return;
    const session = runtime.getPlayer(mapCode, socket.id);
    if (session) {
      if (Number(session.hp) > 0) {
        try { await persistPosition(session, true); } catch { /* keep the socket cleanup moving */ }
      }
      runtime.leave(mapCode, socket.id);
      await socket.leave(roomName(mapCode));
      socket.to(roomName(mapCode)).emit('player_leave', { id: socket.id });
    }
    socket.data.mapCode = null;
  }

  function disconnectLocal(socket) { return disconnectSession(socket); }

  function disconnect(socket) {
    const runLocal = () => track(disconnectLocal(socket));
    if (!cluster?.enabled) return runLocal();
    return track(cluster.disconnect(socket, runLocal));
  }

  function stop() {
    stopping = true;
    clearInterval(runtimeTimer);
  }

  function broadcastMonsterCatalog(id) {
    for (const update of runtime.syncMonsterCatalog(id)) {
      for (let start = 0; start < update.monsters.length; start += MONSTER_UPDATE_BATCH_SIZE) {
        (io.local || io).to(roomName(update.mapCode)).emit("monster_update", { monsters: update.monsters.slice(start, start + MONSTER_UPDATE_BATCH_SIZE) });
      }
    }
  }

  function worldChanged(mapCode) {
    const change = runtime.syncWorld(mapCode);
    const map = world.getByCode(mapCode);
    if (!change || !map) return false;
    change.groundItems = runtime.listDrops(mapCode);

    for (const session of runtime.listPlayers(mapCode)) {
      if (walkable(map, session.x, session.y)) continue;
      const point = safeSpawn(map, session.x, session.y);
      session.x = point.x;
      session.y = point.y;
      runtime.updatePlayer(mapCode, session.socketId, point);
      (io.local || io).to(session.socketId).emit('movement_corrected', {
        ...point,
        reason: 'Vị trí được điều chỉnh theo địa hình bản đồ mới.',
      });
      void persistPosition(session, true).catch(() => {});
    }

    (io.local || io).to(roomName(mapCode)).emit('map_updated', change);
    return true;
  }

  function catalogChanged(collection, id, saved) {
    if (collection === "monsters") {
      monsterCatalogRevision = catalog.getMonsterRevision();
      broadcastMonsterCatalog(id);
    } else if (collection === "items") {
      const item = saved.deleted ? null : catalog.getItemByCode(id);
      for (const room of runtime.activeRooms()) {
        for (const player of room.players.values()) {
          const slots = Object.entries(player.equipment || {});
          const matches = (entry) => (typeof entry === "string" ? entry : entry?.itemCode || entry?.id) === id;
          if (!slots.some(([, entry]) => matches(entry))) continue;
          player.equipment = Object.fromEntries(slots.map(([slot, entry]) => [
            slot,
            matches(entry)
              ? (item ? {
                ...item,
                id,
                itemCode: id,
                ...(entry && typeof entry === 'object' ? {
                  instanceId: entry.instanceId,
                  isInstance: entry.isInstance,
                  rarity: entry.rarity || item.rarity,
                  enhanceLevel: entry.enhanceLevel || 0,
                  hasLuck: Boolean(entry.hasLuck ?? item.hasLuck),
                  exlOptions: Array.isArray(entry.exlOptions) ? entry.exlOptions : [],
                } : {}),
              } : null)
              : entry,
          ]));
          player.derivedStats = deriveStats(player.stats || {}, player.equipment);
          syncEffectiveVitals(player);
          emitPlayerState(player);
        }
      }
      (io.local || io).emit("item_catalog_changed", { id, item });
    }
  }

  async function playerChangedLocal(userId) {
    if (!userId) return false;
    let updated = false;
    for (const room of runtime.activeRooms()) {
      for (const session of room.players.values()) {
        if (String(session.userId) !== String(userId)) continue;
        await syncPlayerState(session);
        emitPlayerState(session, { includeSkills: true });
        const mods = resolveEquipmentModifiers(session.equipment || {});
        io.to(roomName(session.mapCode)).emit('player_appearance_update', {
          id: session.socketId,
          glowTier: mods.glowTier || 0,
          enhanceMaxLevel: mods.enhanceMaxLevel || 0,
        });
        updated = true;
      }
    }
    return updated;
  }

  async function playerChanged(userId) {
    if (!userId) return false;
    if (cluster?.enabled) {
      await cluster.notifyPlayerSync?.(userId);
      return true;
    }
    return playerChangedLocal(userId);
  }

  function broadcastAnnouncement(payload) {
    io.emit('server_announcement', { ...payload, at: Date.now() });
  }

  cluster?.bind?.({
    runtime,
    command: commandLocal,
    commandLocal,
    disconnect: disconnectLocal,
    disconnectLocal,
    playerChangedLocal,
  });
  return { command, commandLocal, disconnect, disconnectLocal, playerChangedLocal, playerChanged, broadcastAnnouncement, runtime, stop, drain, catalogChanged, worldChanged, close: async () => { stop(); await drain(); } };
}

module.exports = { createGameplayService };
