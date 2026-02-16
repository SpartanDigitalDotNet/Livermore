import { hostname } from 'node:os';
import type { InstanceStatus } from '@livermore/schemas';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TTL_SECONDS,
} from '@livermore/schemas';
import { instanceStatusKey } from '@livermore/cache';
import type { RedisClient } from '@livermore/cache';
import { createLogger } from '@livermore/utils';
import { detectPublicIp, detectCountry } from '../utils/detect-public-ip';

const logger = createLogger({ name: 'instance-registry', service: 'network' });

interface RegistryOptions {
  exchangeId: number;
  exchangeName: string;
  redis: RedisClient;
}

/**
 * InstanceRegistryService
 *
 * Manages Redis key lifecycle for exchange instance registration.
 * Implements:
 * - Atomic exchange claim via SET NX EX (one-instance-per-exchange)
 * - Heartbeat timer that refreshes the key every 15s with 45s TTL
 * - Status updates that preserve TTL via KEEPTTL
 * - Self-restart detection (same hostname can reclaim)
 * - Error recording that works without reading the key first (FIX-02)
 * - TTL on every SET call to prevent ghost idle instances (FIX-03)
 */
export class InstanceRegistryService {
  private readonly exchangeId: number;
  private readonly exchangeName: string;
  private readonly redis: RedisClient;
  private readonly host: string;
  private readonly instanceId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registered = false;
  private currentStatus: InstanceStatus;

  constructor(options: RegistryOptions) {
    this.exchangeId = options.exchangeId;
    this.exchangeName = options.exchangeName;
    this.redis = options.redis;
    this.host = hostname();
    this.instanceId = `${this.host}:${this.exchangeId}:${process.pid}:${Date.now()}`;

    // Initialize status with null/default values; will be fully set on register()
    this.currentStatus = {
      exchangeId: this.exchangeId,
      exchangeName: this.exchangeName,
      hostname: this.host,
      ipAddress: null,
      countryCode: null,
      adminEmail: null,
      adminDisplayName: null,
      connectionState: 'idle',
      symbolCount: 0,
      connectedAt: null,
      lastHeartbeat: new Date().toISOString(),
      lastStateChange: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
      lastError: null,
      lastErrorAt: null,
    };
  }

  /**
   * Register this instance for the configured exchange.
   * Uses atomic SET NX EX to claim the exchange slot.
   *
   * @returns true if registration succeeded, false should not occur (throws on conflict)
   * @throws Error if another instance (different host) holds the exchange lock
   */
  async register(): Promise<boolean> {
    const key = instanceStatusKey(this.exchangeId);
    const now = new Date().toISOString();

    // Build initial payload
    this.currentStatus = {
      exchangeId: this.exchangeId,
      exchangeName: this.exchangeName,
      hostname: this.host,
      ipAddress: null,
      countryCode: null,
      adminEmail: null,
      adminDisplayName: null,
      connectionState: 'idle',
      symbolCount: 0,
      connectedAt: null,
      lastHeartbeat: now,
      lastStateChange: now,
      registeredAt: now,
      lastError: null,
      lastErrorAt: null,
    };

    // Atomic claim: SET key value EX ttl NX
    const result = await this.redis.set(
      key,
      JSON.stringify(this.currentStatus),
      'EX',
      HEARTBEAT_TTL_SECONDS,
      'NX'
    );

    if (result === 'OK') {
      // Registration succeeded -- we own this exchange
      this.registered = true;
      logger.info(
        { exchangeId: this.exchangeId, exchangeName: this.exchangeName, hostname: this.host, instanceId: this.instanceId },
        'Instance registered'
      );

      // One-time cleanup: delete old prototype key format (exchange:status:{id})
      this.redis.del('exchange:status:' + this.exchangeId).catch(() => {
        // Ignore errors on cleanup of legacy key
      });

      // Detect public IP and country asynchronously
      detectPublicIp().then((ip) => {
        if (ip) {
          detectCountry(ip).then((countryCode) => {
            this.updateStatus({ ipAddress: ip, countryCode: countryCode ?? null }).catch(() => {
              // Non-critical: IP/country update failure is not fatal
            });
          });
        }
      });

      // Start heartbeat
      this.startHeartbeat();

      return true;
    }

    // Another instance may hold the key -- check ownership
    const existingRaw = await this.redis.get(key);

    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as InstanceStatus;

      // Self-restart detection: same hostname can reclaim (Pitfall 5)
      if (existing.hostname === this.host) {
        // Overwrite with our payload using SET XX (only if key exists)
        await this.redis.set(
          key,
          JSON.stringify(this.currentStatus),
          'EX',
          HEARTBEAT_TTL_SECONDS,
          'XX'
        );

        this.registered = true;
        logger.info(
          { exchangeId: this.exchangeId, hostname: this.host },
          'Instance re-registered (same host restart)'
        );

        this.startHeartbeat();
        return true;
      }

      // Different host holds the lock -- conflict
      const ttl = await this.redis.ttl(key);
      throw new Error(
        `Exchange ${this.exchangeId} (${this.exchangeName}) is already claimed by ${existing.hostname} (${existing.ipAddress}) since ${existing.connectedAt}. Stop that instance first, or wait for TTL to expire (${ttl}s remaining).`
      );
    }

