#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Load Coinbase positions into the Livermore database (sandbox server)

.DESCRIPTION
    Fetches current positions from your Coinbase account and loads them into
    the public.positions table with user_id=3 and exchange_id=1.
    
    This script loads environment variables and executes the TypeScript loader.

.EXAMPLE
    .\scripts\load-positions-into-db.ps1
    
.NOTES
    Requires:
    - User environment variables for database connection
    - User environment variables for Coinbase API credentials
    - Target user_id=3 and exchange_id=1 must exist in database
#>

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Livermore Position Loader - Sandbox Database" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from Windows User environment
Write-Host "🔧 Loading environment variables..." -ForegroundColor Yellow

$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')

# Validate required environment variables
$requiredVars = @(
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_LIVERMORE_USERNAME',
    'DATABASE_LIVERMORE_PASSWORD',
    'LIVERMORE_DATABASE_NAME',
    'Coinbase_ApiKeyId',
    'Coinbase_EcPrivateKeyPem'
)

$missingVars = @()
foreach ($var in $requiredVars) {
    if ([string]::IsNullOrWhiteSpace((Get-Item "Env:$var" -ErrorAction SilentlyContinue).Value)) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host ""
    Write-Host "❌ Missing required environment variables:" -ForegroundColor Red
    foreach ($var in $missingVars) {
        Write-Host "   - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please set these variables in User environment and try again." -ForegroundColor Yellow
    exit 1
}

# Display connection info (without sensitive data)
Write-Host ""
Write-Host "📡 Connection Configuration:" -ForegroundColor Green
Write-Host "   Database Host: $($env:DATABASE_HOST)"
Write-Host "   Database Port: $($env:DATABASE_PORT)"
Write-Host "   Database Name: $($env:LIVERMORE_DATABASE_NAME)"
Write-Host "   Database User: $($env:DATABASE_LIVERMORE_USERNAME)"
Write-Host "   Coinbase Key:  $(if ($env:Coinbase_ApiKeyId) { 'Set ✓' } else { 'NOT SET ✗' })"
Write-Host ""

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

Write-Host "📂 Project Root: $projectRoot" -ForegroundColor Green
Write-Host ""

# Run the TypeScript loader using tsx
Write-Host "🚀 Executing position loader..." -ForegroundColor Cyan
Write-Host ""

& pnpm exec tsx scripts/load-positions-into-db.ts

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Position Load Completed Successfully!" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
} else {
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "  Position Load Failed (Exit Code: $exitCode)" -ForegroundColor Red
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Red
}

exit $exitCode
