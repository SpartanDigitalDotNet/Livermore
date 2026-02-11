-- Reorder user_exchanges columns: move exchange_id to 3rd position (after user_id)
-- PostgreSQL does not support ALTER TABLE column reorder, so we recreate the table.

BEGIN;

-- 1. Drop FKs referencing user_exchanges
ALTER TABLE candles DROP CONSTRAINT candles_exchange_id_user_exchanges_id_fk;
ALTER TABLE indicators DROP CONSTRAINT indicators_exchange_id_user_exchanges_id_fk;
ALTER TABLE positions DROP CONSTRAINT positions_exchange_id_user_exchanges_id_fk;
ALTER TABLE alert_history DROP CONSTRAINT alert_history_exchange_id_user_exchanges_id_fk;

-- 2. Drop indexes on user_exchanges
DROP INDEX IF EXISTS user_exchanges_user_id_idx;
DROP INDEX IF EXISTS user_exchanges_user_exchange_idx;
DROP INDEX IF EXISTS user_exchanges_exchange_id_idx;

-- 3. Drop own FKs and rename old table
ALTER TABLE user_exchanges DROP CONSTRAINT user_exchanges_user_id_users_id_fk;
ALTER TABLE user_exchanges DROP CONSTRAINT user_exchanges_exchange_id_exchanges_id_fk;
ALTER TABLE user_exchanges RENAME TO user_exchanges_old;

-- 4. Create new table with desired column order
CREATE TABLE user_exchanges (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_id" integer NULL,
  "exchange_name" character varying(50) NOT NULL,
  "display_name" character varying(100) NULL,
  "api_key_env_var" character varying(100) NOT NULL,
  "api_secret_env_var" character varying(100) NOT NULL,
  "additional_credentials_env_vars" text NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "last_connected_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "user_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "user_exchanges_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "exchanges" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

-- 5. Copy data
INSERT INTO user_exchanges (id, user_id, exchange_id, exchange_name, display_name, api_key_env_var, api_secret_env_var, additional_credentials_env_vars, is_active, is_default, last_connected_at, created_at, updated_at)
SELECT id, user_id, exchange_id, exchange_name, display_name, api_key_env_var, api_secret_env_var, additional_credentials_env_vars, is_active, is_default, last_connected_at, created_at, updated_at
FROM user_exchanges_old;

-- 6. Sync the sequence
SELECT setval('user_exchanges_id_seq', COALESCE((SELECT MAX(id) FROM user_exchanges), 1), true);

-- 7. Recreate indexes
CREATE INDEX user_exchanges_user_id_idx ON user_exchanges ("user_id");
CREATE INDEX user_exchanges_user_exchange_idx ON user_exchanges ("user_id", "exchange_name");
CREATE INDEX user_exchanges_exchange_id_idx ON user_exchanges ("exchange_id");

-- 8. Restore FKs from other tables
ALTER TABLE candles ADD CONSTRAINT candles_exchange_id_user_exchanges_id_fk FOREIGN KEY ("exchange_id") REFERENCES user_exchanges ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE indicators ADD CONSTRAINT indicators_exchange_id_user_exchanges_id_fk FOREIGN KEY ("exchange_id") REFERENCES user_exchanges ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE positions ADD CONSTRAINT positions_exchange_id_user_exchanges_id_fk FOREIGN KEY ("exchange_id") REFERENCES user_exchanges ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE alert_history ADD CONSTRAINT alert_history_exchange_id_user_exchanges_id_fk FOREIGN KEY ("exchange_id") REFERENCES user_exchanges ("id") ON UPDATE NO ACTION ON DELETE CASCADE;

-- 9. Drop old table
DROP TABLE user_exchanges_old;

COMMIT;