    // Key expired between our NX attempt and GET -- race window. Retry claim.
    const retryResult = await this.redis.set(
      key,
      JSON.stringify(this.currentStatus),
      'EX',
      HEARTBEAT_TTL_SECONDS,
      'NX'
    );

    if (retryResult === 'OK') {
      this.registered = true;
      logger.info(
        { exchangeId: this.exchangeId, hostname: this.host },
        'Instance registered (after stale key expired)'
      );
      this.startHeartbeat();
      return true;
    }

    // Extremely rare: someone else claimed between our GET and retry
    throw new Error(
      `Exchange ${this.exchangeId} (${this.exchangeName}) could not be claimed. Another instance may have just registered.`
    );
  }

  /**
   * Start the heartbeat timer. Refreshes the Redis key every 15 seconds.
   * Timer is unref'd so it does not prevent Node.js from exiting.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  /**
   * Single heartbeat tick. Refreshes the Redis key with full payload and TTL.
   * NEVER throws -- errors are caught and logged.
   */
  private async heartbeatTick(): Promise<void> {
    try {
      const key = instanceStatusKey(this.exchangeId);
      this.currentStatus.lastHeartbeat = new Date().toISOString();

      // SET key value EX ttl XX (only write if key exists)
      const result = await this.redis.set(
        key,
        JSON.stringify(this.currentStatus),
        'EX',
        HEARTBEAT_TTL_SECONDS,
        'XX'
      );

      if (result === null) {
        // Key expired or was deleted -- re-register
        logger.warn(
          { exchangeId: this.exchangeId },
          'Instance key missing during heartbeat, re-registering'
        );
        await this.register();
      }
    } catch (err) {
      // NEVER throw from heartbeat -- throwing kills the setInterval loop
      logger.error(
        { err, exchangeId: this.exchangeId },
        'Heartbeat tick failed'
      );
    }
  }

  /**
   * Stop the heartbeat timer.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Deregister this instance. Stops heartbeat and deletes the Redis key.
   */
  async deregister(): Promise<void> {
    this.stopHeartbeat();
    await this.redis.del(instanceStatusKey(this.exchangeId));
    logger.info(
      { exchangeId: this.exchangeId, instanceId: this.instanceId },
      'Instance deregistered'
    );
  }

  /**
   * Update the instance status in Redis, preserving TTL.
   * Merges the provided updates into the current in-memory status,
   * then writes the full payload with KEEPTTL.
   */
  async updateStatus(updates: Partial<InstanceStatus>): Promise<void> {
    Object.assign(this.currentStatus, updates);

    // Guard: don't write to Redis if register() was never called.
    // Prevents ghost keys (e.g. exchange:0:status) when the placeholder
    // registry records an error before a real exchange is configured.
    if (!this.registered) {
      return;
    }

    await this.redis.set(
      instanceStatusKey(this.exchangeId),
      JSON.stringify(this.currentStatus),
      'KEEPTTL'
    );
  }

  /**
   * Read the current instance status from Redis.
   * Returns null if the key is missing (expired or never set).
   */
  async getStatus(): Promise<InstanceStatus | null> {
    const raw = await this.redis.get(instanceStatusKey(this.exchangeId));
    if (!raw) return null;
    return JSON.parse(raw) as InstanceStatus;
  }

  /**
   * Record an error in the instance status (FIX-02).
   * Writes from in-memory state, not by reading the key first,
   * so it works even if the key has expired.
   */
  async recordError(error: string): Promise<void> {
    await this.updateStatus({
      lastError: error,
      lastErrorAt: new Date().toISOString(),
    });
  }

  /**
   * Set admin identity info. Does NOT write to Redis immediately --
   * the next heartbeat tick will persist the change.
   * Called when ControlChannelService initializes with authenticated user context.
   */
  setAdminInfo(email: string, displayName: string): void {
    this.currentStatus.adminEmail = email;
    this.currentStatus.adminDisplayName = displayName;
  }

  /**
   * Set the number of symbols this instance is monitoring.
   * Does NOT write to Redis immediately -- the next heartbeat tick will persist it.
   */
  setSymbolCount(count: number): void {
    this.currentStatus.symbolCount = count;
  }
}
