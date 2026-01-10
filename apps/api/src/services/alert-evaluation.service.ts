import Redis from 'ioredis';
import { getRedisClient, tickerChannel, indicatorChannel, type CachedIndicatorValue } from '@livermore/cache';
import { getDbClient, alerts, alertHistory } from '@livermore/database';
import { logger } from '@livermore/utils';
import type { Ticker, Timeframe, AlertCondition } from '@livermore/schemas';
import { eq, and } from 'drizzle-orm';
import { getDiscordService } from './discord-notification.service';

/**
 * In-memory alert state for tracking previous values (for cross detection)
 */
interface AlertState {
  alertId: number;
  previousValues: Map<string, number>;
  lastTriggeredAt: number | null;
}

/**
 * Alert Evaluation Service
 *
 * Subscribes to market data and indicator updates,
 * evaluates alert conditions, and triggers notifications.
 */
export class AlertEvaluationService {
  private db = getDbClient();
  private subscriber: Redis | null = null;
  private discordService = getDiscordService();

  // Active alerts by symbol
  private alertsBySymbol: Map<string, AlertState[]> = new Map();

  // Current market data
  private currentPrices: Map<string, number> = new Map();
  private currentIndicators: Map<string, CachedIndicatorValue> = new Map();

  // Temporary: hardcode test user and exchange IDs
  private readonly TEST_USER_ID = 1;
  private readonly TEST_EXCHANGE_ID = 1;

  // Supported symbols and timeframes
  private symbols: string[] = [];
  private timeframes: Timeframe[] = [];

  constructor() {}

  /**
   * Start the alert evaluation service
   */
  async start(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    logger.info({ symbols, timeframes }, 'Starting Alert Evaluation Service');

    this.symbols = symbols;
    this.timeframes = timeframes;

    // Load active alerts from database
    await this.loadAlerts();

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
  }

