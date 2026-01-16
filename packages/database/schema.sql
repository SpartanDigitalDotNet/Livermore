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
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_username_unique" UNIQUE ("username")
);

-- Create "user_exchanges" table
CREATE TABLE "user_exchanges" (
  "id" serial NOT NULL,
  "user_id" serial NOT NULL,
  "exchange_name" character varying(50) NOT NULL,
  "display_name" character varying(100) NULL,
  "api_key" character varying(500) NOT NULL,
  "api_secret" text NOT NULL,
  "additional_credentials" text NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "last_connected_at" timestamp NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "user_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Create index "user_exchanges_user_exchange_idx" to table: "user_exchanges"
CREATE INDEX "user_exchanges_user_exchange_idx" ON "user_exchanges" ("user_id", "exchange_name");

-- Create index "user_exchanges_user_id_idx" to table: "user_exchanges"
CREATE INDEX "user_exchanges_user_id_idx" ON "user_exchanges" ("user_id");

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
