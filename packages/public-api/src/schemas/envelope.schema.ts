import { z } from 'zod';

/**
 * Pagination metadata for cursor-based pagination
 */
export const PaginationMetaSchema = z.object({
  count: z.number().int().nonnegative().describe('Number of items in current response'),
  next_cursor: z.string().nullable().describe('Opaque cursor for fetching next page. Null if no more pages.'),
  has_more: z.boolean().describe('True if more results exist beyond current page'),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Generic success envelope for all API responses
 * Wraps data payload with metadata
 */
export function createEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true).describe('Always true for successful responses'),
    data: dataSchema.describe('Response payload'),
    meta: PaginationMetaSchema.describe('Pagination and metadata'),
  });
}

/**
 * Error details structure
 */
export const ErrorDetailsSchema = z.object({
  code: z.string().describe('Machine-readable error code'),
  message: z.string().describe('Human-readable error message'),
});

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

/**
 * Error envelope for failed responses
 */
export const ErrorEnvelopeSchema = z.object({
  success: z.literal(false).describe('Always false for error responses'),
  error: ErrorDetailsSchema.describe('Error details'),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
