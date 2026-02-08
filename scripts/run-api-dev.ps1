# Load environment variables from Windows User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')
$env:DISCORD_LIVERMORE_BOT = [Environment]::GetEnvironmentVariable('DISCORD_LIVERMORE_BOT', 'User')

# Clerk authentication
$env:CLERK_PUBLISHABLE_KEY = [Environment]::GetEnvironmentVariable('CLERK_PUBLISHABLE_KEY', 'User')
$env:CLERK_SECRET_KEY = [Environment]::GetEnvironmentVariable('CLERK_SECRET_KEY', 'User')
$env:CLERK_WEBHOOK_SIGNING_SECRET = [Environment]::GetEnvironmentVariable('CLERK_WEBHOOK_SIGNING_SECRET', 'User')

# Override API port to avoid conflicts with PerseusWeb (which uses 3000-3002)
$env:API_PORT = '4000'

# Set NODE_ENV (Zod schema expects 'development', not 'dev')
$env:NODE_ENV = 'development'

# Debug: show what we loaded
Write-Host "Loaded DATABASE_HOST: $($env:DATABASE_HOST)"
Write-Host "Loaded DATABASE_PORT: $($env:DATABASE_PORT)"
Write-Host "Loaded DATABASE_LIVERMORE_USERNAME: $($env:DATABASE_LIVERMORE_USERNAME)"
Write-Host "Loaded LIVERMORE_DATABASE_NAME: $($env:LIVERMORE_DATABASE_NAME)"
Write-Host "Loaded LIVERMORE_REDIS_URL: $(if ($env:LIVERMORE_REDIS_URL) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded DISCORD_LIVERMORE_BOT: $(if ($env:DISCORD_LIVERMORE_BOT) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded Coinbase_ApiKeyId: $(if ($env:Coinbase_ApiKeyId) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded Coinbase_EcPrivateKeyPem: $(if ($env:Coinbase_EcPrivateKeyPem) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded CLERK_PUBLISHABLE_KEY: $(if ($env:CLERK_PUBLISHABLE_KEY) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded CLERK_SECRET_KEY: $(if ($env:CLERK_SECRET_KEY) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded CLERK_WEBHOOK_SIGNING_SECRET: $(if ($env:CLERK_WEBHOOK_SIGNING_SECRET) { 'set' } else { 'NOT SET' })"

# Change to project directory and run dev server
Set-Location (Split-Path -Path $PSScriptRoot -Parent)

# Uses turbo which builds dependencies first (cached if unchanged)
pnpm dev:api
