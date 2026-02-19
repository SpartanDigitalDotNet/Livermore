import { getDbClient, exchangeSymbols, exchanges } from '@livermore/database';
import { eq, and, notInArray, isNull } from 'drizzle-orm';
import { logger } from '@livermore/utils';
import { CoinGeckoService, type CoinGeckoCoin } from './coingecko.service';
import { ExchangeProductService, type ExchangeProduct } from './exchange-product.service';
import { scoreAndSummarize } from './liquidity-score.service';

/**
 * Summary of a symbol refresh operation
 */
export interface RefreshSummary {
  added: number;
  updated: number;
  deactivated: number;
  perExchange: Record<string, { added: number; updated: number; deactivated: number }>;
  timestamp: string;
}

/**
 * Exchange configuration for product fetching
 */
interface ExchangeConfig {
  id: number;
  name: string;
  fetchProducts: () => Promise<ExchangeProduct[]>;
}

/**
 * Symbol Refresh Service
 *
 * Orchestrates the full refresh flow:
 * 1. Fetch top N from CoinGecko (global master list)
 * 2. For each exchange, fetch available products
 * 3. Match by base currency (CoinGecko symbol ↔ exchange base_currency)
 * 4. Filter to USD quote (USDT fallback)
 * 5. Upsert into exchange_symbols with global_rank, market_cap, coingecko_id, display_name
 * 6. Mark unmatched symbols as inactive
 */
export class SymbolRefreshService {
  private db = getDbClient();
  private coingecko = new CoinGeckoService();
  private exchangeProducts = new ExchangeProductService();

  /**
   * Run the full refresh: CoinGecko global list → exchange intersection → upsert
   *
   * @param limit - Number of top coins to fetch from CoinGecko
   * @param exchangeId - If provided, refresh only this exchange (bypasses geo-restriction filter)
   */
  async refresh(limit: number = 100, exchangeId?: number): Promise<RefreshSummary> {
    const startTime = Date.now();
    logger.info({ limit, exchangeId }, 'Starting symbol universe refresh');

    // Step 1: Fetch global coin rankings from CoinGecko
    const coins = await this.coingecko.getTopCoinsByMarketCap(limit);

    // Build lookup: lowercase symbol → CoinGecko data
    // Handle duplicates by keeping the higher-ranked coin
    const coinBySymbol = new Map<string, CoinGeckoCoin>();
    for (const coin of coins) {
      const sym = coin.symbol.toUpperCase();
      if (!coinBySymbol.has(sym)) {
        coinBySymbol.set(sym, coin);
      }
    }

    // Step 2: Get exchange configs from database
    const exchangeConfigs = await this.getExchangeConfigs(exchangeId);

    // Step 3: Process exchanges in parallel
    const summary: RefreshSummary = {
      added: 0,
      updated: 0,
      deactivated: 0,
      perExchange: {},
      timestamp: new Date().toISOString(),
    };

    const results = await Promise.all(
      exchangeConfigs.map(async (exchange) => ({
        name: exchange.name,
        result: await this.refreshExchange(exchange, coinBySymbol),
      }))
    );

    for (const { name, result } of results) {
      summary.added += result.added;
      summary.updated += result.updated;
      summary.deactivated += result.deactivated;
      summary.perExchange[name] = result;
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      { ...summary, elapsedMs: elapsed },
      'Symbol universe refresh complete'
    );

    return summary;
  }

