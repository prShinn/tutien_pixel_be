const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const { DomainError, publicPlayer } = require('../domain');
const { combatPower, deriveStats, resolvePassiveModifiers, effectiveMaxVitals, calcDeathXuPenalty, resolveBreakthroughPillRate, calcBreakthroughFailurePenalty, calcBreakthroughRegression, calcEquipmentSellPrice, BALANCE, getVnDateString } = require('../data/balance');
const { items: itemCatalog, skills: skillCatalog, realms: realmCatalog } = require('../data/mock-data');

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (value[key] !== undefined) acc[key] = canonicalJsonValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalJsonValue(value));
}

function createMysqlStore(config) {
  const pool = mysql.createPool({ ...config, timezone: 'Z', waitForConnections: true, queueLimit: config.queueLimit ?? 100, decimalNumbers: true });
  const rawPool = pool.pool || pool;
  if (typeof rawPool?.on === 'function') {
    rawPool.on('connection', (connection) => {
      if (typeof connection?.query === 'function') {
        connection.query("SET time_zone = '+00:00'");
      }
    });
  }
  let catalogSource = null;
  function bindCatalog(catalog) { catalogSource = catalog || null; }
  function activeItems() { return catalogSource?.items || itemCatalog; }
  function activeSkills() { return catalogSource?.skills || skillCatalog; }
  function activeRealms() { return catalogSource?.realms || realmCatalog; }
  function findCatalogItem(code, catalogItems = activeItems()) {
    return catalogItems.find((entry) => entry.id === code || entry.maDo === code) || null;
  }
  function isEquipmentDef(item) {
    return String(item?.type || item?.loai || '').toUpperCase() === 'EQUIPMENT';
  }
  function parseExlOptions(raw) {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }
  function assertPlayerAlive(player, actionLabel = 'thao tác') {
    if (!(Number(player?.hp) > 0)) {
      throw new DomainError('PLAYER_DEAD', `Nhân vật đã tử vong, hãy hồi sinh trước khi ${actionLabel}`, 409);
    }
  }
  async function countUsedInventorySlots(connection, playerId) {
    const [[row]] = await connection.query(
      "SELECT (SELECT COUNT(*) FROM inventory_items WHERE player_id = ?) + (SELECT COUNT(*) FROM item_instances WHERE owner_player_id = ? AND location = 'INVENTORY') AS count",
      [playerId, playerId],
    );
    return Number(row?.count || 0);
  }
  async function nextInventorySlot(connection, playerId) {
    const [[row]] = await connection.query(
      "SELECT GREATEST(COALESCE((SELECT MAX(slot) FROM inventory_items WHERE player_id = ?), -1), COALESCE((SELECT MAX(inventory_slot) FROM item_instances WHERE owner_player_id = ? AND location = 'INVENTORY'), -1)) + 1 AS nextSlot",
      [playerId, playerId],
    );
    return Number(row?.nextSlot || 0);
  }
  async function createItemInstance(connection, playerId, itemCode, meta = {}, location = 'INVENTORY', slotOrEquipped = 0) {
    const instanceId = crypto.randomUUID();
    const rarity = String(meta.rarity || 'NORMAL').toUpperCase();
    const enhanceLevel = Math.max(0, Math.min(BALANCE.enhance.maxLevel, Math.floor(Number(meta.enhanceLevel || 0))));
    const hasLuck = Boolean(meta.hasLuck);
    const exlOptions = Array.isArray(meta.exlOptions) ? meta.exlOptions : [];
    const inventorySlot = location === 'INVENTORY' ? Number(slotOrEquipped || 0) : null;
    const equippedSlot = location === 'EQUIPPED' ? String(slotOrEquipped) : null;
    await connection.execute(
      'INSERT INTO item_instances (id, owner_player_id, item_code, location, inventory_slot, equipped_slot, rarity, enhance_level, has_luck, exl_options_json, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
      [instanceId, playerId, itemCode, location, inventorySlot, equippedSlot, rarity, enhanceLevel, hasLuck ? 1 : 0, JSON.stringify(exlOptions)],
    );
    return { instanceId, itemCode, rarity, enhanceLevel, hasLuck, exlOptions, slot: inventorySlot };
  }
  async function init() {
    await withConnection(async (connection) => {
      await connection.execute(`CREATE TABLE IF NOT EXISTS item_instances (
        id CHAR(36) PRIMARY KEY, owner_player_id VARCHAR(64) NOT NULL, item_code VARCHAR(64) NOT NULL,
        location ENUM('INVENTORY', 'EQUIPPED', 'MARKET_ESCROW', 'DESTROYED') NOT NULL DEFAULT 'INVENTORY',
        inventory_slot INT NULL, equipped_slot VARCHAR(24) NULL,
        equipped_key VARCHAR(24) GENERATED ALWAYS AS (IF(location = 'EQUIPPED', equipped_slot, NULL)) STORED,
        rarity ENUM('NORMAL', 'MAGIC', 'EXL', 'ANCIENT') NOT NULL DEFAULT 'NORMAL',
        enhance_level TINYINT UNSIGNED NOT NULL DEFAULT 0, has_luck BOOLEAN NOT NULL DEFAULT FALSE,
        exl_options_json JSON NOT NULL, version BIGINT NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        KEY ix_inst_owner_loc (owner_player_id, location, inventory_slot, id),
        UNIQUE KEY uq_inst_owner_equipped (owner_player_id, equipped_key),
        CONSTRAINT fk_inst_player FOREIGN KEY (owner_player_id) REFERENCES players(id)
      ) ENGINE=InnoDB`);
      await connection.execute(`CREATE TABLE IF NOT EXISTS player_enhance_logs (
        id VARCHAR(64) PRIMARY KEY, player_id VARCHAR(64) NOT NULL, instance_id CHAR(36) NOT NULL,
        item_code VARCHAR(64) NOT NULL, from_level TINYINT UNSIGNED NOT NULL, to_level TINYINT UNSIGNED NOT NULL,
        outcome ENUM('SUCCESS', 'FAIL_DOWN', 'FAIL_RESET_ZERO', 'FAIL_PROTECTED') NOT NULL,
        used_protection BOOLEAN NOT NULL DEFAULT FALSE, has_luck BOOLEAN NOT NULL DEFAULT FALSE,
        success_rate DECIMAL(5,4) NOT NULL, cost_xu BIGINT NOT NULL DEFAULT 0, cost_linh_thach BIGINT NOT NULL DEFAULT 0,
        consumed_items_json JSON NOT NULL, idempotency_key VARCHAR(80) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_enhance_idempotency (player_id, idempotency_key),
        KEY ix_enhance_player_time (player_id, created_at, id),
        CONSTRAINT fk_enhance_player FOREIGN KEY (player_id) REFERENCES players(id)
      ) ENGINE=InnoDB`);
    });
  }

  async function backfillLegacyEquipment() {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        await connection.execute(`INSERT IGNORE INTO item_instances (id, owner_player_id, item_code, location, equipped_slot, rarity, enhance_level, has_luck, exl_options_json)
          SELECT UUID(), pe.player_id, pe.item_code, 'EQUIPPED', pe.slot, 'NORMAL', 0, FALSE, JSON_ARRAY()
          FROM player_equipment pe
          LEFT JOIN item_instances ii ON ii.owner_player_id = pe.player_id AND ii.location = 'EQUIPPED' AND ii.equipped_slot = pe.slot
          WHERE ii.id IS NULL`);
        const equipCodes = activeItems().filter((entry) => isEquipmentDef(entry)).map((entry) => entry.id);
        for (let offset = 0; offset < equipCodes.length; offset += 50) {
          const chunk = equipCodes.slice(offset, offset + 50);
          if (!chunk.length) continue;
          const placeholders = chunk.map(() => '?').join(', ');
          const [legacyRows] = await connection.query(
            `SELECT id, player_id AS playerId, item_code AS itemCode, quantity, slot FROM inventory_items WHERE item_code IN (${placeholders}) FOR UPDATE`,
            chunk,
          );
          for (const row of legacyRows) {
            const qty = Math.max(1, Math.min(99, Math.floor(Number(row.quantity || 1))));
            let slot = Number(row.slot || 0);
            for (let i = 0; i < qty; i += 1) {
              if (i > 0) slot = await nextInventorySlot(connection, row.playerId);
              const def = findCatalogItem(row.itemCode);
              await createItemInstance(connection, row.playerId, row.itemCode, {
                rarity: def?.rarity || 'NORMAL',
                enhanceLevel: 0,
                hasLuck: Boolean(def?.hasLuck),
                exlOptions: [],
              }, 'INVENTORY', slot);
            }
            await connection.execute('DELETE FROM inventory_items WHERE id = ?', [row.id]);
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }
  async function healthCheck() { await pool.query('SELECT 1'); return true; }
  async function findUserByUsername(username) {
    const [rows] = await pool.execute('SELECT id, username, password_hash AS passwordHash, role, status, created_at AS createdAt FROM users WHERE username = ? LIMIT 1', [username]);
    return rows[0] || null;
  }
  async function findUserById(id) {
    const [rows] = await pool.execute('SELECT id, username, password_hash AS passwordHash, role, status, created_at AS createdAt FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }
  async function insertUser(user) {
    try {
      await pool.execute('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [user.id, user.username, user.passwordHash, user.role, user.status, user.createdAt]);
      return user;
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new DomainError('USERNAME_TAKEN', 'Username đã tồn tại', 409);
      throw error;
    }
  }
  async function saveRefreshToken(userId, tokenHash, expiresAt) {
    await pool.execute(
      'INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      [`rft_${crypto.randomUUID()}`, userId, tokenHash, expiresAt],
    );
  }
  async function rotateRefreshToken(tokenHash, nextTokenHash, nextExpiresAt) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[token]] = await connection.query(
          'SELECT token.id, token.user_id AS userId, token.expires_at AS expiresAt, token.revoked_at AS revokedAt, user.username, user.role, user.status FROM auth_refresh_tokens AS token JOIN users AS user ON user.id = token.user_id WHERE token.token_hash = ? FOR UPDATE',
          [tokenHash],
        );
        if (!token) { await connection.commit(); return null; }
        const expired = new Date(token.expiresAt).getTime() <= Date.now();
        if (token.revokedAt || expired || token.status !== 'ACTIVE') {
          if (token.revokedAt) {
            await connection.execute('UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(3)) WHERE user_id = ? AND revoked_at IS NULL', [token.userId]);
          } else {
            await connection.execute('UPDATE auth_refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ?', [token.id]);
          }
          await connection.commit();
          return null;
        }
        await connection.execute(
          'UPDATE auth_refresh_tokens SET revoked_at = UTC_TIMESTAMP(3), replaced_by_hash = ? WHERE id = ? AND revoked_at IS NULL',
          [nextTokenHash, token.id],
        );
        await connection.execute(
          'INSERT INTO auth_refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
          [`rft_${crypto.randomUUID()}`, token.userId, nextTokenHash, nextExpiresAt],
        );
        await connection.commit();
        return { id: token.userId, username: token.username, role: token.role, status: token.status };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }
  async function revokeRefreshToken(tokenHash) {
    const [result] = await pool.execute(
      'UPDATE auth_refresh_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL',
      [tokenHash],
    );
    return result.affectedRows > 0;
  }
  async function withConnection(work) { const connection = await pool.getConnection(); try { return await work(connection); } finally { connection.release(); } }
  function decodeJson(value) { return typeof value === 'string' ? JSON.parse(value) : value; }

  async function writeAudit(connection, actorId, action, resource, before, after, requestId = null) {
    await connection.execute(
      'INSERT INTO admin_audit_logs (id, actor_id, action, resource, before_json, after_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`aud_${crypto.randomUUID()}`, actorId, action, resource, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), requestId],
    );
  }

  async function listAdminWorlds() {
    const [rows] = await pool.query('SELECT code, status, version, document_json AS documentJson FROM admin_worlds ORDER BY code');
    return rows.map((row) => ({ ...decodeJson(row.documentJson), code: row.code, status: row.status, version: row.version }));
  }

  async function saveAdminWorlds(actorId, documents, action, requestId = null) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const savedDocuments = [];
        for (const document of documents) {
          const [[prior]] = await connection.query('SELECT status, version, document_json AS documentJson FROM admin_worlds WHERE code = ? FOR UPDATE', [document.code]);
          const before = prior ? { ...decodeJson(prior.documentJson), status: prior.status, version: prior.version } : null;
          const status = String(document.status || 'DRAFT').toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
          const version = Number(prior?.version || 0) + 1;
          const stored = { ...document, status, version };
          await connection.execute(
            'INSERT INTO admin_worlds (code, status, version, document_json, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), version = VALUES(version), document_json = VALUES(document_json), updated_by = VALUES(updated_by)',
            [document.code, status, version, JSON.stringify(stored), actorId],
          );
          await writeAudit(connection, actorId, action, `world:${document.code}`, before, stored, requestId);
          savedDocuments.push(stored);
        }
        await connection.commit();
        return savedDocuments;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function deleteAdminWorld(actorId, code, requestId = null) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[prior]] = await connection.query('SELECT status, version, document_json AS documentJson FROM admin_worlds WHERE code = ? FOR UPDATE', [code]);
        if (!prior) throw new DomainError('WORLD_NOT_FOUND', 'Bản đồ không tồn tại', 404);
        const before = { ...decodeJson(prior.documentJson), status: prior.status, version: prior.version };
        const deleted = { ...before, status: 'DELETED', version: Number(prior.version || 0) + 1 };
        await connection.execute('UPDATE admin_worlds SET status = ?, version = ?, document_json = ?, updated_by = ? WHERE code = ?', ['DELETED', deleted.version, JSON.stringify(deleted), actorId, code]);
        await writeAudit(connection, actorId, 'WORLD_DELETE', `world:${code}`, before, deleted, requestId);
        await connection.commit();
        return before;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function listAdminContentRecords(collection) {
    const [rows] = await pool.execute('SELECT record_id AS recordId, document_json AS documentJson, is_deleted AS isDeleted, version FROM admin_content_records WHERE collection_name = ? ORDER BY record_id', [collection]);
    return rows.map((row) => ({ id: row.recordId, data: decodeJson(row.documentJson), deleted: Boolean(row.isDeleted), version: row.version }));
  }

  async function pageAdminCatalog(collection, seeds, { q, ids, limit, offset }) {
    const sql = [
      "WITH seed AS (SELECT CONVERT(record_id USING utf8mb4) COLLATE utf8mb4_unicode_ci AS record_id, CONVERT(name USING utf8mb4) COLLATE utf8mb4_unicode_ci AS name, CONVERT(code USING utf8mb4) COLLATE utf8mb4_unicode_ci AS code FROM JSON_TABLE(?, '$[*]' COLUMNS (record_id VARCHAR(96) PATH '$.id', name VARCHAR(512) PATH '$.name', code VARCHAR(96) PATH '$.code')) AS seed_rows),",
      "effective AS (",
      " SELECT record_id, JSON_UNQUOTE(COALESCE(JSON_EXTRACT(document_json, '$.tenDo'), JSON_EXTRACT(document_json, '$.name'))) COLLATE utf8mb4_unicode_ci AS name,",
      " JSON_UNQUOTE(COALESCE(JSON_EXTRACT(document_json, '$.maDo'), JSON_EXTRACT(document_json, '$.code'))) COLLATE utf8mb4_unicode_ci AS code, TRUE AS isOverride",
      " FROM admin_content_records WHERE collection_name = ? AND is_deleted = FALSE",
      " UNION ALL SELECT seed.record_id, seed.name, seed.code, FALSE FROM seed",
      " WHERE NOT EXISTS (SELECT 1 FROM admin_content_records r WHERE r.collection_name = ? AND r.record_id = seed.record_id)",
      "), filtered AS (SELECT record_id, isOverride FROM effective",
      " WHERE (? = '' OR LOCATE(LOWER(?), LOWER(CONCAT_WS(' ', record_id, name, code))) > 0)",
      " AND (? = 0 OR record_id IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_unicode_ci FROM JSON_TABLE(?, '$[*]' COLUMNS (id VARCHAR(96) PATH '$')) AS ids)",
      " OR code IN (SELECT CONVERT(id USING utf8mb4) COLLATE utf8mb4_unicode_ci FROM JSON_TABLE(?, '$[*]' COLUMNS (id VARCHAR(96) PATH '$')) AS codes))),",
      " paged AS (SELECT record_id, isOverride FROM filtered ORDER BY record_id LIMIT ? OFFSET ?)",
      " SELECT paged.record_id AS id, r.document_json AS documentJson, totals.total FROM (SELECT COUNT(*) AS total FROM filtered) AS totals",
      " LEFT JOIN paged ON TRUE LEFT JOIN admin_content_records r ON paged.isOverride AND r.collection_name = ? AND r.record_id = paged.record_id",
      " ORDER BY paged.record_id",
    ].join("\n");
    const idsJson = JSON.stringify(ids);
    const [rows] = await pool.execute(sql, [JSON.stringify(seeds), collection, collection, q, q, ids.length, idsJson, idsJson, limit, offset, collection]);
    return { total: Number(rows[0]?.total || 0), rows: rows.filter((row) => row.id !== null).map((row) => ({
      id: row.id, data: row.documentJson == null ? null : decodeJson(row.documentJson),
    })) };
  }

  async function getAdminContentRecord(collection, id) {
    const [[row]] = await pool.execute("SELECT document_json AS documentJson, is_deleted AS isDeleted, version FROM admin_content_records WHERE collection_name = ? AND record_id = ?", [collection, id]);
    return row ? { data: decodeJson(row.documentJson), deleted: Boolean(row.isDeleted), version: row.version } : null;
  }

  async function listAdminAccounts() {
    const [rows] = await pool.query('SELECT id, username, role, status, created_at AS createdAt FROM users ORDER BY created_at DESC');
    return rows;
  }

  async function mutateAdminContent(actorId, collection, recordId, document, remove = false, requestId = null, createOnly = false, expectedVersion) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[prior]] = await connection.query('SELECT document_json AS documentJson, is_deleted AS isDeleted, version FROM admin_content_records WHERE collection_name = ? AND record_id = ? FOR UPDATE', [collection, recordId]);
        if (expectedVersion !== undefined && Number(prior?.version || 0) !== Number(expectedVersion)) {
          throw new DomainError("CONTENT_CONFLICT", "Bản ghi vừa thay đổi. Tải lại trước khi lưu.", 409);
        }
        if (createOnly && prior && !prior.isDeleted) throw new DomainError('CONTENT_EXISTS', 'Bản ghi đã tồn tại', 409);
        const before = prior ? { data: decodeJson(prior.documentJson), deleted: Boolean(prior.isDeleted), version: prior.version } : null;
        const stored = document || (prior ? decodeJson(prior.documentJson) : { id: recordId });
        const version = Number(prior?.version || 0) + 1;
        const upsert = createOnly && !prior ? '' : ' ON DUPLICATE KEY UPDATE document_json = VALUES(document_json), is_deleted = VALUES(is_deleted), version = VALUES(version), updated_by = VALUES(updated_by)';
        await connection.execute(
          'INSERT INTO admin_content_records (collection_name, record_id, document_json, is_deleted, version, updated_by) VALUES (?, ?, ?, ?, ?, ?)' + upsert,
          [collection, recordId, JSON.stringify(stored), remove ? 1 : 0, version, actorId],
        );
        await writeAudit(connection, actorId, remove ? 'CONTENT_DELETE' : prior ? 'CONTENT_UPDATE' : 'CONTENT_CREATE', `content:${collection}:${recordId}`, before, { data: stored, deleted: remove, version }, requestId);
        await connection.commit();
        return { data: stored, deleted: remove, version };
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function listAdminSkillVfx() {
    const [rows] = await pool.query('SELECT skill_code AS skillCode, profile_json AS profileJson FROM skill_vfx_profiles ORDER BY skill_code');
    return Object.fromEntries(rows.map((row) => [row.skillCode, decodeJson(row.profileJson)]));
  }

  async function mutateSkillVfx(actorId, skillCode, profile, remove = false, requestId = null) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[prior]] = await connection.query('SELECT profile_json AS profileJson FROM skill_vfx_profiles WHERE skill_code = ? FOR UPDATE', [skillCode]);
        const before = prior ? decodeJson(prior.profileJson) : null;
        if (remove) await connection.execute('DELETE FROM skill_vfx_profiles WHERE skill_code = ?', [skillCode]);
        else await connection.execute(
          'INSERT INTO skill_vfx_profiles (skill_code, profile_json, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE profile_json = VALUES(profile_json), updated_by = VALUES(updated_by)',
          [skillCode, JSON.stringify(profile), actorId],
        );
        await writeAudit(connection, actorId, remove ? 'SKILL_VFX_DELETE' : prior ? 'SKILL_VFX_UPDATE' : 'SKILL_VFX_CREATE', `skill-vfx:${skillCode}`, before, remove ? null : profile, requestId);
        await connection.commit();
        return remove ? null : profile;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  function compactIdempotentPlayer(player) {
    if (!player || typeof player !== 'object') return player;
    const { jsonIventory, trangBi, equip_slot, ...rest } = player;
    return rest;
  }

  function replayIdempotentResult(row, operation, itemCode, count) {
    const stored = typeof row.resultJson === 'string' ? JSON.parse(row.resultJson) : row.resultJson;
    if (stored && stored.__idempotency) {
      const intent = stored.__idempotency;
      if (intent.operation !== operation || intent.itemCode !== itemCode || intent.count !== count) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'requestId đã được dùng cho một yêu cầu khác', 409);
      }
      if (stored.sellTotal != null && stored.player && typeof stored.player === 'object') {
        Object.defineProperty(stored.player, '_sellTotal', { value: Number(stored.sellTotal), enumerable: false });
      }
      return stored.player;
    }
    if (operation === 'BUY_ITEM') return stored;
    throw new DomainError('IDEMPOTENCY_CONFLICT', 'requestId đã được dùng trước khi hỗ trợ bán hàng idempotent', 409);
  }

  function idempotencyEnvelope(operation, itemCode, count, player, sellTotal = null) {
    return JSON.stringify({
      __idempotency: { operation, itemCode, count },
      player: compactIdempotentPlayer(player),
      ...(sellTotal != null ? { sellTotal: Number(sellTotal) } : {}),
    });
  }

  function replayMutation(row, intent) {
    const stored = typeof row.resultJson === 'string' ? JSON.parse(row.resultJson) : row.resultJson;
    const priorIntent = stored?.__idempotency;
    if (!priorIntent || Object.entries(intent).some(([key, value]) => JSON.stringify(priorIntent[key]) !== JSON.stringify(value))) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'requestId đã được dùng cho một yêu cầu khác', 409);
    }
    return { player: stored.player, result: stored.result };
  }

  function getInventoryCapacity(player) {
    return Math.min(BALANCE.inventory.maxCapacity, Math.max(BALANCE.inventory.baseCapacity, Number(player?.inventoryCapacity || BALANCE.inventory.baseCapacity)));
  }

  function ledgerIdempotencyKey(requestId, suffix = '') {
    const tag = String(suffix || '').trim();
    if (!tag) return String(requestId).slice(0, 80);
    const candidate = `${requestId}:${tag}`;
    if (candidate.length <= 80) return candidate;
    const digest = crypto.createHash('sha256').update(String(requestId)).digest('hex').slice(0, 64);
    return `${digest}:${tag}`.slice(0, 80);
  }

  function encodeCursor(createdAt, id) {
    if (!createdAt || !id) return null;
    const iso = new Date(createdAt).toISOString();
    return Buffer.from(JSON.stringify({ createdAt: iso, id: String(id) }), 'utf8').toString('base64url');
  }

  function decodeCursor(cursor) {
    if (!cursor) return null;
    if (typeof cursor !== 'string' || cursor.length > 256) {
      throw new DomainError('INVALID_CURSOR', 'Cursor phân trang không hợp lệ', 400);
    }
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      const time = Date.parse(parsed?.createdAt);
      if (!Number.isFinite(time) || typeof parsed?.id !== 'string' || !parsed.id || parsed.id.length > 64) {
        throw new Error('invalid cursor');
      }
      return { createdAt: new Date(time), id: parsed.id };
    } catch {
      throw new DomainError('INVALID_CURSOR', 'Cursor phân trang không hợp lệ', 400);
    }
  }

  async function adjustWalletBalance(connection, {
    playerId,
    currencyType = 'XU',
    delta,
    reason,
    idempotencyKey,
    referenceType = null,
    referenceId = null,
  }) {
    const type = currencyType === 'LINH_THACH' ? 'LINH_THACH' : 'XU';
    const [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? FOR UPDATE', [playerId]);
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND', 'Không tìm thấy ví nhân vật', 404);
    const safeDelta = Math.trunc(Number(delta || 0));
    if (!Number.isSafeInteger(safeDelta)) throw new DomainError('INVALID_AMOUNT', 'Biến động số dư không hợp lệ', 400);
    const currentXu = Math.max(0, Math.floor(Number(wallet.xu || 0)));
    const currentLinhThach = Math.max(0, Math.floor(Number(wallet.linhThach || 0)));
    const currentBalance = type === 'LINH_THACH' ? currentLinhThach : currentXu;
    const nextBalance = currentBalance + safeDelta;
    if (nextBalance < 0) {
      throw new DomainError(
        type === 'LINH_THACH' ? 'INSUFFICIENT_LINH_THACH' : 'INSUFFICIENT_FUNDS',
        type === 'LINH_THACH' ? 'Không đủ linh thạch' : 'Không đủ xu',
        409,
      );
    }
    const col = type === 'LINH_THACH' ? 'linh_thach' : 'xu';
    if (safeDelta !== 0) {
      await connection.execute(`UPDATE wallets SET ${col} = ?, version = version + 1 WHERE player_id = ?`, [nextBalance, playerId]);
      await connection.execute(
        'INSERT INTO currency_ledger (id, player_id, currency_type, reason, amount, balance_after, reference_type, reference_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))',
        [`led_${crypto.randomUUID()}`, playerId, type, reason, safeDelta, nextBalance, referenceType, referenceId, idempotencyKey],
      );
    }
    return {
      xu: type === 'XU' ? nextBalance : currentXu,
      linhThach: type === 'LINH_THACH' ? nextBalance : currentLinhThach,
      balanceAfter: nextBalance,
    };
  }

  function playerState(row) {
    return {
      tuVi: row.tuVi, tuViLinhCan: row.tuViLinhCan, hp: row.hp, maxHp: row.maxHp,
      mp: row.mp, maxMp: row.maxMp, realmCode: row.realmCode, realmStage: row.realmStage,
      unspentPoints: row.unspentPoints, inventoryCapacity: getInventoryCapacity(row),
      stats: { str: row.str, agi: row.agi, vit: row.vit, ene: row.ene },
    };
  }

  async function saveAction(connection, playerId, action, requestId, payload, before, after) {
    await connection.execute(
      'INSERT INTO player_action_ledger (id, player_id, action, idempotency_key, payload_json, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [`act_${crypto.randomUUID()}`, playerId, action, requestId, JSON.stringify(payload), JSON.stringify(before), JSON.stringify(after)],
    );
  }

  async function playerMutation(userId, requestId, intent, action, { includeSnapshot = true, afterState } = {}) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, gender, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return replay;
        }
        const before = playerState(player);
        const result = await action(connection, player);
        await connection.execute('UPDATE players SET version = version + 1 WHERE id = ?', [player.id]);
        const updatedPlayer = includeSnapshot ? await snapshotWith(connection, userId) : null;
        const finalState = afterState
          ? { ...player, ...afterState(result, player) }
          : { ...player, ...(await currentPlayerState(connection, player.id)) };
        const after = playerState(finalState);
        await saveAction(connection, player.id, intent.operation, requestId, intent, before, after);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: compactIdempotentPlayer(updatedPlayer), result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function currentPlayerState(connection, playerId) {
    const [[row]] = await connection.query(
      'SELECT realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE id = ? LIMIT 1',
      [playerId],
    );
    return row;
  }

  async function ensureQuestState(connection, playerId, definitions) {
    for (const quest of definitions) {
      await connection.execute(
        'INSERT IGNORE INTO player_quests (player_id, quest_id, status, progress) VALUES (?, ?, ?, ?)',
        [playerId, quest.id, quest.initialStatus, quest.initialProgress],
      );
    }
    await connection.execute('INSERT IGNORE INTO player_quest_meta (player_id, revision, tracked_id) VALUES (?, 0, ?)', [playerId, definitions.find((quest) => quest.initialStatus === 'active')?.id || null]);
  }

  async function questSnapshotWith(connection, playerId, definitions) {
    await ensureQuestState(connection, playerId, definitions);
    const [[meta]] = await connection.query('SELECT revision, tracked_id AS trackedId FROM player_quest_meta WHERE player_id = ? LIMIT 1', [playerId]);
    const [states] = await connection.execute('SELECT quest_id AS questId, status, progress FROM player_quests WHERE player_id = ?', [playerId]);
    const { makeSnapshot } = require('../quests/quest-catalog');
    return makeSnapshot(meta, states, definitions);
  }

  async function questSnapshot(userId, definitions) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const snapshot = await questSnapshotWith(connection, player.id, definitions);
        await connection.commit();
        return snapshot;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function grantItems(connection, playerId, entries, items, maxSlots = BALANCE.inventory.baseCapacity, {
    invalidCode = 'QUEST_REWARD_INVALID',
    invalidMessage = 'Phần thưởng chưa được cấu hình',
    fullMessage = 'Túi đồ không đủ chỗ nhận phần thưởng',
  } = {}) {
    const grantedItems = [];
    for (const reward of entries) {
      const code = reward.itemId || reward.itemCode;
      const qty = Math.max(0, Math.floor(Number(reward.amount ?? reward.quantity ?? 0)));
      if (!code || qty <= 0) continue;
      const item = items.find((entry) => entry.id === code || entry.maDo === code);
      if (!item) throw new DomainError(invalidCode, invalidMessage, 409);
      if (isEquipmentDef(item)) {
        const used = await countUsedInventorySlots(connection, playerId);
        if (used + qty > maxSlots) throw new DomainError('INVENTORY_FULL', fullMessage, 409);
        for (let i = 0; i < qty; i += 1) {
          const slot = await nextInventorySlot(connection, playerId);
          const created = await createItemInstance(connection, playerId, item.id, {
            rarity: reward.rarity || item.rarity || 'NORMAL',
            enhanceLevel: reward.enhanceLevel || 0,
            hasLuck: Boolean(reward.hasLuck ?? item.hasLuck),
            exlOptions: Array.isArray(reward.exlOptions) ? reward.exlOptions : [],
          }, 'INVENTORY', slot);
          grantedItems.push({
            itemId: item.id,
            itemCode: item.id,
            instanceId: created.instanceId,
            isInstance: true,
            rarity: created.rarity,
            enhanceLevel: created.enhanceLevel,
            hasLuck: created.hasLuck,
            exlOptions: created.exlOptions,
            name: item.name || item.tenDo || item.id,
            count: 1,
            quantity: 1,
          });
        }
        continue;
      }
      const [[existing]] = await connection.query('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [playerId, item.id]);
      if (existing) {
        if (existing.quantity + qty > 99) throw new DomainError('INVENTORY_FULL', fullMessage, 409);
        await connection.execute('UPDATE inventory_items SET quantity = quantity + ?, version = version + 1 WHERE id = ?', [qty, existing.id]);
      } else {
        const used = await countUsedInventorySlots(connection, playerId);
        if (used >= maxSlots || qty > 99) throw new DomainError('INVENTORY_FULL', fullMessage, 409);
        const slot = await nextInventorySlot(connection, playerId);
        await connection.execute('INSERT INTO inventory_items (id, player_id, item_code, quantity, slot, version) VALUES (?, ?, ?, ?, ?, 1)', [`inv_${crypto.randomUUID()}`, playerId, item.id, qty, slot]);
      }
      grantedItems.push({ itemId: item.id, itemCode: item.id, name: item.name || item.tenDo || item.id, count: qty, quantity: qty });
    }
    return grantedItems;
  }

  async function grantQuestItems(connection, playerId, rewards, items, maxSlots = BALANCE.inventory.baseCapacity) {
    return grantItems(connection, playerId, rewards.filter((entry) => entry.type === 'item'), items, maxSlots, {
      invalidCode: 'QUEST_REWARD_INVALID',
      invalidMessage: 'Phần thưởng nhiệm vụ chưa được cấu hình',
      fullMessage: 'Túi đồ không đủ chỗ nhận phần thưởng',
    });
  }

  async function questAction(userId, requestId, questId, action, definitions, items) {
    const intent = { operation: `QUEST_${action.toUpperCase()}`, questId };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      const definition = definitions.find((quest) => quest.id === questId);
      if (!definition) throw new DomainError('QUEST_NOT_FOUND', 'Nhiệm vụ không tồn tại', 404);
      await ensureQuestState(connection, player.id, definitions);
      const [[quest]] = await connection.query('SELECT status, progress FROM player_quests WHERE player_id = ? AND quest_id = ? FOR UPDATE', [player.id, questId]);
      const [[meta]] = await connection.query('SELECT revision, tracked_id AS trackedId FROM player_quest_meta WHERE player_id = ? FOR UPDATE', [player.id]);
      let rewards = [];
      let grantedItems = [];

      if (action === 'accept') {
        if (quest.status !== 'available') throw new DomainError('QUEST_NOT_AVAILABLE', 'Nhiệm vụ này không thể nhận', 409);
        if (definition.requiresQuestId) {
          const [[prerequisite]] = await connection.query(
            'SELECT status FROM player_quests WHERE player_id = ? AND quest_id = ? FOR UPDATE',
            [player.id, definition.requiresQuestId],
          );
          if (prerequisite?.status !== 'completed') throw new DomainError('QUEST_LOCKED', 'Hoàn thành nhiệm vụ trước để mở khóa', 409);
        }
        const status = definition.target === 0 ? 'ready' : 'active';
        await connection.execute('UPDATE player_quests SET status = ?, version = version + 1 WHERE player_id = ? AND quest_id = ?', [status, player.id, questId]);
        if (!meta.trackedId && status === 'active') meta.trackedId = questId;
      } else if (action === 'track') {
        if (quest.status !== 'active') throw new DomainError('QUEST_NOT_ACTIVE', 'Chỉ có thể theo dõi nhiệm vụ đang làm', 409);
        meta.trackedId = meta.trackedId === questId ? null : questId;
      } else if (action === 'claim') {
        if (quest.status !== 'ready') throw new DomainError('QUEST_NOT_READY', 'Chưa đủ điều kiện nhận thưởng', 409);
        rewards = definition.rewards.map((reward) => ({ ...reward }));
        const xu = rewards.filter((reward) => reward.type === 'xu').reduce((sum, reward) => sum + reward.amount, 0);
        const tuVi = rewards.filter((reward) => reward.type === 'tuVi').reduce((sum, reward) => sum + reward.amount, 0);
        if (xu > 0) {
          await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'XU',
            delta: xu,
            reason: 'QUEST_REWARD',
            idempotencyKey: requestId,
            referenceType: 'QUEST',
            referenceId: questId,
          });
        }
        grantedItems = await grantQuestItems(connection, player.id, rewards, items, getInventoryCapacity(player));
        if (tuVi > 0) await connection.execute('UPDATE players SET tu_vi = tu_vi + ? WHERE id = ?', [tuVi, player.id]);
        await connection.execute('UPDATE player_quests SET status = ?, version = version + 1 WHERE player_id = ? AND quest_id = ?', ['completed', player.id, questId]);
        if (meta.trackedId === questId) {
          const [[next]] = await connection.query('SELECT quest_id AS questId FROM player_quests WHERE player_id = ? AND status = ? AND quest_id <> ? ORDER BY quest_id LIMIT 1', [player.id, 'active', questId]);
          meta.trackedId = next?.questId || null;
        }
      } else {
        throw new DomainError('INVALID_QUEST_ACTION', 'Thao tác nhiệm vụ không hợp lệ');
      }

      await connection.execute('UPDATE player_quest_meta SET revision = revision + 1, tracked_id = ? WHERE player_id = ?', [meta.trackedId, player.id]);
      const snapshot = await questSnapshotWith(connection, player.id, definitions);
      if (action !== 'claim') return { ok: true, ...snapshot };
      const [[wallet]] = await connection.query('SELECT xu FROM wallets WHERE player_id = ? LIMIT 1', [player.id]);
      const [inventory] = await connection.execute('SELECT id, item_code AS itemCode, quantity AS count, slot FROM inventory_items WHERE player_id = ? ORDER BY slot', [player.id]);
      const [rawInstInventory] = await connection.execute(
        "SELECT id, item_code AS itemCode, inventory_slot AS slot, rarity, enhance_level AS enhanceLevel, has_luck AS hasLuck, exl_options_json AS exlOptionsJson FROM item_instances WHERE owner_player_id = ? AND location = 'INVENTORY' ORDER BY inventory_slot, id",
        [player.id],
      );
      const instanceInventory = Array.isArray(rawInstInventory) ? rawInstInventory : [];
      const [[progression]] = await connection.query('SELECT tu_vi AS tuVi FROM players WHERE id = ? LIMIT 1', [player.id]);
      const combinedInventory = [
        ...inventory.map((entry) => ({ id: entry.itemCode, itemCode: entry.itemCode, count: entry.count, quantity: entry.count, slot: entry.slot, instanceId: entry.id })),
        ...instanceInventory.map((entry) => ({
          id: entry.itemCode, itemCode: entry.itemCode, count: 1, quantity: 1, slot: entry.slot ?? 0,
          instanceId: entry.id, isInstance: true, rarity: entry.rarity || 'NORMAL',
          enhanceLevel: Number(entry.enhanceLevel || 0), hasLuck: Boolean(entry.hasLuck),
          exlOptions: parseExlOptions(entry.exlOptionsJson),
        })),
      ].sort((a, b) => (a.slot - b.slot) || String(a.instanceId).localeCompare(String(b.instanceId)));
      return {
        ok: true,
        rewards: rewards.map(({ type, itemId, amount, label }) => ({ type, itemId, amount, label })),
        grantedItems,
        ...snapshot,
        player: { xu: wallet.xu, tuViHienTai: progression.tuVi, inventory: combinedInventory },
      };
    });
  }

  async function applyQuestEvent(userId, eventId, event, definitions) {
    const intent = { operation: 'QUEST_EVENT', eventId };
    return playerMutation(userId, eventId, intent, async (connection, player) => {
      await ensureQuestState(connection, player.id, definitions);
      const [[meta]] = await connection.query('SELECT revision, tracked_id AS trackedId FROM player_quest_meta WHERE player_id = ? FOR UPDATE', [player.id]);
      const amount = Math.max(1, Math.min(99, Math.floor(Number(event.count) || 1)));
      let changed = false;
      for (const definition of definitions) {
        if (definition.eventType !== event.type
            || (definition.targetItemId && definition.targetItemId !== String(event.itemId || ''))
            || (definition.targetMonsterId && definition.targetMonsterId !== String(event.monsterId || ''))
            || (definition.targetMapCode && definition.targetMapCode !== String(event.mapCode || ''))) continue;
        const [[quest]] = await connection.query('SELECT status, progress FROM player_quests WHERE player_id = ? AND quest_id = ? FOR UPDATE', [player.id, definition.id]);
        if (quest.status !== 'active') continue;
        const progress = Math.min(definition.target, quest.progress + amount);
        const status = progress >= definition.target ? 'ready' : 'active';
        await connection.execute('UPDATE player_quests SET progress = ?, status = ?, version = version + 1 WHERE player_id = ? AND quest_id = ?', [progress, status, player.id, definition.id]);
        if (status === 'ready' && meta.trackedId === definition.id) {
          const [[next]] = await connection.query('SELECT quest_id AS questId FROM player_quests WHERE player_id = ? AND status = ? AND quest_id <> ? ORDER BY quest_id LIMIT 1', [player.id, 'active', definition.id]);
          meta.trackedId = next?.questId || null;
        }
        changed = true;
      }
      if (changed) await connection.execute('UPDATE player_quest_meta SET revision = revision + 1, tracked_id = ? WHERE player_id = ?', [meta.trackedId, player.id]);
      return changed ? { changed: true, ...(await questSnapshotWith(connection, player.id, definitions)) } : { changed: false, ...(await questSnapshotWith(connection, player.id, definitions)) };
    });
  }

  async function snapshotWith(connection, userId) {
    const [players] = await connection.execute('SELECT id, user_id AS userId, name, gender, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, map_code AS mapCode, x, y, position_version AS positionVersion, version, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? LIMIT 1', [userId]);
    const player = players[0];
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? LIMIT 1', [player.id]);
    const [inventoryRows] = await connection.execute('SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items WHERE player_id = ? ORDER BY slot, id', [player.id]);
    const [rawInstanceRows] = await connection.execute(
      "SELECT id, item_code AS itemCode, location, inventory_slot AS inventorySlot, equipped_slot AS equippedSlot, rarity, enhance_level AS enhanceLevel, has_luck AS hasLuck, exl_options_json AS exlOptionsJson FROM item_instances WHERE owner_player_id = ? AND location IN ('INVENTORY', 'EQUIPPED') ORDER BY inventory_slot, id",
      [player.id],
    );
    const instanceRows = Array.isArray(rawInstanceRows) ? rawInstanceRows : [];
    const [equipmentRows] = await connection.execute('SELECT slot, item_code AS itemCode FROM player_equipment WHERE player_id = ? ORDER BY slot', [player.id]);
    const [learnedRows] = await connection.execute('SELECT skill_code AS skillCode FROM player_skills WHERE player_id = ? ORDER BY learned_at, skill_code', [player.id]);
    const [equippedRows] = await connection.execute('SELECT skill_code AS skillCode FROM player_equipped_skills WHERE player_id = ? ORDER BY slot', [player.id]);
    const inventory = [
      ...inventoryRows,
      ...instanceRows
        .filter((row) => row.location === 'INVENTORY')
        .map((row) => ({
          id: row.id,
          instanceId: row.id,
          isInstance: true,
          itemCode: row.itemCode,
          quantity: 1,
          slot: row.inventorySlot ?? 0,
          rarity: row.rarity || 'NORMAL',
          enhanceLevel: Number(row.enhanceLevel || 0),
          hasLuck: Boolean(row.hasLuck),
          exlOptions: parseExlOptions(row.exlOptionsJson),
        })),
    ].sort((a, b) => (Number(a.slot || 0) - Number(b.slot || 0)) || String(a.id).localeCompare(String(b.id)));

    const stats = { str: player.str, agi: player.agi, vit: player.vit, ene: player.ene, unspentPoints: player.unspentPoints };
    const equipment = Object.fromEntries(equipmentRows.map((row) => [row.slot, { id: row.itemCode, itemCode: row.itemCode }]));
    for (const row of instanceRows) {
      if (row.location !== 'EQUIPPED' || !row.equippedSlot) continue;
      equipment[row.equippedSlot] = {
        id: row.itemCode,
        itemCode: row.itemCode,
        instanceId: row.id,
        isInstance: true,
        rarity: row.rarity || 'NORMAL',
        enhanceLevel: Number(row.enhanceLevel || 0),
        hasLuck: Boolean(row.hasLuck),
        exlOptions: parseExlOptions(row.exlOptionsJson),
      };
    }
    const itemsCatalog = activeItems();
    const hydratedEquipment = Object.fromEntries(
      Object.entries(equipment).map(([slot, entry]) => {
        if (!entry) return [slot, null];
        const def = findCatalogItem(entry.itemCode, itemsCatalog);
        return [slot, def ? { ...def, ...entry } : entry];
      }),
    );
    const learnedSkills = learnedRows.map((row) => row.skillCode);
    const equippedSkills = equippedRows.map((row) => row.skillCode);
    return publicPlayer({
      ...player,
      stats,
      derivedStats: deriveStats(stats, hydratedEquipment),
      skills: [],
      combatPower: combatPower({ ...player, realm: 1, tangTuVi: player.realmStage, tuViHienTai: player.tuVi, tuViLenCap: 1, stats, equipment: hydratedEquipment, learnedSkills }),
    }, wallet, inventory, equipment, learnedSkills, equippedSkills);
  }
  async function playerSnapshot(userId) { return withConnection((connection) => snapshotWith(connection, userId)); }

  async function createPlayer(userId, player) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[user]] = await connection.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (!user) throw new DomainError('UNAUTHORIZED', 'Tài khoản không tồn tại', 401);
        const [existing] = await connection.execute('SELECT id FROM players WHERE user_id = ? FOR UPDATE', [userId]);
        if (existing.length) { const result = await snapshotWith(connection, userId); await connection.commit(); return result; }
        const stats = player.stats || { str: 5, agi: 5, vit: 5, ene: 5 };
        await connection.execute('INSERT INTO players (id, user_id, name, gender, linh_can, realm_code, realm_stage, tu_vi, tu_vi_linh_can, hp, max_hp, mp, max_mp, map_code, x, y, version, str_stat, agi_stat, vit_stat, ene_stat, unspent_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [player.id, userId, player.name, player.gender, player.linhCan, player.realmCode, player.realmStage, player.tuVi, player.tuViLinhCan, player.hp, player.maxHp, player.mp, player.maxMp, player.mapCode, player.x, player.y, player.version, stats.str, stats.agi, stats.vit, stats.ene, 0]);
        await connection.execute('INSERT INTO wallets (player_id, xu, linh_thach, version) VALUES (?, 50, 0, 1)', [player.id]);
        await connection.execute('INSERT INTO currency_ledger (id, player_id, currency_type, reason, amount, balance_after, reference_type, reference_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))', [`led_${crypto.randomUUID()}`, player.id, 'XU', 'REWARD', 50, 50, 'SYSTEM', 'PLAYER_CREATE', 'PLAYER_CREATE']);
        for (const skillCode of player.initialLearnedSkills || []) {
          await connection.execute('INSERT INTO player_skills (player_id, skill_code) VALUES (?, ?)', [player.id, skillCode]);
        }
        for (const [index, skillCode] of (player.initialEquippedSkills || []).entries()) {
          await connection.execute('INSERT INTO player_equipped_skills (player_id, slot, skill_code) VALUES (?, ?, ?)', [player.id, index + 1, skillCode]);
        }
        const result = await snapshotWith(connection, userId); await connection.commit(); return result;
      } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') throw new DomainError('PLAYER_CONFLICT', 'Tên nhân vật hoặc hồ sơ đã tồn tại', 409);
        throw error;
      }
    });
  }

  async function buyItem(userId, requestId, itemCode, count, item) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query('SELECT id, hp, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE', [userId]);
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) { const replay = replayIdempotentResult(dedup[0], 'BUY_ITEM', itemCode, count); await connection.commit(); return replay; }
        assertPlayerAlive(player, 'mua vật phẩm');
        const currencyType = String(item.currency || 'XU').toUpperCase() === 'LINH_THACH' ? 'LINH_THACH' : 'XU';
        const total = item.price * count;
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType,
          delta: -total,
          reason: 'BUY_ITEM',
          idempotencyKey: requestId,
          referenceType: 'ITEM',
          referenceId: itemCode,
        });
        const catalogDef = findCatalogItem(itemCode);
        if (isEquipmentDef(catalogDef || item)) {
          const usedSlots = await countUsedInventorySlots(connection, player.id);
          if (usedSlots + count > getInventoryCapacity(player)) throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đầy', 409);
          for (let i = 0; i < count; i += 1) {
            const slot = await nextInventorySlot(connection, player.id);
            await createItemInstance(connection, player.id, itemCode, {
              rarity: catalogDef?.rarity || 'NORMAL',
              enhanceLevel: 0,
              hasLuck: Boolean(catalogDef?.hasLuck),
              exlOptions: [],
            }, 'INVENTORY', slot);
          }
        } else {
          const [[existingItem]] = await connection.query('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [player.id, itemCode]);
          if (existingItem) {
            if (existingItem.quantity + count > 99) throw new DomainError('INVENTORY_STACK_LIMIT', 'Số lượng vật phẩm vượt giới hạn túi đồ', 409);
            await connection.execute('UPDATE inventory_items SET quantity = quantity + ?, version = version + 1 WHERE id = ?', [count, existingItem.id]);
          } else {
            const usedSlots = await countUsedInventorySlots(connection, player.id);
            if (usedSlots >= getInventoryCapacity(player)) throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đầy', 409);
            const slot = await nextInventorySlot(connection, player.id);
            await connection.execute('INSERT INTO inventory_items (id, player_id, item_code, quantity, slot, version) VALUES (?, ?, ?, ?, ?, 1)', [`inv_${crypto.randomUUID()}`, player.id, itemCode, count, slot]);
          }
        }
        const result = await snapshotWith(connection, userId);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, idempotencyEnvelope('BUY_ITEM', itemCode, count, result)]);
        await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function sellItem(userId, requestId, itemCode, count, item, instanceId = null) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query('SELECT id, hp FROM players WHERE user_id = ? FOR UPDATE', [userId]);
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const itemKey = instanceId ? `${itemCode}:${instanceId}` : itemCode;
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) { const replay = replayIdempotentResult(dedup[0], 'SELL_ITEM', itemKey, count); await connection.commit(); return replay; }
        assertPlayerAlive(player, 'bán vật phẩm');
        const [[wallet]] = await connection.query('SELECT xu FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        if (!wallet) throw new DomainError('WALLET_NOT_FOUND', 'Không tìm thấy ví nhân vật', 404);

        let total = 0;
        const catalogDef = findCatalogItem(itemCode);
        if (instanceId) {
          if (count !== 1) throw new DomainError('INVALID_QUANTITY', 'Trang bị cá thể chỉ có thể bán từng món một', 400);
          const [[inst]] = await connection.query(
            'SELECT id, item_code AS itemCode, location, rarity, enhance_level AS enhanceLevel FROM item_instances WHERE id = ? AND owner_player_id = ? FOR UPDATE',
            [instanceId, player.id],
          );
          if (!inst || inst.location !== 'INVENTORY') throw new DomainError('INSUFFICIENT_ITEM', 'Không tìm thấy trang bị trong túi đồ để bán', 409);
          if (inst.itemCode !== itemCode) throw new DomainError('ITEM_MISMATCH', 'Trang bị không khớp với mã vật phẩm', 409);
          total = calcEquipmentSellPrice(item.sellPrice, inst.enhanceLevel, inst.rarity);
          await connection.execute(
            "UPDATE item_instances SET location = 'DESTROYED', inventory_slot = NULL, equipped_slot = NULL, version = version + 1 WHERE id = ?",
            [inst.id],
          );
        } else if (isEquipmentDef(catalogDef || item)) {
          const [instRows] = await connection.query(
            "SELECT id, rarity, enhance_level AS enhanceLevel FROM item_instances WHERE owner_player_id = ? AND item_code = ? AND location = 'INVENTORY' ORDER BY enhance_level ASC, inventory_slot ASC LIMIT ? FOR UPDATE",
            [player.id, itemCode, count],
          );
          if (instRows.length >= count) {
            for (const row of instRows.slice(0, count)) {
              total += calcEquipmentSellPrice(item.sellPrice, row.enhanceLevel, row.rarity);
              await connection.execute(
                "UPDATE item_instances SET location = 'DESTROYED', inventory_slot = NULL, equipped_slot = NULL, version = version + 1 WHERE id = ?",
                [row.id],
              );
            }
          } else {
            const [[inventoryItem]] = await connection.execute('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [player.id, itemCode]);
            if (!inventoryItem || inventoryItem.quantity < count) throw new DomainError('INSUFFICIENT_ITEM', 'Không đủ vật phẩm để bán', 409);
            total = item.sellPrice * count;
            if (inventoryItem.quantity === count) await connection.execute('DELETE FROM inventory_items WHERE id = ?', [inventoryItem.id]);
            else await connection.execute('UPDATE inventory_items SET quantity = quantity - ?, version = version + 1 WHERE id = ?', [count, inventoryItem.id]);
          }
        } else {
          const [[inventoryItem]] = await connection.execute('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [player.id, itemCode]);
          if (!inventoryItem || inventoryItem.quantity < count) throw new DomainError('INSUFFICIENT_ITEM', 'Không đủ vật phẩm để bán', 409);
          total = item.sellPrice * count;
          if (inventoryItem.quantity === count) {
            await connection.execute('DELETE FROM inventory_items WHERE id = ?', [inventoryItem.id]);
          } else {
            await connection.execute('UPDATE inventory_items SET quantity = quantity - ?, version = version + 1 WHERE id = ?', [count, inventoryItem.id]);
          }
        }

        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'XU',
          delta: total,
          reason: 'SELL_ITEM',
          idempotencyKey: requestId,
          referenceType: 'ITEM',
          referenceId: itemCode,
        });
        const result = await snapshotWith(connection, userId);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, idempotencyEnvelope('SELL_ITEM', itemKey, count, result, total)]);
        Object.defineProperty(result, '_sellTotal', { value: total, enumerable: false });
        await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function useInventoryItem(userId, requestId, itemCode, operation, effect) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const intent = { operation, itemCode, quantity: 1 };
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return replay;
        }
        assertPlayerAlive(player, 'sử dụng vật phẩm');

        if (effect.kind === 'exchange_xu') {
          await connection.query('SELECT xu FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        }

        const [[inventoryItem]] = await connection.query(
          'SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE',
          [player.id, itemCode],
        );
        if (!inventoryItem || inventoryItem.quantity < 1) throw new DomainError('ITEM_NOT_IN_INVENTORY', 'Vật phẩm không có trong túi đồ', 404);

        const before = playerState(player);
        const next = { ...player, inventoryCapacity: getInventoryCapacity(player) };
        let result;
        if (effect.kind === 'cultivation') {
          next.tuVi += effect.amount;
          result = { type: 'cultivation_absorbed', itemId: itemCode, amount: effect.amount, hp: 0, mp: 0, stat: null };
        } else if (effect.kind === 'root_cultivation') {
          const gain = Math.min(effect.amount, Math.max(0, effect.cap - next.tuViLinhCan));
          if (gain <= 0) throw new DomainError('ROOT_CULTIVATION_CAPPED', 'Tu vi linh căn đã đạt giới hạn vật phẩm', 409);
          next.tuViLinhCan += gain;
          result = { type: 'root_cultivation', itemId: itemCode, gain, hp: 0, mp: 0, stat: null };
        } else if (effect.kind === 'bag_expand') {
          const currentCap = getInventoryCapacity(player);
          const maxCap = BALANCE.inventory.maxCapacity;
          if (currentCap >= maxCap) throw new DomainError('INVENTORY_CAPACITY_MAXED', `Túi đồ đã đạt giới hạn tối đa ${maxCap} ô`, 409);
          next.inventoryCapacity = Math.min(maxCap, currentCap + effect.slots);
          result = {
            type: 'inventory_expanded',
            itemId: itemCode,
            addedSlots: next.inventoryCapacity - currentCap,
            inventoryCapacity: next.inventoryCapacity,
          };
        } else if (effect.kind === 'stat_reset') {
          const base = BALANCE.creation.minStat;
          const refunded = Math.max(0, Number(player.str) - base)
            + Math.max(0, Number(player.agi) - base)
            + Math.max(0, Number(player.vit) - base)
            + Math.max(0, Number(player.ene) - base);
          if (refunded <= 0) throw new DomainError('STAT_RESET_NOT_NEEDED', 'Chưa cộng điểm tiềm năng nào để tẩy điểm', 409);
          next.str = Math.min(Number(player.str), base);
          next.agi = Math.min(Number(player.agi), base);
          next.vit = Math.min(Number(player.vit), base);
          next.ene = Math.min(Number(player.ene), base);
          next.unspentPoints = Number(player.unspentPoints || 0) + refunded;
          next.maxHp = BALANCE.base.hp + next.vit * BALANCE.stats.vit.maxHp;
          next.maxMp = BALANCE.base.mp + next.ene * BALANCE.stats.ene.maxMp;
          const effective = await resolveEffectiveVitalsForPlayer(connection, next);
          next.hp = Math.min(Number(next.hp), effective.maxHp);
          next.mp = Math.min(Number(next.mp), effective.maxMp);
          result = {
            type: 'stats_reset',
            itemId: itemCode,
            refundedPoints: refunded,
            unspentStatPoints: next.unspentPoints,
            stats: { str: next.str, agi: next.agi, vit: next.vit, ene: next.ene },
          };
        } else if (effect.kind === 'exchange_xu') {
          const wallet = await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'XU',
            delta: effect.xuAmount,
            reason: 'ITEM_EXCHANGE',
            idempotencyKey: requestId,
            referenceType: 'ITEM',
            referenceId: itemCode,
          });
          result = { type: 'xu_exchanged', itemId: itemCode, xuAdded: effect.xuAmount, xu: wallet.xu };
        } else if (effect.kind === 'potion') {
          const hpBefore = next.hp;
          const mpBefore = next.mp;
          let stat = null;
          if (effect.statBoost > 0) {
            const statColumn = { str: 'str', agi: 'agi', vit: 'vit', ene: 'ene' }[effect.statKey];
            if (!statColumn) throw new DomainError('INVALID_ITEM_EFFECT', 'Hiệu ứng chỉ số vật phẩm không hợp lệ', 500);
            next[statColumn] += effect.statBoost;
            if (statColumn === 'vit') next.maxHp = 100 + next.vit * 12;
            if (statColumn === 'ene') next.maxMp = 50 + next.ene * 8;
            stat = { key: statColumn, amount: effect.statBoost };
          }
          const effective = await resolveEffectiveVitalsForPlayer(connection, next);
          next.hp = Math.min(effective.maxHp, next.hp + effect.healHp);
          next.mp = Math.min(effective.maxMp, next.mp + effect.healMp);
          result = { type: 'item_used', itemId: itemCode, hp: next.hp - hpBefore, mp: next.mp - mpBefore, stat };
          if (result.hp === 0 && result.mp === 0 && !result.stat) throw new DomainError('ITEM_HAS_NO_EFFECT', 'Vật phẩm hiện không có hiệu quả', 409);
        } else {
          throw new DomainError('ITEM_USE_NOT_SUPPORTED', 'Vật phẩm này chưa hỗ trợ sử dụng', 409);
        }

        if (inventoryItem.quantity === 1) {
          await connection.execute('DELETE FROM inventory_items WHERE id = ?', [inventoryItem.id]);
        } else {
          await connection.execute('UPDATE inventory_items SET quantity = quantity - 1, version = version + 1 WHERE id = ?', [inventoryItem.id]);
        }
        await connection.execute(
          'UPDATE players SET tu_vi = ?, tu_vi_linh_can = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?, str_stat = ?, agi_stat = ?, vit_stat = ?, ene_stat = ?, unspent_points = ?, inventory_capacity = ?, version = version + 1 WHERE id = ?',
          [next.tuVi, next.tuViLinhCan, next.hp, next.maxHp, next.mp, next.maxMp, next.str, next.agi, next.vit, next.ene, next.unspentPoints, next.inventoryCapacity, player.id],
        );
        const after = playerState(next);
        await saveAction(connection, player.id, operation, requestId, { itemCode, effect }, before, after);
        const updatedPlayer = await snapshotWith(connection, userId);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: updatedPlayer, result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function allocateStats(userId, requestId, stat, amount) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const intent = { operation: 'ALLOCATE_STAT', stat, amount };
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return replay;
        }
        assertPlayerAlive(player, 'cộng điểm tiềm năng');
        if (player.unspentPoints < amount) throw new DomainError('INSUFFICIENT_STAT_POINTS', 'Không đủ điểm thuộc tính', 409);
        const before = playerState(player);
        const next = { ...player, unspentPoints: player.unspentPoints - amount };
        next[stat] += amount;
        if (stat === 'vit') next.maxHp = 100 + next.vit * 12;
        if (stat === 'ene') next.maxMp = 50 + next.ene * 8;
        if (stat === 'vit' || stat === 'ene') {
          const effective = await resolveEffectiveVitalsForPlayer(connection, next);
          next.hp = Math.min(next.hp, effective.maxHp);
          next.mp = Math.min(next.mp, effective.maxMp);
        }
        await connection.execute(
          'UPDATE players SET str_stat = ?, agi_stat = ?, vit_stat = ?, ene_stat = ?, unspent_points = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?, version = version + 1 WHERE id = ?',
          [next.str, next.agi, next.vit, next.ene, next.unspentPoints, next.hp, next.maxHp, next.mp, next.maxMp, player.id],
        );
        const after = playerState(next);
        await saveAction(connection, player.id, 'ALLOCATE_STAT', requestId, { stat, amount }, before, after);
        const updatedPlayer = await snapshotWith(connection, userId);
        const result = { stats: { str: next.str, agi: next.agi, vit: next.vit, ene: next.ene }, unspentStatPoints: next.unspentPoints, derivedStats: deriveStats({ str: next.str, agi: next.agi, vit: next.vit, ene: next.ene }) };
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: updatedPlayer, result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function updatePlayerName(userId, playerId, name) {
    return withConnection(async (connection) => {
      const [[owned]] = await connection.query('SELECT id FROM players WHERE id = ? AND user_id = ? LIMIT 1', [playerId, userId]);
      if (!owned) {
        const [[exists]] = await connection.query('SELECT id FROM players WHERE id = ? LIMIT 1', [playerId]);
        throw new DomainError(exists ? 'FORBIDDEN' : 'PLAYER_NOT_FOUND', exists ? 'Không được phép cập nhật nhân vật này' : 'Chưa tạo nhân vật', exists ? 403 : 404);
      }
      try {
        await connection.execute('UPDATE players SET name = ?, version = version + 1 WHERE id = ?', [name, playerId]);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new DomainError('PLAYER_CONFLICT', 'Tên nhân vật đã tồn tại', 409);
        throw error;
      }
      return snapshotWith(connection, userId);
    });
  }

  async function savePlayerPosition(userId, mapCode, x, y, { includeSnapshot = true, expectedPosition } = {}) {
    return withConnection(async (connection) => {
      let result;
      if (expectedPosition) {
        [result] = await connection.execute(
          'UPDATE players SET map_code = ?, x = ?, y = ?, position_version = position_version + 1, version = version + 1 WHERE user_id = ? AND position_version = ? AND hp > 0',
          [mapCode, x, y, userId, expectedPosition.positionVersion],
        );
      } else {
        [result] = await connection.execute('UPDATE players SET map_code = ?, x = ?, y = ?, position_version = position_version + 1, version = version + 1 WHERE user_id = ?', [mapCode, x, y, userId]);
      }
      if (!result.affectedRows && expectedPosition) {
        const [[existing]] = await connection.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
        if (existing) return { saved: false, stale: true };
      }
      if (!result.affectedRows) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
      if (!includeSnapshot) return { saved: true, mapCode, x, y, positionVersion: Number(expectedPosition?.positionVersion || 0) + 1 };
      return snapshotWith(connection, userId);
    });
  }

  async function resolveEffectiveVitalsForPlayer(connection, player, items = activeItems(), skills = activeSkills()) {
    const [legacyRows] = await connection.execute('SELECT slot, item_code AS itemCode FROM player_equipment WHERE player_id = ?', [player.id]);
    const [rawInstRows] = await connection.execute(
      "SELECT id, item_code AS itemCode, equipped_slot AS slot, rarity, enhance_level AS enhanceLevel, has_luck AS hasLuck, exl_options_json AS exlOptionsJson FROM item_instances WHERE owner_player_id = ? AND location = 'EQUIPPED'",
      [player.id],
    );
    const instRows = Array.isArray(rawInstRows) ? rawInstRows : [];
    const [learnedRows] = await connection.execute('SELECT skill_code AS skillCode FROM player_skills WHERE player_id = ?', [player.id]);
    const equipment = Object.fromEntries(
      legacyRows.map((row) => [row.slot, findCatalogItem(row.itemCode, items)]),
    );
    for (const row of instRows) {
      if (!row.slot) continue;
      const def = findCatalogItem(row.itemCode, items);
      equipment[row.slot] = {
        ...(def || {}),
        id: row.itemCode,
        itemCode: row.itemCode,
        instanceId: row.id,
        rarity: row.rarity || def?.rarity || 'NORMAL',
        enhanceLevel: Number(row.enhanceLevel || 0),
        hasLuck: Boolean(row.hasLuck),
        exlOptions: parseExlOptions(row.exlOptionsJson),
      };
    }
    const learnedSkills = learnedRows.map((row) => row.skillCode);
    const derived = deriveStats({ str: player.str, agi: player.agi, vit: player.vit, ene: player.ene }, equipment);
    const passive = resolvePassiveModifiers(skills, learnedSkills, player.linhCan);
    return effectiveMaxVitals(player, derived, passive);
  }

  async function updateVitals(userId, requestId, action, changes) {
    const intent = { operation: action, hp: changes.hp || 0, mp: changes.mp || 0, mpCost: changes.mpCost || 0 };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      if (player.mp < intent.mpCost) throw new DomainError('INSUFFICIENT_MP', 'Không đủ linh lực', 409);
      const effective = await resolveEffectiveVitalsForPlayer(connection, player);
      // Đã tử vong thì chỉ /player/respawn mới hồi được HP (regen/heal đến muộn không được hồi sinh).
      const hp = player.hp <= 0 ? 0 : Math.max(0, Math.min(effective.maxHp, player.hp + intent.hp));
      const mp = Math.max(0, Math.min(effective.maxMp, player.mp - intent.mpCost + intent.mp));
      await connection.execute('UPDATE players SET hp = ?, mp = ? WHERE id = ?', [hp, mp, player.id]);
      return { hp, maxHp: effective.maxHp, mp, maxMp: effective.maxMp };
    }, { includeSnapshot: false, afterState: (result) => ({ hp: result.hp, mp: result.mp }) });
  }

  async function respawn(userId, requestId, mapCode, x, y) {
    const intent = { operation: 'PLAYER_RESPAWN', mapCode, x, y };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      if (Number(player.hp) > 0) throw new DomainError('PLAYER_NOT_DEAD', 'Nhân vật chưa tử trận', 409);
      const effective = await resolveEffectiveVitalsForPlayer(connection, player);
      const [[wallet]] = await connection.query('SELECT xu FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
      const xuBefore = Math.max(0, Math.floor(Number(wallet?.xu || 0)));
      const realmStt = Number(activeRealms().find((entry) => entry.code === player.realmCode)?.stt || 1);
      const xuLost = calcDeathXuPenalty(xuBefore, realmStt);
      const xuAfter = xuBefore - xuLost;
      if (xuLost > 0) {
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'XU',
          delta: -xuLost,
          reason: 'DEATH_PENALTY',
          idempotencyKey: requestId,
          referenceType: 'RESPAWN',
          referenceId: mapCode,
        });
      }
      await connection.execute(
        'UPDATE players SET hp = ?, mp = ?, map_code = ?, x = ?, y = ?, position_version = position_version + 1 WHERE id = ?',
        [effective.maxHp, effective.maxMp, mapCode, x, y, player.id],
      );
      return {
        type: 'player_respawned',
        mapCode,
        x,
        y,
        hp: effective.maxHp,
        maxHp: effective.maxHp,
        mp: effective.maxMp,
        maxMp: effective.maxMp,
        xu: xuAfter,
        xuLost,
        tuViLost: 0,
      };
    }, { afterState: (result) => ({ hp: result.hp, mp: result.mp, xu: result.xu, xuLost: result.xuLost, tuViLost: result.tuViLost }) });
  }

  async function pickupGroundItem(userId, requestId, dropId, itemCode, quantity, dropMeta = {}) {
    const intent = { operation: 'LOOT_PICKUP', dropId, itemCode, quantity };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      try {
        await connection.execute('INSERT INTO loot_pickups (drop_id, player_id, item_code, quantity) VALUES (?, ?, ?, ?)', [dropId, player.id, itemCode, quantity]);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new DomainError('LOOT_ALREADY_CLAIMED', 'Vật phẩm rơi đã được nhặt', 409);
        throw error;
      }
      const catalogDef = findCatalogItem(itemCode);
      const maxSlots = getInventoryCapacity(player);
      const createdInstances = [];
      if (isEquipmentDef(catalogDef)) {
        const usedSlots = await countUsedInventorySlots(connection, player.id);
        if (usedSlots + quantity > maxSlots || quantity > 99) throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đầy', 409);
        for (let i = 0; i < quantity; i += 1) {
          const slot = await nextInventorySlot(connection, player.id);
          const created = await createItemInstance(connection, player.id, itemCode, {
            rarity: dropMeta?.rarity || catalogDef?.rarity || 'NORMAL',
            enhanceLevel: dropMeta?.enhanceLevel || 0,
            hasLuck: Boolean(dropMeta?.hasLuck ?? catalogDef?.hasLuck),
            exlOptions: Array.isArray(dropMeta?.exlOptions) ? dropMeta.exlOptions : [],
          }, 'INVENTORY', slot);
          createdInstances.push(created);
        }
      } else {
        const [[existing]] = await connection.query('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [player.id, itemCode]);
        if (existing) {
          if (existing.quantity + quantity > 99) throw new DomainError('INVENTORY_STACK_LIMIT', 'Số lượng vật phẩm vượt giới hạn túi đồ', 409);
          await connection.execute('UPDATE inventory_items SET quantity = quantity + ?, version = version + 1 WHERE id = ?', [quantity, existing.id]);
        } else {
          const usedSlots = await countUsedInventorySlots(connection, player.id);
          if (usedSlots >= maxSlots || quantity > 99) throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đầy', 409);
          const slot = await nextInventorySlot(connection, player.id);
          await connection.execute('INSERT INTO inventory_items (id, player_id, item_code, quantity, slot, version) VALUES (?, ?, ?, ?, ?, 1)', [`inv_${crypto.randomUUID()}`, player.id, itemCode, quantity, slot]);
        }
      }
      return {
        accepted: true,
        dropId,
        itemCode,
        quantity,
        ...(createdInstances.length ? { instances: createdInstances } : {}),
      };
    });
  }

  async function takeInventoryItem(connection, playerId, itemCode) {
    const [[item]] = await connection.query('SELECT id, quantity FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [playerId, itemCode]);
    if (!item || item.quantity < 1) throw new DomainError('ITEM_NOT_IN_INVENTORY', 'Vật phẩm không có trong túi đồ', 404);
    if (item.quantity === 1) await connection.execute('DELETE FROM inventory_items WHERE id = ?', [item.id]);
    else await connection.execute('UPDATE inventory_items SET quantity = quantity - 1, version = version + 1 WHERE id = ?', [item.id]);
  }

  async function equipItem(userId, requestId, itemCode, slot, expectedRealmCode, playerRealmStt, requiredRealmStt, instanceId = null) {
    const intent = { operation: 'EQUIP_ITEM', itemCode, slot, ...(instanceId ? { instanceId } : {}) };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      assertPlayerAlive(player, 'trang bị vật phẩm');
      if (player.realmCode !== expectedRealmCode) throw new DomainError('PLAYER_STATE_CHANGED', 'Nhân vật đã thay đổi trạng thái, hãy tải lại rồi thử lại', 409);
      const [realmRows] = await connection.execute('SELECT realm_code AS realmCode FROM players WHERE id = ? LIMIT 1', [player.id]);
      if (realmRows[0]?.realmCode !== expectedRealmCode) throw new DomainError('PLAYER_STATE_CHANGED', 'Nhân vật đã thay đổi trạng thái, hãy tải lại rồi thử lại', 409);
      if (playerRealmStt < requiredRealmStt) throw new DomainError('REALM_TOO_LOW', 'Cảnh giới chưa đủ để trang bị', 409);

      const [instRows] = await connection.query(
        "SELECT id, item_code AS itemCode, location, inventory_slot AS inventorySlot, equipped_slot AS equippedSlot, rarity, enhance_level AS enhanceLevel FROM item_instances WHERE owner_player_id = ? AND location IN ('INVENTORY', 'EQUIPPED') ORDER BY id FOR UPDATE",
        [player.id],
      );
      const [legacyEquipRows] = await connection.query('SELECT slot, item_code AS itemCode FROM player_equipment WHERE player_id = ? FOR UPDATE', [player.id]);

      let targetInst = null;
      if (instanceId) {
        targetInst = instRows.find((row) => row.id === instanceId);
        if (!targetInst) throw new DomainError('ITEM_NOT_IN_INVENTORY', 'Vật phẩm không có trong túi đồ', 404);
        if (targetInst.location === 'EQUIPPED') throw new DomainError('ITEM_ALREADY_EQUIPPED', 'Trang bị này đang được trang bị', 409);
        if (targetInst.location !== 'INVENTORY') throw new DomainError('ITEM_NOT_IN_INVENTORY', 'Vật phẩm không có trong túi đồ', 404);
        if (itemCode && targetInst.itemCode !== itemCode) throw new DomainError('ITEM_MISMATCH', 'Trang bị không khớp với mã yêu cầu', 409);
      } else {
        targetInst = instRows
          .filter((row) => row.location === 'INVENTORY' && row.itemCode === itemCode)
          .sort((a, b) => Number(b.enhanceLevel || 0) - Number(a.enhanceLevel || 0))[0] || null;
      }

      const equippedAtSlot = instRows.find((row) => row.location === 'EQUIPPED' && row.equippedSlot === slot) || null;
      const legacyPrevious = legacyEquipRows.find((row) => row.slot === slot) || null;
      const equippedSameCode = instRows.find((row) => row.location === 'EQUIPPED' && row.itemCode === itemCode)
        || legacyEquipRows.find((row) => row.itemCode === itemCode);

      if (!targetInst) {
        if (equippedSameCode) throw new DomainError('ITEM_ALREADY_EQUIPPED', 'Trang bị này đang được trang bị', 409);
        await takeInventoryItem(connection, player.id, itemCode);
        const def = findCatalogItem(itemCode);
        const slotIdx = await nextInventorySlot(connection, player.id);
        const created = await createItemInstance(connection, player.id, itemCode, {
          rarity: def?.rarity || 'NORMAL',
          enhanceLevel: 0,
          hasLuck: Boolean(def?.hasLuck),
          exlOptions: [],
        }, 'INVENTORY', slotIdx);
        targetInst = { id: created.instanceId, itemCode, inventorySlot: created.slot, location: 'INVENTORY' };
      }

      const returnSlot = targetInst.inventorySlot != null ? targetInst.inventorySlot : await nextInventorySlot(connection, player.id);
      if (equippedAtSlot) {
        await connection.execute(
          "UPDATE item_instances SET location = 'INVENTORY', equipped_slot = NULL, inventory_slot = ?, version = version + 1 WHERE id = ?",
          [returnSlot, equippedAtSlot.id],
        );
      } else if (legacyPrevious) {
        const prevDef = findCatalogItem(legacyPrevious.itemCode);
        await createItemInstance(connection, player.id, legacyPrevious.itemCode, {
          rarity: prevDef?.rarity || 'NORMAL',
          enhanceLevel: 0,
          hasLuck: Boolean(prevDef?.hasLuck),
          exlOptions: [],
        }, 'INVENTORY', returnSlot);
      }

      await connection.execute(
        "UPDATE item_instances SET location = 'EQUIPPED', equipped_slot = ?, inventory_slot = NULL, version = version + 1 WHERE id = ?",
        [slot, targetInst.id],
      );
      await connection.execute(
        'INSERT INTO player_equipment (player_id, slot, item_code, version) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE item_code = VALUES(item_code), version = version + 1',
        [player.id, slot, targetInst.itemCode],
      );
      return { type: 'equipment_equipped', slot, itemId: targetInst.itemCode, instanceId: targetInst.id };
    });
  }

  async function unequipItem(userId, requestId, slot) {
    const intent = { operation: 'UNEQUIP_ITEM', slot };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      assertPlayerAlive(player, 'tháo trang bị');
      const [[equippedInst]] = await connection.query(
        "SELECT id, item_code AS itemCode FROM item_instances WHERE owner_player_id = ? AND location = 'EQUIPPED' AND equipped_slot = ? FOR UPDATE",
        [player.id, slot],
      );
      const [[legacyEquipped]] = await connection.query('SELECT item_code AS itemCode FROM player_equipment WHERE player_id = ? AND slot = ? FOR UPDATE', [player.id, slot]);
      if (!equippedInst && !legacyEquipped) throw new DomainError('EQUIPMENT_NOT_FOUND', 'Không có trang bị ở vị trí này', 404);
      const usedSlots = await countUsedInventorySlots(connection, player.id);
      if (usedSlots >= getInventoryCapacity(player)) throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đầy', 409);
      const nextSlot = await nextInventorySlot(connection, player.id);
      let returnedInstanceId = null;
      const itemCode = equippedInst?.itemCode || legacyEquipped.itemCode;
      if (equippedInst) {
        returnedInstanceId = equippedInst.id;
        await connection.execute(
          "UPDATE item_instances SET location = 'INVENTORY', equipped_slot = NULL, inventory_slot = ?, version = version + 1 WHERE id = ?",
          [nextSlot, equippedInst.id],
        );
      } else {
        const def = findCatalogItem(itemCode);
        const created = await createItemInstance(connection, player.id, itemCode, {
          rarity: def?.rarity || 'NORMAL',
          enhanceLevel: 0,
          hasLuck: Boolean(def?.hasLuck),
          exlOptions: [],
        }, 'INVENTORY', nextSlot);
        returnedInstanceId = created.instanceId;
      }
      await connection.execute('DELETE FROM player_equipment WHERE player_id = ? AND slot = ?', [player.id, slot]);
      return { type: 'equipment_unequipped', slot, itemId: itemCode, instanceId: returnedInstanceId };
    });
  }

  async function learnSkill(userId, requestId, skillCode, expectedRealmCode, expectedRoot, playerRealmStt, requiredRealmStt) {
    const intent = { operation: 'LEARN_SKILL', skillCode };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      assertPlayerAlive(player, 'trang bị vật phẩm');
      if (player.realmCode !== expectedRealmCode) throw new DomainError('PLAYER_STATE_CHANGED', 'Nhân vật đã thay đổi trạng thái, hãy tải lại rồi thử lại', 409);
      const [realmRows] = await connection.execute('SELECT realm_code AS realmCode, realm_stage AS realmStage FROM players WHERE id = ? LIMIT 1', [player.id]);
      if (realmRows[0]?.realmCode !== expectedRealmCode) throw new DomainError('PLAYER_STATE_CHANGED', 'Nhân vật đã thay đổi trạng thái, hãy tải lại rồi thử lại', 409);
      if (playerRealmStt < requiredRealmStt) throw new DomainError('REALM_TOO_LOW', 'Cảnh giới chưa đủ để lĩnh hội kỹ năng', 409);
      if (player.linhCan !== expectedRoot) throw new DomainError('PLAYER_STATE_CHANGED', 'Linh căn nhân vật đã thay đổi, hãy tải lại rồi thử lại', 409);
      await connection.execute('INSERT IGNORE INTO player_skills (player_id, skill_code) VALUES (?, ?)', [player.id, skillCode]);
      const [learned] = await connection.execute('SELECT skill_code AS skillCode FROM player_skills WHERE player_id = ? ORDER BY learned_at, skill_code', [player.id]);
      return { learnedSkills: learned.map((row) => row.skillCode) };
    });
  }

  async function equipSkills(userId, requestId, skillCodes) {
    const intent = { operation: 'EQUIP_SKILLS', skillCodes };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      const [learnedRows] = await connection.execute('SELECT skill_code AS skillCode FROM player_skills WHERE player_id = ? FOR UPDATE', [player.id]);
      const learned = new Set(learnedRows.map((row) => row.skillCode));
      if (skillCodes.some((code) => !learned.has(code))) throw new DomainError('SKILL_NOT_LEARNED', 'Chỉ được trang bị kỹ năng đã học', 409);
      await connection.execute('DELETE FROM player_equipped_skills WHERE player_id = ?', [player.id]);
      for (const [index, code] of skillCodes.entries()) {
        await connection.execute('INSERT INTO player_equipped_skills (player_id, slot, skill_code) VALUES (?, ?, ?)', [player.id, index + 1, code]);
      }
      return { equippedSkills: skillCodes };
    });
  }

  async function replayBreakthrough(userId, requestId, pillCode = null) {
    const [[row]] = await pool.execute(
      'SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ?',
      [userId, requestId],
    );
    return row ? replayMutation(row, { operation: 'BREAKTHROUGH', pillCode: pillCode || null }) : null;
  }

  async function breakthrough(userId, requestId, progression) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const intent = { operation: 'BREAKTHROUGH', pillCode: progression.requestedPillCode || null };
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return { ...replay, replayed: true };
        }
        if (!(Number(player.hp) > 0)) throw new DomainError('PLAYER_DEAD', 'Nhân vật đã tử vong, hãy hồi sinh trước khi đột phá', 409);
        if (player.realmCode !== progression.realm.code || player.realmStage !== progression.stage) {
          throw new DomainError('PLAYER_STATE_CHANGED', 'Nhân vật đã thay đổi trạng thái, hãy tải lại rồi thử lại', 409);
        }
        if (player.tuVi < progression.threshold) throw new DomainError('INSUFFICIENT_TUVI', 'Tu vi chưa đủ điều kiện đột phá', 409);
        const [equipmentRows] = await connection.execute('SELECT slot, item_code AS itemCode FROM player_equipment WHERE player_id = ?', [player.id]);
        const [rawInstEquipRows] = await connection.execute(
          "SELECT id, item_code AS itemCode, equipped_slot AS slot, rarity, enhance_level AS enhanceLevel, has_luck AS hasLuck, exl_options_json AS exlOptionsJson FROM item_instances WHERE owner_player_id = ? AND location = 'EQUIPPED'",
          [player.id],
        );
        const instEquipRows = Array.isArray(rawInstEquipRows) ? rawInstEquipRows : [];
        const [learnedRows] = await connection.execute('SELECT skill_code AS skillCode FROM player_skills WHERE player_id = ?', [player.id]);
        const itemsCatalog = progression.itemCatalog || activeItems();
        const equipment = Object.fromEntries(equipmentRows.map((row) => [row.slot, itemsCatalog.find((item) => item.id === row.itemCode || item.maDo === row.itemCode) || null]));
        for (const row of instEquipRows) {
          if (!row.slot) continue;
          const def = itemsCatalog.find((item) => item.id === row.itemCode || item.maDo === row.itemCode) || null;
          equipment[row.slot] = {
            ...(def || {}),
            id: row.itemCode,
            itemCode: row.itemCode,
            instanceId: row.id,
            rarity: row.rarity || def?.rarity || 'NORMAL',
            enhanceLevel: Number(row.enhanceLevel || 0),
            hasLuck: Boolean(row.hasLuck),
            exlOptions: parseExlOptions(row.exlOptionsJson),
          };
        }
        const power = combatPower({
          realm: progression.realm.stt,
          canhGioi: progression.realm,
          tangTuVi: player.realmStage,
          tuViHienTai: player.tuVi,
          tuViLenCap: progression.threshold,
          tuViLinhCan: player.tuViLinhCan,
          stats: { str: player.str, agi: player.agi, vit: player.vit, ene: player.ene },
          equipment,
          learnedSkills: learnedRows.map((row) => row.skillCode),
        });
        if (power < progression.requiredOvr) throw new DomainError('INSUFFICIENT_COMBAT_POWER', 'OVR chưa đủ điều kiện đột phá', 409);

        let wallet = null;
        if (progression.major) {
          [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        }

        let pill = null;
        let pillDef = null;
        let breakthroughRate = 1;
        if (progression.major && progression.realm.danPhaCanh) {
          const candidateCodes = Array.isArray(progression.candidatePillCodes) && progression.candidatePillCodes.length
            ? progression.candidatePillCodes
            : [progression.realm.danPhaCanh];
          const placeholders = candidateCodes.map(() => '?').join(', ');
          const [candidateRows] = await connection.query(
            `SELECT id, item_code AS itemCode, quantity FROM inventory_items WHERE player_id = ? AND item_code IN (${placeholders}) AND quantity > 0 ORDER BY item_code ASC, slot ASC FOR UPDATE`,
            [player.id, ...candidateCodes],
          );
          for (const code of candidateCodes) {
            const match = candidateRows.find((row) => row.itemCode === code && row.quantity >= 1);
            if (match) {
              pill = match;
              break;
            }
          }
          if (!pill) {
            const missingTarget = progression.requestedPillCode || progression.realm.danPhaCanh;
            throw new DomainError('BREAKTHROUGH_PILL_REQUIRED', `Cần ${missingTarget} trong túi đồ để phá đại cảnh giới`, 409);
          }
          pillDef = itemsCatalog.find((entry) => entry.id === pill.itemCode || entry.maDo === pill.itemCode) || { id: pill.itemCode };
          breakthroughRate = resolveBreakthroughPillRate(pillDef);
        }

        const before = playerState(player);
        const rolledRate = (progression.major && breakthroughRate < 1)
          ? Math.min(0.9999, Math.max(0, Number(typeof progression.rollRate === 'function' ? progression.rollRate() : (crypto.randomInt(0, 10_000) / 10_000))))
          : 0;
        const succeeded = !progression.major || breakthroughRate >= 1 || rolledRate < breakthroughRate;

        if (pill) {
          if (pill.quantity === 1) await connection.execute('DELETE FROM inventory_items WHERE id = ?', [pill.id]);
          else await connection.execute('UPDATE inventory_items SET quantity = quantity - 1, version = version + 1 WHERE id = ?', [pill.id]);
        }

        const learnedCodes = learnedRows.map((row) => row.skillCode);
        const derivedForVitals = (candidateStats) => effectiveMaxVitals(
          { maxHp: BALANCE.base.hp + candidateStats.vit * BALANCE.stats.vit.maxHp, maxMp: BALANCE.base.mp + candidateStats.ene * BALANCE.stats.ene.maxMp },
          deriveStats(candidateStats, equipment),
          resolvePassiveModifiers(activeSkills(), learnedCodes, player.linhCan),
        );

        let result;
        if (succeeded) {
          const stats = {
            str: player.str + progression.gain.str,
            agi: player.agi + progression.gain.agi,
            vit: player.vit + progression.gain.vit,
            ene: player.ene + progression.gain.ene,
          };
          const realmCode = progression.major ? progression.nextRealm.code : player.realmCode;
          const realmStage = progression.major ? 1 : player.realmStage + 1;
          const tuVi = Math.max(0, player.tuVi - progression.threshold);
          const unspentPoints = player.unspentPoints + Object.values(progression.gain).reduce((sum, value) => sum + Number(value || 0), 0);
          const maxHp = BALANCE.base.hp + stats.vit * BALANCE.stats.vit.maxHp;
          const maxMp = BALANCE.base.mp + stats.ene * BALANCE.stats.ene.maxMp;
          const effective = derivedForVitals(stats);
          const hp = Math.min(effective.maxHp, player.hp + progression.gain.vit * BALANCE.stats.vit.maxHp);
          const mp = Math.min(effective.maxMp, player.mp + progression.gain.ene * BALANCE.stats.ene.maxMp);
          const next = { ...player, ...stats, realmCode, realmStage, tuVi, hp, maxHp, mp, maxMp, unspentPoints };
          await connection.execute(
            'UPDATE players SET realm_code = ?, realm_stage = ?, tu_vi = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?, str_stat = ?, agi_stat = ?, vit_stat = ?, ene_stat = ?, unspent_points = ?, version = version + 1 WHERE id = ?',
            [realmCode, realmStage, tuVi, hp, maxHp, mp, maxMp, stats.str, stats.agi, stats.vit, stats.ene, unspentPoints, player.id],
          );
          result = {
            type: progression.major ? 'realm_breakthrough' : 'stage_breakthrough',
            success: true,
            gain: progression.gain,
            major: progression.major,
            pillCode: pillDef?.id || null,
            pillQuality: pillDef?.quality || null,
            pillQualityLabel: pillDef?.qualityLabel || null,
            breakthroughRate,
          };
          const after = playerState(next);
          await saveAction(connection, player.id, 'BREAKTHROUGH', requestId, { realmCode: progression.realm.code, stage: progression.stage, threshold: progression.threshold, major: progression.major, pillCode: pillDef?.id || null, breakthroughRate }, before, after);
        } else {
          const realmsList = progression.realmCatalog || activeRealms();
          const prevRealm = realmsList.find((entry) => Number(entry.stt) === Number(progression.realm.stt) - 1) || null;
          const reg = calcBreakthroughRegression({
            realm: progression.realm,
            prevRealm,
            stage: player.realmStage,
            stats: { str: player.str, agi: player.agi, vit: player.vit, ene: player.ene },
            currentTuVi: player.tuVi,
          });
          const rawPenalty = calcBreakthroughFailurePenalty(progression.realm.stt);
          const xuLost = Math.min(Math.max(0, Math.floor(Number(wallet?.xu || 0))), rawPenalty.xuPenalty);
          const linhThachLost = Math.min(Math.max(0, Math.floor(Number(wallet?.linhThach || 0))), rawPenalty.linhThachPenalty);
          if (xuLost > 0) {
            await adjustWalletBalance(connection, {
              playerId: player.id,
              currencyType: 'XU',
              delta: -xuLost,
              reason: 'BREAKTHROUGH_FAIL',
              idempotencyKey: ledgerIdempotencyKey(requestId, 'XU'),
              referenceType: 'BREAKTHROUGH',
              referenceId: progression.realm.code,
            });
          }
          if (linhThachLost > 0) {
            await adjustWalletBalance(connection, {
              playerId: player.id,
              currencyType: 'LINH_THACH',
              delta: -linhThachLost,
              reason: 'BREAKTHROUGH_FAIL',
              idempotencyKey: ledgerIdempotencyKey(requestId, 'LINH_THACH'),
              referenceType: 'BREAKTHROUGH',
              referenceId: progression.realm.code,
            });
          }
          const maxHp = BALANCE.base.hp + reg.nextStats.vit * BALANCE.stats.vit.maxHp;
          const maxMp = BALANCE.base.mp + reg.nextStats.ene * BALANCE.stats.ene.maxMp;
          const effective = derivedForVitals(reg.nextStats);
          const hp = Number(player.hp) > 0 ? Math.min(effective.maxHp, Math.max(1, Number(player.hp))) : 0;
          const mp = Math.min(effective.maxMp, Math.max(0, Number(player.mp || 0)));
          const next = { ...player, ...reg.nextStats, realmCode: reg.nextRealm.code, realmStage: reg.nextStage, tuVi: reg.tuViAfter, hp, maxHp, mp, maxMp };
          await connection.execute(
            'UPDATE players SET realm_code = ?, realm_stage = ?, tu_vi = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?, str_stat = ?, agi_stat = ?, vit_stat = ?, ene_stat = ?, version = version + 1 WHERE id = ?',
            [reg.nextRealm.code, reg.nextStage, reg.tuViAfter, hp, maxHp, mp, maxMp, reg.nextStats.str, reg.nextStats.agi, reg.nextStats.vit, reg.nextStats.ene, player.id],
          );
          result = {
            type: 'realm_breakthrough_failed',
            success: false,
            major: true,
            pillCode: pillDef?.id || null,
            pillQuality: pillDef?.quality || null,
            pillQualityLabel: pillDef?.qualityLabel || null,
            breakthroughRate,
            fromRealmCode: player.realmCode,
            fromStage: player.realmStage,
            toRealmCode: reg.nextRealm.code,
            toStage: reg.nextStage,
            xuLost,
            linhThachLost,
            statLoss: reg.statLoss,
            tuViAfter: reg.tuViAfter,
          };
          const after = playerState(next);
          await saveAction(connection, player.id, 'BREAKTHROUGH_FAIL', requestId, { realmCode: player.realmCode, stage: player.realmStage, pillCode: pillDef?.id || null, breakthroughRate, toRealmCode: reg.nextRealm.code, toStage: reg.nextStage, xuLost, linhThachLost }, before, after);
        }

        const updatedPlayer = await snapshotWith(connection, userId);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: updatedPlayer, result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function replayAlchemy(userId, requestId, recipeCode = null) {
    const [[row]] = await pool.execute(
      'SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ?',
      [userId, requestId],
    );
    if (!row) return null;
    const intent = recipeCode ? { operation: 'ALCHEMY_BREW', recipeCode } : { operation: 'ALCHEMY_BREW' };
    return replayMutation(row, intent);
  }

  async function brewAlchemy(userId, requestId, brewInput) {
    const recipe = brewInput?.recipe;
    if (!recipe || !recipe.code || !recipe.outputItemCode) {
      throw new DomainError('ALCHEMY_RECIPE_NOT_FOUND', 'Đan phương không hợp lệ', 400);
    }
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, user_id AS userId, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const intent = { operation: 'ALCHEMY_BREW', recipeCode: recipe.code };
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return { ...replay, replayed: true };
        }
        if (!(Number(player.hp) > 0)) {
          throw new DomainError('PLAYER_DEAD', 'Nhân vật đã tử vong, hãy hồi sinh trước khi luyện đan', 409);
        }

        const realmsList = brewInput.realmCatalog || activeRealms();
        const playerRealmStt = Number(realmsList.find((entry) => entry.code === player.realmCode)?.stt || 1);
        if (playerRealmStt < Number(recipe.requiredRealmStt || 1)) {
          throw new DomainError('REALM_TOO_LOW', `Cần đạt cảnh giới bậc ${recipe.requiredRealmStt} để luyện đan phương này`, 409);
        }

        const [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        const costXu = Math.max(0, Math.floor(Number(recipe.costXu || 0)));
        const costLinhThach = Math.max(0, Math.floor(Number(recipe.costLinhThach || 0)));
        if (Number(wallet?.xu || 0) < costXu) {
          throw new DomainError('INSUFFICIENT_XU', 'Không đủ Xu để luyện đan', 409);
        }
        if (Number(wallet?.linhThach || 0) < costLinhThach) {
          throw new DomainError('INSUFFICIENT_LINH_THACH', 'Không đủ Linh Thạch để luyện đan', 409);
        }

        const [invRows] = await connection.query(
          'SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items WHERE player_id = ? ORDER BY item_code ASC, slot ASC FOR UPDATE',
          [player.id],
        );
        const invByCode = new Map();
        for (const row of invRows) {
          invByCode.set(row.itemCode, row);
        }

        const requiredIngredients = (recipe.ingredients || []).map((entry) => ({
          itemCode: entry.itemCode,
          quantity: Math.max(1, Math.floor(Number(entry.quantity || 1))),
        }));
        const missing = [];
        for (const reqItem of requiredIngredients) {
          const owned = Number(invByCode.get(reqItem.itemCode)?.quantity || 0);
          if (owned < reqItem.quantity) {
            missing.push({ itemCode: reqItem.itemCode, need: reqItem.quantity, owned });
          }
        }
        if (missing.length) {
          throw new DomainError('INSUFFICIENT_INGREDIENTS', 'Chưa đủ nguyên liệu hoặc Linh Thạch Nhỏ để luyện đan', 409, { missing });
        }

        const maxSlots = getInventoryCapacity(player);
        const postConsumeCodes = new Set();
        let occupiedAfterConsume = invRows.length;
        for (const row of invRows) {
          const reqMatch = requiredIngredients.find((reqItem) => reqItem.itemCode === row.itemCode);
          const remaining = Number(row.quantity) - (reqMatch ? reqMatch.quantity : 0);
          if (remaining > 0) postConsumeCodes.add(row.itemCode);
          else occupiedAfterConsume -= 1;
        }
        const possibleOutputs = [recipe.outputItemCode, recipe.upgradedItemCode].filter(Boolean);
        const outQty = Math.max(1, Math.floor(Number(recipe.outputQuantity || 1)));
        for (const outCode of possibleOutputs) {
          if (!postConsumeCodes.has(outCode) && occupiedAfterConsume + 1 > maxSlots) {
            throw new DomainError('INVENTORY_FULL', 'Túi đồ không đủ chỗ để nhận đan dược', 409);
          }
          const ownedOut = invRows
            .filter((row) => row.itemCode === outCode)
            .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
          const consumedOut = requiredIngredients.find((reqItem) => reqItem.itemCode === outCode)?.quantity || 0;
          const remainingOut = Math.max(0, ownedOut - consumedOut);
          if (remainingOut + outQty > 99) {
            throw new DomainError('INVENTORY_FULL', 'Túi đồ đã đạt giới hạn 99 vật phẩm cho đan thành phẩm', 409);
          }
        }

        if (costXu > 0) {
          await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'XU',
            delta: -costXu,
            reason: 'ALCHEMY_COST',
            idempotencyKey: ledgerIdempotencyKey(requestId, 'XU'),
            referenceType: 'ALCHEMY',
            referenceId: recipe.code,
          });
        }
        if (costLinhThach > 0) {
          await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'LINH_THACH',
            delta: -costLinhThach,
            reason: 'ALCHEMY_COST',
            idempotencyKey: ledgerIdempotencyKey(requestId, 'LINH_THACH'),
            referenceType: 'ALCHEMY',
            referenceId: recipe.code,
          });
        }

        for (const reqItem of requiredIngredients) {
          const row = invByCode.get(reqItem.itemCode);
          if (Number(row.quantity) === reqItem.quantity) {
            await connection.execute('DELETE FROM inventory_items WHERE id = ?', [row.id]);
          } else {
            await connection.execute('UPDATE inventory_items SET quantity = quantity - ?, version = version + 1 WHERE id = ?', [reqItem.quantity, row.id]);
          }
        }

        const outcome = typeof brewInput.decideOutcome === 'function' ? brewInput.decideOutcome() : brewInput.outcome;
        const itemsCatalog = brewInput.itemCatalog || activeItems();
        if ((outcome.outcome === 'SUCCESS' || outcome.outcome === 'MUTATED') && outcome.outputItemCode) {
          await grantItems(
            connection,
            player.id,
            [{ id: outcome.outputItemCode, itemCode: outcome.outputItemCode, itemId: outcome.outputItemCode, quantity: outcome.outputQuantity, count: outcome.outputQuantity }],
            itemsCatalog,
            maxSlots,
            {
              invalidCode: 'ALCHEMY_OUTPUT_INVALID',
              invalidMessage: 'Thành phẩm đan dược không hợp lệ',
              fullMessage: 'Túi đồ không đủ chỗ để nhận đan dược',
            },
          );
        }

        const logId = `alc_${crypto.randomUUID()}`;
        await connection.execute(
          'INSERT INTO player_alchemy_logs (id, player_id, recipe_code, base_item_code, output_item_code, outcome, craft_success_rate, mutation_rate, cost_xu, cost_linh_thach, consumed_items_json, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            logId,
            player.id,
            recipe.code,
            recipe.outputItemCode,
            outcome.outputItemCode || null,
            outcome.outcome,
            outcome.craftSuccessRate,
            outcome.mutationRate,
            costXu,
            costLinhThach,
            JSON.stringify(requiredIngredients),
            requestId,
          ],
        );

        const outMeta = outcome.outputItemCode
          ? itemsCatalog.find((entry) => entry.id === outcome.outputItemCode || entry.maDo === outcome.outputItemCode)
          : null;
        const result = {
          type: 'alchemy_brew',
          logId,
          recipeCode: recipe.code,
          recipeName: recipe.name,
          outcome: outcome.outcome,
          success: Boolean(outcome.success),
          mutated: Boolean(outcome.mutated),
          baseItemCode: recipe.outputItemCode,
          outputItemCode: outcome.outputItemCode || null,
          outputItemName: outMeta?.name || outcome.outputItemCode || null,
          outputItemIcon: outMeta?.icon || null,
          outputItemQuality: outMeta?.quality || null,
          outputItemQualityLabel: outMeta?.qualityLabel || null,
          outputQuantity: outcome.outputQuantity || 0,
          craftSuccessRate: outcome.craftSuccessRate,
          mutationRate: outcome.mutationRate,
          costXu,
          costLinhThach,
          consumedIngredients: requiredIngredients,
        };

        const updatedPlayer = await snapshotWith(connection, userId);
        const before = playerState(player);
        const after = playerState(updatedPlayer);
        await saveAction(connection, player.id, 'ALCHEMY_BREW', requestId, { recipeCode: recipe.code, outcome: outcome.outcome, outputItemCode: outcome.outputItemCode || null, costXu, costLinhThach }, before, after);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: updatedPlayer, result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function listAlchemyLogs(userId, { limit = 20, cursor = null } = {}) {
    const [[player]] = await pool.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const decoded = decodeCursor(cursor);
    const where = ['player_id = ?'];
    const params = [player.id];
    if (decoded) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(decoded.createdAt, decoded.createdAt, decoded.id);
    }
    params.push(safeLimit + 1);
    const [rows] = await pool.query(
      `SELECT id, recipe_code AS recipeCode, base_item_code AS baseItemCode, output_item_code AS outputItemCode, outcome, craft_success_rate AS craftSuccessRate, mutation_rate AS mutationRate, cost_xu AS costXu, cost_linh_thach AS costLinhThach, consumed_items_json AS consumedItemsJson, created_at AS createdAt FROM player_alchemy_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = slice.map((row) => ({
      id: row.id,
      recipeCode: row.recipeCode,
      baseItemCode: row.baseItemCode,
      outputItemCode: row.outputItemCode || null,
      outcome: row.outcome,
      craftSuccessRate: Number(row.craftSuccessRate || 0),
      mutationRate: Number(row.mutationRate || 0),
      costXu: Number(row.costXu || 0),
      costLinhThach: Number(row.costLinhThach || 0),
      consumedIngredients: decodeJson(row.consumedItemsJson) || [],
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async function enhanceEquipment(userId, requestId, enhanceInput) {
    const instanceId = String(enhanceInput?.instanceId || '').trim();
    const useProtection = Boolean(enhanceInput?.useProtection);
    const intent = { operation: 'EQUIPMENT_ENHANCE', instanceId, useProtection };
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query(
          'SELECT id, linh_can AS linhCan, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, tu_vi_linh_can AS tuViLinhCan, hp, max_hp AS maxHp, mp, max_mp AS maxMp, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints, inventory_capacity AS inventoryCapacity FROM players WHERE user_id = ? FOR UPDATE',
          [userId],
        );
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) {
          const replay = replayMutation(dedup[0], intent);
          await connection.commit();
          return { ...replay, replayed: true };
        }
        const [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        if (!wallet) throw new DomainError('WALLET_NOT_FOUND', 'Không tìm thấy ví nhân vật', 404);

        const [[inst]] = await connection.query(
          'SELECT id, owner_player_id AS ownerPlayerId, item_code AS itemCode, location, inventory_slot AS inventorySlot, equipped_slot AS equippedSlot, rarity, enhance_level AS enhanceLevel, has_luck AS hasLuck, exl_options_json AS exlOptionsJson FROM item_instances WHERE id = ? AND owner_player_id = ? FOR UPDATE',
          [instanceId, player.id],
        );
        if (!inst) throw new DomainError('ITEM_INSTANCE_NOT_FOUND', 'Không tìm thấy trang bị thuộc sở hữu của bạn', 404);
        if (inst.location !== 'INVENTORY' && inst.location !== 'EQUIPPED') {
          throw new DomainError('ITEM_NOT_ENHANCEABLE', 'Trang bị hiện không ở trong túi đồ hoặc đang mặc', 409);
        }
        const itemsCatalog = enhanceInput.itemCatalog || activeItems();
        const itemDef = findCatalogItem(inst.itemCode, itemsCatalog);
        if (!itemDef || !isEquipmentDef(itemDef)) {
          throw new DomainError('ITEM_NOT_EQUIPMENT', 'Chỉ có thể cường hóa trang bị', 409);
        }
        const parsedInst = {
          id: inst.id,
          instanceId: inst.id,
          itemCode: inst.itemCode,
          location: inst.location,
          equippedSlot: inst.equippedSlot || null,
          inventorySlot: inst.inventorySlot ?? null,
          rarity: inst.rarity || itemDef.rarity || 'NORMAL',
          enhanceLevel: Math.max(0, Math.floor(Number(inst.enhanceLevel || 0))),
          hasLuck: Boolean(inst.hasLuck),
          exlOptions: parseExlOptions(inst.exlOptionsJson),
        };
        const plan = enhanceInput.planAttempt({ itemDef, instance: parsedInst, useProtection });
        if (Number(wallet.xu || 0) < plan.costXu) throw new DomainError('INSUFFICIENT_FUNDS', 'Không đủ Xu để cường hóa', 409);
        if (Number(wallet.linhThach || 0) < plan.costLinhThach) throw new DomainError('INSUFFICIENT_LINH_THACH', 'Không đủ Linh Thạch để cường hóa', 409);

        const reqEntries = Object.entries(plan.consumedItems || {})
          .map(([itemCode, quantity]) => ({ itemCode, quantity: Math.max(1, Math.floor(Number(quantity || 1))) }))
          .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
        const codes = reqEntries.map((entry) => entry.itemCode);
        const invByCode = new Map();
        if (codes.length) {
          const placeholders = codes.map(() => '?').join(', ');
          const [invRows] = await connection.query(
            `SELECT id, item_code AS itemCode, quantity FROM inventory_items WHERE player_id = ? AND item_code IN (${placeholders}) ORDER BY item_code ASC, slot ASC FOR UPDATE`,
            [player.id, ...codes],
          );
          for (const row of invRows) {
            const list = invByCode.get(row.itemCode) || [];
            list.push(row);
            invByCode.set(row.itemCode, list);
          }
        }
        const missing = [];
        for (const reqItem of reqEntries) {
          const rows = invByCode.get(reqItem.itemCode) || [];
          const owned = rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
          if (owned < reqItem.quantity) missing.push({ itemCode: reqItem.itemCode, need: reqItem.quantity, owned });
        }
        if (missing.length) {
          throw new DomainError('ENHANCE_MATERIAL_MISSING', 'Chưa đủ Ngọc cường hóa hoặc Bùa Bảo Vệ trong túi đồ', 409, { missing });
        }

        if (plan.costXu > 0) {
          await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'XU',
            delta: -plan.costXu,
            reason: 'ENHANCE_COST',
            idempotencyKey: ledgerIdempotencyKey(requestId, 'XU'),
            referenceType: 'ENHANCE',
            referenceId: parsedInst.id,
          });
        }
        if (plan.costLinhThach > 0) {
          await adjustWalletBalance(connection, {
            playerId: player.id,
            currencyType: 'LINH_THACH',
            delta: -plan.costLinhThach,
            reason: 'ENHANCE_COST',
            idempotencyKey: ledgerIdempotencyKey(requestId, 'LINH_THACH'),
            referenceType: 'ENHANCE',
            referenceId: parsedInst.id,
          });
        }
        for (const reqItem of reqEntries) {
          let remainingNeed = reqItem.quantity;
          for (const row of (invByCode.get(reqItem.itemCode) || [])) {
            if (remainingNeed <= 0) break;
            const take = Math.min(remainingNeed, Number(row.quantity || 0));
            if (take <= 0) continue;
            if (take >= Number(row.quantity || 0)) {
              await connection.execute('DELETE FROM inventory_items WHERE id = ?', [row.id]);
            } else {
              await connection.execute('UPDATE inventory_items SET quantity = quantity - ?, version = version + 1 WHERE id = ?', [take, row.id]);
            }
            remainingNeed -= take;
          }
        }

        const outcome = enhanceInput.decideOutcome(plan);
        await connection.execute(
          'UPDATE item_instances SET enhance_level = ?, version = version + 1 WHERE id = ?',
          [outcome.toLevel, parsedInst.id],
        );
        await connection.execute('UPDATE players SET version = version + 1 WHERE id = ?', [player.id]);

        const logId = `enh_${crypto.randomUUID()}`;
        await connection.execute(
          'INSERT INTO player_enhance_logs (id, player_id, instance_id, item_code, from_level, to_level, outcome, used_protection, has_luck, success_rate, cost_xu, cost_linh_thach, consumed_items_json, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            logId,
            player.id,
            parsedInst.id,
            parsedInst.itemCode,
            outcome.fromLevel,
            outcome.toLevel,
            outcome.outcome,
            plan.useProtection ? 1 : 0,
            parsedInst.hasLuck ? 1 : 0,
            plan.successRate,
            plan.costXu,
            plan.costLinhThach,
            JSON.stringify(reqEntries),
            requestId,
          ],
        );

        const updatedPlayer = await snapshotWith(connection, userId);
        const result = {
          type: 'equipment_enhanced',
          logId,
          instance: {
            ...parsedInst,
            enhanceLevel: outcome.toLevel,
          },
          itemCode: parsedInst.itemCode,
          itemName: itemDef.name || itemDef.tenDo || parsedInst.itemCode,
          fromLevel: outcome.fromLevel,
          toLevel: outcome.toLevel,
          outcome: outcome.outcome,
          success: outcome.outcome === 'SUCCESS',
          usedProtection: Boolean(plan.useProtection),
          hasLuck: parsedInst.hasLuck,
          successRate: plan.successRate,
          costXu: plan.costXu,
          costLinhThach: plan.costLinhThach,
          consumed: reqEntries,
        };
        const before = playerState(player);
        const after = playerState(updatedPlayer);
        await saveAction(connection, player.id, 'EQUIPMENT_ENHANCE', requestId, { instanceId: parsedInst.id, fromLevel: outcome.fromLevel, toLevel: outcome.toLevel, outcome: outcome.outcome }, before, after);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify({ __idempotency: intent, player: compactIdempotentPlayer(updatedPlayer), result })]);
        await connection.commit();
        return { player: updatedPlayer, result };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async function listEnhanceLogs(userId, { limit = 10, cursor = null } = {}) {
    const [[player]] = await pool.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
    const decoded = decodeCursor(cursor);
    const where = ['player_id = ?'];
    const params = [player.id];
    if (decoded) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(decoded.createdAt, decoded.createdAt, decoded.id);
    }
    params.push(safeLimit + 1);
    const [rows] = await pool.query(
      `SELECT id, instance_id AS instanceId, item_code AS itemCode, from_level AS fromLevel, to_level AS toLevel, outcome, used_protection AS usedProtection, has_luck AS hasLuck, success_rate AS successRate, cost_xu AS costXu, cost_linh_thach AS costLinhThach, consumed_items_json AS consumedItemsJson, created_at AS createdAt FROM player_enhance_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = slice.map((row) => ({
      id: row.id,
      instanceId: row.instanceId,
      itemCode: row.itemCode,
      fromLevel: Number(row.fromLevel || 0),
      toLevel: Number(row.toLevel || 0),
      outcome: row.outcome,
      usedProtection: Boolean(row.usedProtection),
      hasLuck: Boolean(row.hasLuck),
      successRate: Number(row.successRate || 0),
      costXu: Number(row.costXu || 0),
      costLinhThach: Number(row.costLinhThach || 0),
      consumed: decodeJson(row.consumedItemsJson) || [],
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async function listWalletLedger(userId, { currency = 'ALL', limit = 20, cursor = null } = {}) {
    const [[player]] = await pool.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const [[wallet]] = await pool.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? LIMIT 1', [player.id]);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const normalizedCurrency = String(currency || 'ALL').trim().toUpperCase();
    const filterCurrency = normalizedCurrency === 'XU' || normalizedCurrency === 'LINH_THACH' ? normalizedCurrency : null;
    const decoded = decodeCursor(cursor);
    const where = ['player_id = ?'];
    const params = [player.id];
    if (filterCurrency) {
      where.push('currency_type = ?');
      params.push(filterCurrency);
    }
    if (decoded) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(decoded.createdAt, decoded.createdAt, decoded.id);
    }
    params.push(safeLimit + 1);
    const [rows] = await pool.query(
      `SELECT id, currency_type AS currencyType, reason, amount, balance_after AS balanceAfter, reference_type AS referenceType, reference_id AS referenceId, created_at AS createdAt FROM currency_ledger WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = slice.map((row) => ({
      id: row.id,
      currencyType: row.currencyType || 'XU',
      reason: row.reason,
      amount: Number(row.amount || 0),
      balanceAfter: Number(row.balanceAfter || 0),
      referenceType: row.referenceType || null,
      referenceId: row.referenceId || null,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
    const last = items[items.length - 1];
    return {
      wallet: { xu: Number(wallet?.xu || 0), linhThach: Number(wallet?.linhThach || 0) },
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  function formatMailRow(row) {
    return {
      id: row.id,
      playerId: row.playerId,
      title: row.title,
      body: row.body,
      sourceType: row.sourceType || 'SYSTEM',
      sourceRef: row.sourceRef || null,
      attachments: decodeJson(row.attachmentsJson) || {},
      isRead: Boolean(row.isRead),
      claimedAt: row.claimedAt ? new Date(row.claimedAt).toISOString() : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }

  async function listPlayerMail(userId, { limit = 20, cursor = null } = {}) {
    const [[player]] = await pool.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const decoded = decodeCursor(cursor);
    const [[badge]] = await pool.query(
      'SELECT COUNT(*) AS unclaimedCount FROM player_mail WHERE player_id = ? AND claimed_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))',
      [player.id],
    );
    const where = ['player_id = ?', '(expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))'];
    const params = [player.id];
    if (decoded) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(decoded.createdAt, decoded.createdAt, decoded.id);
    }
    params.push(safeLimit + 1);
    const [rows] = await pool.query(
      `SELECT id, player_id AS playerId, title, body, source_type AS sourceType, source_ref AS sourceRef, attachments_json AS attachmentsJson, is_read AS isRead, claimed_at AS claimedAt, expires_at AS expiresAt, created_at AS createdAt FROM player_mail WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
      params,
    );
    const hasMore = rows.length > safeLimit;
    const slice = hasMore ? rows.slice(0, safeLimit) : rows;
    const items = slice.map(formatMailRow);
    const last = items[items.length - 1];
    return {
      unclaimedCount: Number(badge?.unclaimedCount || 0),
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async function claimPlayerMail(userId, requestId, mailId, items = activeItems()) {
    const intent = { operation: 'MAIL_CLAIM', mailId };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      const [[mail]] = await connection.query(
        'SELECT id, player_id AS playerId, title, attachments_json AS attachmentsJson, claimed_at AS claimedAt, expires_at AS expiresAt, UTC_TIMESTAMP(3) AS serverNow FROM player_mail WHERE id = ? AND player_id = ? FOR UPDATE',
        [mailId, player.id],
      );
      if (!mail) throw new DomainError('MAIL_NOT_FOUND', 'Thư không tồn tại hoặc không thuộc nhân vật này', 404);
      if (mail.claimedAt) throw new DomainError('MAIL_ALREADY_CLAIMED', 'Thư này đã nhận quà trước đó', 409);
      if (mail.expiresAt && new Date(mail.expiresAt).getTime() <= new Date(mail.serverNow).getTime()) {
        throw new DomainError('MAIL_EXPIRED', 'Thư đã hết hạn nhận quà', 409);
      }
      const attachments = decodeJson(mail.attachmentsJson) || {};
      const xu = Math.max(0, Math.floor(Number(attachments.xu || 0)));
      const linhThach = Math.max(0, Math.floor(Number(attachments.linhThach || 0)));
      const tuVi = Math.max(0, Math.floor(Number(attachments.tuVi || 0)));
      const mailItems = Array.isArray(attachments.items) ? attachments.items : [];
      if (xu > 0) {
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'XU',
          delta: xu,
          reason: 'MAIL_CLAIM',
          idempotencyKey: ledgerIdempotencyKey(requestId, 'XU'),
          referenceType: 'MAIL',
          referenceId: mail.id,
        });
      }
      if (linhThach > 0) {
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'LINH_THACH',
          delta: linhThach,
          reason: 'MAIL_CLAIM',
          idempotencyKey: ledgerIdempotencyKey(requestId, 'LINH_THACH'),
          referenceType: 'MAIL',
          referenceId: mail.id,
        });
      }
      const grantedItems = mailItems.length
        ? await grantItems(connection, player.id, mailItems.map((entry) => ({ itemCode: entry.itemCode, quantity: entry.quantity })), items, getInventoryCapacity(player), {
          invalidCode: 'MAIL_REWARD_INVALID',
          invalidMessage: 'Vật phẩm đính kèm không hợp lệ',
          fullMessage: 'Túi đồ không đủ chỗ để nhận vật phẩm từ thư',
        })
        : [];
      if (tuVi > 0) {
        await connection.execute('UPDATE players SET tu_vi = tu_vi + ? WHERE id = ?', [tuVi, player.id]);
      }
      await connection.execute('UPDATE player_mail SET is_read = TRUE, claimed_at = UTC_TIMESTAMP(3) WHERE id = ?', [mail.id]);
      return { type: 'mail_claimed', mailId: mail.id, xu, linhThach, tuVi, grantedItems };
    });
  }

  async function sendPlayerMail(actorId, { requestId, playerId, title, body, sourceType = 'SYSTEM', sourceRef = null, expiresAt = null, attachments = {} }) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [[player]] = await connection.query('SELECT id FROM players WHERE id = ? FOR UPDATE', [playerId]);
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Không tìm thấy nhân vật nhận thư', 404);
        const [[existing]] = await connection.query(
          'SELECT id, player_id AS playerId, title, body, source_type AS sourceType, source_ref AS sourceRef, attachments_json AS attachmentsJson, is_read AS isRead, claimed_at AS claimedAt, expires_at AS expiresAt, created_at AS createdAt FROM player_mail WHERE player_id = ? AND idempotency_key = ? FOR UPDATE',
          [playerId, requestId],
        );
        if (existing) {
          const priorAttachments = decodeJson(existing.attachmentsJson) || {};
          if (existing.title !== title || existing.body !== body || canonicalJson(priorAttachments) !== canonicalJson(attachments)) {
            throw new DomainError('IDEMPOTENCY_CONFLICT', 'requestId đã được dùng cho một thư khác', 409);
          }
          await connection.commit();
          return { mail: formatMailRow(existing), deduplicated: true };
        }
        const mailId = `mail_${crypto.randomUUID()}`;
        await connection.execute(
          'INSERT INTO player_mail (id, player_id, title, body, source_type, source_ref, attachments_json, idempotency_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))',
          [mailId, playerId, title, body, sourceType, sourceRef, JSON.stringify(attachments), requestId, expiresAt],
        );
        if (actorId) {
          await writeAudit(connection, actorId, 'ADMIN_MAIL_SEND', `player_mail:${mailId}`, null, { playerId, title, sourceType, attachments }, requestId);
        }
        const [[created]] = await connection.query(
          'SELECT id, player_id AS playerId, title, body, source_type AS sourceType, source_ref AS sourceRef, attachments_json AS attachmentsJson, is_read AS isRead, claimed_at AS claimedAt, expires_at AS expiresAt, created_at AS createdAt FROM player_mail WHERE id = ? LIMIT 1',
          [mailId],
        );
        await connection.commit();
        return { mail: formatMailRow(created), deduplicated: false };
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  function buildCheckinState(row, dateVn) {
    const rawCycleNo = Math.max(1, Number(row?.cycleNo || 1));
    const rawStreak = Math.max(0, Number(row?.streakDay || 0));
    const lastDate = row?.lastClaimDateVn || null;
    const canClaimToday = lastDate !== dateVn;
    const rolledCycle = rawStreak >= 7 && canClaimToday;
    const cycleNo = rolledCycle ? rawCycleNo + 1 : rawCycleNo;
    const streakDay = rolledCycle ? 0 : Math.min(7, rawStreak);
    const nextDay = canClaimToday ? streakDay + 1 : null;
    const days = BALANCE.retention.checkinRewards.map((entry) => ({
      day: entry.day,
      label: entry.label,
      rewards: { xu: entry.xu, linhThach: entry.linhThach, tuVi: entry.tuVi, items: entry.items },
      claimed: entry.day <= streakDay,
    }));
    return { cycleNo, streakDay, canClaimToday, nextDay, days };
  }

  async function ensureRetentionRows(connection, playerId) {
    await connection.execute('INSERT IGNORE INTO player_checkin_states (player_id, cycle_no, streak_day, last_claim_date_vn) VALUES (?, 1, 0, NULL)', [playerId]);
  }

  async function getRetentionState(userId) {
    return withConnection(async (connection) => {
      const [[player]] = await connection.query('SELECT id FROM players WHERE user_id = ? LIMIT 1', [userId]);
      if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
      const readConsistent = async () => {
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
        try {
          const [[clockRow]] = await connection.query('SELECT UTC_TIMESTAMP(3) AS serverNow');
          const [[checkinRow]] = await connection.query(
            'SELECT cycle_no AS cycleNo, streak_day AS streakDay, last_claim_date_vn AS lastClaimDateVn FROM player_checkin_states WHERE player_id = ? LIMIT 1',
            [player.id],
          );
          if (!checkinRow) {
            await connection.commit();
            return null;
          }
          const nowMs = new Date(clockRow?.serverNow || Date.now()).getTime();
          const dateVn = getVnDateString(nowMs);
          await connection.commit();
          return { nowMs, dateVn, checkinRow };
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      };

      let state = await readConsistent();
      if (!state) {
        await ensureRetentionRows(connection, player.id);
        state = await readConsistent();
      }
      const { nowMs, dateVn, checkinRow } = state || { nowMs: Date.now(), dateVn: getVnDateString(Date.now()), checkinRow: null };
      return {
        serverTime: new Date(nowMs).toISOString(),
        dateVn,
        checkin: buildCheckinState(checkinRow, dateVn),
      };
    });
  }

  async function claimDailyCheckin(userId, requestId, items = activeItems()) {
    const intent = { operation: 'CHECKIN_CLAIM' };
    return playerMutation(userId, requestId, intent, async (connection, player) => {
      await ensureRetentionRows(connection, player.id);
      const [[checkin]] = await connection.query(
        'SELECT cycle_no AS cycleNo, streak_day AS streakDay, last_claim_date_vn AS lastClaimDateVn, UTC_TIMESTAMP(3) AS serverNow FROM player_checkin_states WHERE player_id = ? FOR UPDATE',
        [player.id],
      );
      const nowMs = new Date(checkin?.serverNow || Date.now()).getTime();
      const dateVn = getVnDateString(nowMs);
      if (checkin?.lastClaimDateVn === dateVn) {
        throw new DomainError('CHECKIN_ALREADY_CLAIMED', 'Hôm nay đạo hữu đã điểm danh rồi', 409);
      }
      const rawCycleNo = Math.max(1, Number(checkin?.cycleNo || 1));
      const rawStreak = Math.max(0, Number(checkin?.streakDay || 0));
      const nextCycleNo = rawStreak >= 7 ? rawCycleNo + 1 : rawCycleNo;
      const targetDay = rawStreak >= 7 ? 1 : rawStreak + 1;
      const reward = BALANCE.retention.checkinRewards[targetDay - 1];
      if (!reward) throw new DomainError('CHECKIN_CONFIG_INVALID', 'Cấu hình điểm danh không hợp lệ', 500);
      const xu = Math.max(0, Math.floor(Number(reward.xu || 0)));
      const linhThach = Math.max(0, Math.floor(Number(reward.linhThach || 0)));
      const tuVi = Math.max(0, Math.floor(Number(reward.tuVi || 0)));
      if (xu > 0) {
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'XU',
          delta: xu,
          reason: 'CHECKIN_REWARD',
          idempotencyKey: ledgerIdempotencyKey(requestId, 'XU'),
          referenceType: 'CHECKIN',
          referenceId: `${nextCycleNo}:${targetDay}`,
        });
      }
      if (linhThach > 0) {
        await adjustWalletBalance(connection, {
          playerId: player.id,
          currencyType: 'LINH_THACH',
          delta: linhThach,
          reason: 'CHECKIN_REWARD',
          idempotencyKey: ledgerIdempotencyKey(requestId, 'LINH_THACH'),
          referenceType: 'CHECKIN',
          referenceId: `${nextCycleNo}:${targetDay}`,
        });
      }
      const grantedItems = Array.isArray(reward.items) && reward.items.length
        ? await grantItems(connection, player.id, reward.items, items, getInventoryCapacity(player), {
          invalidCode: 'CHECKIN_REWARD_INVALID',
          invalidMessage: 'Vật phẩm điểm danh không hợp lệ',
          fullMessage: 'Túi đồ không đủ chỗ để nhận quà điểm danh',
        })
        : [];
      if (tuVi > 0) {
        await connection.execute('UPDATE players SET tu_vi = tu_vi + ? WHERE id = ?', [tuVi, player.id]);
      }
      await connection.execute(
        'UPDATE player_checkin_states SET cycle_no = ?, streak_day = ?, last_claim_date_vn = ?, version = version + 1 WHERE player_id = ?',
        [nextCycleNo, targetDay, dateVn, player.id],
      );
      return {
        type: 'daily_checkin_claimed',
        day: targetDay,
        cycleNo: nextCycleNo,
        dateVn,
        rewards: { xu, linhThach, tuVi, items: grantedItems },
      };
    });
  }

  return { init, backfillLegacyEquipment, healthCheck, bindCatalog, findUserByUsername, findUserById, insertUser, saveRefreshToken, rotateRefreshToken, revokeRefreshToken, playerSnapshot, createPlayer, buyItem, sellItem, useInventoryItem, allocateStats, updatePlayerName, savePlayerPosition, updateVitals, respawn, pickupGroundItem, equipItem, unequipItem, enhanceEquipment, listEnhanceLogs, learnSkill, equipSkills, replayBreakthrough, breakthrough, replayAlchemy, brewAlchemy, listAlchemyLogs, questSnapshot, questAction, applyQuestEvent, listWalletLedger, listPlayerMail, claimPlayerMail, sendPlayerMail, getRetentionState, claimDailyCheckin, listAdminWorlds, saveAdminWorlds, deleteAdminWorld, listAdminContentRecords, pageAdminCatalog, getAdminContentRecord, listAdminAccounts, mutateAdminContent, listAdminSkillVfx, mutateSkillVfx, close: () => pool.end() };
}

module.exports = { createMysqlStore, canonicalJson };
