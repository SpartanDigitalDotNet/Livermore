import { verifyWebhook, type WebhookEvent } from '@clerk/fastify/webhooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDbClient, users } from '@livermore/database';
import { logger } from '@livermore/utils';
import { eq, and } from 'drizzle-orm';

// Clerk User data structure from webhook payload
interface ClerkUserData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: Array<{
    id: string;
    email_address: string;
  }>;
  primary_email_address_id: string | null;
  image_url: string | null;
  last_sign_in_at: number | null;  // Milliseconds since epoch
}

/**
 * Extract primary email from Clerk user data
 */
function getPrimaryEmail(userData: ClerkUserData): string {
  if (!userData.primary_email_address_id || !userData.email_addresses.length) {
    throw new Error('User has no primary email address');
  }

  const primary = userData.email_addresses.find(
    (e) => e.id === userData.primary_email_address_id
  );

  if (!primary) {
    // Fallback to first email
    return userData.email_addresses[0].email_address;
  }

  return primary.email_address;
}

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
 * Sync Clerk user to PostgreSQL users table
 * Uses check-then-update pattern for idempotency
 */
async function syncUser(userData: ClerkUserData): Promise<void> {
  const db = getDbClient();
  const email = getPrimaryEmail(userData);
  const displayName = [userData.first_name, userData.last_name]
    .filter(Boolean)
    .join(' ') || null;

  // Check if user exists by Clerk ID
  const existing = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(
      and(
        eq(users.identityProvider, 'clerk'),
        eq(users.identitySub, userData.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // UPDATE existing user
    await db
      .update(users)
      .set({
        email,
        displayName,
        identityPictureUrl: userData.image_url,
        lastLoginAt: userData.last_sign_in_at
          ? new Date(userData.last_sign_in_at).toISOString()
          : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, existing[0].id));

    logger.info({ clerkId: userData.id, userId: existing[0].id }, 'Updated user from Clerk webhook');
  } else {
    // INSERT new user
    await db.insert(users).values({
      email,
      username: generateUsername(email),
      identityProvider: 'clerk',
      identitySub: userData.id,
      displayName,
      identityPictureUrl: userData.image_url,
      role: 'user',
      lastLoginAt: userData.last_sign_in_at
        ? new Date(userData.last_sign_in_at).toISOString()
        : null,
    });

    logger.info({ clerkId: userData.id, email }, 'Created user from Clerk webhook');
  }
}

/**
 * Clerk webhook handler
 * Processes user.created and user.updated events
 */
export async function clerkWebhookHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // verifyWebhook validates svix signature using CLERK_WEBHOOK_SIGNING_SECRET
    const evt = await verifyWebhook(request) as WebhookEvent;

    logger.debug({ eventType: evt.type }, 'Received Clerk webhook');

    switch (evt.type) {
      case 'user.created':
      case 'user.updated':
        await syncUser(evt.data as ClerkUserData);
        break;
      default:
        logger.debug({ eventType: evt.type }, 'Ignoring unhandled webhook event type');
    }

    reply.code(200).send({ received: true });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Clerk webhook error');
    reply.code(400).send({ error: 'Webhook verification failed' });
  }
}
