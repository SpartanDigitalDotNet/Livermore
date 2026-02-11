import type { Config } from 'drizzle-kit';

// Build connection string from individual environment variables
const connectionString = `postgresql://${process.env.DATABASE_LIVERMORE_USERNAME}:${process.env.DATABASE_LIVERMORE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.LIVERMORE_DATABASE_NAME}?sslmode=verify-full`;

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
    ssl: true, // SSL required for Azure PostgreSQL - no exceptions
  },
} satisfies Config;
