import { z } from 'zod';
import { ErrorEnvelopeSchema } from './envelope.schema.js';

/**
 * Error code enum for standardized error responses
 */
export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/**
 * 400 Bad Request error schema
 */
export const BadRequestErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('BAD_REQUEST'),
    message: z.string().describe('Validation error details'),
  }),
});

/**
 * 404 Not Found error schema
 */
export const NotFoundErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('NOT_FOUND'),
    message: z.string().describe('Resource not found description'),
  }),
});

/**
 * 429 Rate Limited error schema
 */
export const RateLimitedErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('RATE_LIMITED'),
    message: z.string().describe('Rate limit exceeded message'),
  }),
});

/**
 * 500 Internal Server Error schema
 */
export const InternalErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('INTERNAL_ERROR'),
    message: z.string().describe('Internal error message (no sensitive details)'),
  }),
});

/**
 * 401 Unauthorized error schema
 */
export const UnauthorizedErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('UNAUTHORIZED'),
    message: z.string().describe('Authentication required message'),
  }),
});

/**
 * 403 Forbidden error schema
 */
export const ForbiddenErrorSchema = ErrorEnvelopeSchema.extend({
  error: z.object({
    code: z.literal('FORBIDDEN'),
    message: z.string().describe('Access denied message'),
  }),
});
