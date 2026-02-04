#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start both API and Admin dev servers (no git pull)

.DESCRIPTION
    1. Starts API dev server in a new window
    2. Waits for API to be ready
    3. Starts Admin dev server in a new window

    Use pull-and-run.ps1 if you need to pull latest code first.

.EXAMPLE
    .\run.ps1
#>

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Path $MyInvocation.MyCommand.Path -Parent

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Livermore - Run Dev Servers" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check environment variables
Write-Host "[1/4] Checking environment variables..." -ForegroundColor Yellow
& "$projectRoot\check-env-vars.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Please set the missing environment variables and try again." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 2: Start API in new window
Write-Host "[2/4] Starting API server..." -ForegroundColor Yellow
$apiScript = Join-Path $projectRoot "scripts\run-api-dev.ps1"
Start-Process pwsh -ArgumentList "-NoExit", "-File", $apiScript -WorkingDirectory $projectRoot
Write-Host "      API starting in new window." -ForegroundColor Green
Write-Host ""

# Step 3: Wait for API to be ready
Write-Host "[3/4] Waiting for API to be ready..." -ForegroundColor Yellow
$apiUrl = "http://localhost:4000/health"
$maxAttempts = 30
$attempt = 0

while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($response.status -eq "ok") {
            Write-Host "      API is ready!" -ForegroundColor Green
            break
        }
    }
    catch {
        Write-Host "      Waiting... ($attempt/$maxAttempts)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

if ($attempt -ge $maxAttempts) {
    Write-Host "      API did not start in time. Starting Admin anyway..." -ForegroundColor Yellow
}

# Step 4: Start Admin
Write-Host ""
Write-Host "[4/4] Starting Admin server..." -ForegroundColor Yellow
$adminScript = Join-Path $projectRoot "scripts\run-admin-dev.ps1"
Start-Process pwsh -ArgumentList "-NoExit", "-File", $adminScript -WorkingDirectory $projectRoot
Write-Host "      Admin starting in new window." -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Both servers starting!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  API:   http://localhost:4000" -ForegroundColor Cyan
Write-Host "  Admin: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
