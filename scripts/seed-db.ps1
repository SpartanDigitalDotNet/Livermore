#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Seed the database with test user and exchange connection

.DESCRIPTION
    Loads environment variables from User scope and runs the seed script.

.EXAMPLE
    .\scripts\seed-db.ps1
#>

Write-Host "Loading environment variables from User scope..." -ForegroundColor Cyan

# Load database connection vars from User environment
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

# Load Coinbase credential env var names (we validate they exist, but store the NAMES not values)
$env:Coinbase_ApiKeyId = [Environment]::GetEnvironmentVariable('Coinbase_ApiKeyId', 'User')
$env:Coinbase_EcPrivateKeyPem = [Environment]::GetEnvironmentVariable('Coinbase_EcPrivateKeyPem', 'User')

Write-Host "   Database: $env:DATABASE_HOST`:$env:DATABASE_PORT/$env:LIVERMORE_DATABASE_NAME" -ForegroundColor Gray
Write-Host ""

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Run the seed
pnpm exec tsx packages/database/src/seed.ts

exit $LASTEXITCODE
