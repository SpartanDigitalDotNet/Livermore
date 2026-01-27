/**
 * User role definitions for authorization
 *
 * Roles (from requirements):
 * - user: Default role for all users
 * - admin: Full administrative access
 * - subscriber_basic: Basic subscription tier
 * - subscriber_pro: Professional subscription tier
 */
export const USER_ROLES = ['user', 'admin', 'subscriber_basic', 'subscriber_pro'] as const;

export type UserRole = typeof USER_ROLES[number];

/**
 * Type guard to validate role strings
 */
export function isValidRole(role: string): role is UserRole {
  return USER_ROLES.indexOf(role as UserRole) !== -1;
}

/**
 * Assert role is valid, throw if not
 */
export function assertRole(role: string): asserts role is UserRole {
  if (!isValidRole(role)) {
    throw new Error(`Invalid role: ${role}. Valid roles: ${USER_ROLES.join(', ')}`);
  }
}
