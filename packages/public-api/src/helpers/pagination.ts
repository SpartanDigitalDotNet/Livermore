import type { PaginationMeta } from '../schemas/envelope.schema.js';

/**
 * Encode a timestamp (or other numeric value) as an opaque cursor
 *
 * Uses Base64 encoding to make cursor values opaque to clients.
 * Clients should treat cursors as strings, not parse them.
 *
 * @param value - Numeric value to encode (typically Redis sorted set score or timestamp)
 * @returns Base64-encoded cursor string
 */
export function encodeCursor(value: number): string {
  return Buffer.from(value.toString()).toString('base64');
}

/**
 * Decode an opaque cursor back to numeric value
 *
 * @param cursor - Base64-encoded cursor string
 * @returns Decoded numeric value
 * @throws Error if cursor is invalid
 */
export function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const value = Number(decoded);
    if (isNaN(value)) {
      throw new Error('Invalid cursor: not a number');
    }
    return value;
  } catch (error) {
    throw new Error(`Invalid cursor format: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Build pagination metadata for response envelope
 *
 * Determines if more pages exist based on whether the result set is full.
 * If items.length === limit, there MAY be more results (has_more = true).
 * If items.length < limit, we've reached the end (has_more = false).
 *
 * @param items - Array of items in current response
 * @param limit - Page size limit requested
 * @param lastValue - Value from last item to use as cursor (timestamp for candles, id for symbols)
 * @returns Pagination metadata object
 */
export function buildPaginationMeta(
  items: unknown[],
  limit: number,
  lastValue: number | null
): PaginationMeta {
  const count = items.length;
  const has_more = count === limit;
  const next_cursor = has_more && lastValue !== null ? encodeCursor(lastValue) : null;

  return {
    count,
    next_cursor,
    has_more,
  };
}
