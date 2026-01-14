# Portfolio MACD-V Analysis
# Fetches all symbols in one fast API call

Add-Type -AssemblyName System.Web

$symbols = @(
    "BTC-USD","ETH-USD","XRP-USD","LINK-USD","BONK-USD",
    "ONDO-USD","PENGU-USD","WLD-USD","TOSHI-USD","SYRUP-USD",
    "GFI-USD","DIA-USD","NEON-USD","DIMO-USD","SKL-USD",
    "MATH-USD","CTX-USD","SPK-USD","OMNI-USD","METIS-USD",
    "LRDS-USD","ASM-USD","NOICE-USD","LCX-USD","SD-USD"
)

$input = @{ symbols = $symbols } | ConvertTo-Json -Compress
$encoded = [System.Web.HttpUtility]::UrlEncode($input)
$url = "http://localhost:3002/trpc/indicator.getPortfolioAnalysis?input=$encoded"

$start = Get-Date
try {
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10
    $elapsed = ((Get-Date) - $start).TotalMilliseconds

    $data = $response.result.data

    Write-Host ""
    Write-Host "=== MACD-V Portfolio Analysis ===" -ForegroundColor Cyan
    Write-Host "Response time: $([math]::Round($elapsed))ms" -ForegroundColor Gray
    Write-Host ""

    # Table header
    Write-Host ("{0,-12} | {1,6} | {2,6} | {3,6} | {4,6} | {5,6} | {6,6} | {7,-10} | {8,-14} | {9}" -f "Symbol", "1m", "5m", "15m", "1h", "4h", "1d", "Stage", "Signal", "Liquidity") -ForegroundColor Yellow
    Write-Host ("-" * 120)

    foreach ($sym in $data.symbols) {
        $v = $sym.values
        $liq = if ($sym.liquidity) { $sym.liquidity } else { "?" }
        $stage = if ($sym.stage) { $sym.stage } else { "?" }
        $line = "{0,-12} | {1,6} | {2,6} | {3,6} | {4,6} | {5,6} | {6,6} | {7,-10} | {8,-14} | {9}" -f `
            $sym.symbol, `
            $(if ($null -eq $v.'1m') { "N/A" } else { $v.'1m' }), `
            $(if ($null -eq $v.'5m') { "N/A" } else { $v.'5m' }), `
            $(if ($null -eq $v.'15m') { "N/A" } else { $v.'15m' }), `
            $(if ($null -eq $v.'1h') { "N/A" } else { $v.'1h' }), `
            $(if ($null -eq $v.'4h') { "N/A" } else { $v.'4h' }), `
            $(if ($null -eq $v.'1d') { "N/A" } else { $v.'1d' }), `
            $stage, `
            $sym.signal, `
            $liq

        $color = switch ($sym.signal) {
            "STRONG BUY" { "Green" }
            "Bullish" { "DarkGreen" }
            "STRONG SELL" { "Red" }
            "Bearish" { "DarkRed" }
            "Reversal Up?" { "Cyan" }
            "Reversal Down?" { "Magenta" }
            default { "White" }
        }
        Write-Host $line -ForegroundColor $color
    }

    Write-Host ""
    Write-Host "=== Opportunities ===" -ForegroundColor Green
    if ($data.opportunities.bullish.Count -gt 0) {
        Write-Host "Bullish (1h>50, 4h>0):" -ForegroundColor Green
        foreach ($b in $data.opportunities.bullish) {
            $liq = if ($b.liquidity) { "[$($b.liquidity)]" } else { "" }
            Write-Host "  $($b.symbol): 1h=$($b.h1), 4h=$($b.h4), 1d=$($b.d1) $liq"
        }
    } else {
        Write-Host "  No strong bullish signals" -ForegroundColor Gray
    }

    if ($data.opportunities.reversalUp.Count -gt 0) {
        Write-Host "Potential Reversal Up:" -ForegroundColor Cyan
        foreach ($r in $data.opportunities.reversalUp) {
            $liq = if ($r.liquidity) { "[$($r.liquidity)]" } else { "" }
            Write-Host "  $($r.symbol): 1h=$($r.h1), 4h=$($r.h4), 1d=$($r.d1) $liq"
        }
    }

    Write-Host ""
    Write-Host "=== Risks ===" -ForegroundColor Red
    if ($data.risks.bearish.Count -gt 0) {
        Write-Host "Bearish (1h<-50, 4h<0):" -ForegroundColor Red
        foreach ($b in $data.risks.bearish) {
            $liq = if ($b.liquidity) { "[$($b.liquidity)]" } else { "" }
            Write-Host "  $($b.symbol): 1h=$($b.h1), 4h=$($b.h4), 1d=$($b.d1) $liq"
        }
    } else {
        Write-Host "  No strong bearish signals" -ForegroundColor Gray
    }

    if ($data.risks.reversalDown.Count -gt 0) {
        Write-Host "Potential Reversal Down:" -ForegroundColor Magenta
        foreach ($r in $data.risks.reversalDown) {
            $liq = if ($r.liquidity) { "[$($r.liquidity)]" } else { "" }
            Write-Host "  $($r.symbol): 1h=$($r.h1), 4h=$($r.h4), 1d=$($r.d1) $liq"
        }
    }

    # Report timestamp in Chicago time
    Write-Host ""
    $chicagoTz = [TimeZoneInfo]::FindSystemTimeZoneById("Central Standard Time")
    $chicagoTime = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $chicagoTz)
    Write-Host "Report generated: $($chicagoTime.ToString('yyyy-MM-dd hh:mm:ss tt')) (Chicago)" -ForegroundColor Gray
    Write-Host ""

} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Server may need restart to pick up new endpoint" -ForegroundColor Yellow
}