  /**
   * Load active alerts from database
   */
  private async loadAlerts(): Promise<void> {
    logger.debug('Loading alerts from database');

    const activeAlerts = await this.db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, this.TEST_USER_ID),
          eq(alerts.exchangeId, this.TEST_EXCHANGE_ID),
          eq(alerts.isActive, true)
        )
      );

    // Group alerts by symbol
    this.alertsBySymbol.clear();

    for (const alert of activeAlerts) {
      const state: AlertState = {
        alertId: alert.id,
        previousValues: new Map(),
        lastTriggeredAt: alert.lastTriggeredAt?.getTime() || null,
      };

      if (!this.alertsBySymbol.has(alert.symbol)) {
        this.alertsBySymbol.set(alert.symbol, []);
      }
      this.alertsBySymbol.get(alert.symbol)!.push(state);
    }

    logger.info(
      { alertCount: activeAlerts.length, symbols: [...this.alertsBySymbol.keys()] },
      'Loaded alerts from database'
    );
  }

  /**
   * Reload alerts (call this when alerts are added/modified)
   */
  async reloadAlerts(): Promise<void> {
    await this.loadAlerts();
  }

  /**
   * Subscribe to Redis pub/sub channels
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.subscriber) return;

    const channels: string[] = [];

    // Subscribe to ticker channels for all symbols
    for (const symbol of this.symbols) {
      channels.push(tickerChannel(this.TEST_USER_ID, this.TEST_EXCHANGE_ID, symbol));
    }

    // Subscribe to indicator channels for all symbol/timeframe combos
    for (const symbol of this.symbols) {
      for (const timeframe of this.timeframes) {
        channels.push(
          indicatorChannel(
            this.TEST_USER_ID,
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
   * Handle ticker update
   */
  private async handleTickerUpdate(ticker: Ticker): Promise<void> {
    const { symbol, price } = ticker;

    // Store current price
    const previousPrice = this.currentPrices.get(symbol);
    this.currentPrices.set(symbol, price);

    // Evaluate price-based alerts
    const alertStates = this.alertsBySymbol.get(symbol) || [];

    for (const state of alertStates) {
      await this.evaluateAlertWithPrice(state, symbol, price, previousPrice);
    }
  }

  /**
   * Handle indicator update
   */
  private async handleIndicatorUpdate(indicator: CachedIndicatorValue): Promise<void> {
    const { symbol, timeframe, type } = indicator;
    const key = `${symbol}:${timeframe}:${type}`;

    // Store current indicator
    const previousIndicator = this.currentIndicators.get(key);
    this.currentIndicators.set(key, indicator);

    // Get current price for this symbol
    const currentPrice = this.currentPrices.get(symbol);
    if (!currentPrice) return;

    // Evaluate indicator-based alerts
    const alertStates = this.alertsBySymbol.get(symbol) || [];

    for (const state of alertStates) {
      await this.evaluateAlertWithIndicator(
        state,
        symbol,
        timeframe,
        indicator,
        previousIndicator,
        currentPrice
      );
    }
  }

  /**
   * Evaluate an alert against current price
   */
  private async evaluateAlertWithPrice(
    state: AlertState,
    _symbol: string,
    price: number,
    previousPrice: number | undefined
  ): Promise<void> {
    // Get alert from database
    const alert = await this.db.query.alerts.findFirst({
      where: eq(alerts.id, state.alertId),
    });

    if (!alert || !alert.isActive) return;

    // Check cooldown
    if (!this.checkCooldown(state, alert.cooldownMs)) return;

    // Evaluate conditions
    const conditions = alert.conditions as AlertCondition[];
    const conditionsMet: AlertCondition[] = [];

    for (const condition of conditions) {
      if (condition.indicator !== 'price') continue;

      const met = this.evaluateCondition(
        condition,
        price,
        typeof condition.target === 'number' ? condition.target : 0,
        previousPrice,
        state
      );

      if (met) {
        conditionsMet.push(condition);
      }
    }

    // All conditions must be met
    const priceConditions = conditions.filter((c) => c.indicator === 'price');
    if (priceConditions.length > 0 && conditionsMet.length === priceConditions.length) {
      await this.triggerAlert(alert, conditionsMet, price);
      state.lastTriggeredAt = Date.now();
    }
  }

  /**
   * Evaluate an alert against indicator values
   */
  private async evaluateAlertWithIndicator(
    state: AlertState,
    _symbol: string,
    timeframe: Timeframe,
    indicator: CachedIndicatorValue,
    previousIndicator: CachedIndicatorValue | undefined,
    currentPrice: number
  ): Promise<void> {
    // Get alert from database
    const alert = await this.db.query.alerts.findFirst({
      where: and(
        eq(alerts.id, state.alertId),
        eq(alerts.timeframe, timeframe)
      ),
    });

    if (!alert || !alert.isActive) return;

    // Check cooldown
    if (!this.checkCooldown(state, alert.cooldownMs)) return;

    // Evaluate conditions
    const conditions = alert.conditions as AlertCondition[];
    const conditionsMet: AlertCondition[] = [];

    for (const condition of conditions) {
      // Skip non-indicator conditions
      if (condition.indicator === 'price') continue;

      // Get indicator value based on condition
      let currentValue: number | undefined;
      let previousValue: number | undefined;

      if (condition.indicator === 'macd-v') {
        currentValue = indicator.value['macdV'];
        previousValue = previousIndicator?.value['macdV'];
      } else if (condition.indicator === 'macd-v-signal') {
        currentValue = indicator.value['signal'];
        previousValue = previousIndicator?.value['signal'];
      } else if (condition.indicator === 'macd-v-histogram') {
        currentValue = indicator.value['histogram'];
        previousValue = previousIndicator?.value['histogram'];
      }

      if (currentValue === undefined) continue;

      const targetValue = typeof condition.target === 'number' ? condition.target : 0;

      const met = this.evaluateCondition(
        condition,
        currentValue,
        targetValue,
        previousValue,
        state
      );

      if (met) {
        conditionsMet.push(condition);
      }
    }

    // All indicator conditions must be met
    const indicatorConditions = conditions.filter((c) => c.indicator !== 'price');
    if (indicatorConditions.length > 0 && conditionsMet.length === indicatorConditions.length) {
      await this.triggerAlert(alert, conditionsMet, currentPrice);
      state.lastTriggeredAt = Date.now();
    }
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: AlertCondition,
    currentValue: number,
    targetValue: number,
    previousValue: number | undefined,
    state: AlertState
  ): boolean {
    const stateKey = `${condition.indicator}:${condition.operator}:${targetValue}`;

    switch (condition.operator) {
      case 'greater_than':
        return currentValue > targetValue;

      case 'less_than':
        return currentValue < targetValue;

      case 'equals':
        return Math.abs(currentValue - targetValue) < 0.0001;

      case 'crosses_above':
        if (previousValue === undefined) {
          // Initialize state
          state.previousValues.set(stateKey, currentValue);
          return false;
        }
        const wasBelow = previousValue <= targetValue;
        const isAbove = currentValue > targetValue;
        state.previousValues.set(stateKey, currentValue);
        return wasBelow && isAbove;

      case 'crosses_below':
        if (previousValue === undefined) {
          state.previousValues.set(stateKey, currentValue);
          return false;
        }
        const wasAbove = previousValue >= targetValue;
        const isBelow = currentValue < targetValue;
        state.previousValues.set(stateKey, currentValue);
        return wasAbove && isBelow;

      default:
        return false;
    }
  }

  /**
   * Check if alert is in cooldown period
   */
  private checkCooldown(state: AlertState, cooldownMs: number): boolean {
    if (!state.lastTriggeredAt) return true;

    const elapsed = Date.now() - state.lastTriggeredAt;
    return elapsed >= cooldownMs;
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(
    alert: typeof alerts.$inferSelect,
    conditionsMet: AlertCondition[],
    price: number
  ): Promise<void> {
    logger.info(
      { alertId: alert.id, alertName: alert.name, symbol: alert.symbol, price },
      'Alert triggered'
    );

    // Build alert message
    const conditionDescriptions = conditionsMet.map((c) => {
      const target = typeof c.target === 'number' ? c.target : 'N/A';
      return `${c.indicator} ${c.operator.replace('_', ' ')} ${target}`;
    });

    const message = `${alert.name}: ${conditionDescriptions.join(' AND ')}`;

    // Send Discord notification
    let notificationSent = false;
    let notificationError: string | null = null;

    try {
      await this.discordService.sendAlert({
        title: `Alert: ${alert.name}`,
        description: message,
        type: 'price_alert',
        symbol: alert.symbol,
        price,
        fields: conditionsMet.map((c) => ({
          name: c.indicator,
          value: `${c.operator.replace('_', ' ')} ${typeof c.target === 'number' ? c.target : 'N/A'}`,
          inline: true,
        })),
      });
      notificationSent = true;
    } catch (error) {
      notificationError = (error as Error).message;
      logger.error({ error, alertId: alert.id }, 'Failed to send Discord notification');
    }

    // Record alert history
    await this.db.insert(alertHistory).values({
      alertId: alert.id,
      price: price.toString(),
      conditions: conditionsMet,
      notificationSent,
      notificationError,
    });

    // Update last triggered timestamp
    await this.db
      .update(alerts)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(alerts.id, alert.id));
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
