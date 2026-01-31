import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, users } from '@livermore/database';
import { UserSettingsSchema, UserSettingsPatchSchema } from '@livermore/schemas';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Settings Router
 *
 * Provides CRUD operations for user settings stored as JSONB.
 * All endpoints require Clerk authentication (protectedProcedure).
 *
 * Endpoints:
 * - get: Retrieve current user settings
 * - update: Replace entire settings document (use for import/reset)
 * - patch: Update specific path via jsonb_set (use for partial updates)
 * - export: Export settings with metadata (for backup/download)
 * - import: Import settings from export file (with validation)
 */
export const settingsRouter = router({
  /**
   * GET /settings.get
   *
   * Retrieve the current user's settings.
   * Returns settings object or default { version: 1 } if null.
   * Requirement: SET-03
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();
    const clerkId = ctx.auth.userId;

    ctx.logger.debug({ clerkId }, 'Fetching user settings');

    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(
        and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, clerkId)
        )
      )
      .limit(1);

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    return user.settings ?? { version: 1 };
  }),

  /**
   * POST /settings.update
   *
   * Replace the entire settings document.
   * Use for import or reset scenarios.
   * For partial updates, use patch() instead.
   * Requirement: SET-04
   */
  update: protectedProcedure
    .input(UserSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      ctx.logger.info({ clerkId }, 'Replacing user settings');

      // First check if user exists
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Update settings with full replacement
      const [updated] = await db
        .update(users)
        .set({
          settings: input,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, existing.id))
        .returning({ settings: users.settings });

      ctx.logger.info(
        { userId: existing.id },
        'User settings replaced successfully'
      );

      return updated.settings;
    }),

  /**
   * POST /settings.patch
   *
   * Update a specific path within settings using PostgreSQL jsonb_set.
   * Atomic operation - no race conditions.
   * Creates missing intermediate keys automatically.
   *
   * Example:
   *   path: ['perseus_profile', 'timezone']
   *   value: 'America/New_York'
   *
   * Requirement: SET-05
   */
  patch: protectedProcedure
    .input(UserSettingsPatchSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      ctx.logger.info(
        { clerkId, path: input.path },
        'Patching user settings'
      );

      // Get user ID first (needed for raw SQL)
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Build JSON path for jsonb_set: ['a', 'b'] -> '{a,b}'
      const pathStr = `{${input.path.join(',')}}`;
      const valueJson = JSON.stringify(input.value);

      // Use jsonb_set for atomic partial update
      // The `true` parameter creates missing intermediate keys
      await db.execute(sql`
        UPDATE users
        SET settings = jsonb_set(COALESCE(settings, '{}'), ${pathStr}::text[], ${valueJson}::jsonb, true),
            updated_at = NOW()
        WHERE id = ${user.id}
      `);

      // Return updated settings
      const [updated] = await db
        .select({ settings: users.settings })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      ctx.logger.info(
        { userId: user.id, path: input.path },
        'User settings patched successfully'
      );

      return updated.settings;
    }),

  /**
   * GET /settings.export
   *
   * Export user settings with metadata for backup/download.
   * Returns settings wrapped in export envelope with timestamp.
   * Client handles file download via Blob/URL.createObjectURL.
   *
   * Requirement: SET-06
   */
  export: protectedProcedure.query(async ({ ctx }) => {
    const db = getDbClient();
    const clerkId = ctx.auth.userId;

    ctx.logger.info({ clerkId }, 'Exporting user settings');

    const [user] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(
        and(
          eq(users.identityProvider, 'clerk'),
          eq(users.identitySub, clerkId)
        )
      )
      .limit(1);

    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    return {
      exportedAt: new Date().toISOString(),
      exportVersion: '1.0',
      settings: user.settings ?? { version: 1 },
    };
  }),

  /**
   * POST /settings.import
   *
   * Import settings from previously exported file.
   * Validates settings against UserSettingsSchema before saving.
   * Accepts export envelope, extracts and validates settings field.
   *
   * Requirement: SET-07
   */
  import: protectedProcedure
    .input(
      z.object({
        settings: UserSettingsSchema,
        // Optional metadata fields (ignored, but allowed for export format compatibility)
        exportedAt: z.string().optional(),
        exportVersion: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      ctx.logger.info({ clerkId }, 'Importing user settings');

      // Check if user exists
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Replace settings with imported data (same as update, semantically for import)
      const [updated] = await db
        .update(users)
        .set({
          settings: input.settings,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, existing.id))
        .returning({ settings: users.settings });

      ctx.logger.info(
        { userId: existing.id },
        'User settings imported successfully'
      );

      return updated.settings;
    }),
});

export type SettingsRouter = typeof settingsRouter;
