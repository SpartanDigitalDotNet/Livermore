# Load environment variables from Windows User environment
# Maps standard env var names to Vite-prefixed names

# Clerk - map CLERK_PUBLISHABLE_KEY to VITE_CLERK_PUBLISHABLE_KEY
$env:VITE_CLERK_PUBLISHABLE_KEY = [Environment]::GetEnvironmentVariable('CLERK_PUBLISHABLE_KEY', 'User')

# API URL - Livermore API runs on port 4000
$env:VITE_API_URL = 'http://localhost:4000/trpc'

# Debug: show what we loaded
Write-Host "Loaded VITE_CLERK_PUBLISHABLE_KEY: $(if ($env:VITE_CLERK_PUBLISHABLE_KEY) { 'set' } else { 'NOT SET' })"
Write-Host "Loaded VITE_API_URL: $($env:VITE_API_URL)"

# Validate required variables
if (-not $env:VITE_CLERK_PUBLISHABLE_KEY) {
    Write-Host ""
    Write-Host "ERROR: CLERK_PUBLISHABLE_KEY not found in Windows User environment." -ForegroundColor Red
    Write-Host "Set it with:" -ForegroundColor Yellow
    Write-Host "  [Environment]::SetEnvironmentVariable('CLERK_PUBLISHABLE_KEY', 'pk_test_...', 'User')" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

# Change to project directory and run dev server
Set-Location (Split-Path -Path $PSScriptRoot -Parent)

# Uses turbo which builds dependencies first (cached if unchanged)
pnpm dev:admin
