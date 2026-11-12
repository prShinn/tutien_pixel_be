-- Migration: Alchemy logs table for pill brewing and breakthrough quality audit.
-- Target: MySQL 8.0+ (Idempotent, expand-only).

CREATE TABLE IF NOT EXISTS player_alchemy_logs (
  id VARCHAR(64) PRIMARY KEY,
  player_id VARCHAR(64) NOT NULL,
  recipe_code VARCHAR(64) NOT NULL,
  base_item_code VARCHAR(64) NOT NULL,
  output_item_code VARCHAR(64) NULL,
  outcome ENUM('SUCCESS', 'MUTATED', 'FAILED') NOT NULL,
  craft_success_rate DECIMAL(5,4) NOT NULL,
  mutation_rate DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  cost_xu BIGINT NOT NULL DEFAULT 0,
  cost_linh_thach BIGINT NOT NULL DEFAULT 0,
  consumed_items_json JSON NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_alchemy_idempotency (player_id, idempotency_key),
  KEY ix_alchemy_player_time (player_id, created_at, id),
  CONSTRAINT fk_player_alchemy_player FOREIGN KEY (player_id) REFERENCES players(id)
) ENGINE=InnoDB;
