import { relations } from "drizzle-orm/relations";
import { userExchanges, alertHistory, users, candles, indicators, positions, exchanges, exchangeSymbols } from "./schema";

export const alertHistoryRelations = relations(alertHistory, ({one}) => ({
	userExchange: one(userExchanges, {
		fields: [alertHistory.exchangeId],
		references: [userExchanges.id]
	}),
}));

export const userExchangesRelations = relations(userExchanges, ({one, many}) => ({
	alertHistories: many(alertHistory),
	candles: many(candles),
	indicators: many(indicators),
	positions: many(positions),
	user: one(users, {
		fields: [userExchanges.userId],
		references: [users.id]
	}),
	exchange: one(exchanges, {
		fields: [userExchanges.exchangeId],
		references: [exchanges.id]
	}),
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

export const usersRelations = relations(users, ({many}) => ({
	candles: many(candles),
	indicators: many(indicators),
	positions: many(positions),
	userExchanges: many(userExchanges),
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

export const exchangesRelations = relations(exchanges, ({many}) => ({
	userExchanges: many(userExchanges),
	exchangeSymbols: many(exchangeSymbols),
}));

export const exchangeSymbolsRelations = relations(exchangeSymbols, ({one}) => ({
	exchange: one(exchanges, {
		fields: [exchangeSymbols.exchangeId],
		references: [exchanges.id]
	}),
}));