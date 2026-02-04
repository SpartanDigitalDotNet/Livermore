#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Pull latest code and start both API and Admin dev servers

.DESCRIPTION
    1. Pulls latest from current branch
    2. Runs pnpm install (which triggers turbo build via postinstall)
    3. Starts API dev server in a new window
    4. Waits for API to be ready
    5. Starts Admin dev server in a new window

.EXAMPLE
    .\pull-and-run.ps1
#>

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Path $MyInvocation.MyCommand.Path -Parent

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Livermore - Pull and Run" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check environment variables
Write-Host "[1/6] Checking environment variables..." -ForegroundColor Yellow
& "$projectRoot\check-env-vars.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Please set the missing environment variables and try again." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Step 2: Git pull
Write-Host "[2/6] Pulling latest from GitHub..." -ForegroundColor Yellow
Set-Location $projectRoot
git pull
if ($LASTEXITCODE -ne 0) {
    Write-Host "Git pull failed!" -ForegroundColor Red
    exit 1
}
Write-Host "      Done." -ForegroundColor Green
Write-Host ""

# Step 3: Install dependencies (triggers build via postinstall)
Write-Host "[3/6] Installing dependencies and building..." -ForegroundColor Yellow
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "pnpm install failed!" -ForegroundColor Red
    exit 1
}
Write-Host "      Done." -ForegroundColor Green
Write-Host ""

# Step 4: Start API in new window
Write-Host "[4/6] Starting API server..." -ForegroundColor Yellow
$apiScript = Join-Path $projectRoot "scripts\run-api-dev.ps1"
Start-Process pwsh -ArgumentList "-NoExit", "-File", $apiScript -WorkingDirectory $projectRoot
Write-Host "      API starting in new window." -ForegroundColor Green
Write-Host ""

# Step 5: Wait for API to be ready
Write-Host "[5/6] Waiting for API to be ready..." -ForegroundColor Yellow
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

# Step 6: Start Admin
Write-Host ""
Write-Host "[6/6] Starting Admin server..." -ForegroundColor Yellow
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
