# Debug Redis Candles
# Queries candle data directly from Redis at 127.0.0.1:6400

param(
    [string]$Symbol = "SKL-USD",
    [string]$Timeframe = "1m",
    [int]$Count = 10
)

# Get Redis password from environment (User scope)
$redisPassword = [Environment]::GetEnvironmentVariable('REDIS_PASSWORD', 'User')
if (-not $redisPassword) {
    Write-Host "ERROR: REDIS_PASSWORD environment variable not set" -ForegroundColor Red
    exit 1
}

# Redis connection - port 6400 on localhost
$redisHost = "127.0.0.1"
$redisPort = 6400

# Build the key pattern (matches candle-cache.ts key format)
$userId = 1
$exchangeId = 1
$key = "candles:${userId}:${exchangeId}:${Symbol}:${Timeframe}"

Write-Host ""
Write-Host "=== Redis Candle Debug ===" -ForegroundColor Cyan
Write-Host "Key: $key" -ForegroundColor Yellow
Write-Host "Redis: ${redisHost}:${redisPort}" -ForegroundColor Gray
Write-Host ""

# Show all timeframe counts for this symbol
Write-Host "Candle counts by timeframe:" -ForegroundColor Cyan
$timeframes = @("1m", "5m", "15m", "1h", "4h", "1d")
foreach ($tf in $timeframes) {
    $tfKey = "candles:${userId}:${exchangeId}:${Symbol}:${tf}"
    $tfCount = docker exec Hermes redis-cli -a $redisPassword --no-auth-warning ZCARD $tfKey
    Write-Host "  ${tf}: $tfCount candles"
}

Write-Host ""

# Get candle count
$candleCount = docker exec Hermes redis-cli -a $redisPassword --no-auth-warning ZCARD $key
Write-Host "Total $Timeframe candles in cache: $candleCount" -ForegroundColor Green

# Get last N candles (most recent)
Write-Host ""
Write-Host "Last $Count candles:" -ForegroundColor Yellow
$candles = docker exec Hermes redis-cli -a $redisPassword --no-auth-warning ZRANGE $key (-$Count) -1

foreach ($candleJson in $candles) {
    if ($candleJson -and $candleJson -notmatch "Warning:") {
        try {
            $candle = $candleJson | ConvertFrom-Json
            $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($candle.timestamp).ToString("yyyy-MM-dd HH:mm:ss")
            $ohlc = "O:{0:F6} H:{1:F6} L:{2:F6} C:{3:F6}" -f $candle.open, $candle.high, $candle.low, $candle.close
            $range = $candle.high - $candle.low
            Write-Host "$ts | $ohlc | Range: $($range.ToString('F8'))"
        } catch {
            Write-Host "Parse error: $candleJson" -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
