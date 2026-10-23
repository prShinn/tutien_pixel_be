const mysql = require('mysql2/promise');
const { DomainError, publicPlayer } = require('../domain');

function createMysqlStore(config) {
  const pool = mysql.createPool({ ...config, waitForConnections: true, queueLimit: 0, decimalNumbers: true });
  async function init() { const connection = await pool.getConnection(); connection.release(); }
  async function findUserByUsername(username) {
    const [rows] = await pool.execute('SELECT id, username, password_hash AS passwordHash, role, status, created_at AS createdAt FROM users WHERE username = ? LIMIT 1', [username]);
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
  async function withConnection(work) { const connection = await pool.getConnection(); try { return await work(connection); } finally { connection.release(); } }

  async function snapshotWith(connection, userId) {
    const [players] = await connection.execute('SELECT id, user_id AS userId, name, realm_code AS realmCode, realm_stage AS realmStage, tu_vi AS tuVi, map_code AS mapCode, x, y, version, str_stat AS str, agi_stat AS agi, vit_stat AS vit, ene_stat AS ene, unspent_points AS unspentPoints FROM players WHERE user_id = ? LIMIT 1', [userId]);
    const player = players[0];
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
    const [[wallet]] = await connection.query('SELECT xu, linh_thach AS linhThach FROM wallets WHERE player_id = ? LIMIT 1', [player.id]);
    const [inventory] = await connection.execute('SELECT id, item_code AS itemCode, quantity, slot FROM inventory_items WHERE player_id = ? ORDER BY slot, id', [player.id]);
    return publicPlayer({ ...player, stats: { str: player.str, agi: player.agi, vit: player.vit, ene: player.ene, unspentPoints: player.unspentPoints } }, wallet, inventory);
  }
  async function playerSnapshot(userId) { return withConnection((connection) => snapshotWith(connection, userId)); }

  async function createPlayer(userId, player) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [existing] = await connection.execute('SELECT id FROM players WHERE user_id = ? FOR UPDATE', [userId]);
        if (existing.length) throw new DomainError('PLAYER_EXISTS', 'Tài khoản đã có nhân vật', 409);
        await connection.execute('INSERT INTO players (id, user_id, name, realm_code, realm_stage, tu_vi, map_code, x, y, version, str_stat, agi_stat, vit_stat, ene_stat, unspent_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [player.id, userId, player.name, player.realmCode, player.realmStage, player.tuVi, player.mapCode, player.x, player.y, player.version, 5, 5, 5, 5, 0]);
        await connection.execute('INSERT INTO wallets (player_id, xu, linh_thach, version) VALUES (?, 100, 0, 1)', [player.id]);
        await connection.execute('INSERT INTO inventory_items (id, player_id, item_code, quantity, slot, version) VALUES (?, ?, ?, 1, 0, 1)', [player.inventoryId, player.id, 'small_xu_pack']);
        const result = await snapshotWith(connection, userId); await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }

  async function buyItem(userId, requestId, itemCode, count, item) {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [dedup] = await connection.execute('SELECT result_json AS resultJson FROM idempotency_keys WHERE user_id = ? AND request_id = ? FOR UPDATE', [userId, requestId]);
        if (dedup.length) { await connection.commit(); return JSON.parse(dedup[0].resultJson); }
        const [[player]] = await connection.query('SELECT id FROM players WHERE user_id = ? FOR UPDATE', [userId]);
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', 'Chưa tạo nhân vật', 404);
        const [[wallet]] = await connection.query('SELECT xu FROM wallets WHERE player_id = ? FOR UPDATE', [player.id]);
        const total = item.price * count;
        if (!wallet || wallet.xu < total) throw new DomainError('INSUFFICIENT_FUNDS', 'Không đủ xu', 409);
        await connection.execute('UPDATE wallets SET xu = xu - ?, version = version + 1 WHERE player_id = ?', [total, player.id]);
        const [[existingItem]] = await connection.query('SELECT id FROM inventory_items WHERE player_id = ? AND item_code = ? FOR UPDATE', [player.id, itemCode]);
        if (existingItem) {
          await connection.execute('UPDATE inventory_items SET quantity = quantity + ?, version = version + 1 WHERE id = ?', [count, existingItem.id]);
        } else {
          const [[slot]] = await connection.query('SELECT COALESCE(MAX(slot), -1) + 1 AS nextSlot FROM inventory_items WHERE player_id = ?', [player.id]);
          await connection.execute('INSERT INTO inventory_items (id, player_id, item_code, quantity, slot, version) VALUES (?, ?, ?, ?, ?, 1)', [`inv_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, player.id, itemCode, count, slot.nextSlot]);
        }
        await connection.execute('INSERT INTO currency_ledger (id, player_id, reason, amount, balance_after, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)', [`led_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`, player.id, 'BUY_ITEM', -total, wallet.xu - total, requestId]);
        const result = await snapshotWith(connection, userId);
        await connection.execute('INSERT INTO idempotency_keys (user_id, request_id, result_json) VALUES (?, ?, ?)', [userId, requestId, JSON.stringify(result)]);
        await connection.commit(); return result;
      } catch (error) { await connection.rollback(); throw error; }
    });
  }
  return { init, findUserByUsername, insertUser, playerSnapshot, createPlayer, buyItem, close: () => pool.end() };
}

module.exports = { createMysqlStore };
