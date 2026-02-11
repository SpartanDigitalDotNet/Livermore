import { pgTable, unique, serial, varchar, jsonb, timestamp, uniqueIndex, boolean, text, index, foreignKey, bigint, numeric, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const userSettings = pgTable("user_settings", {
	id: serial().primaryKey().notNull(),
	key: varchar({ length: 100 }).notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		userSettingsKeyUnique: unique("user_settings_key_unique").on(table.key),
	}
});

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	username: varchar({ length: 50 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	identityProvider: varchar("identity_provider", { length: 20 }),
	identitySub: varchar("identity_sub", { length: 255 }),
	displayName: varchar("display_name", { length: 100 }),
	identityPictureUrl: text("identity_picture_url"),
	role: varchar({ length: 20 }).default('user').notNull(),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	settings: jsonb().default({"version":1}),
}, (table) => {
	return {
		identityProviderSubIdx: uniqueIndex("users_identity_provider_sub_idx").using("btree", table.identityProvider.asc().nullsLast().op("text_ops"), table.identitySub.asc().nullsLast().op("text_ops")).where(sql`(identity_provider IS NOT NULL)`),
		usersUsernameUnique: unique("users_username_unique").on(table.username),
		usersEmailUnique: unique("users_email_unique").on(table.email),
	}
});

export const alertHistory = pgTable("alert_history", {
	id: serial().primaryKey().notNull(),
	exchangeId: serial("exchange_id").notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	timeframe: varchar({ length: 5 }),
	alertType: varchar("alert_type", { length: 50 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	triggeredAtEpoch: bigint("triggered_at_epoch", { mode: "number" }).notNull(),
	triggeredAt: timestamp("triggered_at", { withTimezone: true, mode: 'string' }).notNull(),
	price: numeric({ precision: 20, scale:  8 }).notNull(),
	triggerValue: numeric("trigger_value", { precision: 20, scale:  8 }),
	triggerLabel: varchar("trigger_label", { length: 100 }).notNull(),
	previousLabel: varchar("previous_label", { length: 100 }),
	details: jsonb(),
	notificationSent: boolean("notification_sent").default(false).notNull(),
	notificationError: varchar("notification_error", { length: 500 }),
}, (table) => {
	return {
		alertTypeIdx: index("alert_history_alert_type_idx").using("btree", table.alertType.asc().nullsLast().op("text_ops")),
		exchangeSymbolIdx: index("alert_history_exchange_symbol_idx").using("btree", table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("int4_ops")),
		triggeredAtIdx: index("alert_history_triggered_at_idx").using("btree", table.triggeredAt.desc().nullsFirst().op("timestamptz_ops")),
		alertHistoryExchangeIdUserExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [userExchanges.id],
			name: "alert_history_exchange_id_user_exchanges_id_fk"
		}).onDelete("cascade"),
	}
});

export const candles = pgTable("candles", {
	id: serial().primaryKey().notNull(),
	userId: serial("user_id").notNull(),
	exchangeId: serial("exchange_id").notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	timeframe: varchar({ length: 5 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	timestamp: bigint({ mode: "number" }).notNull(),
	open: numeric({ precision: 20, scale:  8 }).notNull(),
	high: numeric({ precision: 20, scale:  8 }).notNull(),
	low: numeric({ precision: 20, scale:  8 }).notNull(),
	close: numeric({ precision: 20, scale:  8 }).notNull(),
	volume: numeric({ precision: 20, scale:  8 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		timestampIdx: index("candles_timestamp_idx").using("btree", table.timestamp.asc().nullsLast().op("int8_ops")),
		userExchangeIdx: index("candles_user_exchange_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("int4_ops")),
		userSymbolTimeframeIdx: index("candles_user_symbol_timeframe_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("int4_ops"), table.timeframe.asc().nullsLast().op("int4_ops")),
		candlesUserIdUsersIdFk: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "candles_user_id_users_id_fk"
		}).onDelete("cascade"),
		candlesExchangeIdUserExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [userExchanges.id],
			name: "candles_exchange_id_user_exchanges_id_fk"
		}).onDelete("cascade"),
		candlesUnique: unique("candles_unique").on(table.userId, table.exchangeId, table.symbol, table.timeframe, table.timestamp),
	}
});

export const indicators = pgTable("indicators", {
	id: serial().primaryKey().notNull(),
	userId: serial("user_id").notNull(),
	exchangeId: serial("exchange_id").notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	timeframe: varchar({ length: 5 }).notNull(),
	type: varchar({ length: 20 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	timestamp: bigint({ mode: "number" }).notNull(),
	value: jsonb().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		timestampIdx: index("indicators_timestamp_idx").using("btree", table.timestamp.asc().nullsLast().op("int8_ops")),
		userExchangeIdx: index("indicators_user_exchange_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("int4_ops")),
		userSymbolTimeframeTypeIdx: index("indicators_user_symbol_timeframe_type_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.exchangeId.asc().nullsLast().op("int4_ops"), table.symbol.asc().nullsLast().op("text_ops"), table.timeframe.asc().nullsLast().op("int4_ops"), table.type.asc().nullsLast().op("text_ops")),
		indicatorsUserIdUsersIdFk: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "indicators_user_id_users_id_fk"
		}).onDelete("cascade"),
		indicatorsExchangeIdUserExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [userExchanges.id],
			name: "indicators_exchange_id_user_exchanges_id_fk"
		}).onDelete("cascade"),
	}
});