  /**
   * Get exchange configurations with their product fetchers
   *
   * @param exchangeId - If provided, return only this exchange (bypasses geo-restriction filter).
   *                     If omitted, return all active exchanges without geo restrictions.
   */
  private async getExchangeConfigs(exchangeId?: number): Promise<ExchangeConfig[]> {
    const whereClause = exchangeId
      ? and(eq(exchanges.isActive, true), eq(exchanges.id, exchangeId))
      : and(eq(exchanges.isActive, true), isNull(exchanges.geoRestrictions));

    const allExchanges = await this.db
      .select({ id: exchanges.id, name: exchanges.name })
      .from(exchanges)
      .where(whereClause);

    const configs: ExchangeConfig[] = [];

    for (const ex of allExchanges) {
      switch (ex.name) {
        case 'coinbase':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getCoinbaseProducts(),
          });
          break;
        case 'binance':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getBinanceProducts(),
          });
          break;
        case 'binance_us':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getBinanceUSProducts(),
          });
          break;
        case 'kraken':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getKrakenProducts(),
          });
          break;
        case 'kucoin':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getKucoinProducts(),
          });
          break;
        case 'mexc':
          configs.push({
            id: ex.id,
            name: ex.name,
            fetchProducts: () => this.exchangeProducts.getMexcProducts(),
          });
          break;
        default:
          logger.debug({ exchange: ex.name }, 'Skipping exchange (no product fetcher)');
          break;
      }
    }

    return configs;
  }

  /**
   * Refresh symbols for a single exchange by intersecting with CoinGecko data
   */
  private async refreshExchange(
    exchange: ExchangeConfig,
    coinBySymbol: Map<string, CoinGeckoCoin>
  ): Promise<{ added: number; updated: number; deactivated: number }> {
    logger.info({ exchange: exchange.name }, 'Refreshing exchange symbols');

    let products: ExchangeProduct[];
    try {
      products = await exchange.fetchProducts();
    } catch (error: any) {
      logger.error(
        { exchange: exchange.name, error: error.message },
        'Failed to fetch exchange products, skipping'
      );
      return { added: 0, updated: 0, deactivated: 0 };
    }

    let added = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const upsertedSymbols: string[] = [];

    // Build a map of exchange products by base currency for USD/USDT fallback
    // Group by base currency, prefer USD over USDT
    const bestProductByBase = new Map<string, ExchangeProduct>();
    for (const product of products) {
      const base = product.baseCurrency.toUpperCase();
      const existing = bestProductByBase.get(base);
      if (!existing) {
        bestProductByBase.set(base, product);
      } else if (product.quoteCurrency === 'USD' && existing.quoteCurrency !== 'USD') {
        // Prefer USD over USDT
        bestProductByBase.set(base, product);
      }
    }

    // Compute liquidity scores for the selected products
    const selectedProducts = Array.from(bestProductByBase.values());
    const { scores } = scoreAndSummarize(exchange.name, selectedProducts);
    const scoreBySymbol = new Map<string, number>();
    selectedProducts.forEach((p, i) => scoreBySymbol.set(p.symbol, scores[i]));

    for (const [baseCurrency, product] of bestProductByBase) {
      const coin = coinBySymbol.get(baseCurrency);
      if (!coin) continue; // Not in CoinGecko top N — skip

      upsertedSymbols.push(product.symbol);
      const liquidityScore = scoreBySymbol.get(product.symbol)?.toString() ?? null;

      // Check if symbol already exists
      const [existing] = await this.db
        .select({ id: exchangeSymbols.id })
        .from(exchangeSymbols)
        .where(
          and(
            eq(exchangeSymbols.exchangeId, exchange.id),
            eq(exchangeSymbols.symbol, product.symbol)
          )
        )
        .limit(1);

      if (existing) {
        // Update existing
        await this.db
          .update(exchangeSymbols)
          .set({
            volume24h: product.volume24h.toString(),
            tradeCount24h: product.tradeCount24h ?? null,
            liquidityScore,
            globalRank: coin.market_cap_rank,
            marketCap: coin.market_cap.toString(),
            coingeckoId: coin.id,
            displayName: coin.name,
            isActive: true,
            lastVolumeUpdate: now,
            updatedAt: now,
          })
          .where(eq(exchangeSymbols.id, existing.id));
        updated++;
      } else {
        // Insert new
        await this.db
          .insert(exchangeSymbols)
          .values({
            exchangeId: exchange.id,
            symbol: product.symbol,
            baseCurrency: product.baseCurrency,
            quoteCurrency: product.quoteCurrency,
            volume24h: product.volume24h.toString(),
            tradeCount24h: product.tradeCount24h ?? null,
            liquidityScore,
            globalRank: coin.market_cap_rank,
            marketCap: coin.market_cap.toString(),
            coingeckoId: coin.id,
            displayName: coin.name,
            isActive: true,
            lastVolumeUpdate: now,
            updatedAt: now,
          });
        added++;
      }
    }

    // Deactivate symbols that are no longer in the intersection
    let deactivated = 0;
    if (upsertedSymbols.length > 0) {
      const result = await this.db
        .update(exchangeSymbols)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(exchangeSymbols.exchangeId, exchange.id),
            eq(exchangeSymbols.isActive, true),
            notInArray(exchangeSymbols.symbol, upsertedSymbols)
          )
        )
        .returning({ id: exchangeSymbols.id });
      deactivated = result.length;
    }

    logger.info(
      { exchange: exchange.name, added, updated, deactivated },
      'Exchange symbol refresh complete'
    );

    return { added, updated, deactivated };
  }
}
