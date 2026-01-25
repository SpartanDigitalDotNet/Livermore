# Check Livermore logs for errors and boundary fetch status
# Usage: .\scripts\check-logs.ps1

$logDir = ".\logs"
$today = Get-Date -Format "yyyy-MM-dd"
$logFile = "$logDir\livermore-$today.log"

if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile" -ForegroundColor Red
    exit 1
}

Write-Host "=== Livermore Log Check ===" -ForegroundColor Cyan
Write-Host "Log file: $logFile"
Write-Host ""

# Check for 429 errors (actual HTTP 429, not prices containing 429)
Write-Host "--- 429 Rate Limit Errors ---" -ForegroundColor Yellow
$errors429 = Select-String -Path $logFile -Pattern '"status":429|"statusCode":429|429 Too Many|rate.limit|Too Many Requests'
if ($errors429) {
    Write-Host "FOUND 429 ERRORS:" -ForegroundColor Red
    $errors429 | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "None found" -ForegroundColor Green
}
Write-Host ""

# Check for rate limit mentions
Write-Host "--- Rate Limit Mentions ---" -ForegroundColor Yellow
$rateLimit = Select-String -Path $logFile -Pattern "rate.?limit" -AllMatches
if ($rateLimit) {
    Write-Host "FOUND RATE LIMIT MENTIONS:" -ForegroundColor Red
    $rateLimit | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "None found" -ForegroundColor Green
}
Write-Host ""

# Check for errors (excluding "errors":0)
Write-Host "--- Error Messages ---" -ForegroundColor Yellow
$errors = Select-String -Path $logFile -Pattern '"level":"ERROR"|"level":"FATAL"'
if ($errors) {
    Write-Host "FOUND ERRORS:" -ForegroundColor Red
    $errors | Select-Object -Last 20 | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "None found" -ForegroundColor Green
}
Write-Host ""

# Show boundary fetch results
Write-Host "--- Boundary Fetches (last 10) ---" -ForegroundColor Yellow
$boundaries = Select-String -Path $logFile -Pattern "boundary_fetch_complete"
if ($boundaries) {
    $boundaries | Select-Object -Last 10 | ForEach-Object {
        $json = $_.Line | ConvertFrom-Json
        $time = $json.timestamp
        $completed = $json.completed
        $total = $json.total
        $errors = $json.errors
        $elapsed = $json.elapsedSec

        $color = if ($errors -eq 0) { "Green" } else { "Red" }
        Write-Host "$time - $completed/$total in ${elapsed}s (errors: $errors)" -ForegroundColor $color
    }
} else {
    Write-Host "No boundary fetches found" -ForegroundColor Gray
}
Write-Host ""

# Show boundary triggers
Write-Host "--- Boundary Triggers (last 10) ---" -ForegroundColor Yellow
$triggers = Select-String -Path $logFile -Pattern "boundary_triggered"
if ($triggers) {
    $triggers | Select-Object -Last 10 | ForEach-Object {
        $json = $_.Line | ConvertFrom-Json
        $time = $json.timestamp
        $timeframes = $json.timeframes -join ", "
        Write-Host "$time - [$timeframes]" -ForegroundColor Cyan
    }
} else {
    Write-Host "No boundary triggers found" -ForegroundColor Gray
}
Write-Host ""

# Summary
Write-Host "=== Summary ===" -ForegroundColor Cyan
$totalBoundaries = if ($boundaries) { $boundaries.Count } else { 0 }
$totalErrors = if ($errors) { $errors.Count } else { 0 }
$total429 = if ($errors429) { $errors429.Count } else { 0 }

Write-Host "Boundary fetches: $totalBoundaries"
Write-Host "Error messages: $totalErrors" -ForegroundColor $(if ($totalErrors -eq 0) { "Green" } else { "Red" })
Write-Host "429 errors: $total429" -ForegroundColor $(if ($total429 -eq 0) { "Green" } else { "Red" })