export const positions = pgTable("positions", {
	id: serial().primaryKey().notNull(),
	userId: serial("user_id").notNull(),
	exchangeId: serial("exchange_id").notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	displayName: varchar("display_name", { length: 100 }),
	coinbaseAccountId: varchar("coinbase_account_id", { length: 100 }),
	quantity: numeric({ precision: 30, scale:  18 }).notNull(),
	availableQuantity: numeric("available_quantity", { precision: 30, scale:  18 }),
	costBasis: numeric("cost_basis", { precision: 20, scale:  2 }),
	lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		symbolIdx: index("positions_symbol_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("int4_ops")),
		userExchangeIdx: index("positions_user_exchange_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("int4_ops")),
		positionsUserIdUsersIdFk: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "positions_user_id_users_id_fk"
		}).onDelete("cascade"),
		positionsExchangeIdUserExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [userExchanges.id],
			name: "positions_exchange_id_user_exchanges_id_fk"
		}).onDelete("cascade"),
		positionsUniqueSymbol: unique("positions_unique_symbol").on(table.userId, table.exchangeId, table.symbol),
	}
});

export const exchanges = pgTable("exchanges", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 50 }).notNull(),
	displayName: varchar("display_name", { length: 100 }).notNull(),
	wsUrl: varchar("ws_url", { length: 255 }),
	restUrl: varchar("rest_url", { length: 255 }),
	supportedTimeframes: jsonb("supported_timeframes").default([]).notNull(),
	apiLimits: jsonb("api_limits"),
	feeSchedule: jsonb("fee_schedule"),
	geoRestrictions: jsonb("geo_restrictions"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		exchangesNameUnique: unique("exchanges_name_unique").on(table.name),
	}
});

export const userExchanges = pgTable("user_exchanges", {
	id: serial().primaryKey().notNull(),
	userId: serial("user_id").notNull(),
	exchangeId: integer("exchange_id"),
	exchangeName: varchar("exchange_name", { length: 50 }).notNull(),
	displayName: varchar("display_name", { length: 100 }),
	apiKeyEnvVar: varchar("api_key_env_var", { length: 100 }).notNull(),
	apiSecretEnvVar: varchar("api_secret_env_var", { length: 100 }).notNull(),
	additionalCredentialsEnvVars: text("additional_credentials_env_vars"),
	isActive: boolean("is_active").default(true).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	lastConnectedAt: timestamp("last_connected_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		exchangeIdIdx: index("user_exchanges_exchange_id_idx").using("btree", table.exchangeId.asc().nullsLast().op("int4_ops")),
		userExchangeIdx: index("user_exchanges_user_exchange_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.exchangeName.asc().nullsLast().op("int4_ops")),
		userIdIdx: index("user_exchanges_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
		userExchangesUserIdUsersIdFk: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_exchanges_user_id_users_id_fk"
		}).onDelete("cascade"),
		userExchangesExchangeIdExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [exchanges.id],
			name: "user_exchanges_exchange_id_exchanges_id_fk"
		}).onDelete("set null"),
	}
});

export const exchangeSymbols = pgTable("exchange_symbols", {
	id: serial().primaryKey().notNull(),
	exchangeId: integer("exchange_id").notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	baseCurrency: varchar("base_currency", { length: 10 }).notNull(),
	quoteCurrency: varchar("quote_currency", { length: 10 }).notNull(),
	volume24H: numeric("volume_24h", { precision: 30, scale:  8 }),
	volumeRank: integer("volume_rank"),
	isActive: boolean("is_active").default(true).notNull(),
	lastVolumeUpdate: timestamp("last_volume_update", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	globalRank: integer("global_rank"),
	marketCap: numeric("market_cap", { precision: 30, scale:  2 }),
	coingeckoId: varchar("coingecko_id", { length: 100 }),
	displayName: varchar("display_name", { length: 100 }),
}, (table) => {
	return {
		exchangeRankIdx: index("exchange_symbols_exchange_rank_idx").using("btree", table.exchangeId.asc().nullsLast().op("int4_ops"), table.globalRank.asc().nullsLast().op("int4_ops")).where(sql`(is_active = true)`),
		symbolIdx: index("exchange_symbols_symbol_idx").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
		exchangeSymbolsExchangeIdExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [exchanges.id],
			name: "exchange_symbols_exchange_id_exchanges_id_fk"
		}).onDelete("cascade"),
		exchangeSymbolsUnique: unique("exchange_symbols_unique").on(table.exchangeId, table.symbol),
	}
});
