import { CoinbaseRestClient } from '@livermore/exchange-core';
import { createLogger } from '@livermore/utils';

const logger = createLogger({ name: 'account-symbols' });

const BLACKLISTED_SYMBOLS = [
  // Delisted from Coinbase
  'MOBILE', 'SYN',
  // Stablecoins (no X-USD trading pair exists)
  'USD', 'USDC', 'USDT', 'DAI', 'GUSD', 'BUSD', 'PYUSD', 'USDP', 'TUSD', 'FRAX', 'LUSD', 'SUSD', 'EURC',
];

// Minimum position value to include in monitoring (USD)
const MIN_POSITION_VALUE_USD = 2;

export interface AccountSymbolsResult {
  /** Symbols meeting minimum value threshold */
  monitored: string[];
  /** Symbols excluded due to low value (for cleanup) */
  excluded: string[];
}

/**
 * Fetch trading symbols from Coinbase account holdings.
 * Returns symbols with position value >= MIN_POSITION_VALUE_USD, excluding blacklisted and fiat.
 */
export async function getAccountSymbols(apiKeyId: string, privateKeyPem: string): Promise<AccountSymbolsResult> {
  const client = new CoinbaseRestClient(apiKeyId, privateKeyPem);
  const accounts = await client.getAccounts();

  // First pass: collect all non-zero crypto balances
  const holdings: { currency: string; balance: number }[] = [];

  for (const account of accounts) {
    if (account.type === 'ACCOUNT_TYPE_FIAT') continue;
    const balance = parseFloat(account.available_balance.value);
    if (balance <= 0) continue;
    const currency = account.currency;
    if (BLACKLISTED_SYMBOLS.includes(currency)) continue;
    holdings.push({ currency, balance });
  }

  // Get spot prices for all currencies
  const currencies = holdings.map((h) => h.currency);
  const prices = await client.getSpotPrices(currencies);

  // Filter by position value
  const monitored: string[] = [];
  const excluded: string[] = [];

  for (const { currency, balance } of holdings) {
    const price = prices.get(currency);
    const symbol = `${currency}-USD`;

    if (price === null || price === undefined) {
      logger.debug({ currency }, 'No price available, excluding from monitoring');
      excluded.push(symbol);
      continue;
    }

    const positionValue = balance * price;

    if (positionValue >= MIN_POSITION_VALUE_USD) {
      monitored.push(symbol);
      logger.debug({ symbol, balance, price, positionValue: positionValue.toFixed(2) }, 'Including in monitoring');
    } else {
      excluded.push(symbol);
      logger.debug({ symbol, balance, price, positionValue: positionValue.toFixed(2) }, 'Excluding (below minimum)');
    }
  }

  return {
    monitored: [...new Set(monitored)],
    excluded: [...new Set(excluded)],
  };
}
