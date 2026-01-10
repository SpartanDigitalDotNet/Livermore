-- PostgreSQL initialization script for Livermore
-- This script runs when the database is first created

-- Ensure the database exists
\c livermore;

-- Enable extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create a comment for documentation
COMMENT ON DATABASE livermore IS 'Livermore crypto trading monitoring system database';

-- Set timezone to UTC
SET TIMEZONE='UTC';

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'Livermore database initialized successfully';
END $$;
