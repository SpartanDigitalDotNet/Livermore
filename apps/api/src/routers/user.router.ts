import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '@livermore/trpc-config';
import { getDbClient, users, type User } from '@livermore/database';
import { eq, and } from 'drizzle-orm';

/**
 * Input schema for Google OAuth login (PerseusWeb)
 * Note: googleId is kept for reference/logging but NOT used for lookup
 */
const LoginFromGoogleInput = z.object({
  googleId: z.string().min(1, 'Google ID is required'),
  email: z.string().email('Valid email is required'),
  displayName: z.string().optional(),
  pictureUrl: z.string().url().optional().nullable(),
});

/**
 * Input schema for Clerk OAuth sync (LivermoreAdmin)
 */
const SyncFromClerkInput = z.object({
  clerkId: z.string().min(1, 'Clerk ID is required'),
  email: z.string().email('Valid email is required'),
  displayName: z.string().optional(),
  pictureUrl: z.string().url().optional().nullable(),
});

/**
 * Generate username from email
 * Format: email prefix + random suffix for uniqueness
 */
function generateUsername(email: string): string {
  const prefix = email.split('@')[0].slice(0, 30);
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${prefix}_${suffix}`;
}

/**
 * User router
 *
 * Handles user sync for external OAuth providers (Google).
 * This is the entry point for PerseusWeb to onboard/sync users.
 */
export const userRouter = router({
  /**
   * Login user from Google OAuth (PerseusWeb)
   *
   * Called by PerseusWeb when a user signs in with Google.
   * Looks up user by EMAIL (not Google ID) to find users
   * who registered via LivermoreAdmin (Clerk).
   *
   * IMPORTANT: Does NOT create new users.
   * Users must register via LivermoreAdmin first.
   *
   * Updates personal data only (displayName, pictureUrl, lastLoginAt).
   * Does NOT modify identity_provider or identity_sub fields.
   */
  loginFromGoogle: publicProcedure
    .input(LoginFromGoogleInput)
    .mutation(async ({ input, ctx }): Promise<User> => {
      const db = getDbClient();
      const { googleId, email, displayName, pictureUrl } = input;

      ctx.logger.info({ googleId, email }, 'Processing Google OAuth login');

      // Lookup user by EMAIL (not identity fields)
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!existing) {
        ctx.logger.warn({ email }, 'User not found - must register via LivermoreAdmin first');
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found. Please register via LivermoreAdmin first, then return to PerseusWeb.',
        });
      }

      // UPDATE personal data only (preserve identity_provider and identity_sub)
      const [updated] = await db
        .update(users)
        .set({
          displayName: displayName || existing.displayName,
          identityPictureUrl: pictureUrl ?? existing.identityPictureUrl,
          lastLoginAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, existing.id))
        .returning();

      ctx.logger.info(
        { userId: updated.id, email },
        'User logged in from Google OAuth (PerseusWeb)'
      );

      return updated;
    }),

  /**
   * Get user by email
   *
   * Allows PerseusWeb to check if a user exists before attempting login.
   * Can be used to show appropriate UI (login vs "please register first").
   */
  getByEmail: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input, ctx }): Promise<User | null> => {
      const db = getDbClient();

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (user) {
        ctx.logger.debug({ userId: user.id, email: input.email }, 'Found user by email');
      }

      return user || null;
    }),

  /**
   * Sync user from Clerk OAuth (LivermoreAdmin)
   *
   * Called by LivermoreAdmin when a user signs in with Clerk.
   * Creates user if not exists, updates if exists.
   * Returns the user record.
   *
   * This ensures users are onboarded seamlessly during Admin login,
   * allowing them to set up exchanges and symbols.
   */
  syncFromClerk: publicProcedure
    .input(SyncFromClerkInput)
    .mutation(async ({ input, ctx }): Promise<User> => {
      const db = getDbClient();
      const { clerkId, email, displayName, pictureUrl } = input;

      ctx.logger.info({ clerkId, email }, 'Processing Clerk OAuth sync');

      // Check if user exists by Clerk identity
      const existing = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // UPDATE existing user
        const [updated] = await db
          .update(users)
          .set({
            email,
            displayName: displayName || existing[0].displayName,
            identityPictureUrl: pictureUrl ?? existing[0].identityPictureUrl,
            lastLoginAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, existing[0].id))
          .returning();

        ctx.logger.info(
          { userId: updated.id, clerkId },
          'Updated user from Clerk OAuth'
        );

        return updated;
      }

      // INSERT new user
      const [created] = await db
        .insert(users)
        .values({
          email,
          username: generateUsername(email),
          identityProvider: 'clerk',
          identitySub: clerkId,
          displayName: displayName || null,
          identityPictureUrl: pictureUrl || null,
          role: 'user',
          lastLoginAt: new Date().toISOString(),
        })
        .returning();

      ctx.logger.info(
        { userId: created.id, clerkId, email },
        'Created user from Clerk OAuth'
      );

      return created;
    }),

  /**
   * Get current authenticated user's database record
   *
   * Requires Clerk authentication. Returns the user record
   * for the currently authenticated Clerk user.
   */
  me: protectedProcedure
    .query(async ({ ctx }): Promise<User | null> => {
      const db = getDbClient();
      const clerkId = ctx.auth.userId;

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.identityProvider, 'clerk'),
            eq(users.identitySub, clerkId)
          )
        )
        .limit(1);

      return user || null;
    }),
});
