import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, apiKeys } from '@livermore/database';
import { clearKeyCache } from '@livermore/public-api';
import { eq } from 'drizzle-orm';

/**
 * API Key Router
 *
 * Provides CRUD operations for public API key management.
 * All endpoints require Clerk authentication (protectedProcedure).
 *
 * Endpoints:
 * - list: List all API keys (with masked key preview)
 * - create: Create a new API key (returns full key once)
 * - regenerate: Regenerate an existing key (returns new full key)
 * - deactivate: Deactivate an API key
 */
export const apiKeyRouter = router({
  /**
   * List all API keys with masked previews.
   * Full key is never returned after creation.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();

    ctx.logger.debug('Listing API keys');

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        key: apiKeys.key,
        isActive: apiKeys.isActive,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .orderBy(apiKeys.createdAt);

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPreview: `••••••••-${k.key.slice(-8)}`,
      isActive: k.isActive,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));
  }),

  /**
   * Create a new API key.
   * Returns the full key value -- shown only once to the user.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const key = randomUUID();

      ctx.logger.info({ name: input.name }, 'Creating API key');

      const [created] = await db
        .insert(apiKeys)
        .values({
          name: input.name,
          key,
          createdBy: ctx.auth.userId,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          key: apiKeys.key,
          createdAt: apiKeys.createdAt,
        });

      return created;
    }),

  /**
   * Regenerate an existing API key.
   * Returns the new full key value.
   * Invalidates the old key immediately.
   */
  regenerate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const newKey = randomUUID();

      ctx.logger.info({ id: input.id }, 'Regenerating API key');

      const [updated] = await db
        .update(apiKeys)
        .set({
          key: newKey,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(apiKeys.id, input.id))
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          key: apiKeys.key,
        });

      if (!updated) {
        throw new Error('API key not found');
      }

      // Invalidate in-memory auth cache so old key is rejected immediately
      clearKeyCache();

      return updated;
    }),

  /**
   * Deactivate an API key.
   * The key can no longer be used for authentication.
   */
  deactivate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();

      ctx.logger.info({ id: input.id }, 'Deactivating API key');

      const [updated] = await db
        .update(apiKeys)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(apiKeys.id, input.id))
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          isActive: apiKeys.isActive,
        });

      if (!updated) {
        throw new Error('API key not found');
      }

      // Invalidate in-memory auth cache so deactivated key is rejected immediately
      clearKeyCache();

      return updated;
    }),
});

export type ApiKeyRouter = typeof apiKeyRouter;
