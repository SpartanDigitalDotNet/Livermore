import type { FileTransport } from './file-transport';

/**
 * Performance entry written to .perf.log
 */
export interface PerfEntry {
  timestamp: string;
  operation: string;
  duration: number;
  success: boolean;
  context?: Record<string, unknown>;
  error?: string;
}

/**
 * Performance tracker for timing operations
 *
 * Usage:
 * ```typescript
 * const perf = new PerformanceTracker(fileTransport);
 *
 * // Track async operation
 * const result = await perf.track('calculateIndicators', async () => {
 *   return await calculateIndicators(symbol, timeframe);
 * }, { symbol, timeframe });
 *
 * // Manual timing
 * perf.start('operation');
 * // ... do work ...
 * perf.end('operation', { extraContext: true });
 * ```
 */
export class PerformanceTracker {
  private pending: Map<string, { startTime: number; context?: Record<string, unknown> }> =
    new Map();

  constructor(private fileTransport: FileTransport | null) {}

  /**
   * Start timing an operation
   */
  start(operation: string, context?: Record<string, unknown>): void {
    this.pending.set(operation, {
      startTime: performance.now(),
      context,
    });
  }

  /**
   * End timing an operation and write to perf log
   */
  end(
    operation: string,
    additionalContext?: Record<string, unknown>,
    error?: Error
  ): number {
    const entry = this.pending.get(operation);
    if (!entry) {
      return 0;
    }

    this.pending.delete(operation);
    const duration = Math.round(performance.now() - entry.startTime);

    const perfEntry: PerfEntry = {
      timestamp: new Date().toISOString(),
      operation,
      duration,
      success: !error,
      context: { ...entry.context, ...additionalContext },
      ...(error && { error: error.message }),
    };

    this.write(perfEntry);
    return duration;
  }

  /**
   * Track an operation and return its result
   */
  async track<T>(
    operation: string,
    fn: () => T | Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    this.start(operation, context);
    try {
      const result = await fn();
      this.end(operation);
      return result;
    } catch (error) {
      this.end(operation, undefined, error as Error);
      throw error;
    }
  }

  /**
   * Track a synchronous operation
   */
  trackSync<T>(
    operation: string,
    fn: () => T,
    context?: Record<string, unknown>
  ): T {
    this.start(operation, context);
    try {
      const result = fn();
      this.end(operation);
      return result;
    } catch (error) {
      this.end(operation, undefined, error as Error);
      throw error;
    }
  }

  /**
   * Write a performance entry to the log
   */
  private write(entry: PerfEntry): void {
    if (this.fileTransport) {
      this.fileTransport.writePerf(entry as unknown as Record<string, unknown>);
    }
  }
}

/**
 * Create a no-op performance tracker for when perf logging is disabled
 */
export function createNoOpPerformanceTracker(): PerformanceTracker {
  return new PerformanceTracker(null);
}
