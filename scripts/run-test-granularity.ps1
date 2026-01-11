# Load environment variables from Windows User environment
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')

Write-Host "Coinbase_ApiKeyId: $(if ($env:Coinbase_ApiKeyId) { 'set' } else { 'NOT SET' })"
Write-Host "Coinbase_EcPrivateKeyPem: $(if ($env:Coinbase_EcPrivateKeyPem) { 'set' } else { 'NOT SET' })"
Write-Host ""

Set-Location 'C:\Dev\claude\Livermore'
npx tsx tests/manual/test-granularity.ts
