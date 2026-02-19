-- Livermore Database Schema
-- Source of truth for Atlas state-based deployments
-- Reverse engineered from production database 2026-01-14

-- Create "user_settings" table
CREATE TABLE "user_settings" (
  "id" serial NOT NULL,
  "key" character varying(100) NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "user_settings_key_unique" UNIQUE ("key")
);

-- Create "users" table
CREATE TABLE "users" (
  "id" serial NOT NULL,
  "username" character varying(50) NOT NULL,
  "email" character varying(255) NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "identity_provider" character varying(20) NULL,
  "identity_sub" character varying(255) NULL,
  "display_name" character varying(100) NULL,
  "identity_picture_url" text NULL,
  "role" character varying(20) NOT NULL DEFAULT 'user',
  "last_login_at" timestamp NULL,
  "settings" jsonb DEFAULT '{"version":1}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_username_unique" UNIQUE ("username")
);

-- Unique partial index for OAuth identity lookup (allows multiple NULL identity_provider values)
CREATE UNIQUE INDEX "users_identity_provider_sub_idx" ON "users" ("identity_provider", "identity_sub")
  WHERE identity_provider IS NOT NULL;

-- Create "exchanges" table (Phase 23)
-- Exchange metadata for multi-exchange architecture
CREATE TABLE "exchanges" (
  "id" serial NOT NULL,
  "name" character varying(50) NOT NULL,
  "display_name" character varying(100) NOT NULL,
  "ws_url" character varying(255) NULL,
  "rest_url" character varying(255) NULL,
  "supported_timeframes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "api_limits" jsonb NULL,
  "fee_schedule" jsonb NULL,
  "geo_restrictions" jsonb NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "exchanges_name_unique" UNIQUE ("name")
);

-- Seed data for exchanges (idempotent via ON CONFLICT)
INSERT INTO "exchanges" ("name", "display_name", "ws_url", "rest_url", "supported_timeframes", "api_limits", "fee_schedule", "geo_restrictions") VALUES
  ('coinbase', 'Coinbase Advanced Trade',
   'wss://advanced-trade-ws.coinbase.com',
   'https://api.coinbase.com',
   '["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d"]'::jsonb,
   '{"ws_connections_per_ip": 750, "ws_messages_per_second": 8, "rest_weight_limit": 10000}'::jsonb,
   '{"base_maker": 0.006, "base_taker": 0.012}'::jsonb,
   NULL
  ),
  ('binance', 'Binance',
   'wss://stream.binance.com:9443',
   'https://api.binance.com',
   '["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]'::jsonb,
   '{"ws_connections_per_5min": 300, "rest_weight_limit": 6000, "orders_per_10s": 50}'::jsonb,
   '{"base_maker": 0.001, "base_taker": 0.001}'::jsonb,
   '{"blocked_countries": ["US"], "note": "US users geo-blocked (HTTP 451). Use binance_us instead."}'::jsonb
  ),
  ('binance_us', 'Binance US',
   'wss://stream.binance.us:9443',
   'https://api.binance.us',
   '["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]'::jsonb,
   '{"rest_weight_limit": 1200, "orders_per_10s": 10}'::jsonb,
   '{"base_maker": 0.001, "base_taker": 0.001}'::jsonb,
   NULL
  ),
  ('kraken', 'Kraken',
   'wss://ws.kraken.com',
   'https://api.kraken.com',
   '["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]'::jsonb,
   '{"rest_calls_per_second": 1, "rest_decay_per_second": 0.33}'::jsonb,
   '{"base_maker": 0.0016, "base_taker": 0.0026}'::jsonb,
   NULL
  ),
  ('kucoin', 'KuCoin',
   'wss://ws-api-spot.kucoin.com',
   'https://api.kucoin.com',
   '["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"]'::jsonb,
   '{"rest_calls_per_second": 10}'::jsonb,
   '{"base_maker": 0.001, "base_taker": 0.001}'::jsonb,
   NULL
  ),
  ('mexc', 'MEXC',
   'wss://wbs.mexc.com/ws',
   'https://api.mexc.com',
   '["1m", "5m", "15m", "30m", "1h", "4h", "8h", "1d", "1w", "1M"]'::jsonb,
   '{"rest_calls_per_second": 20}'::jsonb,
   '{"base_maker": 0.0, "base_taker": 0.001}'::jsonb,
   NULL
  )
ON CONFLICT ("name") DO UPDATE SET
  "display_name" = EXCLUDED."display_name",
  "ws_url" = EXCLUDED."ws_url",
  "rest_url" = EXCLUDED."rest_url",
  "supported_timeframes" = EXCLUDED."supported_timeframes",
  "api_limits" = EXCLUDED."api_limits",
  "fee_schedule" = EXCLUDED."fee_schedule",
  "geo_restrictions" = EXCLUDED."geo_restrictions",
  "updated_at" = now();

