import type { IRestClient } from '@livermore/schemas';
import { CoinbaseRestClient } from '@livermore/coinbase-client';
import { BinanceRestClient } from '@livermore/binance-client';

export function createRestClient(
  exchangeName: string,
  apiKeyEnvVar: string,
  apiSecretEnvVar: string
): IRestClient {
  switch (exchangeName) {
    case 'coinbase': {
      const apiKeyId = process.env[apiKeyEnvVar];
      const privateKeyPem = process.env[apiSecretEnvVar];
      if (!apiKeyId || !privateKeyPem) {
        throw new Error(`Missing Coinbase credentials: ${apiKeyEnvVar} / ${apiSecretEnvVar}`);
      }
      return new CoinbaseRestClient(apiKeyId, privateKeyPem);
    }
    case 'binance':
    case 'binanceus': {
      const baseUrl = exchangeName === 'binanceus'
        ? 'https://api.binance.us'
        : 'https://api.binance.com';
      return new BinanceRestClient({ baseUrl });
    }
    default:
      throw new Error(`Unsupported exchange for REST client: ${exchangeName}`);
  }
}
