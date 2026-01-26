# Apply Atlas schema to Azure PostgreSQL Sandbox
# Requires: PG_SANDBOX_HOST, PG_SANDBOX_USER, PG_SANDBOX_PASSWORD in Windows User environment

$ErrorActionPreference = "Stop"

Write-Host "=== Deploying Schema to Sandbox ===" -ForegroundColor Cyan

# Load environment variables from Windows User environment
$host_ = [Environment]::GetEnvironmentVariable('PG_SANDBOX_HOST', 'User')
$user = [Environment]::GetEnvironmentVariable('PG_SANDBOX_USER', 'User')
$password = [Environment]::GetEnvironmentVariable('PG_SANDBOX_PASSWORD', 'User')

# Validate all required variables are present
$missing = @()
if (-not $host_) { $missing += "PG_SANDBOX_HOST" }
if (-not $user) { $missing += "PG_SANDBOX_USER" }
if (-not $password) { $missing += "PG_SANDBOX_PASSWORD" }

if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing required environment variables:" -ForegroundColor Red
    foreach ($var in $missing) {
        Write-Host "  - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Set these in Windows User environment:" -ForegroundColor Yellow
    Write-Host '  [Environment]::SetEnvironmentVariable("PG_SANDBOX_HOST", "<value>", "User")' -ForegroundColor Yellow
    exit 1
}

# Build connection URL with sslmode=require for Azure
$url = "postgresql://${user}:${password}@${host_}:5432/livermore?sslmode=require"

# Display target with masked password
Write-Host "Target: postgresql://${user}:****@${host_}:5432/livermore" -ForegroundColor White
Write-Host ""

# Set DATABASE_URL and run Atlas
Write-Host "Running Atlas schema apply..." -ForegroundColor White
$env:DATABASE_URL = $url

$originalLocation = Get-Location
try {
    Set-Location "$PSScriptRoot\..\packages\database"
    & "$PSScriptRoot\..\atlas.exe" schema apply --env sandbox --auto-approve

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "=== Schema deployment FAILED ===" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "=== Schema deployed successfully ===" -ForegroundColor Green
} finally {
    Set-Location $originalLocation
}
