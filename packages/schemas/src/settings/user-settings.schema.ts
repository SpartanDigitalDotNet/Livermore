import { z } from 'zod';

/**
 * Exchange configuration schema
 * Stores environment variable names for exchange credentials (not actual secrets)
 */
export const ExchangeConfigSchema = z.object({
  /** Whether this exchange is enabled */
  enabled: z.boolean(),
  /** Environment variable name containing the API key */
  ApiKeyEnvironmentVariableName: z.string(),
  /** Environment variable name containing the API secret */
  SecretEnvironmentVariableName: z.string(),
  /** Environment variable name containing the password (optional, some exchanges require) */
  PasswordEnvironmentVariableName: z.string().optional(),
});

/**
 * Perseus profile schema
 * User's trading profile configuration
 */
export const PerseusProfileSchema = z.object({
  /** Public display name for the profile */
  public_name: z.string().optional(),
  /** Profile description */
  description: z.string().optional(),
  /** Primary exchange for trading (e.g., 'coinbase') */
  primary_exchange: z.string(),
  /** Trading mode: paper (simulated) or live (real money) */
  trading_mode: z.enum(['paper', 'live']),
  /** Base currency for calculations (default: USD) */
  currency: z.string().default('USD'),
  /** User timezone for display (default: UTC) */
  timezone: z.string().default('UTC'),
  /** User locale for formatting (default: en-US) */
  locale: z.string().default('en-US'),
});

/**
 * Logging configuration schema
 */
export const LoggingConfigSchema = z.object({
  /** Directory for data files */
  data_directory: z.string().optional(),
  /** Directory for log files */
  log_directory: z.string().optional(),
  /** Logging verbosity level */
  verbosity_level: z.string().default('error'),
});

/**
 * Livermore runtime configuration schema
 * Controls how the Livermore service runs for this user
 */
export const LivermoreRuntimeSchema = z.object({
  /** Whether to auto-start data collection on service startup */
  auto_start: z.boolean().default(false),
  /** Logging configuration */
  logging: LoggingConfigSchema.optional(),
});

/**
 * User settings schema
 * Complete settings structure stored as JSONB in users table
 * Includes version field for schema evolution
 */
export const UserSettingsSchema = z.object({
  /** Schema version for migrations (always set, default 1) */
  version: z.number().default(1),
  /** Clerk identity subject (optional, for cross-reference) */
  sub: z.string().optional(),
  /** User's trading profile */
  perseus_profile: PerseusProfileSchema.optional(),
  /** Livermore service runtime configuration */
  livermore_runtime: LivermoreRuntimeSchema.optional(),
  /** Exchange configurations by exchange name */
  exchanges: z.record(z.string(), ExchangeConfigSchema).optional(),
  /** Symbols the user is tracking */
  symbols: z.array(z.string()).optional(),
  /** Timestamp of last scanner symbols update */
  scanner_symbols_last_update: z.string().optional(),
  /** Exchange used for symbol scanning */
  scanner_exchange: z.string().optional(),
});

/**
 * User settings patch schema
 * Used for partial updates via jsonb_set
 */
export const UserSettingsPatchSchema = z.object({
  /** JSON path array to the field to update (e.g., ['perseus_profile', 'timezone']) */
  path: z.array(z.string()).min(1),
  /** New value to set at the path */
  value: z.unknown(),
});

// Export inferred TypeScript types
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type PerseusProfile = z.infer<typeof PerseusProfileSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type LivermoreRuntime = z.infer<typeof LivermoreRuntimeSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UserSettingsPatch = z.infer<typeof UserSettingsPatchSchema>;
