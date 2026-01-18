import { logger } from '@livermore/utils';

/**
 * Alert severity/type for color coding
 */
export type AlertType =
  | 'price_alert'
  | 'indicator_alert'
  | 'system'
  | 'error'
  | 'info';

/**
 * Discord embed field
 */
export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Alert notification data
 */
export interface AlertNotification {
  title: string;
  description: string;
  type: AlertType;
  symbol?: string;
  price?: number;
  fields?: DiscordField[];
  timestamp?: Date;
}

/**
 * MACD-V timeframe data for multi-timeframe alerts
 */
export interface MACDVTimeframeData {
  timeframe: string;
  macdV: number | null;
  stage: string;
}

/**
 * Color mapping for alert types
 */
const ALERT_COLORS: Record<AlertType, number> = {
  price_alert: 0x00ff00,    // Green - price alerts
  indicator_alert: 0x0099ff, // Blue - indicator alerts
  system: 0xffff00,          // Yellow - system notifications
  error: 0xff0000,           // Red - errors
  info: 0x808080,            // Gray - informational
};

/**
 * Format price with appropriate decimal places based on magnitude
 * - Prices >= $1: 2 decimals ($2.07)
 * - Prices >= $0.01: 4 decimals ($0.0234)
 * - Prices >= $0.0001: 6 decimals ($0.000123)
 * - Prices < $0.0001: 8 decimals ($0.00001073)
 */
function formatPrice(price: number): string {
  if (price >= 1) {
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  } else if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  } else {
    return `$${price.toFixed(8)}`;
  }
}

/**
 * Discord Notification Service
 *
 * Sends formatted messages to Discord via webhook.
 * Supports embeds, rate limiting, and retry logic.
 */
export class DiscordNotificationService {
  private webhookUrl: string | null = null;
  private rateLimitRemaining = 5;
  private rateLimitReset: number | null = null;
  private queue: Array<{ payload: any; resolve: () => void; reject: (e: Error) => void }> = [];
  private processing = false;

  constructor() {
    this.webhookUrl = process.env.DISCORD_LIVERMORE_BOT || null;

    if (!this.webhookUrl) {
      logger.warn('Discord webhook URL not configured (DISCORD_LIVERMORE_BOT)');
    }
  }

  /**
   * Check if Discord notifications are enabled
   */
  isEnabled(): boolean {
    return this.webhookUrl !== null;
  }

  /**
   * Send an alert notification
   */
  async sendAlert(alert: AlertNotification): Promise<void> {
    if (!this.webhookUrl) {
      logger.debug({ alert }, 'Discord notifications disabled, skipping alert');
      return;
    }

    const color = ALERT_COLORS[alert.type];
    const timestamp = (alert.timestamp || new Date()).toISOString();

    // Build embed fields
    const fields: DiscordField[] = [];

    if (alert.symbol) {
      fields.push({ name: 'Symbol', value: alert.symbol, inline: true });
    }

    if (alert.price !== undefined) {
      fields.push({
        name: 'Price',
        value: formatPrice(alert.price),
        inline: true,
      });
    }

    // Add custom fields
    if (alert.fields) {
      fields.push(...alert.fields);
    }

    const payload = {
      embeds: [
        {
          title: alert.title,
          description: alert.description,
          color,
          fields: fields.length > 0 ? fields : undefined,
          timestamp,
          footer: {
            text: 'Livermore Trading System',
          },
        },
      ],
    };

    await this.send(payload);
  }

