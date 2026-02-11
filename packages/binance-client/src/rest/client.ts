import type { Candle, Timeframe } from '@livermore/schemas';
import { CandleSchema } from '@livermore/schemas';
import { logger } from '@livermore/utils';
import { BinanceAuth } from './auth';

/**
 * Binance REST API client
 *
 * Supports both Binance.com and Binance.US (identical API, different base URL).
 * Public endpoints (klines) require no authentication.
 * Signed endpoints (account, trading) require API key + HMAC-SHA256 signature.
 *
 * Reference: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
 */
export class BinanceRestClient {
  private readonly baseUrl: string;
  private readonly auth: BinanceAuth | null;

  constructor(options?: { baseUrl?: string; auth?: { apiKey: string; secretKey: string } }) {
    this.baseUrl = options?.baseUrl ?? 'https://api.binance.com';
    this.auth = options?.auth
      ? new BinanceAuth(options.auth.apiKey, options.auth.secretKey)
      : null;
  }

  /**
   * Fetch historical candles (klines) for a symbol
   *
   * Binance /api/v3/klines is a public endpoint — no auth required.
   * Returns up to 1000 candles per request (default limit: 100).
   *
   * @param symbol - Trading pair in Binance format (e.g., "BTCUSDT")
   * @param timeframe - Candle interval (e.g., "1m", "1h", "1d")
   * @param start - Optional start time in milliseconds
   * @param end - Optional end time in milliseconds
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    start?: number,
    end?: number
  ): Promise<Candle[]> {
    const params = new URLSearchParams({
      symbol,
      interval: timeframe,
      limit: '100',
    });

    if (start) {
      params.append('startTime', start.toString());
    }

    if (end) {
      params.append('endTime', end.toString());
    }

    try {
      const response = await this.request('GET', `/api/v3/klines?${params.toString()}`);

      // Binance kline response: array of arrays
      // [0] openTime, [1] open, [2] high, [3] low, [4] close, [5] volume, ...
      const candles: Candle[] = response.map((kline: any[]) =>
        CandleSchema.parse({
          timestamp: kline[0],
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
          symbol,
          timeframe,
        })
      );

      return candles;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, symbol, timeframe }, 'Failed to fetch candles from Binance');
      throw err;
    }
  }

  /**
   * All project timeframes are supported by Binance
   * (Binance uses the same format: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 1d)
   */
  static readonly SUPPORTED_TIMEFRAMES: Timeframe[] = [
    '1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d',
  ];

  /**
   * Check if a timeframe is supported — always true for project timeframes
   */
  static isTimeframeSupported(timeframe: Timeframe): boolean {
    return BinanceRestClient.SUPPORTED_TIMEFRAMES.includes(timeframe);
  }

  /**
   * Make a request to the Binance API
   *
   * @param method - HTTP method
   * @param path - API path with query string (e.g., "/api/v3/klines?symbol=BTCUSDT&interval=1m")
   * @param signed - Whether to add timestamp + HMAC signature (for private endpoints)
   */
  private async request(method: string, path: string, signed = false): Promise<any> {
    const headers: Record<string, string> = {};

    if (signed) {
      if (!this.auth) {
        throw new Error('BinanceRestClient: auth required for signed endpoints');
      }

      headers['X-MBX-APIKEY'] = this.auth.apiKey;

      // Append timestamp and signature to query string
      const separator = path.includes('?') ? '&' : '?';
      const timestamp = Date.now();
      const queryWithTimestamp = path.includes('?')
        ? `${path.split('?')[1]}&timestamp=${timestamp}`
        : `timestamp=${timestamp}`;
      const signature = this.auth.sign(queryWithTimestamp);
      path = `${path}${separator}timestamp=${timestamp}&signature=${signature}`;
    }

    const url = `${this.baseUrl}${path}`;

    logger.debug({ method, path: path.split('?')[0] }, 'Making Binance API request');

    const response = await fetch(url, { method, headers });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { status: response.status, statusText: response.statusText, error: errorText },
        'Binance API request failed'
      );
      throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}
