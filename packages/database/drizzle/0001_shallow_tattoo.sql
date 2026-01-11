CREATE TABLE IF NOT EXISTS "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"exchange_id" serial NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"display_name" varchar(100),
	"coinbase_account_id" varchar(100),
	"quantity" numeric(30, 18) NOT NULL,
	"available_quantity" numeric(30, 18),
	"cost_basis" numeric(20, 2),
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_unique_symbol" UNIQUE("user_id","exchange_id","symbol")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_exchange_id_user_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."user_exchanges"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_user_exchange_idx" ON "positions" USING btree ("user_id","exchange_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_symbol_idx" ON "positions" USING btree ("user_id","exchange_id","symbol");