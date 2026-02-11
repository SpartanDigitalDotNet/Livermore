#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Refresh exchange symbols from CoinGecko + exchange product APIs

.DESCRIPTION
    Loads environment variables from User scope and runs the refresh script.
    By default, refreshes all non-geo-restricted exchanges in parallel.
    Use -ExchangeId to refresh a specific exchange (bypasses geo-restriction filter).

.PARAMETER ExchangeId
    Optional. The exchange ID to refresh. 0 = all non-geo-restricted exchanges.

.EXAMPLE
    # Refresh all non-geo-restricted exchanges
    .\scripts\JOB-refresh-exchange-symbols.ps1

.EXAMPLE
    # Refresh only Binance.com (exchange_id = 2) — for Kaia
    .\scripts\JOB-refresh-exchange-symbols.ps1 -ExchangeId 2
#>
param(
    [int]$ExchangeId = 0
)

Write-Host "Loading environment variables from User scope..." -ForegroundColor Cyan

# Load database connection vars from User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')
$env:NODE_ENV = [Environment]::GetEnvironmentVariable('NODE_ENV', 'User')

Write-Host "   Database: $env:DATABASE_HOST`:$env:DATABASE_PORT/$env:LIVERMORE_DATABASE_NAME" -ForegroundColor Gray
Write-Host ""

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Build args
$tsArgs = @()
if ($ExchangeId -gt 0) {
    $tsArgs += "--exchange-id"
    $tsArgs += "$ExchangeId"
    Write-Host "Refreshing exchange_id=$ExchangeId only" -ForegroundColor Yellow
} else {
    Write-Host "Refreshing all non-geo-restricted exchanges" -ForegroundColor Green
}
Write-Host ""

# Run the refresh script
npx tsx scripts/refresh-exchange-symbols.ts @tsArgs

exit $LASTEXITCODE
