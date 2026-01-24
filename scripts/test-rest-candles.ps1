# Load environment variables from Windows User environment
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')

Set-Location 'C:\Dev\claude\Livermore'
pnpm tsx scripts/test-rest-candles.ts
