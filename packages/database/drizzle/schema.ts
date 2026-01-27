import { pgTable, unique, check, serial, varchar, jsonb, timestamp, index, foreignKey, text, boolean, bigint, numeric, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const userSettings = pgTable("user_settings", {
	id: serial().primaryKey().notNull(),
	key: varchar({ length: 100 }).notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		userSettingsKeyUnique: unique("user_settings_key_unique").on(table.key),
		userSettingsIdNotNull: check("user_settings_id_not_null", sql`NOT NULL id`),
		userSettingsKeyNotNull: check("user_settings_key_not_null", sql`NOT NULL key`),
		userSettingsValueNotNull: check("user_settings_value_not_null", sql`NOT NULL value`),
		userSettingsUpdatedAtNotNull: check("user_settings_updated_at_not_null", sql`NOT NULL updated_at`),
	}
});

export const userExchanges = pgTable("user_exchanges", {
	id: serial().primaryKey().notNull(),
	userId: serial("user_id").notNull(),
	exchangeName: varchar("exchange_name", { length: 50 }).notNull(),
	displayName: varchar("display_name", { length: 100 }),
	apiKey: varchar("api_key", { length: 500 }).notNull(),
	apiSecret: text("api_secret").notNull(),
	additionalCredentials: text("additional_credentials"),
	isActive: boolean("is_active").default(true).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	lastConnectedAt: timestamp("last_connected_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => {
	return {
		userExchangeIdx: index("user_exchanges_user_exchange_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeName.asc().nullsLast().op("int4_ops")),
		userIdIdx: index("user_exchanges_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
		userExchangesUserIdUsersIdFk: foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_exchanges_user_id_users_id_fk"
		}).onDelete("cascade"),
		userExchangesIdNotNull: check("user_exchanges_id_not_null", sql`NOT NULL id`),
		userExchangesUserIdNotNull: check("user_exchanges_user_id_not_null", sql`NOT NULL user_id`),
		userExchangesExchangeNameNotNull: check("user_exchanges_exchange_name_not_null", sql`NOT NULL exchange_name`),
		userExchangesApiKeyNotNull: check("user_exchanges_api_key_not_null", sql`NOT NULL api_key`),
		userExchangesApiSecretNotNull: check("user_exchanges_api_secret_not_null", sql`NOT NULL api_secret`),
		userExchangesIsActiveNotNull: check("user_exchanges_is_active_not_null", sql`NOT NULL is_active`),
		userExchangesIsDefaultNotNull: check("user_exchanges_is_default_not_null", sql`NOT NULL is_default`),
		userExchangesCreatedAtNotNull: check("user_exchanges_created_at_not_null", sql`NOT NULL created_at`),
		userExchangesUpdatedAtNotNull: check("user_exchanges_updated_at_not_null", sql`NOT NULL updated_at`),
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
		userSymbolTimeframeIdx: index("candles_user_symbol_timeframe_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("int4_ops"), table.timeframe.asc().nullsLast().op("int4_ops")),
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
		candlesUnique: unique("candles_unique").on(table.userId, table.timestamp, table.timeframe, table.symbol, table.exchangeId),
		candlesIdNotNull: check("candles_id_not_null", sql`NOT NULL id`),
		candlesUserIdNotNull: check("candles_user_id_not_null", sql`NOT NULL user_id`),
		candlesExchangeIdNotNull: check("candles_exchange_id_not_null", sql`NOT NULL exchange_id`),
		candlesSymbolNotNull: check("candles_symbol_not_null", sql`NOT NULL symbol`),
		candlesTimeframeNotNull: check("candles_timeframe_not_null", sql`NOT NULL timeframe`),
		candlesTimestampNotNull: check("candles_timestamp_not_null", sql`NOT NULL "timestamp"`),
		candlesOpenNotNull: check("candles_open_not_null", sql`NOT NULL open`),
		candlesHighNotNull: check("candles_high_not_null", sql`NOT NULL high`),
		candlesLowNotNull: check("candles_low_not_null", sql`NOT NULL low`),
		candlesCloseNotNull: check("candles_close_not_null", sql`NOT NULL close`),
		candlesVolumeNotNull: check("candles_volume_not_null", sql`NOT NULL volume`),
		candlesCreatedAtNotNull: check("candles_created_at_not_null", sql`NOT NULL created_at`),
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
		userSymbolTimeframeTypeIdx: index("indicators_user_symbol_timeframe_type_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("text_ops"), table.timeframe.asc().nullsLast().op("int4_ops"), table.type.asc().nullsLast().op("int4_ops")),
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
		indicatorsIdNotNull: check("indicators_id_not_null", sql`NOT NULL id`),
		indicatorsUserIdNotNull: check("indicators_user_id_not_null", sql`NOT NULL user_id`),
		indicatorsExchangeIdNotNull: check("indicators_exchange_id_not_null", sql`NOT NULL exchange_id`),
		indicatorsSymbolNotNull: check("indicators_symbol_not_null", sql`NOT NULL symbol`),
		indicatorsTimeframeNotNull: check("indicators_timeframe_not_null", sql`NOT NULL timeframe`),
		indicatorsTypeNotNull: check("indicators_type_not_null", sql`NOT NULL type`),
		indicatorsTimestampNotNull: check("indicators_timestamp_not_null", sql`NOT NULL "timestamp"`),
		indicatorsValueNotNull: check("indicators_value_not_null", sql`NOT NULL value`),
		indicatorsCreatedAtNotNull: check("indicators_created_at_not_null", sql`NOT NULL created_at`),
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
		exchangeSymbolIdx: index("alert_history_exchange_symbol_idx").using("btree", table.exchangeId.asc().nullsLast().op("int4_ops"), table.symbol.asc().nullsLast().op("int4_ops")),
		triggeredAtIdx: index("alert_history_triggered_at_idx").using("btree", table.triggeredAt.desc().nullsFirst().op("timestamptz_ops")),
		alertHistoryExchangeIdUserExchangesIdFk: foreignKey({
			columns: [table.exchangeId],
			foreignColumns: [userExchanges.id],
			name: "alert_history_exchange_id_user_exchanges_id_fk"
		}).onDelete("cascade"),
		alertHistoryIdNotNull: check("alert_history_id_not_null", sql`NOT NULL id`),
		alertHistoryExchangeIdNotNull: check("alert_history_exchange_id_not_null", sql`NOT NULL exchange_id`),
		alertHistorySymbolNotNull: check("alert_history_symbol_not_null", sql`NOT NULL symbol`),
		alertHistoryAlertTypeNotNull: check("alert_history_alert_type_not_null", sql`NOT NULL alert_type`),
		alertHistoryTriggeredAtEpochNotNull: check("alert_history_triggered_at_epoch_not_null", sql`NOT NULL triggered_at_epoch`),
		alertHistoryTriggeredAtNotNull: check("alert_history_triggered_at_not_null", sql`NOT NULL triggered_at`),
		alertHistoryPriceNotNull: check("alert_history_price_not_null", sql`NOT NULL price`),
		alertHistoryTriggerLabelNotNull: check("alert_history_trigger_label_not_null", sql`NOT NULL trigger_label`),
		alertHistoryNotificationSentNotNull: check("alert_history_notification_sent_not_null", sql`NOT NULL notification_sent`),
	}
});

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	username: varchar({ length: 50 }).notNull(),
	email: varchar({ length: 255 }).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	identityProvider: varchar("identity_provider", { length: 20 }),
	identitySub: varchar("identity_sub", { length: 255 }),
	displayName: varchar("display_name", { length: 100 }),
	identityPictureUrl: text("identity_picture_url"),
	role: varchar({ length: 20 }).default('user').notNull(),
	lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
}, (table) => {
	return {
		identityProviderSubIdx: uniqueIndex("users_identity_provider_sub_idx").using("btree", table.identityProvider.asc().nullsLast().op("text_ops"), table.identitySub.asc().nullsLast().op("text_ops")).where(sql`(identity_provider IS NOT NULL)`),
		usersUsernameUnique: unique("users_username_unique").on(table.username),
		usersEmailUnique: unique("users_email_unique").on(table.email),
		usersIdNotNull: check("users_id_not_null", sql`NOT NULL id`),
		usersUsernameNotNull: check("users_username_not_null", sql`NOT NULL username`),
		usersEmailNotNull: check("users_email_not_null", sql`NOT NULL email`),
		usersIsActiveNotNull: check("users_is_active_not_null", sql`NOT NULL is_active`),
		usersCreatedAtNotNull: check("users_created_at_not_null", sql`NOT NULL created_at`),
		usersUpdatedAtNotNull: check("users_updated_at_not_null", sql`NOT NULL updated_at`),
		usersRoleNotNull: check("users_role_not_null", sql`NOT NULL role`),
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
		symbolIdx: index("positions_symbol_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.exchangeId.asc().nullsLast().op("text_ops"), table.symbol.asc().nullsLast().op("text_ops")),
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
		positionsUniqueSymbol: unique("positions_unique_symbol").on(table.userId, table.symbol, table.exchangeId),
		positionsIdNotNull: check("positions_id_not_null", sql`NOT NULL id`),
		positionsUserIdNotNull: check("positions_user_id_not_null", sql`NOT NULL user_id`),
		positionsExchangeIdNotNull: check("positions_exchange_id_not_null", sql`NOT NULL exchange_id`),
		positionsSymbolNotNull: check("positions_symbol_not_null", sql`NOT NULL symbol`),
		positionsQuantityNotNull: check("positions_quantity_not_null", sql`NOT NULL quantity`),
		positionsCreatedAtNotNull: check("positions_created_at_not_null", sql`NOT NULL created_at`),
		positionsUpdatedAtNotNull: check("positions_updated_at_not_null", sql`NOT NULL updated_at`),
	}
});
