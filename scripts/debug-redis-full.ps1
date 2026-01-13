# Debug Redis Full
# Shows complete picture of what's in Redis

# Get Redis password from environment (User scope)
$redisPassword = [Environment]::GetEnvironmentVariable('REDIS_PASSWORD', 'User')
if (-not $redisPassword) {
    Write-Host "ERROR: REDIS_PASSWORD environment variable not set" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Redis Full Analysis ===" -ForegroundColor Cyan
Write-Host ""

# Count all keys
$dbSize = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning DBSIZE
Write-Host "Total keys: $dbSize" -ForegroundColor Yellow
Write-Host ""

# Check various key patterns
$patterns = @(
    "candles:*",
    "indicator:*",
    "ticker:*",
    "klines:*",
    "market:*",
    "orderbook:*"
)

foreach ($pattern in $patterns) {
    $count = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS $pattern 2>$null | Measure-Object | Select-Object -ExpandProperty Count
    if ($count -eq 0) {
        Write-Host "${pattern}: 0 keys" -ForegroundColor Gray
    } else {
        Write-Host "${pattern}: $count keys" -ForegroundColor Green
    }
}

Write-Host ""

# Check if any SKL-USD data exists anywhere
Write-Host "=== SKL-USD Keys ===" -ForegroundColor Cyan
$sklKeys = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning KEYS "*SKL-USD*"
if ($sklKeys) {
    $sklKeys | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  (none found)" -ForegroundColor Gray
}

Write-Host ""

# Check klines for SKL-USD specifically
Write-Host "=== klines:SKL-USD:1m:history content ===" -ForegroundColor Cyan
$klinesKey = "klines:SKL-USD:1m:history"
$klinesType = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning TYPE $klinesKey
Write-Host "Type: $klinesType"

if ($klinesType -eq "zset") {
    $klinesCount = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning ZCARD $klinesKey
    Write-Host "Count: $klinesCount"

    if ([int]$klinesCount -gt 0) {
        Write-Host "Last 3 entries:"
        $entries = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning ZRANGE $klinesKey -3 -1
        foreach ($entry in $entries) {
            if ($entry -and $entry.Length -gt 0) {
                try {
                    $parsed = $entry | ConvertFrom-Json
                    $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($parsed.timestamp).ToString("yyyy-MM-dd HH:mm:ss")
                    Write-Host "  $ts | O:$($parsed.open) H:$($parsed.high) L:$($parsed.low) C:$($parsed.close)"
                } catch {
                    Write-Host "  (parse error: $entry)"
                }
            }
        }
    }
} elseif ($klinesType -eq "list") {
    $listLen = docker exec perseus-redis redis-cli -a $redisPassword --no-auth-warning LLEN $klinesKey
    Write-Host "Length: $listLen"
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
