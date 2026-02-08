import { logger } from '@livermore/utils';

/**
 * CoinGecko coin data from /coins/markets endpoint
 */
export interface CoinGeckoCoin {
  id: string;           // e.g., "bitcoin"
  symbol: string;       // e.g., "btc"
  name: string;         // e.g., "Bitcoin"
  market_cap: number;
  market_cap_rank: number;
}

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

/**
 * CoinGecko Service
 *
 * Minimal client for fetching top coins by market cap.
 * Uses public API (no key required, 5-15 calls/min).
 * Optional COINGECKO_API_KEY env var for demo plan header.
 */
export class CoinGeckoService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.COINGECKO_API_KEY;
  }

  /**
   * Fetch top N coins by market cap from CoinGecko.
   * Single API call: GET /coins/markets?vs_currency=usd&order=market_cap_desc&per_page={limit}
   */
  async getTopCoinsByMarketCap(limit: number = 100): Promise<CoinGeckoCoin[]> {
    const url = `${COINGECKO_BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.apiKey) {
      headers['x-cg-demo-api-key'] = this.apiKey;
    }

    logger.info({ limit }, 'Fetching top coins from CoinGecko');

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`CoinGecko API error ${response.status}: ${text}`);
    }

    const data = await response.json() as Array<{
      id: string;
      symbol: string;
      name: string;
      market_cap: number;
      market_cap_rank: number;
    }>;

    const coins: CoinGeckoCoin[] = data.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      market_cap: c.market_cap,
      market_cap_rank: c.market_cap_rank,
    }));

    logger.info({ count: coins.length }, 'Fetched coins from CoinGecko');
    return coins;
  }
}
