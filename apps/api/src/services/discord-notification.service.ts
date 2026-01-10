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
        value: `$${alert.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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
   * Send a MACD-V stage change alert
   */
  async sendMACDVAlert(
    symbol: string,
    stage: string,
    macdV: number,
    signal: number,
    price: number
  ): Promise<void> {
    const stageDescriptions: Record<string, { title: string; description: string; bullish: boolean }> = {
      oversold: {
        title: 'Risk: Oversold',
        description: 'MACD-V has dropped below -150. High risk zone.',
        bullish: false,
      },
      rebounding: {
        title: 'Rebounding',
        description: 'MACD-V is recovering from oversold conditions.',
        bullish: true,
      },
      rallying: {
        title: 'Rallying',
        description: 'Strong upward momentum. MACD-V between +50 and +150.',
        bullish: true,
      },
      overbought: {
        title: 'Risk: Overbought',
        description: 'MACD-V has risen above +150. High risk zone.',
        bullish: false,
      },
      retracing: {
        title: 'Retracing',
        description: 'Momentum is weakening. MACD-V below signal line.',
        bullish: false,
      },
      reversing: {
        title: 'Reversing',
        description: 'Downward momentum increasing. Watch for further decline.',
        bullish: false,
      },
      ranging: {
        title: 'Ranging',
        description: 'Neutral zone. MACD-V between -50 and +50.',
        bullish: true, // neutral, use green
      },
    };

    const stageInfo = stageDescriptions[stage] || {
      title: `Stage: ${stage}`,
      description: 'Unknown stage',
      bullish: true,
    };

    await this.sendAlert({
      title: `${symbol} - ${stageInfo.title}`,
      description: stageInfo.description,
      type: 'indicator_alert',
      symbol,
      price,
      fields: [
        { name: 'MACD-V', value: macdV.toFixed(2), inline: true },
        { name: 'Signal', value: signal.toFixed(2), inline: true },
        { name: 'Histogram', value: (macdV - signal).toFixed(2), inline: true },
      ],
    });
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
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
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
        await this.sendToDiscord(item.payload);
        item.resolve();
      } catch (error) {
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

    logger.debug({ payload }, 'Sending Discord notification');

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

    logger.debug('Discord notification sent successfully');
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