  /**
   * Send a MACD-V alert with all timeframes
   */
  async sendMACDVAlert(
    symbol: string,
    triggerTimeframe: string,
    previousStage: string,
    currentStage: string,
    timeframes: MACDVTimeframeData[],
    bias: string,
    price: number
  ): Promise<void> {
    // Stage abbreviations for compact display
    const stageAbbrev: Record<string, string> = {
      oversold: 'OS',
      rebounding: 'rebound',
      rallying: 'rally',
      overbought: 'OB',
      retracing: 'retrace',
      reversing: 'reverse',
      ranging: 'range',
      unknown: '?',
    };

    // Capitalize stage name
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    // Format timeframe values compactly: "+142 (rally)"
    const formatTf = (tf: MACDVTimeframeData): string => {
      const val = tf.macdV !== null ? (tf.macdV >= 0 ? `+${tf.macdV.toFixed(0)}` : tf.macdV.toFixed(0)) : 'N/A';
      const stage = stageAbbrev[tf.stage] || tf.stage;
      return `${val} (${stage})`;
    };

    // Build compact timeframe display (2 per line)
    const tf1m = timeframes.find(t => t.timeframe === '1m');
    const tf5m = timeframes.find(t => t.timeframe === '5m');
    const tf15m = timeframes.find(t => t.timeframe === '15m');
    const tf1h = timeframes.find(t => t.timeframe === '1h');
    const tf4h = timeframes.find(t => t.timeframe === '4h');
    const tf1d = timeframes.find(t => t.timeframe === '1d');

    const line1 = `1m: ${tf1m ? formatTf(tf1m) : 'N/A'} │ 5m: ${tf5m ? formatTf(tf5m) : 'N/A'}`;
    const line2 = `15m: ${tf15m ? formatTf(tf15m) : 'N/A'} │ 1h: ${tf1h ? formatTf(tf1h) : 'N/A'}`;
    const line3 = `4h: ${tf4h ? formatTf(tf4h) : 'N/A'} │ 1d: ${tf1d ? formatTf(tf1d) : 'N/A'}`;

    const description = [
      '```',
      line1,
      line2,
      line3,
      '```',
      `**Bias: ${bias}**`,
    ].join('\n');

    // Title shows symbol and transition: "XRP-USD: Overbought → Retracing (1m)"
    const title = `${symbol}: ${capitalize(previousStage)} → ${capitalize(currentStage)} (${triggerTimeframe})`;

    await this.sendAlert({
      title,
      description,
      type: 'indicator_alert',
      price,
      // Don't pass symbol - it's already in the title
    });
  }

  /**
   * Send a MACD-V level crossing alert
   * @param chartBuffer - Optional PNG image buffer to attach
   */
  async sendMACDVLevelAlert(
    symbol: string,
    timeframe: string,
    level: number,
    direction: 'up' | 'down',
    currentMacdV: number,
    timeframes: MACDVTimeframeData[],
    bias: string,
    price: number,
    chartBuffer?: Buffer
  ): Promise<void> {
    logger.info({ symbol, timeframe, level, direction, hasChart: !!chartBuffer }, 'Discord: sendMACDVLevelAlert called');
    const zone = level > 0 ? 'overbought' : 'oversold';
    const title = `${symbol}: MACD-V crossed ${direction === 'up' ? 'above' : 'below'} ${level} (${timeframe})`;

    const description = [
      `Entering ${zone} territory`,
      `MACD-V: ${currentMacdV >= 0 ? '+' : ''}${currentMacdV.toFixed(1)}`,
      '```',
      this.formatTimeframeLines(timeframes),
      '```',
      `**Bias: ${bias}**`,
    ].join('\n');

    const color = ALERT_COLORS.indicator_alert;
    const timestamp = new Date().toISOString();

    const embed = {
      title,
      description,
      color,
      fields: [
        { name: 'Price', value: formatPrice(price), inline: true },
      ],
      timestamp,
      footer: { text: 'Livermore Trading System' },
      // Reference the attachment if we have a chart
      ...(chartBuffer ? { image: { url: 'attachment://macdv-chart.png' } } : {}),
    };

    const payload = { embeds: [embed] };

    if (chartBuffer) {
      await this.sendWithImage(payload, chartBuffer, 'macdv-chart.png');
    } else {
      await this.send(payload);
    }
  }

