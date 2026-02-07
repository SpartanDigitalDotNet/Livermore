import { getDbClient, exchangeSymbols } from '@livermore/database';
import { eq, and, lte } from 'drizzle-orm';
import { logger } from '@livermore/utils';

/**
 * Symbol with tier classification
 */
export interface ClassifiedSymbol {
  symbol: string;
  tier: 1 | 2;
  source: 'exchange_volume' | 'user_position';
  volumeRank?: number;
  volume24h?: number;
}

/**
 * Symbol Source Service
 *
 * Phase 25: Two-tier symbol sourcing with automatic de-duplication.
 *
 * - Tier 1: Top N symbols by 24h volume from exchange (shared pool)
 * - Tier 2: User positions not in Tier 1 (user overflow with TTL)
 *
 * De-duplication: If a user position is in Tier 1, use shared pool (no duplicate data).
 */
export class SymbolSourceService {
  private db = getDbClient();

  /** Maximum Tier 1 symbols per exchange */
  private readonly TIER_1_LIMIT = 50;

  constructor(private exchangeId: number) {}

  /**
   * Get Tier 1 symbols for the exchange
   * These are top N by 24h volume, shared across all users
   */
  async getTier1Symbols(): Promise<ClassifiedSymbol[]> {
    const symbols = await this.db
      .select({
        symbol: exchangeSymbols.symbol,
        volumeRank: exchangeSymbols.volumeRank,
        volume24h: exchangeSymbols.volume24h,
      })
      .from(exchangeSymbols)
      .where(
        and(
          eq(exchangeSymbols.exchangeId, this.exchangeId),
          eq(exchangeSymbols.isActive, true),
          lte(exchangeSymbols.volumeRank, this.TIER_1_LIMIT)
        )
      )
      .orderBy(exchangeSymbols.volumeRank);

    return symbols.map((s) => ({
      symbol: s.symbol,
      tier: 1 as const,
      source: 'exchange_volume' as const,
      volumeRank: s.volumeRank ?? undefined,
      volume24h: s.volume24h ? parseFloat(s.volume24h) : undefined,
    }));
  }

  /**
   * Classify user positions into Tier 1 or Tier 2
   *
   * @param userPositionSymbols - Symbols from user's open positions
   * @returns Classified symbols with tier assignment
   */
  async classifyUserPositions(userPositionSymbols: string[]): Promise<ClassifiedSymbol[]> {
    if (userPositionSymbols.length === 0) return [];

    // Get Tier 1 symbols for de-duplication
    const tier1Symbols = await this.getTier1Symbols();
    const tier1Set = new Set(tier1Symbols.map((s) => s.symbol));

    const classified: ClassifiedSymbol[] = [];

    for (const symbol of userPositionSymbols) {
      if (tier1Set.has(symbol)) {
        // Symbol is in Tier 1 - use shared pool (de-duplication)
        const tier1Symbol = tier1Symbols.find((s) => s.symbol === symbol);
        classified.push({
          symbol,
          tier: 1,
          source: 'user_position',
          volumeRank: tier1Symbol?.volumeRank,
          volume24h: tier1Symbol?.volume24h,
        });
      } else {
        // Symbol not in Tier 1 - Tier 2 (user overflow)
        classified.push({
          symbol,
          tier: 2,
          source: 'user_position',
        });
      }
    }

    return classified;
  }

