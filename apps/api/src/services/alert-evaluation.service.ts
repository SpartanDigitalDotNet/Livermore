import { getRedisClient, tickerChannel, indicatorChannel, exchangeAlertChannel, IndicatorCacheStrategy, CandleCacheStrategy, type CachedIndicatorValue, type RedisClient } from '@livermore/cache';
import { getDbClient, alertHistory } from '@livermore/database';
import { logger } from '@livermore/utils';
import type { Ticker, Timeframe } from '@livermore/schemas';
import { generateMacdVChart, type AlertMarker } from '@livermore/charts';
import { getDiscordService, type MACDVTimeframeData } from './discord-notification.service';
import { broadcastAlert } from '../server';

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
  private subscriber: RedisClient | null = null;
  private discordService = getDiscordService();
  private indicatorCache: IndicatorCacheStrategy;
  private candleCache: CandleCacheStrategy;

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

  // Exchange identity for scoping Redis channels, cache keys, and alert metadata
  private exchangeId: number;
  private exchangeName: string;

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

  // Chart generation settings
  private readonly CHART_DISPLAY_BARS = 25;
  private readonly CHART_WARMUP_BARS = 35; // 26 for ATR + 9 for signal
  private readonly CHART_TIMEOUT_MS = 3000;

  constructor(exchangeId: number, exchangeName: string = 'unknown') {
    this.exchangeId = exchangeId;
    this.exchangeName = exchangeName;
    this.indicatorCache = new IndicatorCacheStrategy(this.redis);
    this.candleCache = new CandleCacheStrategy(this.redis);
  }

  /**
   * Update exchange identity at runtime (e.g., when handleStart resolves the user's exchange)
   */
  setExchange(exchangeId: number, exchangeName: string): void {
    this.exchangeId = exchangeId;
    this.exchangeName = exchangeName;
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
      // Remove event listener before disconnecting to prevent handlers firing during shutdown
      this.subscriber.removeAllListeners('message');
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
      channels.push(tickerChannel(this.exchangeId, symbol));
    }

    // Subscribe to indicator channels for all symbol/timeframe combos
    for (const symbol of this.symbols) {
      for (const timeframe of this.timeframes) {
        channels.push(
          indicatorChannel(
            1, // user_id (hardcoded for now)
            this.exchangeId,
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

    // Check reversal signals (only if we were already in extreme territory)
    await this.checkReversalSignals(
      symbol,
      timeframe as Timeframe,
      previousMacdV,
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
    // Levels are ordered [-150, -200, -250, ...] - find the deepest level crossed
    let deepestOversoldCrossed: number | null = null;
    for (const level of this.OVERSOLD_LEVELS) {
      if (previousMacdV >= level && currentMacdV < level) {
        deepestOversoldCrossed = level; // Keep going to find deepest
      }
    }
    if (deepestOversoldCrossed !== null) {
      const cooldownKey = `${key}:${deepestOversoldCrossed}`;
      if (!this.isInCooldown(cooldownKey)) {
        // Set guards BEFORE async call to prevent race condition with rapid messages
        this.alertedLevels.set(cooldownKey, Date.now());
        // Reset reversal state when entering new extreme level
        this.inReversalState.set(key, false);
        await this.triggerLevelAlert(symbol, timeframe, deepestOversoldCrossed, 'down', currentMacdV, histogram, indicator);
      }
    }

    // Check overbought level crossings (crossing UP through positive levels)
    // Levels are ordered [150, 200, 250, ...] - find the highest level crossed
    let highestOverboughtCrossed: number | null = null;
    for (const level of this.OVERBOUGHT_LEVELS) {
      if (previousMacdV <= level && currentMacdV > level) {
        highestOverboughtCrossed = level; // Keep going to find highest
      }
    }
    if (highestOverboughtCrossed !== null) {
      const cooldownKey = `${key}:${highestOverboughtCrossed}`;
      if (!this.isInCooldown(cooldownKey)) {
        // Set guards BEFORE async call to prevent race condition with rapid messages
        this.alertedLevels.set(cooldownKey, Date.now());
        // Reset reversal state when entering new extreme level
        this.inReversalState.set(key, false);
        await this.triggerLevelAlert(symbol, timeframe, highestOverboughtCrossed, 'up', currentMacdV, histogram, indicator);
      }
    }
  }

  /**
   * Check for reversal signals in extreme territory
   * Only triggers if we were ALREADY in extreme territory on the previous tick
   * (prevents double alert when crossing level and reversal at same time)
   */
  private async checkReversalSignals(
    symbol: string,
    timeframe: Timeframe,
    previousMacdV: number,
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

    // Reversal from oversold (both previous and current MACD-V must be < -150)
    // This prevents firing when we just crossed into oversold territory
    if (currentMacdV < -150 && previousMacdV < -150) {
      const buffer = Math.abs(currentMacdV) * this.OVERSOLD_BUFFER_PCT;
      if (histogram > buffer) {
        // Set guards BEFORE async call to prevent race condition with rapid messages
        this.reversalAlertTimestamps.set(cooldownKey, Date.now());
        this.inReversalState.set(key, true);
        await this.triggerReversalAlert(symbol, timeframe, 'oversold', currentMacdV, histogram, buffer, indicator);
      }
    }

    // Reversal from overbought (both previous and current MACD-V must be > +150)
    // This prevents firing when we just crossed into overbought territory
    if (currentMacdV > 150 && previousMacdV > 150) {
      const buffer = Math.abs(currentMacdV) * this.OVERBOUGHT_BUFFER_PCT;
      if (histogram < -buffer) {
        // Set guards BEFORE async call to prevent race condition with rapid messages
        this.reversalAlertTimestamps.set(cooldownKey, Date.now());
        this.inReversalState.set(key, true);
        await this.triggerReversalAlert(symbol, timeframe, 'overbought', currentMacdV, histogram, buffer, indicator);
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
   * Generate MACD-V chart for an alert
   * Returns null if chart generation fails or times out
   */
  private async generateAlertChart(
    symbol: string,
    timeframe: Timeframe,
    alertMarker?: AlertMarker
  ): Promise<Buffer | null> {
    try {
      // Fetch candles (extra for MACD-V warmup period)
      const totalBars = this.CHART_DISPLAY_BARS + this.CHART_WARMUP_BARS;
      const candles = await this.candleCache.getRecentCandles(
        1 /* legacy userId param */,
        this.exchangeId,
        symbol,
        timeframe,
        totalBars
      );

      if (candles.length < this.CHART_WARMUP_BARS) {
        logger.warn({ symbol, timeframe, count: candles.length }, 'Insufficient candles for chart');
        return null;
      }

      // Generate chart with timeout
      // Use displayBars to show only the seeded portion (MACD-V fills entire chart)
      const chartPromise = Promise.resolve().then(() =>
        generateMacdVChart({
          symbol,
          timeframe,
          candles,
          alertMarkers: alertMarker ? [alertMarker] : [],
          displayBars: this.CHART_DISPLAY_BARS,
        })
      );

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), this.CHART_TIMEOUT_MS)
      );

      const result = await Promise.race([chartPromise, timeoutPromise]);

      if (result) {
        logger.debug({ symbol, timeframe, size: result.buffer.length }, 'Chart generated successfully');
        return result.buffer;
      }

      logger.warn({ symbol, timeframe }, 'Chart generation timed out');
      return null;
    } catch (error) {
      logger.error({ error, symbol, timeframe }, 'Chart generation failed');
      return null;
    }
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
    let price = this.currentPrices.get(symbol) || 0;
    if (price === 0) {
      const latestCandle = await this.candleCache.getLatestCandle(1, this.exchangeId, symbol, timeframe);
      if (latestCandle) price = latestCandle.close;
    }

    logger.info(
      { symbol, timeframe, level, direction, macdV: currentMacdV, price },
      'Alert triggered: level crossing'
    );

    const timeframes = await this.gatherMACDVTimeframes(symbol);
    const bias = this.calculateBias(timeframes);

    // Generate chart (non-blocking with fallback)
    const isOversold = level < 0;
    const alertMarker: AlertMarker = {
      barIndex: -1, // Last bar
      type: isOversold ? 'oversold' : 'overbought',
      label: `level_${level}`,
      value: currentMacdV,
    };

    const chartBuffer = await this.generateAlertChart(symbol, timeframe, alertMarker);

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
        price,
        chartBuffer ?? undefined
      );
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
    }

    // Record to database
    const now = new Date();
    try {
      const [inserted] = await this.db.insert(alertHistory).values({
        exchangeId: this.exchangeId,
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
          chartGenerated: chartBuffer !== null,
        },
        notificationSent,
        notificationError,
      }).returning({ id: alertHistory.id });

      // Broadcast to WebSocket clients
      const alertPayload = {
        id: inserted.id,
        symbol,
        alertType: 'macdv',
        timeframe,
        price,
        triggerValue: currentMacdV,
        signalDelta: histogram,
        triggeredAt: now.toISOString(),
        sourceExchangeId: this.exchangeId,
        sourceExchangeName: this.exchangeName,
        triggerLabel: `level_${level}`,
      };
      broadcastAlert(alertPayload);

      // Publish to Redis for cross-exchange visibility (Phase 27 VIS-01)
      const channel = exchangeAlertChannel(this.exchangeId);
      await this.redis.publish(channel, JSON.stringify(alertPayload));
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
    bufferValue: number,
    indicator: CachedIndicatorValue
  ): Promise<void> {
    let price = this.currentPrices.get(symbol) || 0;
    if (price === 0) {
      const latestCandle = await this.candleCache.getLatestCandle(1, this.exchangeId, symbol, timeframe);
      if (latestCandle) price = latestCandle.close;
    }
    const bufferPct = zone === 'oversold' ? this.OVERSOLD_BUFFER_PCT : this.OVERBOUGHT_BUFFER_PCT;

    logger.info(
      { symbol, timeframe, zone, macdV: currentMacdV, histogram, buffer: bufferValue, price },
      'Alert triggered: reversal signal'
    );

    const timeframes = await this.gatherMACDVTimeframes(symbol);
    const bias = this.calculateBias(timeframes);

    // Generate chart (non-blocking with fallback)
    const alertMarker: AlertMarker = {
      barIndex: -1, // Last bar
      type: zone,
      label: `reversal_${zone}`,
      value: currentMacdV,
    };

    const chartBuffer = await this.generateAlertChart(symbol, timeframe, alertMarker);

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
        bufferValue,
        timeframes,
        bias,
        price,
        chartBuffer ?? undefined
      );
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, symbol, timeframe }, 'Failed to send Discord notification');
    }

    // Record to database
    const now = new Date();
    try {
      const [inserted] = await this.db.insert(alertHistory).values({
        exchangeId: this.exchangeId,
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
          buffer: bufferValue,
          bufferPct,
          signal: indicator.value['signal'],
          timeframes,
          bias,
          chartGenerated: chartBuffer !== null,
        },
        notificationSent,
        notificationError,
      }).returning({ id: alertHistory.id });

      // Broadcast to WebSocket clients
      const alertPayload = {
        id: inserted.id,
        symbol,
        alertType: 'macdv',
        timeframe,
        price,
        triggerValue: currentMacdV,
        signalDelta: histogram,
        triggeredAt: now.toISOString(),
        sourceExchangeId: this.exchangeId,
        sourceExchangeName: this.exchangeName,
        triggerLabel: `reversal_${zone}`,
      };
      broadcastAlert(alertPayload);

      // Publish to Redis for cross-exchange visibility (Phase 27 VIS-01)
      const channel = exchangeAlertChannel(this.exchangeId);
      await this.redis.publish(channel, JSON.stringify(alertPayload));
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
      1 /* legacy userId param */,
      this.exchangeId,
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