  /**
   * Send a MACD-V reversal signal alert
   * @param chartBuffer - Optional PNG image buffer to attach
   */
  async sendMACDVReversalAlert(
    symbol: string,
    timeframe: string,
    zone: 'oversold' | 'overbought',
    currentMacdV: number,
    histogram: number,
    bufferValue: number,
    timeframes: MACDVTimeframeData[],
    bias: string,
    price: number,
    chartBuffer?: Buffer
  ): Promise<void> {
    logger.info({ symbol, timeframe, zone, hasChart: !!chartBuffer }, 'Discord: sendMACDVReversalAlert called');
    const direction = zone === 'oversold' ? 'up' : 'down';
    const title = `${symbol}: Potential reversal ${direction} from ${zone} (${timeframe})`;

    const description = [
      `Signal line crossover confirmed`,
      `MACD-V: ${currentMacdV >= 0 ? '+' : ''}${currentMacdV.toFixed(1)} | Histogram: ${histogram >= 0 ? '+' : ''}${histogram.toFixed(1)} | Buffer: ${bufferValue.toFixed(1)}`,
      '```',
      this.formatTimeframeLines(timeframes),
      '```',
      `**Bias: ${bias}**`,
    ].join('\n');

    const color = ALERT_COLORS.indicator_alert;
    const timestamp = new Date().toISOString();

    const embed = {
      title,
      description,
      color,
      fields: [
        { name: 'Price', value: formatPrice(price), inline: true },
      ],
      timestamp,
      footer: { text: 'Livermore Trading System' },
      // Reference the attachment if we have a chart
      ...(chartBuffer ? { image: { url: 'attachment://macdv-chart.png' } } : {}),
    };

    const payload = { embeds: [embed] };

    if (chartBuffer) {
      await this.sendWithImage(payload, chartBuffer, 'macdv-chart.png');
    } else {
      await this.send(payload);
    }
  }

  /**
   * Format timeframe data as compact lines for Discord display
   */
  private formatTimeframeLines(timeframes: MACDVTimeframeData[]): string {
    const formatTf = (tf: MACDVTimeframeData | undefined): string => {
      if (!tf || tf.macdV === null) return 'N/A';
      return tf.macdV >= 0 ? `+${tf.macdV.toFixed(0)}` : tf.macdV.toFixed(0);
    };

    const tf1m = timeframes.find(t => t.timeframe === '1m');
    const tf5m = timeframes.find(t => t.timeframe === '5m');
    const tf15m = timeframes.find(t => t.timeframe === '15m');
    const tf1h = timeframes.find(t => t.timeframe === '1h');
    const tf4h = timeframes.find(t => t.timeframe === '4h');
    const tf1d = timeframes.find(t => t.timeframe === '1d');

    const line1 = `1m: ${formatTf(tf1m)} | 5m: ${formatTf(tf5m)}`;
    const line2 = `15m: ${formatTf(tf15m)} | 1h: ${formatTf(tf1h)}`;
    const line3 = `4h: ${formatTf(tf4h)} | 1d: ${formatTf(tf1d)}`;

    return [line1, line2, line3].join('\n');
  }

  /**
   * Send a price cross alert
   */
  async sendPriceCrossAlert(
    symbol: string,
    direction: 'above' | 'below',
    currentPrice: number,
    targetPrice: number
  ): Promise<void> {
    const emoji = direction === 'above' ? '\u{1F680}' : '\u{1F4C9}';
    const verb = direction === 'above' ? 'crossed above' : 'dropped below';

    await this.sendAlert({
      title: `${emoji} ${symbol} Price Alert`,
      description: `Price ${verb} $${targetPrice.toLocaleString()}`,
      type: 'price_alert',
      symbol,
      price: currentPrice,
      fields: [
        { name: 'Target', value: `$${targetPrice.toLocaleString()}`, inline: true },
        { name: 'Direction', value: direction === 'above' ? 'Bullish' : 'Bearish', inline: true },
      ],
    });
  }

  /**
   * Send a system notification
   */
  async sendSystemNotification(title: string, message: string): Promise<void> {
    await this.sendAlert({
      title,
      description: message,
      type: 'system',
    });
  }

