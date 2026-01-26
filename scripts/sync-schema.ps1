# Sync Schema: Atlas Apply + Drizzle Pull
# Combines schema deployment and TypeScript type regeneration in one command.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Local Schema Sync ===" -ForegroundColor Cyan
Write-Host ""

# Load environment variables from Windows User environment
$host_ = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$port = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$username = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$password = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$database = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

# Validate all required variables present
$missing = @()
if (-not $host_) { $missing += "DATABASE_HOST" }
if (-not $port) { $missing += "DATABASE_PORT" }
if (-not $username) { $missing += "DATABASE_LIVERMORE_USERNAME" }
if (-not $password) { $missing += "DATABASE_LIVERMORE_PASSWORD" }
if (-not $database) { $missing += "LIVERMORE_DATABASE_NAME" }

if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing required environment variables:" -ForegroundColor Red
    foreach ($var in $missing) {
        Write-Host "  - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Set these in Windows User environment variables." -ForegroundColor Yellow
    exit 1
}

# Build connection URL
$url = "postgresql://${username}:${password}@${host_}:${port}/${database}?sslmode=disable&search_path=public"

Write-Host "=== Step 1: Applying Schema via Atlas ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: postgresql://${username}:****@${host_}:${port}/${database}"
Write-Host ""

# Set DATABASE_URL for Atlas
$env:DATABASE_URL = $url

# Navigate to packages/database
$originalLocation = Get-Location
Set-Location "$PSScriptRoot\..\packages\database"

try {
    # Run Atlas apply
    & "$PSScriptRoot\..\atlas.exe" schema apply --env local --auto-approve

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Atlas apply FAILED (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "Atlas apply completed" -ForegroundColor Green
    Write-Host ""

    Write-Host "=== Step 2: Regenerating Drizzle Types ===" -ForegroundColor Cyan
    Write-Host ""

    # Run Drizzle pull
    & pnpm drizzle-kit pull

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Drizzle pull FAILED (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "Drizzle types regenerated" -ForegroundColor Green
    Write-Host ""

    Write-Host "=== Schema Sync Complete ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "- Schema applied to local PostgreSQL"
    Write-Host "- Drizzle types regenerated in packages/database/drizzle"
    Write-Host ""
}
finally {
    # Return to original location
    Set-Location $originalLocation
}
