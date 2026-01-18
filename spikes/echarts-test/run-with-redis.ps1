# Run ECharts spike with Redis data
# Loads environment variables and runs the chart generator

param(
    [string]$Symbol = "BTC-USD",
    [string]$Timeframe = "1m",
    [int]$Bars = 25
)

# Load environment variables from Windows User environment
$env:REDIS_HOST = [Environment]::GetEnvironmentVariable('REDIS_HOST', 'User')
$env:REDIS_PORT = [Environment]::GetEnvironmentVariable('REDIS_PORT', 'User')
$env:REDIS_PASSWORD = [Environment]::GetEnvironmentVariable('REDIS_PASSWORD', 'User')

# Database environment variables
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

# Default Redis settings if not set
if (-not $env:REDIS_HOST) { $env:REDIS_HOST = "localhost" }
if (-not $env:REDIS_PORT) { $env:REDIS_PORT = "6379" }

# Default database settings if not set
if (-not $env:DATABASE_HOST) { $env:DATABASE_HOST = "localhost" }
if (-not $env:DATABASE_PORT) { $env:DATABASE_PORT = "5432" }
if (-not $env:LIVERMORE_DATABASE_NAME) { $env:LIVERMORE_DATABASE_NAME = "livermore" }

Write-Host "Redis: $($env:REDIS_HOST):$($env:REDIS_PORT)" -ForegroundColor Cyan
Write-Host "Database: $($env:DATABASE_HOST):$($env:DATABASE_PORT)/$($env:LIVERMORE_DATABASE_NAME)" -ForegroundColor Cyan
Write-Host "Generating chart for $Symbol ($Timeframe, $Bars bars)..." -ForegroundColor Yellow

# Run the Node.js script
node "$PSScriptRoot\generate-chart-redis.js" $Symbol $Timeframe $Bars

if ($LASTEXITCODE -eq 0) {
    $outputFile = "$PSScriptRoot\macdv-chart-$($Symbol -replace '/', '-')-$Timeframe.png"
    Write-Host "Chart saved to: $outputFile" -ForegroundColor Green
} else {
    Write-Host "Chart generation failed!" -ForegroundColor Red
}