  /**
   * Send a raw payload to Discord
   */
  private async send(payload: any): Promise<void> {
    const msgId = Math.random().toString(36).substring(7);
    logger.debug({ msgId, queueLength: this.queue.length }, 'Discord send() called');
    return new Promise((resolve, reject) => {
      this.queue.push({ payload: { ...payload, __msgId: msgId }, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process the message queue with rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      // Check rate limit
      if (this.rateLimitRemaining <= 0 && this.rateLimitReset) {
        const waitMs = this.rateLimitReset - Date.now();
        if (waitMs > 0) {
          logger.debug({ waitMs }, 'Rate limited, waiting...');
          await this.sleep(waitMs);
        }
      }

      const item = this.queue.shift();
      if (!item) break;

      try {
        const msgId = item.payload.__msgId || 'unknown';
        // Check if payload has an image attachment
        if (item.payload.__image) {
          const { buffer, filename } = item.payload.__image;
          logger.debug({ msgId, filename }, 'processQueue: sending with image');
          await this.sendToDiscordWithImage(item.payload, buffer, filename);
        } else {
          logger.debug({ msgId }, 'processQueue: sending without image');
          await this.sendToDiscord(item.payload);
        }
        logger.debug({ msgId }, 'processQueue: send complete');
        item.resolve();
      } catch (error) {
        const msgId = item.payload.__msgId || 'unknown';
        logger.error({ msgId, error }, 'processQueue: send failed');
        item.reject(error as Error);
      }

      // Small delay between messages
      await this.sleep(100);
    }

    this.processing = false;
  }

  /**
   * Send payload to Discord webhook
   */
  private async sendToDiscord(payload: any): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }

    const msgId = payload.__msgId || 'unknown';
    logger.info({ msgId }, 'Discord: HTTP POST starting');

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    // Update rate limit info from headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset) {
      this.rateLimitReset = parseInt(reset, 10) * 1000; // Convert to ms
    }

    if (!response.ok) {
      const text = await response.text();

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          this.rateLimitReset = Date.now() + parseInt(retryAfter, 10) * 1000;
        }
        throw new Error(`Rate limited by Discord. Retry after: ${retryAfter}s`);
      }

      logger.error(
        { status: response.status, error: text },
        'Discord webhook request failed'
      );
      throw new Error(`Discord webhook error: ${response.status}`);
    }

    logger.info({ msgId }, 'Discord: HTTP POST completed successfully');
  }

  /**
   * Send a payload with an image attachment to Discord
   * Uses multipart/form-data instead of JSON
   */
  private async sendWithImage(payload: any, imageBuffer: Buffer, filename: string): Promise<void> {
    const msgId = Math.random().toString(36).substring(7);
    const title = payload.embeds?.[0]?.title || 'unknown';
    logger.info({ msgId, queueLength: this.queue.length, title }, 'Discord: sendWithImage queuing message');
    return new Promise((resolve, reject) => {
      this.queue.push({
        payload: { __image: { buffer: imageBuffer, filename }, __msgId: msgId, ...payload },
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  /**
   * Send payload with image to Discord webhook using multipart/form-data
   */
  private async sendToDiscordWithImage(payload: any, imageBuffer: Buffer, filename: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }

    const msgId = payload.__msgId || 'unknown';
    logger.info({ msgId, filename, size: imageBuffer.length }, 'Discord: HTTP POST with image starting');

    // Create FormData for multipart upload
    const formData = new FormData();

    // Add the JSON payload (without the __image metadata)
    const jsonPayload = { ...payload };
    delete jsonPayload.__image;
    formData.append('payload_json', JSON.stringify(jsonPayload));

    // Add the image as a file attachment
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('files[0]', blob, filename);

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      body: formData,
      // Note: Do NOT set Content-Type header - fetch sets it automatically with boundary
    });

    // Update rate limit info from headers
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
    if (reset) {
      this.rateLimitReset = parseInt(reset, 10) * 1000; // Convert to ms
    }

    if (!response.ok) {
      const text = await response.text();

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          this.rateLimitReset = Date.now() + parseInt(retryAfter, 10) * 1000;
        }
        throw new Error(`Rate limited by Discord. Retry after: ${retryAfter}s`);
      }

      logger.error(
        { status: response.status, error: text },
        'Discord webhook with image request failed'
      );
      throw new Error(`Discord webhook error: ${response.status}`);
    }

    logger.info({ msgId }, 'Discord: HTTP POST with image completed successfully');
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance: DiscordNotificationService | null = null;

/**
 * Get the Discord notification service instance
 */
export function getDiscordService(): DiscordNotificationService {
  if (!instance) {
    instance = new DiscordNotificationService();
  }
  return instance;
}
