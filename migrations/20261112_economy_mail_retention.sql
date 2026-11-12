-- Migration: Dual-currency ledger (XU / LINH_THACH), inventory capacity, mail & daily check-in.
-- Target: MySQL 8.0+ (Idempotent, expand-only, backward-compatible with legacy XU rows, safe across CLI & mysql2).

SET @schema_name = DATABASE();

-- 1. players.inventory_capacity (INSTANT append at end of row)
SET @has_inv_cap = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'players' AND COLUMN_NAME = 'inventory_capacity'
);
SET @sql = IF(@has_inv_cap = 0,
  'ALTER TABLE players ADD COLUMN inventory_capacity INT UNSIGNED NOT NULL DEFAULT 40',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. currency_ledger new columns (append without AFTER for MySQL 8.0 INSTANT DDL)
SET @has_cur_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'currency_ledger' AND COLUMN_NAME = 'currency_type'
);
SET @sql = IF(@has_cur_type = 0,
  "ALTER TABLE currency_ledger ADD COLUMN currency_type ENUM('XU', 'LINH_THACH') NOT NULL DEFAULT 'XU'",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_ref_type = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'currency_ledger' AND COLUMN_NAME = 'reference_type'
);
SET @sql = IF(@has_ref_type = 0,
  'ALTER TABLE currency_ledger ADD COLUMN reference_type VARCHAR(32) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_ref_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'currency_ledger' AND COLUMN_NAME = 'reference_id'
);
SET @sql = IF(@has_ref_id = 0,
  'ALTER TABLE currency_ledger ADD COLUMN reference_id VARCHAR(64) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Separate index creation from ADD COLUMN to avoid full table copy lock
SET @has_idx_ledger_cur = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'currency_ledger' AND INDEX_NAME = 'ix_ledger_player_currency_time'
);
SET @sql = IF(@has_idx_ledger_cur = 0,
  'ALTER TABLE currency_ledger ADD KEY ix_ledger_player_currency_time (player_id, currency_type, created_at, id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_ledger_all = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'currency_ledger' AND INDEX_NAME = 'ix_ledger_player_time'
);
SET @sql = IF(@has_idx_ledger_all = 0,
  'ALTER TABLE currency_ledger ADD KEY ix_ledger_player_time (player_id, created_at, id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Player mailbox
CREATE TABLE IF NOT EXISTS player_mail (
  id VARCHAR(64) PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  source_type VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
  source_ref VARCHAR(64) NULL,
  attachments_json JSON NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_player_mail_idempotency (player_id, idempotency_key),
  KEY ix_player_mail_feed (player_id, created_at, id),
  KEY ix_player_mail_unclaimed (player_id, claimed_at, expires_at),
  CONSTRAINT fk_player_mail_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB;

-- 4. Daily 7-day check-in state
CREATE TABLE IF NOT EXISTS player_checkin_states (
  player_id VARCHAR(64) PRIMARY KEY,
  cycle_no INT UNSIGNED NOT NULL DEFAULT 1,
  streak_day TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_claim_date_vn CHAR(10) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  version BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT fk_player_checkin_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB;
