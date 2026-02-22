import WebSocket from 'ws';

/**
 * ClientConnection manages per-client WebSocket state including:
 * - Subscription tracking (which channels this client cares about)
 * - Heartbeat ping/pong liveness detection (30s interval)
 * - Backpressure detection via bufferedAmount (WS-07)
 *
 * Backpressure thresholds:
 * - 64KB: skip message (client falling behind, drop non-critical data)
 * - 256KB: terminate connection (client is irrecoverably slow)
 *
 * These are heuristic thresholds -- bufferedAmount is not perfectly
 * accurate but sufficient for detecting slow consumers.
 */

/** 64KB warning threshold -- skip messages */
const BUFFER_WARN_THRESHOLD = 64 * 1024;

/** 256KB disconnect threshold -- terminate connection */
const BUFFER_KILL_THRESHOLD = 256 * 1024;

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

export class ClientConnection {
  public readonly apiKeyId: number;
  public readonly connectionId: string;
  public readonly subscriptions: Set<string> = new Set();

  private alive = true;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly socket: WebSocket;

  constructor(opts: { socket: WebSocket; apiKeyId: number; connectionId: string }) {
    this.socket = opts.socket;
    this.apiKeyId = opts.apiKeyId;
    this.connectionId = opts.connectionId;

    // Attach pong handler ONCE in constructor (not per heartbeat tick)
    this.socket.on('pong', () => {
      this.alive = true;
    });
  }

  /**
   * Start heartbeat ping/pong cycle.
   * Every 30 seconds: if client did not respond to previous ping, terminate.
   * Otherwise mark as not-alive and send a new ping.
   */
  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.alive) {
        this.socket.terminate();
        return;
      }
      this.alive = false;
      this.socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop heartbeat interval */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send data to the client with backpressure detection.
   *
   * @returns true if sent, false if skipped or connection terminated
   */
  send(data: string): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Kill threshold: client is irrecoverably slow
    if (this.socket.bufferedAmount > BUFFER_KILL_THRESHOLD) {
      this.socket.terminate();
      return false;
    }

    // Warn threshold: skip this message (client falling behind)
    if (this.socket.bufferedAmount > BUFFER_WARN_THRESHOLD) {
      return false;
    }

    this.socket.send(data);
    return true;
  }

  /** Add a channel subscription */
  addSubscription(channel: string): void {
    this.subscriptions.add(channel);
  }

  /** Remove a channel subscription */
  removeSubscription(channel: string): void {
    this.subscriptions.delete(channel);
  }

  /**
   * Check if client is subscribed to a channel.
   * Supports wildcard matching: a subscription like `signals:*:*` matches
   * any `signals:X:Y`, and `candles:BTC-USD:*` matches any `candles:BTC-USD:Y`.
   */
  hasSubscription(channel: string): boolean {
    if (this.subscriptions.has(channel)) return true;

    // Check wildcard subscriptions
    const channelParts = channel.split(':');
    for (const sub of this.subscriptions) {
      if (!sub.includes('*')) continue;
      const subParts = sub.split(':');
      if (subParts.length !== channelParts.length) continue;
      const matches = subParts.every(
        (seg, i) => seg === '*' || seg === channelParts[i]
      );
      if (matches) return true;
    }
    return false;
  }

  /** Clean up: stop heartbeat and close socket if open */
  destroy(): void {
    this.stopHeartbeat();
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }
}
