-- Migration: Item Instances (unique equipment tracking +0..+15, Exl, Luck) and Enhance Logs.
-- Target: MySQL 8.0+ (Idempotent, expand-only).

CREATE TABLE IF NOT EXISTS item_instances (
  id CHAR(36) PRIMARY KEY,
  owner_player_id VARCHAR(64) NOT NULL,
  item_code VARCHAR(64) NOT NULL,
  location ENUM('INVENTORY', 'EQUIPPED', 'MARKET_ESCROW', 'DESTROYED') NOT NULL DEFAULT 'INVENTORY',
  inventory_slot INT NULL,
  equipped_slot VARCHAR(24) NULL,
  equipped_key VARCHAR(24) GENERATED ALWAYS AS (IF(location = 'EQUIPPED', equipped_slot, NULL)) STORED,
  rarity ENUM('NORMAL', 'MAGIC', 'EXL', 'ANCIENT') NOT NULL DEFAULT 'NORMAL',
  enhance_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
  has_luck BOOLEAN NOT NULL DEFAULT FALSE,
  exl_options_json JSON NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_inst_owner_loc (owner_player_id, location, inventory_slot, id),
  UNIQUE KEY uq_inst_owner_equipped (owner_player_id, equipped_key),
  CONSTRAINT fk_inst_player FOREIGN KEY (owner_player_id) REFERENCES players(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_enhance_logs (
  id VARCHAR(64) PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  instance_id CHAR(36) NOT NULL,
  item_code VARCHAR(64) NOT NULL,
  from_level TINYINT UNSIGNED NOT NULL,
  to_level TINYINT UNSIGNED NOT NULL,
  outcome ENUM('SUCCESS', 'FAIL_DOWN', 'FAIL_RESET_ZERO', 'FAIL_PROTECTED') NOT NULL,
  used_protection BOOLEAN NOT NULL DEFAULT FALSE,
  has_luck BOOLEAN NOT NULL DEFAULT FALSE,
  success_rate DECIMAL(5,4) NOT NULL,
  cost_xu BIGINT NOT NULL DEFAULT 0,
  cost_linh_thach BIGINT NOT NULL DEFAULT 0,
  consumed_items_json JSON NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_enhance_idempotency (player_id, idempotency_key),
  KEY ix_enhance_player_time (player_id, created_at, id),
  CONSTRAINT fk_enhance_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO item_instances (id, owner_player_id, item_code, location, equipped_slot, rarity, enhance_level, has_luck, exl_options_json)
SELECT UUID(), pe.player_id, pe.item_code, 'EQUIPPED', pe.slot, 'NORMAL', 0, FALSE, JSON_ARRAY()
FROM player_equipment pe
LEFT JOIN item_instances ii
  ON ii.owner_player_id = pe.player_id
 AND ii.location = 'EQUIPPED'
 AND ii.equipped_slot = pe.slot
WHERE ii.id IS NULL;

-- Note: Legacy stackable equipment rows inside inventory_items (including Admin-created equipment items
-- loaded from admin_content_records) are split 1-per-row into item_instances idempotently by
-- store.backfillLegacyEquipment() after catalog overrides load during server startup.
