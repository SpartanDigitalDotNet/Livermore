/**
 * @livermore/public-api
 *
 * Public API package for external clients.
 * Provides IP-protected schemas, transformers, helpers, and Fastify plugin for public endpoints.
 *
 * CRITICAL: This package does NOT depend on @livermore/indicators to maintain
 * hard IP isolation boundary. Proprietary indicator calculations are never exposed.
 */

// Export all schemas
export * from './schemas/index.js';

// Export all transformers
export * from './transformers/index.js';

// Export all helpers
export * from './helpers/index.js';

// Export plugin
export { publicApiPlugin } from './plugin.js';
