import {
  EnvConfigSchema,
  PwHostEnvConfigSchema,
  resolveMode,
  type EnvConfig,
  type PwHostEnvConfig,
  type RuntimeMode,
} from '@livermore/schemas';
import { logger } from '../logger/logger';

/**
 * Validate environment variables on application startup.
 *
 * When called with no mode argument, auto-detects from LIVERMORE_MODE env var.
 * This ensures callers like getRedisClient() and getDbClient() that call
 * validateEnv() internally use the correct schema in pw-host mode.
 *
 * @param mode - Runtime mode determining which schema to use (auto-detected if omitted)
 * @returns Validated environment configuration
 * @throws Exits process if validation fails
 */
export function validateEnv(mode?: 'exchange'): EnvConfig;
export function validateEnv(mode: 'pw-host'): PwHostEnvConfig;
export function validateEnv(mode?: RuntimeMode): EnvConfig | PwHostEnvConfig {
  try {
    const effectiveMode = mode ?? resolveMode();
    const schema = effectiveMode === 'pw-host' ? PwHostEnvConfigSchema : EnvConfigSchema;
    const config = schema.parse(process.env);
    logger.info({ mode: effectiveMode }, 'Environment variables validated');
    return config;
  } catch (error) {
    logger.error('Invalid environment variables:');
    logger.error({ err: error instanceof Error ? error.message : String(error) });
    logger.error(
      'Please ensure all required environment variables are set. See documentation for details.'
    );
    process.exit(1);
  }
}

/**
 * Check if a specific environment variable is set
 *
 * @param key - Environment variable name
 * @returns True if the variable is set and not empty
 */
export function hasEnvVar(key: string): boolean {
  const value = process.env[key];
  return value !== undefined && value !== '';
}

/**
 * Get an environment variable with a default value
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Environment variable value or default
 */
export function getEnvVar(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Get an environment variable as a number
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed number or default
 */
export function getEnvVarAsNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;

  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get an environment variable as a boolean
 *
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns Boolean value ('true' => true, anything else => false)
 */
export function getEnvVarAsBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;

  return value.toLowerCase() === 'true';
}
