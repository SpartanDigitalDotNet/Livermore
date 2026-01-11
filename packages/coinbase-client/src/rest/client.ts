import type { Candle, Timeframe } from '@livermore/schemas';
import { CandleSchema } from '@livermore/schemas';
import { logger } from '@livermore/utils';
import { CoinbaseAuth } from './auth';

/**
 * Coinbase account type from the Advanced Trade API
 */
export interface CoinbaseAccount {
  /** Account UUID */
  uuid: string;
  /** Account name (e.g., "BTC Wallet") */
  name: string;
  /** Currency code (e.g., "BTC", "ETH", "USD") */
  currency: string;
  /** Available balance (not on hold) */
  available_balance: {
    value: string;
    currency: string;
  };
  /** Amount on hold for orders */
  hold: {
    value: string;
    currency: string;
  };
  /** Account type */
  type: 'ACCOUNT_TYPE_CRYPTO' | 'ACCOUNT_TYPE_FIAT' | 'ACCOUNT_TYPE_UNSPECIFIED';
  /** Whether the account is active */
  active: boolean;
  /** ISO timestamp when account was created */
  created_at: string;
  /** ISO timestamp when account was last updated */
  updated_at: string;
  /** Whether account is ready for trading */
  ready: boolean;
}

/**
 * Coinbase order from the Advanced Trade API
 */
export interface CoinbaseOrder {
  order_id: string;
  client_order_id?: string;
  product_id: string;
  side: 'BUY' | 'SELL';
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'UNKNOWN_ORDER_STATUS';
  time_in_force: 'GTC' | 'GTD' | 'IOC' | 'FOK';
  created_time: string;
  completion_percentage: string;
  filled_size: string;
  average_filled_price: string;
  fee: string;
  number_of_fills: string;
  filled_value: string;
  pending_cancel: boolean;
  size_in_quote: boolean;
  total_fees: string;
  total_value_after_fees: string;
  order_type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  reject_reason: string;
  settled: boolean;
  product_type: 'SPOT' | 'FUTURE';
  outstanding_hold_amount: string;
  order_configuration: {
    market_market_ioc?: {
      quote_size?: string;
      base_size?: string;
    };
    limit_limit_gtc?: {
      base_size: string;
      limit_price: string;
      post_only: boolean;
    };
    limit_limit_gtd?: {
      base_size: string;
      limit_price: string;
      end_time: string;
      post_only: boolean;
    };
    stop_limit_stop_limit_gtc?: {
      base_size: string;
      limit_price: string;
      stop_price: string;
      stop_direction: 'STOP_DIRECTION_STOP_UP' | 'STOP_DIRECTION_STOP_DOWN';
    };
    stop_limit_stop_limit_gtd?: {
      base_size: string;
      limit_price: string;
      stop_price: string;
      end_time: string;
      stop_direction: 'STOP_DIRECTION_STOP_UP' | 'STOP_DIRECTION_STOP_DOWN';
    };
  };
}

/**
 * Transaction summary with fee tier information from Coinbase
 */
export interface CoinbaseTransactionSummary {
  total_volume: number;
  total_fees: number;
  fee_tier: {
    pricing_tier: string;
    usd_from: string;
    usd_to: string;
    taker_fee_rate: string;
    maker_fee_rate: string;
  };
  advanced_trade_only_volume: number;
  advanced_trade_only_fees: number;
}

