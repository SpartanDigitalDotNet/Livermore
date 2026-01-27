import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * Log entry shape from structured JSON logs.
 */
interface LogEntry {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  name: string;
  service: string;
  msg: string;
  event?: string;
  symbol?: string;
  [key: string]: unknown;
}

/**
 * Get the logs directory path.
 * Logs are stored in ./logs/ relative to the project root.
 */
const LOG_DIR = path.resolve(process.cwd(), 'logs');

/**
 * Parse a single log line (JSON format).
 */
function parseLogLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

/**
 * Get available log dates (from filenames).
 */
function getAvailableDates(): string[] {
  if (!existsSync(LOG_DIR)) return [];

  const files = readdirSync(LOG_DIR);
  const dates = files
    .filter(f => f.startsWith('livermore-') && f.endsWith('.log'))
    .map(f => f.replace('livermore-', '').replace('.log', ''))
    .sort()
    .reverse();

  return dates;
}

/**
 * Read and parse a log file for a specific date.
 */
function readLogFile(date: string): LogEntry[] {
  const filePath = path.join(LOG_DIR, `livermore-${date}.log`);

  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);

  const entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = parseLogLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Logs Router
 *
 * Provides endpoints for viewing application logs.
 * All endpoints require authentication (protectedProcedure).
 */
export const logsRouter = router({
  /**
   * Get recent log entries, optionally filtered by level.
   * Returns entries in reverse chronological order (newest first).
   */
  getRecent: protectedProcedure
    .input(
      z.object({
        /** Filter by log level. If 'WARN', returns WARN and ERROR. If 'ERROR', returns only ERROR. */
        level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
        /** Maximum number of entries to return. Default 100, max 500. */
        limit: z.number().int().positive().max(500).default(100),
        /** Date to fetch logs for (YYYY-MM-DD). Defaults to today. */
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const level = input?.level;
      const limit = input?.limit ?? 100;
      const date = input?.date ?? new Date().toISOString().split('T')[0];

      // Read log file
      let entries = readLogFile(date);

      // Filter by level (WARN includes ERROR, INFO includes WARN and ERROR, etc.)
      if (level === 'ERROR') {
        entries = entries.filter(e => e.level === 'ERROR');
      } else if (level === 'WARN') {
        entries = entries.filter(e => e.level === 'WARN' || e.level === 'ERROR');
      } else if (level === 'INFO') {
        entries = entries.filter(e => e.level !== 'DEBUG');
      }
      // DEBUG = no filter (all levels)

      // Return most recent entries (reverse order, then limit)
      const recent = entries.slice(-limit).reverse();

      return {
        success: true,
        date,
        count: recent.length,
        total: entries.length,
        data: recent,
      };
    }),

  /**
   * Get available log dates.
   * Useful for date picker in UI.
   */
  getAvailableDates: protectedProcedure
    .query(async () => {
      const dates = getAvailableDates();

      return {
        success: true,
        dates,
      };
    }),
});

export type LogsRouter = typeof logsRouter;
