import { relations } from "drizzle-orm/relations";
import { userExchanges, alertHistory, users, exchanges, candles, indicators, positions } from "./schema";

export const alertHistoryRelations = relations(alertHistory, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [alertHistory.exchangeId],
		references: [userExchanges.id]
	}),
}));

export const userExchangesRelations = relations(userExchanges, ({one, many}) => ({
	alertHistories: many(alertHistory),
	user: one(users, {
		fields: [userExchanges.userId],
		references: [users.id]
	}),
	exchange: one(exchanges, {
		fields: [userExchanges.exchangeId],
		references: [exchanges.id]
	}),
	candles: many(candles),
	indicators: many(indicators),
	positions: many(positions),
}));

export const usersRelations = relations(users, ({many}) => ({
	userExchanges: many(userExchanges),
	candles: many(candles),
	indicators: many(indicators),
	positions: many(positions),
}));

export const exchangesRelations = relations(exchanges, ({many}) => ({
	userExchanges: many(userExchanges),
}));

export const candlesRelations = relations(candles, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [candles.exchangeId],
		references: [userExchanges.id]
	}),
	user: one(users, {
		fields: [candles.userId],
		references: [users.id]
	}),
}));

export const indicatorsRelations = relations(indicators, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [indicators.exchangeId],
		references: [userExchanges.id]
	}),
	user: one(users, {
		fields: [indicators.userId],
		references: [users.id]
	}),
}));

export const positionsRelations = relations(positions, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [positions.exchangeId],
		references: [userExchanges.id]
	}),
	user: one(users, {
		fields: [positions.userId],
		references: [users.id]
	}),
}));