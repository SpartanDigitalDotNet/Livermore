import Redis from 'ioredis';
import { getRedisClient, tickerChannel, indicatorChannel, IndicatorCacheStrategy, type CachedIndicatorValue } from '@livermore/cache';
import { getDbClient, alertHistory } from '@livermore/database';
import { logger } from '@livermore/utils';
import type { Ticker, Timeframe } from '@livermore/schemas';
import { getDiscordService, type MACDVTimeframeData } from './discord-notification.service';

/**
 * Alert Evaluation Service
 *
 * Monitors MACD-V levels and triggers alerts based on:
 * 1. Level crossings at ±150, ±200, ±250, etc.
 * 2. Reversal signals (signal line crossovers) when in extreme territory
 *
 * Uses asymmetric buffer percentages:
 * - Oversold reversals: 5% buffer (bottoms form gradually)
 * - Overbought reversals: 3% buffer (tops can collapse fast)
 */
export class AlertEvaluationService {
  private db = getDbClient();
  private redis = getRedisClient();
  private subscriber: Redis | null = null;
  private discordService = getDiscordService();
  private indicatorCache: IndicatorCacheStrategy;

  // Track previous MACD-V values for level crossing detection (key: "symbol:timeframe")
  private previousMacdV: Map<string, number> = new Map();

  // Track alerted levels with timestamps for cooldown (key: "symbol:timeframe:level")
  private alertedLevels: Map<string, number> = new Map();

  // Track reversal alert timestamps for cooldown (key: "symbol:timeframe:reversal")
  private reversalAlertTimestamps: Map<string, number> = new Map();

  // Track if we've alerted a reversal for current extreme move (key: "symbol:timeframe")
  // Reset when entering a new extreme level
  private inReversalState: Map<string, boolean> = new Map();

  // Current prices from ticker updates
  private currentPrices: Map<string, number> = new Map();

  // Temporary: hardcode test user/exchange ID
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Cooldown period in milliseconds (5 minutes)
  private readonly COOLDOWN_MS = 300000;

  // Extreme level thresholds
  private readonly OVERSOLD_LEVELS = [-150, -200, -250, -300, -350, -400];
  private readonly OVERBOUGHT_LEVELS = [150, 200, 250, 300, 350, 400];

  // Buffer percentages for reversal signals
  private readonly OVERSOLD_BUFFER_PCT = 0.05;   // 5%
  private readonly OVERBOUGHT_BUFFER_PCT = 0.03; // 3%

  // Supported symbols and timeframes
  private symbols: string[] = [];
  private timeframes: Timeframe[] = [];

  constructor() {
    this.indicatorCache = new IndicatorCacheStrategy(this.redis);
  }

