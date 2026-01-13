# Debug Redis Keys
# Lists all keys matching patterns to understand cache state

# Get Redis password from environment (User scope)
$redisPassword = [Environment]::GetEnvironmentVariable('REDIS_PASSWORD', 'User')
if (-not $redisPassword) {
    Write-Host "ERROR: REDIS_PASSWORD environment variable not set" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Redis Key Analysis ===" -ForegroundColor Cyan
Write-Host ""

# Count all keys
$allKeys = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning DBSIZE
Write-Host "Total keys in Redis: $allKeys" -ForegroundColor Yellow
Write-Host ""

# Check candle keys
Write-Host "Candle keys (candles:*):" -ForegroundColor Cyan
$candleKeys = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS "candles:*"
if ($candleKeys) {
    $candleKeys | ForEach-Object { Write-Host "  $_" }
    Write-Host "  Count: $(($candleKeys | Measure-Object).Count)"
} else {
    Write-Host "  (none found)"
}

Write-Host ""

# Check indicator keys
Write-Host "Indicator keys (indicator:*):" -ForegroundColor Cyan
$indicatorKeys = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS "indicator:*"
if ($indicatorKeys) {
    $indicatorKeys | ForEach-Object { Write-Host "  $_" }
    Write-Host "  Count: $(($indicatorKeys | Measure-Object).Count)"
} else {
    Write-Host "  (none found)"
}

Write-Host ""

# Check ticker keys
Write-Host "Ticker keys (ticker:*):" -ForegroundColor Cyan
$tickerKeys = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS "ticker:*"
if ($tickerKeys) {
    Write-Host "  Count: $(($tickerKeys | Measure-Object).Count)"
    # Show first 5
    $tickerKeys | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }
    if (($tickerKeys | Measure-Object).Count -gt 5) {
        Write-Host "  ..."
    }
} else {
    Write-Host "  (none found)"
}

Write-Host ""

# Sample some random keys to see what exists
Write-Host "Sampling keys with SCAN:" -ForegroundColor Cyan
$scanResult = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning SCAN 0 COUNT 30
Write-Host $scanResult

Write-Host ""

# Try wildcard search
Write-Host "All keys matching *:" -ForegroundColor Cyan
$allKeySample = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS "*" 2>$null | Select-Object -First 30
if ($allKeySample) {
    $allKeySample | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  (none found or error)"
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
