#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test Redis Pub/Sub on Azure Redis

.DESCRIPTION
    Tests end-to-end publish/subscribe functionality.
    Requires LIVERMORE_REDIS_URL environment variable to be set.

.EXAMPLE
    .\scripts\test-redis-pubsub.ps1
#>

Write-Host "Running Redis Pub/Sub test..." -ForegroundColor Cyan
Write-Host ""

# Load LIVERMORE_REDIS_URL from User environment
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')

if ([string]::IsNullOrWhiteSpace($env:LIVERMORE_REDIS_URL)) {
    Write-Host "❌ LIVERMORE_REDIS_URL environment variable not set" -ForegroundColor Red
    Write-Host "   Set it in User environment variables and try again." -ForegroundColor Yellow
    exit 1
}

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Run the TypeScript test
& pnpm exec tsx scripts/test-redis-pubsub.ts

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "Test completed successfully!" -ForegroundColor Green
} else {
    Write-Host "Test failed!" -ForegroundColor Red
}

exit $exitCode