  /**
   * Start the alert evaluation service
   */
  async start(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    logger.info({ symbols, timeframes }, 'Starting Alert Evaluation Service');

    this.symbols = symbols;
    this.timeframes = timeframes;

    // Create subscriber connection
    this.subscriber = getRedisClient().duplicate();

    // Subscribe to ticker and indicator channels
    await this.subscribeToChannels();

    // Handle messages
    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message).catch((error) => {
        logger.error({ error, channel }, 'Error handling pub/sub message');
      });
    });

    logger.info('Alert Evaluation Service started');
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    logger.info('Stopping Alert Evaluation Service');

    if (this.subscriber) {
      await this.subscriber.unsubscribe();
      this.subscriber.disconnect();
      this.subscriber = null;
    }

    // Clear tracking maps
    this.previousMacdV.clear();
    this.alertedLevels.clear();
    this.reversalAlertTimestamps.clear();
    this.inReversalState.clear();
    this.currentPrices.clear();
  }

  /**
   * Subscribe to Redis pub/sub channels
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.subscriber) return;

    const channels: string[] = [];

    // Subscribe to ticker channels for all symbols (for price tracking)
    for (const symbol of this.symbols) {
      channels.push(tickerChannel(1, this.TEST_EXCHANGE_ID, symbol));
    }

    // Subscribe to indicator channels for all symbol/timeframe combos
    for (const symbol of this.symbols) {
      for (const timeframe of this.timeframes) {
        channels.push(
          indicatorChannel(
            1, // user_id (hardcoded for now)
            this.TEST_EXCHANGE_ID,
            symbol,
            timeframe,
            'macd-v'
          )
        );
      }
    }

    if (channels.length > 0) {
      await this.subscriber.subscribe(...channels);
      logger.debug({ channelCount: channels.length }, 'Subscribed to pub/sub channels');
    }
  }

  /**
   * Handle incoming pub/sub messages
   */
  private async handleMessage(channel: string, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);

      if (channel.includes('channel:ticker:')) {
        await this.handleTickerUpdate(data as Ticker);
      } else if (channel.includes('channel:indicator:')) {
        await this.handleIndicatorUpdate(data as CachedIndicatorValue);
      }
    } catch (error) {
      logger.error({ error, channel }, 'Failed to parse pub/sub message');
    }
  }

  /**
   * Handle ticker update - track the price
   */
  private async handleTickerUpdate(ticker: Ticker): Promise<void> {
    const { symbol, price } = ticker;
    this.currentPrices.set(symbol, price);
  }

  /**
   * Handle indicator update - check for level crossings and reversal signals
   */
  private async handleIndicatorUpdate(indicator: CachedIndicatorValue): Promise<void> {
    const { symbol, timeframe } = indicator;
    const key = `${symbol}:${timeframe}`;

    const currentMacdV = indicator.value['macdV'] as number;
    const histogram = indicator.value['histogram'] as number;

    // Skip invalid data
    if (currentMacdV === undefined || currentMacdV === null || Number.isNaN(currentMacdV)) {
      return;
    }

    const previousMacdV = this.previousMacdV.get(key);
    this.previousMacdV.set(key, currentMacdV);

    // Skip first update (no previous value to compare)
    if (previousMacdV === undefined) {
      logger.debug({ symbol, timeframe, macdV: currentMacdV }, 'Initial MACD-V recorded');
      return;
    }

    // Check level crossings
    await this.checkLevelCrossings(
      symbol,
      timeframe as Timeframe,
      previousMacdV,
      currentMacdV,
      histogram,
      indicator
    );

    // Check reversal signals
    await this.checkReversalSignals(
      symbol,
      timeframe as Timeframe,
      currentMacdV,
      histogram,
      indicator
    );
  }

  /**
   * Check for level crossings at extreme thresholds
   */
  private async checkLevelCrossings(
    symbol: string,
    timeframe: Timeframe,
    previousMacdV: number,
    currentMacdV: number,
    histogram: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const key = `${symbol}:${timeframe}`;

    // Check oversold level crossings (crossing DOWN through negative levels)
    for (const level of this.OVERSOLD_LEVELS) {
      if (previousMacdV >= level && currentMacdV < level) {
        const cooldownKey = `${key}:${level}`;
        if (!this.isInCooldown(cooldownKey)) {
          await this.triggerLevelAlert(symbol, timeframe, level, 'down', currentMacdV, histogram, indicator);
          this.alertedLevels.set(cooldownKey, Date.now());
          // Reset reversal state when entering new extreme level
          this.inReversalState.set(key, false);
        }
      }
    }

    // Check overbought level crossings (crossing UP through positive levels)
    for (const level of this.OVERBOUGHT_LEVELS) {
      if (previousMacdV <= level && currentMacdV > level) {
        const cooldownKey = `${key}:${level}`;
        if (!this.isInCooldown(cooldownKey)) {
          await this.triggerLevelAlert(symbol, timeframe, level, 'up', currentMacdV, histogram, indicator);
          this.alertedLevels.set(cooldownKey, Date.now());
          // Reset reversal state when entering new extreme level
          this.inReversalState.set(key, false);
        }
      }
    }
  }

  /**
   * Check for reversal signals in extreme territory
   */
  private async checkReversalSignals(
    symbol: string,
    timeframe: Timeframe,
    currentMacdV: number,
    histogram: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const key = `${symbol}:${timeframe}`;

    // Skip if histogram is invalid
    if (histogram === undefined || histogram === null || Number.isNaN(histogram)) {
      return;
    }

    // Already alerted reversal for this extreme move?
    if (this.inReversalState.get(key)) {
      return;
    }

    // Check cooldown
    const cooldownKey = `${key}:reversal`;
    if (this.isInCooldown(cooldownKey)) {
      return;
    }

    // Reversal from oversold (MACD-V < -150)
    if (currentMacdV < -150) {
      const buffer = Math.abs(currentMacdV) * this.OVERSOLD_BUFFER_PCT;
      if (histogram > buffer) {
        await this.triggerReversalAlert(symbol, timeframe, 'oversold', currentMacdV, histogram, buffer, indicator);
        this.reversalAlertTimestamps.set(cooldownKey, Date.now());
        this.inReversalState.set(key, true);
      }
    }

    // Reversal from overbought (MACD-V > +150)
    if (currentMacdV > 150) {
      const buffer = Math.abs(currentMacdV) * this.OVERBOUGHT_BUFFER_PCT;
      if (histogram < -buffer) {
        await this.triggerReversalAlert(symbol, timeframe, 'overbought', currentMacdV, histogram, buffer, indicator);
        this.reversalAlertTimestamps.set(cooldownKey, Date.now());
        this.inReversalState.set(key, true);
      }
    }
  }

  /**
   * Check if a cooldown key is still in cooldown period
   */
  private isInCooldown(key: string): boolean {
    const lastTriggered = this.alertedLevels.get(key) ?? this.reversalAlertTimestamps.get(key);
    if (lastTriggered === undefined) return false;
    return Date.now() - lastTriggered < this.COOLDOWN_MS;
  }

  /**
   * Trigger a level crossing alert
   */
  private async triggerLevelAlert(
    symbol: string,
    timeframe: Timeframe,
    level: number,
    direction: 'up' | 'down',
    currentMacdV: number,
    histogram: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const price = this.currentPrices.get(symbol) || 0;

    logger.info(
      { symbol, timeframe, level, direction, macdV: currentMacdV, price },
      'Alert triggered: level crossing'
    );

    const timeframes = await this.gatherMACDVTimeframes(symbol);
    const bias = this.calculateBias(timeframes);

    // Send Discord notification
    let notificationSent = false;
    let notificationError: string | null = null;

    try {
      await this.discordService.sendMACDVLevelAlert(
        symbol,
        timeframe,
        level,
        direction,
        currentMacdV,
        timeframes,
        bias,
        price
      );
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
    }

    // Record to database
    const now = new Date();
    try {
      await this.db.insert(alertHistory).values({
        exchangeId: this.TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        alertType: 'macdv',
        triggeredAtEpoch: now.getTime(),
        triggeredAt: now,
        price: price.toString(),
        triggerValue: currentMacdV.toString(),
        triggerLabel: `level_${level}`,
        previousLabel: null,
        details: {
          level,
          direction,
          histogram,
          signal: indicator.value['signal'],
          timeframes,
          bias,
        },
        notificationSent,
        notificationError,
      });
    } catch (dbError) {
      logger.error({ error: dbError, symbol, timeframe }, 'Failed to record alert to database');
    }
  }

  /**
   * Trigger a reversal signal alert
   */
  private async triggerReversalAlert(
    symbol: string,
    timeframe: Timeframe,
    zone: 'oversold' | 'overbought',
    currentMacdV: number,
    histogram: number,
    buffer: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const price = this.currentPrices.get(symbol) || 0;
    const bufferPct = zone === 'oversold' ? this.OVERSOLD_BUFFER_PCT : this.OVERBOUGHT_BUFFER_PCT;

    logger.info(
      { symbol, timeframe, zone, macdV: currentMacdV, histogram, buffer, price },
      'Alert triggered: reversal signal'
    );

    const timeframes = await this.gatherMACDVTimeframes(symbol);
    const bias = this.calculateBias(timeframes);

    // Send Discord notification
    let notificationSent = false;
    let notificationError: string | null = null;

    try {
      await this.discordService.sendMACDVReversalAlert(
        symbol,
        timeframe,
        zone,
        currentMacdV,
        histogram,
        buffer,
        timeframes,
        bias,
        price
      );
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
    }

    // Record to database
    const now = new Date();
    try {
      await this.db.insert(alertHistory).values({
        exchangeId: this.TEST_EXCHANGE_ID,
        symbol,
        timeframe,
        alertType: 'macdv',
        triggeredAtEpoch: now.getTime(),
        triggeredAt: now,
        price: price.toString(),
        triggerValue: currentMacdV.toString(),
        triggerLabel: `reversal_${zone}`,
        previousLabel: null,
        details: {
          zone,
          histogram,
          buffer,
          bufferPct,
          signal: indicator.value['signal'],
          timeframes,
          bias,
        },
        notificationSent,
        notificationError,
      });
    } catch (dbError) {
      logger.error({ error: dbError, symbol, timeframe }, 'Failed to record alert to database');
    }
  }

  /**
   * Gather MACD-V data for all timeframes for a symbol
   * Fetches directly from Redis cache to get current values
   */
  private async gatherMACDVTimeframes(symbol: string): Promise<MACDVTimeframeData[]> {
    // Build bulk request for all timeframes
    const requests = this.timeframes.map((timeframe) => ({
      symbol,
      timeframe,
      type: 'macd-v',
    }));

    // Fetch all timeframes in one Redis call
    const indicatorMap = await this.indicatorCache.getIndicatorsBulk(
      this.TEST_USER_ID,
      this.TEST_EXCHANGE_ID,
      requests
    );

    // Build result array
    const result: MACDVTimeframeData[] = [];
    for (const timeframe of this.timeframes) {
      const key = `${symbol}:${timeframe}`;
      const indicator = indicatorMap.get(key);

      if (indicator) {
        result.push({
          timeframe,
          macdV: indicator.value['macdV'] ?? null,
          stage: (indicator.params?.stage as string) || 'unknown',
        });
      } else {
        result.push({
          timeframe,
          macdV: null,
          stage: 'unknown',
        });
      }
    }

    return result;
  }

  /**
   * Calculate overall bias from timeframe data
   */
  private calculateBias(timeframes: MACDVTimeframeData[]): string {
    const bullishStages = ['oversold', 'rebounding', 'rallying'];
    const bearishStages = ['overbought', 'retracing', 'reversing'];

    const weights: Record<string, number> = {
      '1m': 1, '5m': 2, '15m': 3, '1h': 4, '4h': 5, '1d': 6,
    };

    let bullishScore = 0;
    let bearishScore = 0;

    for (const tf of timeframes) {
      const weight = weights[tf.timeframe] || 1;
      if (bullishStages.includes(tf.stage)) {
        bullishScore += weight;
      } else if (bearishStages.includes(tf.stage)) {
        bearishScore += weight;
      }
    }

    if (bullishScore > bearishScore * 1.5) return 'Bullish';
    if (bearishScore > bullishScore * 1.5) return 'Bearish';
    return 'Neutral';
  }

  /**
   * Manually trigger a test alert (for testing)
   */
  async triggerTestAlert(symbol: string, price: number): Promise<void> {
    await this.discordService.sendAlert({
      title: 'Test Alert',
      description: 'This is a test alert from the Alert Evaluation Service',
      type: 'info',
      symbol,
      price,
    });
  }
}
