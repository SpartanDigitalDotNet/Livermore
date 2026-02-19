import { CoinbaseRestClient, type CoinbaseAccount } from '@livermore/exchange-core';
import { getRedisClient, TickerCacheStrategy } from '@livermore/cache';
import { getDbClient, positions, userExchanges } from '@livermore/database';
import { logger } from '@livermore/utils';
import type { Position, Portfolio } from '@livermore/schemas';
import { eq, and } from 'drizzle-orm';

/**
 * Currency display name mapping
 */
const CURRENCY_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  USDC: 'USD Coin',
  USDT: 'Tether',
  USD: 'US Dollar',
  DOGE: 'Dogecoin',
  ADA: 'Cardano',
  DOT: 'Polkadot',
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  MATIC: 'Polygon',
  UNI: 'Uniswap',
  ATOM: 'Cosmos',
  LTC: 'Litecoin',
  XRP: 'Ripple',
};

/**
 * Get display name for a currency symbol
 */
function getCurrencyDisplayName(symbol: string): string {
  return CURRENCY_NAMES[symbol.toUpperCase()] || symbol;
}

/**
 * Position Sync Service
 *
 * Syncs user positions from Coinbase to the local database.
 * Fetches current prices directly from Coinbase REST API for accurate valuations.
 */
export class PositionSyncService {
  private db = getDbClient();
  private redis = getRedisClient();
  private tickerCache: TickerCacheStrategy;

  // Price cache for current sync operation
  private priceCache: Map<string, number> = new Map();

  constructor() {
    this.tickerCache = new TickerCacheStrategy(this.redis);
  }

  /**
   * Sync positions from Coinbase for a user/exchange
   * Fetches account balances, gets current prices, calculates P&L, and updates database
   */
  async syncPositions(userId: number, exchangeId: number): Promise<Portfolio> {
    logger.info({ userId, exchangeId }, 'Starting position sync');

    // Get exchange credentials from database
    const exchange = await this.db.query.userExchanges.findFirst({
      where: and(
        eq(userExchanges.id, exchangeId),
        eq(userExchanges.userId, userId)
      ),
    });

    if (!exchange) {
      throw new Error(`Exchange not found for userId=${userId}, exchangeId=${exchangeId}`);
    }

    if (exchange.exchangeName !== 'coinbase') {
      throw new Error(`Unsupported exchange: ${exchange.exchangeName}`);
    }

    // Read credentials from environment variables (NEVER stored in DB)
    const apiKey = process.env[exchange.apiKeyEnvVar];
    const apiSecret = process.env[exchange.apiSecretEnvVar];

    if (!apiKey || !apiSecret) {
      throw new Error(
        `Missing credentials: Environment variables ${exchange.apiKeyEnvVar} and/or ${exchange.apiSecretEnvVar} not set`
      );
    }

    // Create Coinbase client with credentials from environment
    const client = new CoinbaseRestClient(apiKey, apiSecret);

    // Fetch accounts with balances from Coinbase
    const accounts = await client.getAccountsWithBalance();
    logger.debug({ count: accounts.length }, 'Fetched accounts with balances');

    // Get unique symbols from accounts
    const symbols = [...new Set(accounts.map((a) => a.currency))];
    logger.debug({ symbolCount: symbols.length }, 'Fetching spot prices');

    // Fetch all spot prices from Coinbase in parallel
    const spotPrices = await client.getSpotPrices(symbols);

    // Update price cache
    this.priceCache.clear();
    for (const [symbol, price] of spotPrices) {
      if (price !== null) {
        this.priceCache.set(symbol, price);
      }
    }

    logger.debug(
      { pricesFound: this.priceCache.size, total: symbols.length },
      'Fetched spot prices from Coinbase'
    );

    // Process all accounts
    const syncedPositions: Position[] = [];
    const now = Date.now();

    for (const account of accounts) {
      const position = await this.processAccount(userId, exchangeId, account, now);
      if (position) {
        syncedPositions.push(position);
      }
    }

    // Calculate portfolio totals
    const portfolio = this.calculatePortfolioSummary(syncedPositions, now);

    logger.info(
      {
        userId,
        exchangeId,
        positionCount: syncedPositions.length,
        totalValue: portfolio.totalValue.toFixed(2),
      },
      'Position sync completed'
    );

    return portfolio;
  }

