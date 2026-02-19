import { getDbClient, apiKeys } from '@livermore/database';
import { eq } from 'drizzle-orm';

/**
 * In-memory cache for API key validation results.
 * TTL: 60 seconds. Avoids hitting the database on every request.
 */
const keyCache = new Map<string, { id: number; isActive: boolean; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Validate an API key against the database (with in-memory caching).
 * Returns the key ID if valid and active, null otherwise.
 *
 * On cache miss: queries database, caches result, fire-and-forget updates last_used_at.
 */
export async function validateApiKey(apiKey: string): Promise<number | null> {
  // Check cache first
  const cached = keyCache.get(apiKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.isActive ? cached.id : null;
  }

  // Cache miss -- query database
  const db = getDbClient();
  const [row] = await db
    .select({ id: apiKeys.id, isActive: apiKeys.isActive })
    .from(apiKeys)
    .where(eq(apiKeys.key, apiKey))
    .limit(1);

  if (!row) {
    // Cache negative result to prevent repeated DB hits for invalid keys
    keyCache.set(apiKey, { id: 0, isActive: false, cachedAt: Date.now() });
    return null;
  }

  // Cache the result
  keyCache.set(apiKey, { id: row.id, isActive: row.isActive, cachedAt: Date.now() });

  if (!row.isActive) {
    return null;
  }

  // Fire-and-forget: update last_used_at
  db.update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return row.id;
}

/**
 * Clear the entire in-memory API key cache.
 * Called from tRPC mutations (regenerate, deactivate) to ensure
 * invalidated keys are rejected immediately.
 */
export function clearKeyCache(): void {
  keyCache.clear();
}

/**
 * Build an onRequest hook that validates the X-API-Key header.
 *
 * Skips:
 * - OPTIONS requests (CORS preflight)
 * - /docs and /docs/* paths (Swagger UI)
 * - /openapi.json path (OpenAPI spec)
 */
export function buildAuthHook() {
  return async (request: any, reply: any) => {
    // Skip CORS preflight
    if (request.method === 'OPTIONS') {
      return;
    }

    // Skip Swagger UI and OpenAPI spec
    const url: string = request.url;
    // Extract path relative to the plugin prefix
    // When registered under /public/v1, request.url is the full path
    // but within the plugin scope, routeOptions.url gives the scoped path.
    // Use request.routeOptions?.url or parse from full URL.
    const routerPath = request.routeOptions?.url ?? url;
    if (
      routerPath === '/docs' ||
      routerPath === '/docs/' ||
      routerPath.startsWith('/docs/') ||
      routerPath === '/openapi.json'
    ) {
      return;
    }

    // Also check against the full URL for safety
    if (
      url.includes('/docs') ||
      url.endsWith('/openapi.json')
    ) {
      // Only skip if it matches the public API docs paths
      const publicDocsPattern = /\/public\/v1\/(docs|openapi\.json)/;
      if (publicDocsPattern.test(url)) {
        return;
      }
    }

    // Require X-API-Key header
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key required. Set X-API-Key header.',
        },
      });
    }

    // Validate the key
    const keyId = await validateApiKey(apiKey);
    if (keyId === null) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or inactive API key.',
        },
      });
    }

    // Store key ID on request for rate limiting key generator
    (request as any).apiKeyId = keyId;
  };
}
