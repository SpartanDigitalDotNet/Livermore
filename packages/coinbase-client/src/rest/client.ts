import type { Candle, Timeframe } from '@livermore/schemas';
import { CandleSchema } from '@livermore/schemas';
import { logger } from '@livermore/utils';
import { CoinbaseAuth } from './auth';

/**
 * Coinbase Advanced Trade API REST client
 *
 * Provides methods for fetching historical market data
 * Reference: https://docs.cdp.coinbase.com/advanced-trade/docs/rest-api-overview
 */
export class CoinbaseRestClient {
  private baseUrl = 'https://api.coinbase.com';
  private auth: CoinbaseAuth;

  constructor(apiKeyId: string, privateKeyPem: string) {
    this.auth = new CoinbaseAuth(apiKeyId, privateKeyPem);
  }

  /**
   * Fetch historical candles for a symbol
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    start?: number,
    end?: number
  ): Promise<Candle[]> {
    // Map our timeframe format to Coinbase granularity (in seconds)
    const granularity = this.timeframeToGranularity(timeframe);

    // Build query parameters
    const params = new URLSearchParams({
      granularity: granularity.toString(),
    });

    if (start) {
      params.append('start', Math.floor(start / 1000).toString());
    }

    if (end) {
      params.append('end', Math.floor(end / 1000).toString());
    }

    const path = `/api/v3/brokerage/products/${symbol}/candles?${params.toString()}`;

    try {
      const response = await this.request('GET', path);

      // Transform Coinbase candle format to our schema
      const candles: Candle[] = response.candles.map((cb: any) => ({
        timestamp: parseInt(cb.start) * 1000, // Convert to milliseconds
        open: parseFloat(cb.open),
        high: parseFloat(cb.high),
        low: parseFloat(cb.low),
        close: parseFloat(cb.close),
        volume: parseFloat(cb.volume),
        symbol,
        timeframe,
      }));

      // Validate with Zod
      return candles.map(c => CandleSchema.parse(c));

    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Failed to fetch candles from Coinbase');
      throw error;
    }
  }

  /**
   * Get list of available trading pairs
   */
  async getProducts(): Promise<any[]> {
    const path = '/api/v3/brokerage/products';

    try {
      const response = await this.request('GET', path);
      return response.products || [];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch products from Coinbase');
      throw error;
    }
  }

  /**
   * Get product details
   */
  async getProduct(symbol: string): Promise<any> {
    const path = `/api/v3/brokerage/products/${symbol}`;

    try {
      const response = await this.request('GET', path);
      return response;
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch product from Coinbase');
      throw error;
    }
  }

  /**
   * Make authenticated request to Coinbase API
   */
  private async request(method: string, path: string, body?: any): Promise<any> {
    const token = await this.auth.generateToken();

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${path}`;

    logger.debug({ method, path }, 'Making Coinbase API request');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, statusText: response.statusText, error: errorText },
        'Coinbase API request failed'
      );
      throw new Error(`Coinbase API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Convert our timeframe format to Coinbase granularity (seconds)
   */
  private timeframeToGranularity(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };

    return map[timeframe];
  }
}
