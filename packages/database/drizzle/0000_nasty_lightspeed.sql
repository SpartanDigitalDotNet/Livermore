CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_exchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"exchange_name" varchar(50) NOT NULL,
	"display_name" varchar(100),
	"api_key" varchar(500) NOT NULL,
	"api_secret" text NOT NULL,
	"additional_credentials" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"exchange_id" serial NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(5) NOT NULL,
	"timestamp" bigint NOT NULL,
	"open" numeric(20, 8) NOT NULL,
	"high" numeric(20, 8) NOT NULL,
	"low" numeric(20, 8) NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"volume" numeric(20, 8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candles_unique" UNIQUE("user_id","exchange_id","symbol","timeframe","timestamp")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indicators" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"exchange_id" serial NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(5) NOT NULL,
	"type" varchar(20) NOT NULL,
	"timestamp" bigint NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alert_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" serial NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"conditions" jsonb NOT NULL,
	"notification_sent" boolean DEFAULT false NOT NULL,
	"notification_error" varchar(500)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"exchange_id" serial NOT NULL,
	"name" varchar(100) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timeframe" varchar(5) NOT NULL,
	"conditions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"cooldown_ms" bigint DEFAULT 300000 NOT NULL,
	"last_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_exchanges" ADD CONSTRAINT "user_exchanges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candles" ADD CONSTRAINT "candles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "candles" ADD CONSTRAINT "candles_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."user_exchanges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicators" ADD CONSTRAINT "indicators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "indicators" ADD CONSTRAINT "indicators_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."user_exchanges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."user_exchanges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_exchanges_user_id_idx" ON "user_exchanges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_exchanges_user_exchange_idx" ON "user_exchanges" USING btree ("user_id","exchange_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candles_user_exchange_idx" ON "candles" USING btree ("user_id","exchange_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candles_user_symbol_timeframe_idx" ON "candles" USING btree ("user_id","exchange_id","symbol","timeframe");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candles_timestamp_idx" ON "candles" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "indicators_user_exchange_idx" ON "indicators" USING btree ("user_id","exchange_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "indicators_user_symbol_timeframe_type_idx" ON "indicators" USING btree ("user_id","exchange_id","symbol","timeframe","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "indicators_timestamp_idx" ON "indicators" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_history_alert_id_idx" ON "alert_history" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_history_triggered_at_idx" ON "alert_history" USING btree ("triggered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_user_exchange_idx" ON "alerts" USING btree ("user_id","exchange_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_user_symbol_idx" ON "alerts" USING btree ("user_id","exchange_id","symbol");