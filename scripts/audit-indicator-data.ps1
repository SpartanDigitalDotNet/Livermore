# Audit Indicator Data
# Checks timestamps, data freshness, and timeframe alignment

$baseUrl = "http://localhost:3002/trpc"

function Get-IndicatorData {
    param([string]$symbol, [string]$timeframe)

    $input = @{ symbol = $symbol; timeframe = $timeframe } | ConvertTo-Json -Compress
    $encoded = [System.Web.HttpUtility]::UrlEncode($input)
    $url = "$baseUrl/indicator.getAnalysis?input=$encoded"

    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
        return $response.result.data.data
    } catch {
        return $null
    }
}

function Format-Timestamp {
    param([long]$ts)
    if ($ts -eq 0) { return "N/A" }
    $epoch = [DateTimeOffset]::FromUnixTimeMilliseconds($ts)
    return $epoch.ToString("yyyy-MM-dd HH:mm:ss")
}

function Get-TimeframeBoundary {
    param([string]$timeframe, [DateTimeOffset]$dt)

    switch ($timeframe) {
        "1m"  { return $dt.AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        "5m"  { return $dt.AddMinutes(-($dt.Minute % 5)).AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        "15m" { return $dt.AddMinutes(-($dt.Minute % 15)).AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        "1h"  { return $dt.AddMinutes(-$dt.Minute).AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        "4h"  { return $dt.AddHours(-($dt.Hour % 4)).AddMinutes(-$dt.Minute).AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        "1d"  { return $dt.AddHours(-$dt.Hour).AddMinutes(-$dt.Minute).AddSeconds(-$dt.Second).AddMilliseconds(-$dt.Millisecond) }
        default { return $dt }
    }
}

function Get-TimeframeMs {
    param([string]$timeframe)
    switch ($timeframe) {
        "1m"  { return 60000 }
        "5m"  { return 300000 }
        "15m" { return 900000 }
        "1h"  { return 3600000 }
        "4h"  { return 14400000 }
        "1d"  { return 86400000 }
        default { return 0 }
    }
}

# Add System.Web for URL encoding
Add-Type -AssemblyName System.Web

Write-Host "=== Indicator Data Audit ===" -ForegroundColor Cyan
$now = [DateTimeOffset]::UtcNow
Write-Host "Current Time: $($now.ToString('yyyy-MM-dd HH:mm:ss'))Z" -ForegroundColor Gray
Write-Host ""

$symbols = @("BTC-USD", "ETH-USD", "XRP-USD", "LINK-USD", "BONK-USD")
$timeframes = @("1m", "5m", "15m", "1h", "4h", "1d")

Write-Host "=== Timestamp Alignment Check ===" -ForegroundColor Yellow
Write-Host ""

foreach ($tf in $timeframes) {
    Write-Host "--- Timeframe: $tf ---" -ForegroundColor Green
    $tfMs = Get-TimeframeMs -timeframe $tf
    $expectedBoundary = Get-TimeframeBoundary -timeframe $tf -dt $now

    Write-Host "Expected latest candle boundary: $($expectedBoundary.ToString('yyyy-MM-dd HH:mm:ss'))Z"
    Write-Host ""

    $results = @()
    foreach ($sym in $symbols) {
        $data = Get-IndicatorData -symbol $sym -timeframe $tf

        if ($data) {
            $candleTs = [DateTimeOffset]::FromUnixTimeMilliseconds($data.timestamp)
            $candleTsMs = $data.timestamp
            $ageMs = ($now.ToUnixTimeMilliseconds() - $data.timestamp)
            $ageMinutes = [math]::Round($ageMs / 60000, 1)

            # Check if timestamp is on boundary (compare Unix ms to avoid DateTimeOffset precision issues)
            $boundary = Get-TimeframeBoundary -timeframe $tf -dt $candleTs
            $boundaryMs = $boundary.ToUnixTimeMilliseconds()
            $isAligned = ($candleTsMs -eq $boundaryMs)

            # Check if it's the expected candle (current or previous)
            $expectedBoundaryMs = $expectedBoundary.ToUnixTimeMilliseconds()
            $expectedPrevBoundaryMs = $expectedBoundaryMs - $tfMs
            $isCurrentOrPrev = ($candleTsMs -eq $expectedBoundaryMs -or $candleTsMs -eq $expectedPrevBoundaryMs)

            $status = ""
            if (-not $isAligned) {
                $status = "[MISALIGNED]"
            } elseif ($ageMs -gt ($tfMs * 2)) {
                $status = "[STALE]"
            } elseif (-not $isCurrentOrPrev) {
                $status = "[UNEXPECTED]"
            } else {
                $status = "[OK]"
            }

            Write-Host ("{0,-12} ts={1}  age={2,6}m  macdV={3,8:F1}  {4}" -f $sym, $candleTs.ToString("yyyy-MM-dd HH:mm"), $ageMinutes, $data.macdV, $status)
        } else {
            Write-Host ("{0,-12} NO DATA" -f $sym) -ForegroundColor Red
        }
    }
    Write-Host ""
}

Write-Host "=== Histogram Series Check (checking for gaps) ===" -ForegroundColor Yellow
Write-Host ""

foreach ($tf in @("1h", "4h", "1d")) {
    Write-Host "--- $tf Histogram Series ---" -ForegroundColor Green
    $tfMs = Get-TimeframeMs -timeframe $tf

    $data = Get-IndicatorData -symbol "BTC-USD" -timeframe $tf
    if ($data -and $data.histogramSeries) {
        $series = $data.histogramSeries
        Write-Host "BTC-USD $tf histogram series (last $($series.Count) values):"

        $prevTs = 0
        foreach ($item in $series) {
            $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($item.timestamp)
            $gap = ""
            if ($prevTs -gt 0) {
                $diff = $item.timestamp - $prevTs
                if ($diff -ne $tfMs) {
                    $gap = " [GAP: expected $tfMs ms, got $diff ms]"
                }
            }
            Write-Host ("  {0}  histogram={1,8:F2}{2}" -f $ts.ToString("yyyy-MM-dd HH:mm"), $item.value, $gap)
            $prevTs = $item.timestamp
        }
    }
    Write-Host ""
}

Write-Host "=== Candle Count Check ===" -ForegroundColor Yellow
Write-Host ""

foreach ($tf in $timeframes) {
    $data = Get-IndicatorData -symbol "BTC-USD" -timeframe $tf
    if ($data) {
        Write-Host ("{0,-4} candleCount={1}" -f $tf, $data.candleCount)
    }
}

Write-Host ""
Write-Host "=== Audit Complete ===" -ForegroundColor Cyan
