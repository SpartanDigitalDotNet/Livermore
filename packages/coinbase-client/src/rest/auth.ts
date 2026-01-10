/**
 * Coinbase Advanced Trade API Authentication
 *
 * Uses JWT-based authentication with EC private keys (ES256).
 * Reference: https://docs.cdp.coinbase.com/advanced-trade/docs/ws-auth
 */
import jwt from 'jsonwebtoken';

export class CoinbaseAuth {
  private apiKeyName: string;
  private privateKey: string;

  constructor(apiKeyName: string, privateKeyPem: string) {
    this.apiKeyName = apiKeyName;
    // Handle PEM keys stored with literal \n strings (common in env vars)
    this.privateKey = privateKeyPem.replace(/\\n/g, '\n');
  }

  /**
   * Generate JWT token for WebSocket authentication
   * Reference: https://docs.cdp.coinbase.com/advanced-trade/docs/ws-auth
   */
  generateToken(): string {
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      sub: this.apiKeyName,
      iss: 'coinbase-cloud',
      nbf: now,
      exp: now + 120,
    };

    // Match working Python implementation - NO nonce in header
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = jwt.sign(payload, this.privateKey, {
      algorithm: 'ES256',
      header: {
        kid: this.apiKeyName,
        typ: 'JWT',
      },
    } as any);

    return token;
  }

  /**
   * Generate JWT token for REST API authentication
   * @param method HTTP method (GET, POST, etc.)
   * @param requestPath API path (e.g., /api/v3/brokerage/accounts)
   */
  generateRestToken(method: string, requestPath: string): string {
    const now = Math.floor(Date.now() / 1000);
    const uri = `${method} api.coinbase.com${requestPath}`;

    const payload = {
      sub: this.apiKeyName,
      iss: 'coinbase-cloud',
      nbf: now,
      exp: now + 120,
      uri,
    };

    // Match working Python implementation - NO nonce in header
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = jwt.sign(payload, this.privateKey, {
      algorithm: 'ES256',
      header: {
        kid: this.apiKeyName,
        typ: 'JWT',
      },
    } as any);

    return token;
  }

  getApiKeyName(): string {
    return this.apiKeyName;
  }
}
