# Subscription Test Harness - PowerShell Wrapper
#
# Usage:
#   .\scripts\test-subscription-harness.ps1
#   .\scripts\test-subscription-harness.ps1 -Exchange binance_us
#   .\scripts\test-subscription-harness.ps1 -Exchange binance

param(
    [string]$Exchange = "binance_us"
)

Write-Host ""
Write-Host "=== Livermore Subscription Test Harness ===" -ForegroundColor Cyan
Write-Host ""

Set-Location 'C:\Dev\claude\Livermore'

# Run the TypeScript test harness
npx tsx scripts/test-subscription-harness.ts $Exchange

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "Test harness completed successfully" -ForegroundColor Green
} else {
    Write-Host "Test harness failed with exit code $exitCode" -ForegroundColor Red
}

exit $exitCode
