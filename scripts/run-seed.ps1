# Load environment variables from Windows User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')

# Debug: show what we loaded
Write-Host "DATABASE_HOST: $($env:DATABASE_HOST)"
Write-Host "DATABASE_PORT: $($env:DATABASE_PORT)"
Write-Host "DATABASE_LIVERMORE_USERNAME: $($env:DATABASE_LIVERMORE_USERNAME)"
Write-Host "LIVERMORE_DATABASE_NAME: $($env:LIVERMORE_DATABASE_NAME)"
Write-Host "Coinbase_ApiKeyId: $(if ($env:Coinbase_ApiKeyId) { 'set' } else { 'NOT SET' })"

# Change to project directory and run seed
Set-Location 'C:\Dev\claude\Livermore'
pnpm --filter @livermore/database seed
