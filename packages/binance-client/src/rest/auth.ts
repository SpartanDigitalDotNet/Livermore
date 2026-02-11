import { createHmac } from 'node:crypto';

/**
 * Binance API Authentication (HMAC-SHA256)
 *
 * Used for signed endpoints (account, trading).
 * Not needed for public endpoints like /api/v3/klines.
 *
 * Reference: https://developers.binance.com/docs/binance-spot-api-docs/general-info#signed-trade-and-user_data-endpoint-security
 */
export class BinanceAuth {
  private readonly _apiKey: string;
  private readonly secretKey: string;

  constructor(apiKey: string, secretKey: string) {
    this._apiKey = apiKey;
    this.secretKey = secretKey;
  }

  /**
   * Generate HMAC-SHA256 signature for a query string
   */
  sign(queryString: string): string {
    return createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  /**
   * API key for X-MBX-APIKEY header
   */
  get apiKey(): string {
    return this._apiKey;
  }
}
