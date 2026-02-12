param(
    [string]$Symbol = "BTC-USD",
    [string]$Timeframe = "15m",
    [switch]$Discord,
    [int]$Bars = 60
)

$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:DISCORD_LIVERMORE_BOT = [Environment]::GetEnvironmentVariable('DISCORD_LIVERMORE_BOT', 'User')
$env:NODE_ENV = 'development'
$env:CHART_SYMBOL = $Symbol
$env:CHART_TIMEFRAME = $Timeframe
$env:CHART_DISCORD = if ($Discord) { 'true' } else { 'false' }
$env:CHART_BARS = $Bars

pnpm exec tsx scripts/generate-chart.ts