  /**
   * Process a single Coinbase account and upsert position
   */
  private async processAccount(
    userId: number,
    exchangeId: number,
    account: CoinbaseAccount,
    timestamp: number
  ): Promise<Position | null> {
    const symbol = account.currency;
    const quantity = parseFloat(account.available_balance.value);
    const holdQuantity = parseFloat(account.hold.value);
    const totalQuantity = quantity + holdQuantity;

    if (totalQuantity === 0) {
      return null;
    }

    // Get current price
    const currentPrice = await this.getCurrentPrice(symbol, exchangeId);

    // Calculate current value
    const currentValue = totalQuantity * currentPrice;

    // Get existing position for cost basis
    const existingPosition = await this.db.query.positions.findFirst({
      where: and(
        eq(positions.userId, userId),
        eq(positions.exchangeId, exchangeId),
        eq(positions.symbol, symbol)
      ),
    });

    // Use existing cost basis or default to current value (first sync)
    const costBasis = existingPosition?.costBasis
      ? parseFloat(existingPosition.costBasis)
      : currentValue;

    // Calculate P&L
    const unrealizedPnL = currentValue - costBasis;
    const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

    // Upsert position in database
    await this.db
      .insert(positions)
      .values({
        userId,
        exchangeId,
        symbol,
        displayName: getCurrencyDisplayName(symbol),
        coinbaseAccountId: account.uuid,
        quantity: totalQuantity.toString(),
        availableQuantity: quantity.toString(),
        costBasis: costBasis.toString(),
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [positions.userId, positions.exchangeId, positions.symbol],
        set: {
          quantity: totalQuantity.toString(),
          availableQuantity: quantity.toString(),
          coinbaseAccountId: account.uuid,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    return {
      symbol,
      displayName: getCurrencyDisplayName(symbol),
      quantity: totalQuantity,
      availableQuantity: quantity,
      costBasis,
      currentPrice,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
      lastUpdated: timestamp,
    };
  }

  /**
   * Get current price for a symbol
   * Uses price cache populated during sync, falls back to ticker cache
   */
  private async getCurrentPrice(
    symbol: string,
    exchangeId: number
  ): Promise<number> {
    // Handle stablecoins and fiat
    if (['USD', 'USDC', 'USDT', 'DAI', 'GUSD', 'BUSD'].includes(symbol.toUpperCase())) {
      return 1.0;
    }

    // First check the price cache (populated during sync)
    const cachedPrice = this.priceCache.get(symbol);
    if (cachedPrice !== undefined) {
      return cachedPrice;
    }

    // Fallback to ticker cache (for WebSocket prices)
    const tradingPair = `${symbol}-USD`;
    try {
      const ticker = await this.tickerCache.getTicker(exchangeId, tradingPair);
      if (ticker?.price) {
        return ticker.price;
      }
    } catch (error) {
      logger.debug({ symbol, error }, 'Failed to get ticker from cache');
    }

    // No price available
    logger.debug({ symbol }, 'No price available for symbol');
    return 0;
  }

  /**
   * Get all positions from database
   */
  async getPositions(userId: number, exchangeId: number): Promise<Position[]> {
    const dbPositions = await this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.exchangeId, exchangeId)
        )
      );

    // Convert to Position type with P&L calculations
    const positionsWithPnL: Position[] = [];
    const now = Date.now();

    for (const pos of dbPositions) {
      const symbol = pos.symbol;
      const quantity = parseFloat(pos.quantity);
      const availableQuantity = pos.availableQuantity
        ? parseFloat(pos.availableQuantity)
        : quantity;
      const costBasis = pos.costBasis ? parseFloat(pos.costBasis) : 0;

      // Get current price
      const currentPrice = await this.getCurrentPrice(symbol, exchangeId);
      const currentValue = quantity * currentPrice;
      const unrealizedPnL = currentValue - costBasis;
      const unrealizedPnLPercent = costBasis > 0 ? (unrealizedPnL / costBasis) * 100 : 0;

      positionsWithPnL.push({
        symbol,
        displayName: pos.displayName || getCurrencyDisplayName(symbol),
        quantity,
        availableQuantity,
        costBasis,
        currentPrice,
        currentValue,
        unrealizedPnL,
        unrealizedPnLPercent,
        lastUpdated: pos.lastSyncedAt?.getTime() || now,
      });
    }

    return positionsWithPnL;
  }

  /**
   * Get portfolio summary
   */
  async getPortfolioSummary(userId: number, exchangeId: number): Promise<Portfolio> {
    const positions = await this.getPositions(userId, exchangeId);
    return this.calculatePortfolioSummary(positions, Date.now());
  }

  /**
   * Calculate portfolio totals from positions
   */
  private calculatePortfolioSummary(positions: Position[], timestamp: number): Portfolio {
    const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
    const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const totalPnL = totalValue - totalCostBasis;
    const totalPnLPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

    return {
      totalValue,
      totalCostBasis,
      totalPnL,
      totalPnLPercent,
      positions,
      lastSynced: timestamp,
    };
  }

  /**
   * Get position for a specific symbol
   */
  async getPositionBySymbol(
    userId: number,
    exchangeId: number,
    symbol: string
  ): Promise<Position | null> {
    const positions = await this.getPositions(userId, exchangeId);
    return positions.find((p) => p.symbol === symbol) || null;
  }

  /**
   * Update cost basis for a position
   * Used for manually adjusting cost basis
   */
  async updateCostBasis(
    userId: number,
    exchangeId: number,
    symbol: string,
    newCostBasis: number
  ): Promise<void> {
    await this.db
      .update(positions)
      .set({
        costBasis: newCostBasis.toString(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.exchangeId, exchangeId),
          eq(positions.symbol, symbol)
        )
      );
  }
}
