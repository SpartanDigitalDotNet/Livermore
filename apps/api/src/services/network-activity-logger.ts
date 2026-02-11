import type { ConnectionState } from '@livermore/schemas';
import type { RedisClient } from '@livermore/cache';
import { networkActivityStreamKey } from '@livermore/cache';
import { createLogger } from '@livermore/utils';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000; // 7_776_000_000

const logger = createLogger({ name: 'activity-logger', service: 'network' });

interface ActivityLoggerOptions {
  redis: RedisClient;
  exchangeId: number;
  exchangeName: string;
  hostname: string;
  ip?: string | null;
  adminEmail?: string | null;
}

class NetworkActivityLogger {
  private readonly redis: RedisClient;
  private readonly exchangeId: number;
  private readonly exchangeName: string;
  private readonly hostname: string;
  private ip: string;
  private adminEmail: string;

  constructor(options: ActivityLoggerOptions) {
    this.redis = options.redis;
    this.exchangeId = options.exchangeId;
    this.exchangeName = options.exchangeName;
    this.hostname = options.hostname;
    this.ip = options.ip ?? '';
    this.adminEmail = options.adminEmail ?? '';
  }

  /**
   * Log a state transition to the network activity stream.
   * Fire-and-forget: catches all errors internally and never throws.
   */
  async logTransition(from: ConnectionState, to: ConnectionState): Promise<void> {
    try {
      const streamKey = networkActivityStreamKey(this.exchangeName);
      const minId = `${Date.now() - NINETY_DAYS_MS}-0`;

      await this.redis.xadd(
        streamKey,
        'MINID',
        '~',
        minId,
        '*',
        'event', 'state_transition',
        'timestamp', new Date().toISOString(),
        'fromState', from,
        'toState', to,
        'exchangeId', String(this.exchangeId),
        'exchangeName', this.exchangeName,
        'hostname', this.hostname,
        'ip', this.ip,
        'adminEmail', this.adminEmail,
      );
    } catch (err) {
      logger.error({ err }, 'Failed to log state transition to stream');
    }
  }

  /**
   * Log an error to the network activity stream.
   * Fire-and-forget: catches all errors internally and never throws.
   */
  async logError(error: string, currentState: ConnectionState): Promise<void> {
    try {
      const streamKey = networkActivityStreamKey(this.exchangeName);
      const minId = `${Date.now() - NINETY_DAYS_MS}-0`;

      await this.redis.xadd(
        streamKey,
        'MINID',
        '~',
        minId,
        '*',
        'event', 'error',
        'timestamp', new Date().toISOString(),
        'error', error,
        'exchangeId', String(this.exchangeId),
        'exchangeName', this.exchangeName,
        'hostname', this.hostname,
        'ip', this.ip,
        'state', currentState,
      );
    } catch (err) {
      logger.error({ err }, 'Failed to log error to stream');
    }
  }

  /**
   * Update the IP address for this logger.
   * Called after async IP detection completes.
   */
  setIp(ip: string): void {
    this.ip = ip;
  }

  /**
   * Update the admin email for this logger.
   * Called when ControlChannelService initializes with authenticated user context.
   */
  setAdminEmail(email: string): void {
    this.adminEmail = email;
  }
}

export { NetworkActivityLogger };
export type { ActivityLoggerOptions };
