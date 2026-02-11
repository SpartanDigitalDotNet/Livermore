import { logger } from '@livermore/utils';

/**
 * Normalized exchange product representation
 */
export interface ExchangeProduct {
  symbol: string;        // Exchange-native format (e.g., "BTC-USD" for Coinbase)
  baseCurrency: string;  // e.g., "BTC"
  quoteCurrency: string; // e.g., "USD"
  volume24h: number;
}

/**
 * Exchange Product Service
 *
 * Fetches available products from each exchange's public API (no auth needed).
 * Filters to SPOT, online, USD-quoted pairs.
 */
export class ExchangeProductService {

  /**
   * Fetch Coinbase products (public endpoint, no auth).
   * GET https://api.coinbase.com/api/v3/brokerage/market/products
   * Filters to SPOT, status=online, USD quote.
   */
  async getCoinbaseProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching Coinbase products (public API)');

    const url = 'https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT&limit=500';
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Coinbase API error ${response.status}: ${text}`);
    }

    const data = await response.json() as {
      products: Array<{
        product_id: string;
        base_currency_id: string;
        quote_currency_id: string;
        status: string;
        trading_disabled: boolean;
        volume_24h: string;
        product_type: string;
      }>;
    };

    const products = data.products
      .filter((p) =>
        p.product_type === 'SPOT' &&
        p.status === 'online' &&
        !p.trading_disabled &&
        p.quote_currency_id === 'USD'
      )
      .map((p) => ({
        symbol: p.product_id,
        baseCurrency: p.base_currency_id,
        quoteCurrency: p.quote_currency_id,
        volume24h: parseFloat(p.volume_24h) || 0,
      }));

    logger.info({ count: products.length }, 'Fetched Coinbase products');
    return products;
  }

  /**
   * Fetch Binance US products (public endpoint, no auth).
   * GET https://api.binance.us/api/v3/exchangeInfo + GET https://api.binance.us/api/v3/ticker/24hr
   * Joins pair info with volume, filters to USD/USDT quote.
   */
  async getBinanceUSProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching Binance US products (public API)');

    // Fetch exchange info and 24hr tickers in parallel
    const [infoResponse, tickerResponse] = await Promise.all([
      fetch('https://api.binance.us/api/v3/exchangeInfo', {
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.binance.us/api/v3/ticker/24hr', {
        headers: { 'Accept': 'application/json' },
      }),
    ]);

    if (!infoResponse.ok) {
      const text = await infoResponse.text();
      throw new Error(`Binance US exchangeInfo error ${infoResponse.status}: ${text}`);
    }

    if (!tickerResponse.ok) {
      const text = await tickerResponse.text();
      throw new Error(`Binance US ticker error ${tickerResponse.status}: ${text}`);
    }

    const exchangeInfo = await infoResponse.json() as {
      symbols: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        status: string;
      }>;
    };

    const tickers = await tickerResponse.json() as Array<{
      symbol: string;
      volume: string;
      quoteVolume: string;
    }>;

    // Build volume lookup
    const volumeMap = new Map<string, number>();
    for (const t of tickers) {
      volumeMap.set(t.symbol, parseFloat(t.quoteVolume) || 0);
    }

    // Filter to USD quote, TRADING status
    const products = exchangeInfo.symbols
      .filter((s) =>
        s.status === 'TRADING' &&
        (s.quoteAsset === 'USD' || s.quoteAsset === 'USDT')
      )
      .map((s) => ({
        symbol: s.symbol,  // Binance native format: "BTCUSD"
        baseCurrency: s.baseAsset,
        quoteCurrency: s.quoteAsset,
        volume24h: volumeMap.get(s.symbol) || 0,
      }));

    logger.info({ count: products.length }, 'Fetched Binance US products');
    return products;
  }

  /**
   * Fetch Binance global products (public endpoint, no auth).
   * Same API shape as Binance US but at api.binance.com.
   * Filters to USDT quote (Binance global doesn't have USD pairs).
   */
  async getBinanceProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching Binance products (public API)');

    const [infoResponse, tickerResponse] = await Promise.all([
      fetch('https://api.binance.com/api/v3/exchangeInfo', {
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.binance.com/api/v3/ticker/24hr', {
        headers: { 'Accept': 'application/json' },
      }),
    ]);

    if (!infoResponse.ok) {
      const text = await infoResponse.text();
      throw new Error(`Binance exchangeInfo error ${infoResponse.status}: ${text}`);
    }

    if (!tickerResponse.ok) {
      const text = await tickerResponse.text();
      throw new Error(`Binance ticker error ${tickerResponse.status}: ${text}`);
    }

    const exchangeInfo = await infoResponse.json() as {
      symbols: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        status: string;
      }>;
    };

    const tickers = await tickerResponse.json() as Array<{
      symbol: string;
      volume: string;
      quoteVolume: string;
    }>;

    const volumeMap = new Map<string, number>();
    for (const t of tickers) {
      volumeMap.set(t.symbol, parseFloat(t.quoteVolume) || 0);
    }

    const products = exchangeInfo.symbols
      .filter((s) =>
        s.status === 'TRADING' &&
        (s.quoteAsset === 'USDT' || s.quoteAsset === 'USD')
      )
      .map((s) => ({
        symbol: s.symbol,
        baseCurrency: s.baseAsset,
        quoteCurrency: s.quoteAsset,
        volume24h: volumeMap.get(s.symbol) || 0,
      }));

    logger.info({ count: products.length }, 'Fetched Binance products');
    return products;
  }

  /**
   * Fetch Kraken products (public endpoint, no auth).
   * GET https://api.kraken.com/0/public/AssetPairs
   * GET https://api.kraken.com/0/public/Ticker
   * Filters to USD quote pairs.
   */
  async getKrakenProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching Kraken products (public API)');

    const pairsResponse = await fetch('https://api.kraken.com/0/public/AssetPairs', {
      headers: { 'Accept': 'application/json' },
    });

    if (!pairsResponse.ok) {
      const text = await pairsResponse.text();
      throw new Error(`Kraken AssetPairs error ${pairsResponse.status}: ${text}`);
    }

    const pairsData = await pairsResponse.json() as {
      error: string[];
      result: Record<string, {
        altname: string;
        wsname: string;
        base: string;
        quote: string;
        status: string;
      }>;
    };

    if (pairsData.error?.length > 0) {
      throw new Error(`Kraken API error: ${pairsData.error.join(', ')}`);
    }

    // Filter to USD-quoted, active pairs
    const usdPairs = Object.entries(pairsData.result)
      .filter(([, pair]) =>
        pair.status === 'online' &&
        (pair.quote === 'ZUSD' || pair.quote === 'USD')
      );

    // Fetch volume data for the filtered pairs
    const pairNames = usdPairs.map(([key]) => key).join(',');
    const tickerResponse = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pairNames}`, {
      headers: { 'Accept': 'application/json' },
    });

    const tickerData = await tickerResponse.json() as {
      error: string[];
      result: Record<string, {
        v: [string, string]; // [today, last24h] volume
      }>;
    };

    const volumeMap = new Map<string, number>();
    if (tickerData.result) {
      for (const [key, ticker] of Object.entries(tickerData.result)) {
        volumeMap.set(key, parseFloat(ticker.v[1]) || 0);
      }
    }

    const products = usdPairs.map(([key, pair]) => {
      // Kraken prefixes some assets with X/Z (e.g., XXBT=BTC, ZUSD=USD)
      let base = pair.base;
      if (base === 'XXBT') base = 'BTC';
      else if (base === 'XETH') base = 'ETH';
      else if (base === 'XXRP') base = 'XRP';
      else if (base === 'XLTC') base = 'LTC';
      else if (base === 'XXLM') base = 'XLM';
      else if (base === 'XXDG') base = 'DOGE';
      else if (base.startsWith('X') && base.length === 4) base = base.slice(1);

      return {
        symbol: pair.wsname || pair.altname, // Kraken native: "XBT/USD"
        baseCurrency: base,
        quoteCurrency: 'USD',
        volume24h: volumeMap.get(key) || 0,
      };
    });

    logger.info({ count: products.length }, 'Fetched Kraken products');
    return products;
  }

  /**
   * Fetch KuCoin products (public endpoint, no auth).
   * GET https://api.kucoin.com/api/v1/symbols
   * GET https://api.kucoin.com/api/v1/market/allTickers
   * Filters to USDT quote (KuCoin has very few USD pairs).
   */
  async getKucoinProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching KuCoin products (public API)');

    const [symbolsResponse, tickersResponse] = await Promise.all([
      fetch('https://api.kucoin.com/api/v1/symbols', {
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.kucoin.com/api/v1/market/allTickers', {
        headers: { 'Accept': 'application/json' },
      }),
    ]);

    if (!symbolsResponse.ok) {
      const text = await symbolsResponse.text();
      throw new Error(`KuCoin symbols error ${symbolsResponse.status}: ${text}`);
    }

    if (!tickersResponse.ok) {
      const text = await tickersResponse.text();
      throw new Error(`KuCoin tickers error ${tickersResponse.status}: ${text}`);
    }

    const symbolsData = await symbolsResponse.json() as {
      data: Array<{
        symbol: string;       // "BTC-USDT"
        baseCurrency: string; // "BTC"
        quoteCurrency: string; // "USDT"
        enableTrading: boolean;
      }>;
    };

    const tickersData = await tickersResponse.json() as {
      data: {
        ticker: Array<{
          symbol: string;
          volValue: string; // 24h volume in quote currency
        }>;
      };
    };

    const volumeMap = new Map<string, number>();
    for (const t of tickersData.data.ticker) {
      volumeMap.set(t.symbol, parseFloat(t.volValue) || 0);
    }

    const products = symbolsData.data
      .filter((s) =>
        s.enableTrading &&
        (s.quoteCurrency === 'USDT' || s.quoteCurrency === 'USD')
      )
      .map((s) => ({
        symbol: s.symbol,       // KuCoin native: "BTC-USDT"
        baseCurrency: s.baseCurrency,
        quoteCurrency: s.quoteCurrency,
        volume24h: volumeMap.get(s.symbol) || 0,
      }));

    logger.info({ count: products.length }, 'Fetched KuCoin products');
    return products;
  }

  /**
   * Fetch MEXC products (public endpoint, no auth).
   * GET https://api.mexc.com/api/v3/exchangeInfo
   * GET https://api.mexc.com/api/v3/ticker/24hr
   * Binance-compatible API shape. Filters to USDT quote.
   */
  async getMexcProducts(): Promise<ExchangeProduct[]> {
    logger.info('Fetching MEXC products (public API)');

    const [infoResponse, tickerResponse] = await Promise.all([
      fetch('https://api.mexc.com/api/v3/exchangeInfo', {
        headers: { 'Accept': 'application/json' },
      }),
      fetch('https://api.mexc.com/api/v3/ticker/24hr', {
        headers: { 'Accept': 'application/json' },
      }),
    ]);

    if (!infoResponse.ok) {
      const text = await infoResponse.text();
      throw new Error(`MEXC exchangeInfo error ${infoResponse.status}: ${text}`);
    }

    if (!tickerResponse.ok) {
      const text = await tickerResponse.text();
      throw new Error(`MEXC ticker error ${tickerResponse.status}: ${text}`);
    }

    const exchangeInfo = await infoResponse.json() as {
      symbols: Array<{
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        status: string;
        isSpotTradingAllowed: boolean;
      }>;
    };

    const tickers = await tickerResponse.json() as Array<{
      symbol: string;
      volume: string;
      quoteVolume: string;
    }>;

    const volumeMap = new Map<string, number>();
    for (const t of tickers) {
      volumeMap.set(t.symbol, parseFloat(t.quoteVolume) || 0);
    }

    const products = exchangeInfo.symbols
      .filter((s) =>
        s.status === '1' &&
        s.isSpotTradingAllowed &&
        s.quoteAsset === 'USDT'
      )
      .map((s) => ({
        symbol: s.symbol,       // MEXC native: "BTCUSDT"
        baseCurrency: s.baseAsset,
        quoteCurrency: s.quoteAsset,
        volume24h: volumeMap.get(s.symbol) || 0,
      }));

    logger.info({ count: products.length }, 'Fetched MEXC products');
    return products;
  }
}
