#!/bin/bash

# Development startup script for Livermore API
# Reads environment variables from your shell and starts the server

# Check if required environment variables are set
required_vars=(
  "DATABASE_LIVERMORE_USERNAME"
  "DATABASE_LIVERMORE_PASSWORD"
  "LIVERMORE_DATABASE_NAME"
  "Coinbase_ApiKeyId"
  "Coinbase_EcPrivateKeyPem"
  "DISCORD_LIVERMORE_BOT"
)

missing_vars=()
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    missing_vars+=("$var")
  fi
done

if [ ${#missing_vars[@]} -gt 0 ]; then
  echo "❌ Missing required environment variables:"
  printf '   - %s\n' "${missing_vars[@]}"
  echo ""
  echo "Please set these environment variables before running this script."
  exit 1
fi

echo "🚀 Starting Livermore API server..."
echo "Environment variables validated ✓"

# Set defaults for optional variables
export NODE_ENV="${NODE_ENV:-development}"
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-3000}"
export DATABASE_HOST="${DATABASE_HOST:-localhost}"
export DATABASE_PORT="${DATABASE_PORT:-5432}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6400}"

# Start the server
pnpm dev
