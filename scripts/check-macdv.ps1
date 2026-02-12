param([string]$Symbol = "BTC-USD")
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:NODE_ENV = 'development'
$env:CHECK_SYMBOL = $Symbol
pnpm exec tsx scripts/check-macdv.ts
