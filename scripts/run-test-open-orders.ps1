# Load environment variables from Windows User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')
$env:REDIS_URL = [Environment]::GetEnvironmentVariable('REDIS_URL', 'User')
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')
$env:DISCORD_LIVERMORE_BOT = [Environment]::GetEnvironmentVariable('DISCORD_LIVERMORE_BOT', 'User')

Write-Host "Coinbase_ApiKeyId: $(if ($env:Coinbase_ApiKeyId) { 'set' } else { 'NOT SET' })"
Write-Host "REDIS_URL: $($env:REDIS_URL)"
Write-Host ""

Set-Location 'C:\Dev\claude\Livermore'
npx tsx tests/manual/test-open-orders.ts
