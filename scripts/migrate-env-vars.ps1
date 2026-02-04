#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Run migration to rename api credential columns to env var name columns

.DESCRIPTION
    Loads environment variables from User scope and runs the migration script.

.EXAMPLE
    .\scripts\migrate-env-vars.ps1
#>

Write-Host "Loading environment variables from User scope..." -ForegroundColor Cyan

# Load database connection vars from User environment
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

# Validate
$missing = @()
if ([string]::IsNullOrWhiteSpace($env:DATABASE_LIVERMORE_USERNAME)) { $missing += 'DATABASE_LIVERMORE_USERNAME' }
if ([string]::IsNullOrWhiteSpace($env:DATABASE_LIVERMORE_PASSWORD)) { $missing += 'DATABASE_LIVERMORE_PASSWORD' }
if ([string]::IsNullOrWhiteSpace($env:DATABASE_HOST)) { $missing += 'DATABASE_HOST' }
if ([string]::IsNullOrWhiteSpace($env:DATABASE_PORT)) { $missing += 'DATABASE_PORT' }
if ([string]::IsNullOrWhiteSpace($env:LIVERMORE_DATABASE_NAME)) { $missing += 'LIVERMORE_DATABASE_NAME' }

if ($missing.Count -gt 0) {
    Write-Host "Missing environment variables: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "   Database: $env:DATABASE_HOST`:$env:DATABASE_PORT/$env:LIVERMORE_DATABASE_NAME" -ForegroundColor Gray
Write-Host ""

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Run the migration
pnpm exec tsx packages/database/src/migrate-env-vars.ts

exit $LASTEXITCODE