-- Create "user_exchanges" table
CREATE TABLE "user_exchanges" (
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

-- Create index "user_exchanges_user_exchange_idx" to table: "user_exchanges"
CREATE INDEX "user_exchanges_user_exchange_idx" ON "user_exchanges" ("user_id", "exchange_name");

-- Create index "user_exchanges_user_id_idx" to table: "user_exchanges"
CREATE INDEX "user_exchanges_user_id_idx" ON "user_exchanges" ("user_id");

-- Create index "user_exchanges_exchange_id_idx" to table: "user_exchanges" (Phase 23)
CREATE INDEX "user_exchanges_exchange_id_idx" ON "user_exchanges" ("exchange_id");

-- Create "exchange_symbols" table (Phase 25)
-- Tier 1 symbols: Top N by global market cap rank, shared across users
CREATE TABLE "exchange_symbols" (
  "id" serial NOT NULL,
  "exchange_id" integer NOT NULL,
  "symbol" character varying(20) NOT NULL,
  "base_currency" character varying(10) NOT NULL,
  "quote_currency" character varying(10) NOT NULL,
  "volume_24h" numeric(30,8) NULL,
  "volume_rank" integer NULL,
  "global_rank" integer NULL,
  "market_cap" numeric(30,2) NULL,
  "coingecko_id" character varying(100) NULL,
  "display_name" character varying(100) NULL,
  "trade_count_24h" integer NULL,
  "liquidity_score" numeric(5,3) NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_volume_update" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "exchange_symbols_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "exchanges" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "exchange_symbols_unique" UNIQUE ("exchange_id", "symbol")
);

-- Index for global rank queries
CREATE INDEX "exchange_symbols_exchange_rank_idx" ON "exchange_symbols" ("exchange_id", "global_rank") WHERE is_active = true;

-- Index for symbol lookup
CREATE INDEX "exchange_symbols_symbol_idx" ON "exchange_symbols" ("symbol");

-- Create "candles" table
CREATE TABLE "candles" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_id" serial NOT NULL,
  "symbol" character varying(20) NOT NULL,
  "timeframe" character varying(5) NOT NULL,
  "timestamp" bigint NOT NULL,
  "open" numeric(20,8) NOT NULL,
  "high" numeric(20,8) NOT NULL,
  "low" numeric(20,8) NOT NULL,
  "close" numeric(20,8) NOT NULL,
  "volume" numeric(20,8) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "candles_unique" UNIQUE ("user_id", "exchange_id", "symbol", "timeframe", "timestamp"),
  CONSTRAINT "candles_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "user_exchanges" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "candles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Create index "candles_timestamp_idx" to table: "candles"
CREATE INDEX "candles_timestamp_idx" ON "candles" ("timestamp");

-- Create index "candles_user_exchange_idx" to table: "candles"
CREATE INDEX "candles_user_exchange_idx" ON "candles" ("user_id", "exchange_id");

-- Create index "candles_user_symbol_timeframe_idx" to table: "candles"
CREATE INDEX "candles_user_symbol_timeframe_idx" ON "candles" ("user_id", "exchange_id", "symbol", "timeframe");

-- Create "indicators" table
CREATE TABLE "indicators" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_id" serial NOT NULL,
  "symbol" character varying(20) NOT NULL,
  "timeframe" character varying(5) NOT NULL,
  "type" character varying(20) NOT NULL,
  "timestamp" bigint NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "indicators_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "user_exchanges" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "indicators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Create index "indicators_timestamp_idx" to table: "indicators"
CREATE INDEX "indicators_timestamp_idx" ON "indicators" ("timestamp");

-- Create index "indicators_user_exchange_idx" to table: "indicators"
CREATE INDEX "indicators_user_exchange_idx" ON "indicators" ("user_id", "exchange_id");

-- Create index "indicators_user_symbol_timeframe_type_idx" to table: "indicators"
CREATE INDEX "indicators_user_symbol_timeframe_type_idx" ON "indicators" ("user_id", "exchange_id", "symbol", "timeframe", "type");

-- Create "positions" table
CREATE TABLE "positions" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_id" serial NOT NULL,
  "symbol" character varying(20) NOT NULL,
  "display_name" character varying(100) NULL,
  "coinbase_account_id" character varying(100) NULL,
  "quantity" numeric(30,18) NOT NULL,
  "available_quantity" numeric(30,18) NULL,
  "cost_basis" numeric(20,2) NULL,
  "last_synced_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "positions_unique_symbol" UNIQUE ("user_id", "exchange_id", "symbol"),
  CONSTRAINT "positions_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "user_exchanges" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Create index "positions_symbol_idx" to table: "positions"
CREATE INDEX "positions_symbol_idx" ON "positions" ("user_id", "exchange_id", "symbol");

-- Create index "positions_user_exchange_idx" to table: "positions"
CREATE INDEX "positions_user_exchange_idx" ON "positions" ("user_id", "exchange_id");

-- Create "alert_history" table
-- Records all triggered alerts (exchange-level, not user-level)
CREATE TABLE "alert_history" (
  "id" serial NOT NULL,
  "exchange_id" serial NOT NULL,
  "symbol" character varying(20) NOT NULL,
  "timeframe" character varying(5) NULL,
  "alert_type" character varying(50) NOT NULL,
  "triggered_at_epoch" bigint NOT NULL,
  "triggered_at" timestamp with time zone NOT NULL,
  "price" numeric(20,8) NOT NULL,
  "trigger_value" numeric(20,8) NULL,
  "trigger_label" character varying(100) NOT NULL,
  "previous_label" character varying(100) NULL,
  "details" jsonb NULL,
  "notification_sent" boolean NOT NULL DEFAULT false,
  "notification_error" character varying(500) NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "alert_history_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "user_exchanges" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Create index "alert_history_exchange_symbol_idx" to table: "alert_history"
CREATE INDEX "alert_history_exchange_symbol_idx" ON "alert_history" ("exchange_id", "symbol");

-- Create index "alert_history_triggered_at_idx" to table: "alert_history"
CREATE INDEX "alert_history_triggered_at_idx" ON "alert_history" ("triggered_at" DESC);

-- Create index "alert_history_alert_type_idx" to table: "alert_history"
CREATE INDEX "alert_history_alert_type_idx" ON "alert_history" ("alert_type");
