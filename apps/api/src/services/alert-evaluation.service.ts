import Redis from 'ioredis';
import { getRedisClient, tickerChannel, indicatorChannel, IndicatorCacheStrategy, type CachedIndicatorValue } from '@livermore/cache';
import { getDbClient, alertHistory } from '@livermore/database';
import { logger } from '@livermore/utils';
import type { Ticker, Timeframe } from '@livermore/schemas';
import type { MACDVStage } from '@livermore/indicators';
import { getDiscordService, type MACDVTimeframeData } from './discord-notification.service';

/**
 * Alert Evaluation Service
 *
 * Monitors MACD-V stage transitions and triggers alerts when stages change.
 * Uses hardcoded stage classification rules from @livermore/indicators.
 * No database configuration - rules are built into the indicator library.
 */
export class AlertEvaluationService {
  private db = getDbClient();
  private redis = getRedisClient();
  private subscriber: Redis | null = null;
  private discordService = getDiscordService();
  private indicatorCache: IndicatorCacheStrategy;

  // Track previous stages for transition detection (key: "symbol:timeframe")
  private previousStages: Map<string, MACDVStage> = new Map();

  // Cooldown tracking to prevent alert spam (key: "symbol:timeframe:stage")
  private stageTransitionCooldown: Map<string, number> = new Map();

  // Current prices from ticker updates
  private currentPrices: Map<string, number> = new Map();

  // Temporary: hardcode test user/exchange ID
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Cooldown period in milliseconds (5 minutes)
  private readonly COOLDOWN_MS = 300000;

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
    this.previousStages.clear();
    this.stageTransitionCooldown.clear();
    this.currentPrices.clear();
  }

  /**
   * Subscribe to Redis pub/sub channels
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.subscriber) return;

    const channels: string[] = [];

    // Subscribe to ticker channels for all symbols (for price tracking)
    // Note: Using exchange_id=1 for now; tickers are user-scoped in current cache design
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
   * Handle ticker update - just track the price
   */
  private async handleTickerUpdate(ticker: Ticker): Promise<void> {
    const { symbol, price } = ticker;
    this.currentPrices.set(symbol, price);
  }

  /**
   * Handle indicator update - detect stage transitions
   */
  private async handleIndicatorUpdate(indicator: CachedIndicatorValue): Promise<void> {
    const { symbol, timeframe } = indicator;
    const key = `${symbol}:${timeframe}`;

    // Get current stage from indicator params
    const currentStage = indicator.params?.stage as MACDVStage | undefined;

    if (!currentStage || currentStage === 'unknown') {
      return;
    }

    // Get previous stage
    const previousStage = this.previousStages.get(key);

    // Update tracking
    this.previousStages.set(key, currentStage);

    // Skip if no previous stage (first update after startup)
    if (!previousStage) {
      logger.debug({ symbol, timeframe, stage: currentStage }, 'Initial stage recorded');
      return;
    }

    // Skip if stage hasn't changed
    if (currentStage === previousStage) {
      return;
    }

    // Check cooldown for this specific transition
    const cooldownKey = `${key}:${currentStage}`;
    const lastTriggered = this.stageTransitionCooldown.get(cooldownKey);
    if (lastTriggered && Date.now() - lastTriggered < this.COOLDOWN_MS) {
      logger.debug(
        { symbol, timeframe, from: previousStage, to: currentStage },
        'Stage transition in cooldown, skipping alert'
      );
      return;
    }

    // Stage changed! Trigger alert
    logger.info(
      { symbol, timeframe, from: previousStage, to: currentStage },
      'Stage transition detected'
    );

    await this.triggerStageChangeAlert(
      symbol,
      timeframe as Timeframe,
      previousStage,
      currentStage,
      indicator
    );

    // Set cooldown
    this.stageTransitionCooldown.set(cooldownKey, Date.now());
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
   * Trigger a stage change alert
   */
  private async triggerStageChangeAlert(
    symbol: string,
    timeframe: Timeframe,
    previousStage: MACDVStage,
    currentStage: MACDVStage,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    const price = this.currentPrices.get(symbol) || 0;
    const macdVValue = indicator.value['macdV'] as number;

    logger.info(
      { symbol, timeframe, from: previousStage, to: currentStage, price, macdV: macdVValue },
      'Alert triggered: stage change'
    );

    // Gather all timeframe data for context (fetches from Redis cache)
    const timeframes = await this.gatherMACDVTimeframes(symbol);
    const bias = this.calculateBias(timeframes);

    // Send Discord notification
    let notificationSent = false;
    let notificationError: string | null = null;

    try {
      await this.discordService.sendMACDVAlert(
        symbol,
        timeframe,
        previousStage,
        currentStage,
        timeframes,
        bias,
        price
      );
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
    }

    // Record to alert_history table
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
        triggerValue: macdVValue?.toString() || null,
        triggerLabel: currentStage,
        previousLabel: previousStage,
        details: {
          timeframes,
          bias,
          histogram: indicator.value['histogram'],
          signal: indicator.value['signal'],
        },
        notificationSent,
        notificationError,
      });
    } catch (dbError) {
      logger.error({ error: dbError, symbol, timeframe }, 'Failed to record alert to database');
    }
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