/**
 * Coinbase Advanced Trade API REST client
 *
 * Provides methods for fetching historical market data and account info
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
    // Map our timeframe format to Coinbase granularity string
    const granularity = this.timeframeToGranularity(timeframe);

    if (!granularity) {
      throw new Error(`Timeframe '${timeframe}' is not supported by Coinbase`);
    }

    // Build query parameters
    const params = new URLSearchParams({
      granularity,
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
   * List all accounts (wallets) for the authenticated user
   * Returns all crypto and fiat wallets with their balances
   *
   * Reference: https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getaccounts
   */
  async getAccounts(limit: number = 250): Promise<CoinbaseAccount[]> {
    const allAccounts: CoinbaseAccount[] = [];
    let cursor: string | undefined;

    // Paginate through all accounts
    do {
      const params = new URLSearchParams({
        limit: limit.toString(),
      });

      if (cursor) {
        params.append('cursor', cursor);
      }

      const path = `/api/v3/brokerage/accounts?${params.toString()}`;

      try {
        const response = await this.request('GET', path);
        const accounts = response.accounts || [];
        allAccounts.push(...accounts);

        // Check for more pages
        cursor = response.has_next && response.cursor ? response.cursor : undefined;

      } catch (error) {
        logger.error({ error }, 'Failed to fetch accounts from Coinbase');
        throw error;
      }
    } while (cursor);

    logger.debug({ count: allAccounts.length }, 'Fetched Coinbase accounts');
    return allAccounts;
  }

  /**
   * Get a specific account by UUID
   *
   * Reference: https://docs.cdp.coinbase.com/advanced-trade/reference/retailbrokerageapi_getaccount
   */
  async getAccount(accountId: string): Promise<CoinbaseAccount> {
    const path = `/api/v3/brokerage/accounts/${accountId}`;

    try {
      const response = await this.request('GET', path);
      return response.account;
    } catch (error) {
      logger.error({ error, accountId }, 'Failed to fetch account from Coinbase');
      throw error;
    }
  }

  /**
   * Get accounts with non-zero balances only
   * Convenience method that filters out empty wallets
   */
  async getAccountsWithBalance(): Promise<CoinbaseAccount[]> {
    const accounts = await this.getAccounts();

    return accounts.filter((account) => {
      const balance = parseFloat(account.available_balance.value);
      const hold = parseFloat(account.hold.value);
      return balance > 0 || hold > 0;
    });
  }

  /**
   * Get the best bid/ask prices for multiple products in a single API call
   * Uses the /best_bid_ask endpoint which is more efficient than individual product calls
   *
   * Reference: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-best-bid-ask
   *
   * @param productIds - Array of trading pair IDs (e.g., ['BTC-USD', 'ETH-USD'])
   * @returns Map of product_id -> mid price (average of best bid and ask)
   */
  async getBestBidAsk(productIds: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (productIds.length === 0) {
      return prices;
    }

    // Build query string with multiple product_ids
    const params = new URLSearchParams();
    for (const productId of productIds) {
      params.append('product_ids', productId);
    }

    const path = `/api/v3/brokerage/best_bid_ask?${params.toString()}`;

    try {
      const response = await this.request('GET', path);

      if (response?.pricebooks) {
        for (const pricebook of response.pricebooks) {
          const productId = pricebook.product_id;

          // Get best bid and ask prices
          const bestBid = pricebook.bids?.[0]?.price;
          const bestAsk = pricebook.asks?.[0]?.price;

          if (bestBid && bestAsk) {
            // Use mid price (average of bid and ask)
            const midPrice = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2;
            prices.set(productId, midPrice);
          } else if (bestBid) {
            prices.set(productId, parseFloat(bestBid));
          } else if (bestAsk) {
            prices.set(productId, parseFloat(bestAsk));
          }
        }
      }

      logger.debug({ count: prices.size, requested: productIds.length }, 'Fetched best bid/ask prices');
      return prices;

    } catch (error) {
      logger.error({ error, productCount: productIds.length }, 'Failed to fetch best bid/ask');
      return prices;
    }
  }

  /**
   * Get spot prices for multiple symbols
   * Converts symbols to valid product IDs and fetches prices via best_bid_ask endpoint
   * Handles symbols that may have different quote currencies (USD, USDC, etc.)
   *
   * @param symbols - Array of asset symbols (e.g., ['BTC', 'ETH', 'SOL'])
   * @returns Map of symbol -> price (null if unavailable)
   */
  async getSpotPrices(symbols: string[]): Promise<Map<string, number | null>> {
    const prices = new Map<string, number | null>();

    // Separate stablecoins/fiat from crypto
    const stableAssets = ['USD', 'USDC', 'USDT', 'DAI', 'GUSD', 'BUSD'];
    const cryptoSymbols: string[] = [];

    for (const symbol of symbols) {
      if (stableAssets.includes(symbol.toUpperCase())) {
        prices.set(symbol, 1.0);
      } else {
        cryptoSymbols.push(symbol);
      }
    }

    if (cryptoSymbols.length === 0) {
      return prices;
    }

    // Fetch all valid products to find correct trading pairs
    const validProducts = await this.getValidProductsMap();

    // Find valid trading pairs for each symbol
    // Prefer USD, then USDC as quote currency
    const symbolToProductId = new Map<string, string>();
    const productIdsToFetch: string[] = [];

    for (const symbol of cryptoSymbols) {
      const upperSymbol = symbol.toUpperCase();

      // Try USD first, then USDC
      const usdPair = `${upperSymbol}-USD`;
      const usdcPair = `${upperSymbol}-USDC`;

      if (validProducts.has(usdPair)) {
        symbolToProductId.set(symbol, usdPair);
        productIdsToFetch.push(usdPair);
      } else if (validProducts.has(usdcPair)) {
        symbolToProductId.set(symbol, usdcPair);
        productIdsToFetch.push(usdcPair);
      } else {
        logger.debug({ symbol }, 'No USD or USDC trading pair found');
      }
    }

    if (productIdsToFetch.length === 0) {
      // Mark all as null
      for (const symbol of cryptoSymbols) {
        prices.set(symbol, null);
      }
      return prices;
    }

    // Batch fetch prices in chunks (API may have limits)
    const BATCH_SIZE = 100;
    for (let i = 0; i < productIdsToFetch.length; i += BATCH_SIZE) {
      const batch = productIdsToFetch.slice(i, i + BATCH_SIZE);
      const batchPrices = await this.getBestBidAsk(batch);

      // Map back to symbol -> price
      for (const [productId, price] of batchPrices) {
        // Find the original symbol for this product ID
        for (const [symbol, pid] of symbolToProductId) {
          if (pid === productId) {
            prices.set(symbol, price);
            break;
          }
        }
      }
    }

    // Mark missing symbols as null
    for (const symbol of cryptoSymbols) {
      if (!prices.has(symbol)) {
        prices.set(symbol, null);
        logger.debug({ symbol }, 'No price found for symbol');
      }
    }

    logger.debug(
      { pricesFound: prices.size, cryptoSymbols: cryptoSymbols.length },
      'Fetched spot prices'
    );

    return prices;
  }

  // Cache for valid products (refreshed periodically)
  private validProductsCache: Map<string, boolean> | null = null;
  private validProductsCacheTime: number = 0;
  private readonly PRODUCTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get a map of valid product IDs from Coinbase
   * Results are cached for 5 minutes
   */
  private async getValidProductsMap(): Promise<Map<string, boolean>> {
    const now = Date.now();

    // Return cached if still valid
    if (this.validProductsCache && (now - this.validProductsCacheTime) < this.PRODUCTS_CACHE_TTL) {
      return this.validProductsCache;
    }

    // Fetch fresh list
    const products = await this.getProducts();
    const productMap = new Map<string, boolean>();

    for (const product of products) {
      if (product.product_id && product.status === 'online') {
        productMap.set(product.product_id, true);
      }
    }

    this.validProductsCache = productMap;
    this.validProductsCacheTime = now;

    logger.debug({ productCount: productMap.size }, 'Cached valid product IDs');

    return productMap;
  }

  /**
   * Get transaction summary including fee tier
   * Returns the user's current maker/taker rates based on 30-day volume
   *
   * Reference: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/fees/get-transaction-summary
   */
  async getTransactionSummary(): Promise<CoinbaseTransactionSummary> {
    const path = '/api/v3/brokerage/transaction_summary';

    try {
      const response = await this.request('GET', path);
      return response;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch transaction summary from Coinbase');
      throw error;
    }
  }

  /**
   * Get open orders (PENDING and OPEN status)
   * Returns all orders that are currently on the order book or awaiting execution
   *
   * Reference: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/list-orders
   *
   * @param productId - Optional: filter by trading pair (e.g., "BTC-USD")
   * @returns Array of open orders
   */
  async getOpenOrders(productId?: string): Promise<CoinbaseOrder[]> {
    const allOrders: CoinbaseOrder[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams();
      // Note: Coinbase API does not allow multiple statuses with OPEN
      // PENDING orders quickly transition to OPEN, so we just query OPEN
      params.append('order_status', 'OPEN');
      params.append('limit', '100');

      if (productId) {
        params.append('product_id', productId);
      }

      if (cursor) {
        params.append('cursor', cursor);
      }

      const path = `/api/v3/brokerage/orders/historical/batch?${params.toString()}`;

      try {
        const response = await this.request('GET', path);
        const orders = response.orders || [];
        allOrders.push(...orders);

        // Check for more pages
        cursor = response.has_next && response.cursor ? response.cursor : undefined;

      } catch (error) {
        logger.error({ error, productId }, 'Failed to fetch open orders from Coinbase');
        throw error;
      }
    } while (cursor);

    logger.debug({ count: allOrders.length, productId }, 'Fetched open orders from Coinbase');
    return allOrders;
  }

  /**
   * Get a single order by ID
   *
   * @param orderId - The order ID to retrieve
   * @returns The order details
   */
  async getOrder(orderId: string): Promise<CoinbaseOrder> {
    const path = `/api/v3/brokerage/orders/historical/${orderId}`;

    try {
      const response = await this.request('GET', path);
      return response.order;
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to fetch order from Coinbase');
      throw error;
    }
  }

  /**
   * Make authenticated request to Coinbase API
   */
  private async request(method: string, path: string, body?: any): Promise<any> {
    // Extract path without query string for JWT URI
    const pathWithoutQuery = path.split('?')[0];
    const token = this.auth.generateRestToken(method, pathWithoutQuery);

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
   * Coinbase Advanced Trade API granularity values
   * Reference: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product-candles
   */
  private static readonly COINBASE_GRANULARITY = {
    '1m': 'ONE_MINUTE',
    '5m': 'FIVE_MINUTE',
    '15m': 'FIFTEEN_MINUTE',
    '30m': 'THIRTY_MINUTE',
    '1h': 'ONE_HOUR',
    '2h': 'TWO_HOUR',
    '4h': 'FOUR_HOUR',
    '6h': 'SIX_HOUR',
    '1d': 'ONE_DAY',
  } as const;

  /**
   * Timeframes supported by Coinbase Advanced Trade API
   */
  static readonly SUPPORTED_TIMEFRAMES: Timeframe[] = [
    '1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '1d'
  ];

  /**
   * Check if a timeframe is supported by Coinbase
   */
  static isTimeframeSupported(timeframe: Timeframe): boolean {
    return timeframe in CoinbaseRestClient.COINBASE_GRANULARITY;
  }

  /**
   * Convert canonical timeframe to Coinbase granularity string
   * Returns null if timeframe is not supported
   */
  private timeframeToGranularity(timeframe: Timeframe): string | null {
    const granularity = CoinbaseRestClient.COINBASE_GRANULARITY[timeframe];
    if (!granularity) {
      logger.warn({ timeframe }, 'Timeframe not supported by Coinbase');
      return null;
    }
    return granularity;
  }
}
