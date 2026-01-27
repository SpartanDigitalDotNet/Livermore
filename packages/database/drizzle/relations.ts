import { relations } from "drizzle-orm/relations";
import { users, userExchanges, candles, indicators, alertHistory, positions } from "./schema";

export const userExchangesRelations = relations(userExchanges, ({one, many}) => ({
	user: one(users, {
		fields: [userExchanges.userId],
		references: [users.id]
	}),
	candles: many(candles),
	indicators: many(indicators),
	alertHistories: many(alertHistory),
	positions: many(positions),
}));

export const usersRelations = relations(users, ({many}) => ({
	userExchanges: many(userExchanges),
	candles: many(candles),
	indicators: many(indicators),
	positions: many(positions),
}));

export const candlesRelations = relations(candles, ({one}) => ({
	user: one(users, {
		fields: [candles.userId],
		references: [users.id]
	}),
	userExchange: one(userExchanges, {
		fields: [candles.exchangeId],
		references: [userExchanges.id]
	}),
}));

export const indicatorsRelations = relations(indicators, ({one}) => ({
	user: one(users, {
		fields: [indicators.userId],
		references: [users.id]
	}),
	userExchange: one(userExchanges, {
		fields: [indicators.exchangeId],
		references: [userExchanges.id]
	}),
}));

export const alertHistoryRelations = relations(alertHistory, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [alertHistory.exchangeId],
		references: [userExchanges.id]
	}),
}));

export const positionsRelations = relations(positions, ({one}) => ({
	user: one(users, {
		fields: [positions.userId],
		references: [users.id]
	}),
	userExchange: one(userExchanges, {
		fields: [positions.exchangeId],
		references: [userExchanges.id]
	}),
}));