import type { Candle, Timeframe } from '../market/candle.schema';

export interface IRestClient {
  getCandles(
    symbol: string,
    timeframe: Timeframe,
    start?: number,
    end?: number
  ): Promise<Candle[]>;
}