  /**
   * Get merged symbol list with tier annotations
   *
   * Combines Tier 1 symbols with user positions, de-duplicating where possible.
   *
   * @param userPositionSymbols - Symbols from user's open positions
   * @returns All symbols to monitor with tier classification
   */
  async getMergedSymbols(userPositionSymbols: string[] = []): Promise<ClassifiedSymbol[]> {
    const tier1Symbols = await this.getTier1Symbols();
    const tier1Set = new Set(tier1Symbols.map((s) => s.symbol));

    // Start with all Tier 1 symbols
    const result = new Map<string, ClassifiedSymbol>();
    for (const s of tier1Symbols) {
      result.set(s.symbol, s);
    }

    // Add Tier 2 symbols (positions not in Tier 1)
    for (const symbol of userPositionSymbols) {
      if (!tier1Set.has(symbol)) {
        result.set(symbol, {
          symbol,
          tier: 2,
          source: 'user_position',
        });
      }
      // If in Tier 1, already included (de-duplication)
    }

    const merged = Array.from(result.values());
    logger.debug(
      {
        exchangeId: this.exchangeId,
        tier1Count: tier1Symbols.length,
        tier2Count: merged.filter((s) => s.tier === 2).length,
        totalCount: merged.length,
      },
      'Symbol source merged'
    );

    return merged;
  }

  /**
   * Refresh Tier 1 symbols from exchange volume data
   *
   * Called periodically to update volume rankings.
   * Fetches top N products by 24h volume from exchange API.
   *
   * @param volumeData - Array of { symbol, volume24h } from exchange
   */
  async refreshTier1Symbols(
    volumeData: Array<{ symbol: string; baseCurrency: string; quoteCurrency: string; volume24h: number }>
  ): Promise<void> {
    if (volumeData.length === 0) return;

    // Sort by volume descending and assign ranks
    const ranked = volumeData
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, this.TIER_1_LIMIT)
      .map((d, i) => ({
        ...d,
        volumeRank: i + 1,
      }));

    const now = new Date().toISOString();

    // Upsert each symbol
    for (const data of ranked) {
      await this.db
        .insert(exchangeSymbols)
        .values({
          exchangeId: this.exchangeId,
          symbol: data.symbol,
          baseCurrency: data.baseCurrency,
          quoteCurrency: data.quoteCurrency,
          volume24h: data.volume24h.toString(),
          volumeRank: data.volumeRank,
          isActive: true,
          lastVolumeUpdate: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [exchangeSymbols.exchangeId, exchangeSymbols.symbol],
          set: {
            volume24h: data.volume24h.toString(),
            volumeRank: data.volumeRank,
            isActive: true,
            lastVolumeUpdate: now,
            updatedAt: now,
          },
        });
    }

    // Mark symbols outside top N as inactive
    const rankedSymbols = new Set(ranked.map((r) => r.symbol));
    const allSymbols = await this.db
      .select({ symbol: exchangeSymbols.symbol })
      .from(exchangeSymbols)
      .where(eq(exchangeSymbols.exchangeId, this.exchangeId));

    for (const row of allSymbols) {
      if (!rankedSymbols.has(row.symbol)) {
        await this.db
          .update(exchangeSymbols)
          .set({ isActive: false, updatedAt: now })
          .where(
            and(
              eq(exchangeSymbols.exchangeId, this.exchangeId),
              eq(exchangeSymbols.symbol, row.symbol)
            )
          );
      }
    }

    logger.info(
      { exchangeId: this.exchangeId, symbolCount: ranked.length },
      'Refreshed Tier 1 symbols'
    );
  }

  /**
   * Check if a symbol is in Tier 1 (shared pool)
   */
  async isInTier1(symbol: string): Promise<boolean> {
    const [result] = await this.db
      .select({ symbol: exchangeSymbols.symbol })
      .from(exchangeSymbols)
      .where(
        and(
          eq(exchangeSymbols.exchangeId, this.exchangeId),
          eq(exchangeSymbols.symbol, symbol),
          eq(exchangeSymbols.isActive, true),
          lte(exchangeSymbols.volumeRank, this.TIER_1_LIMIT)
        )
      )
      .limit(1);

    return !!result;
  }

  /**
   * Get the tier for a symbol
   *
   * @returns 1 if in shared pool, 2 if user overflow, null if not found
   */
  async getSymbolTier(symbol: string): Promise<1 | 2 | null> {
    const inTier1 = await this.isInTier1(symbol);
    if (inTier1) return 1;

    // Symbol not in Tier 1 - would be Tier 2 if user has position
    // This method returns null if symbol is completely unknown
    return null;
  }
}
