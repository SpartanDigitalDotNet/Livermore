<#
.SYNOPSIS
    Test harness for Coinbase Advanced Trade WebSocket candles channel.

.DESCRIPTION
    Connects to Coinbase WebSocket and subscribes to the candles channel
    to determine what data is actually provided (snapshot size, granularity, etc.)

.PARAMETER Symbol
    Trading pair to test (default: BTC-USD)

.PARAMETER Symbols
    Array of trading pairs for multi-symbol test

.PARAMETER Duration
    How long to listen for messages in seconds (default: 30)

.PARAMETER OutputFile
    Path to save results JSON (default: candles-test-results.json)

.EXAMPLE
    .\test-candles-channel.ps1

.EXAMPLE
    .\test-candles-channel.ps1 -Symbol "ETH-USD" -Duration 60

.EXAMPLE
    .\test-candles-channel.ps1 -Symbols @("BTC-USD", "ETH-USD", "SOL-USD")
#>

param(
    [string]$Symbol = "BTC-USD",
    [string[]]$Symbols = @(),
    [int]$Duration = 30,
    [string]$OutputFile = "candles-test-results.json"
)

# Use Symbols array if provided, otherwise use single Symbol
if ($Symbols.Count -eq 0) {
    $Symbols = @($Symbol)
}

$wsUri = "wss://advanced-trade-ws.coinbase.com"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Coinbase Candles Channel Test Harness" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Endpoint: $wsUri"
Write-Host "Symbols: $($Symbols -join ', ')"
Write-Host "Duration: $Duration seconds"
Write-Host ""

# Results object
$results = @{
    test_timestamp = (Get-Date -Format "o")
    endpoint = $wsUri
    channel = "candles"
    product_ids = $Symbols
    authenticated = $false
    connection_status = "pending"
    snapshots = @{}
    updates = @()
    errors = @()
    observations = @()
}

try {
    # Create WebSocket client
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $cts = New-Object System.Threading.CancellationTokenSource

    Write-Host "Connecting to WebSocket..." -ForegroundColor Yellow

    # Connect
    $connectTask = $ws.ConnectAsync([Uri]$wsUri, $cts.Token)
    $connectTask.Wait(10000) | Out-Null

    if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
        throw "Failed to connect. State: $($ws.State)"
    }

    Write-Host "Connected!" -ForegroundColor Green
    $results.connection_status = "connected"

    # Subscribe to candles channel
    $subscribeMsg = @{
        type = "subscribe"
        product_ids = $Symbols
        channel = "candles"
    } | ConvertTo-Json -Compress

    Write-Host ""
    Write-Host "Subscribing to candles channel..." -ForegroundColor Yellow
    Write-Host "Message: $subscribeMsg" -ForegroundColor DarkGray

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($subscribeMsg)
    $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
    $sendTask = $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token)
    $sendTask.Wait(5000) | Out-Null

    Write-Host "Subscribed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Listening for messages ($Duration seconds)..." -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Cyan

    # Receive messages
    $buffer = New-Object byte[] 65536
    $messageCount = 0
    $snapshotCount = 0
    $updateCount = 0
    $startTime = Get-Date

    while (((Get-Date) - $startTime).TotalSeconds -lt $Duration) {
        if ($ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
            Write-Host "WebSocket closed unexpectedly" -ForegroundColor Red
            break
        }

        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
        $receiveTask = $ws.ReceiveAsync($segment, $cts.Token)

        # Wait with timeout
        if ($receiveTask.Wait(1000)) {
            $result = $receiveTask.Result

            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Text) {
                $messageCount++
                $message = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
                $json = $message | ConvertFrom-Json

                # Determine message type
                $channel = $json.channel
                $type = $json.type

                if ($channel -eq "candles") {
                    # Check if this is a snapshot or update
                    $events = $json.events

                    foreach ($event in $events) {
                        $eventType = $event.type

                        if ($eventType -eq "snapshot") {
                            $snapshotCount++
                            $candles = $event.candles
                            $candleCount = $candles.Count

                            Write-Host ""
                            Write-Host ">>> SNAPSHOT RECEIVED <<<" -ForegroundColor Green
                            Write-Host "    Candle count: $candleCount" -ForegroundColor White

                            if ($candleCount -gt 0) {
                                $oldest = $candles | Sort-Object { [long]$_.start } | Select-Object -First 1
                                $newest = $candles | Sort-Object { [long]$_.start } | Select-Object -Last 1

                                $oldestTime = [DateTimeOffset]::FromUnixTimeSeconds([long]$oldest.start).DateTime
                                $newestTime = [DateTimeOffset]::FromUnixTimeSeconds([long]$newest.start).DateTime
                                $timeSpan = $newestTime - $oldestTime

                                Write-Host "    Oldest: $oldestTime" -ForegroundColor White
                                Write-Host "    Newest: $newestTime" -ForegroundColor White
                                Write-Host "    Time span: $($timeSpan.TotalHours.ToString('F1')) hours" -ForegroundColor White

                                # Detect granularity from time differences
                                if ($candleCount -ge 2) {
                                    $sorted = $candles | Sort-Object { [long]$_.start }
                                    $diff = [long]$sorted[1].start - [long]$sorted[0].start
                                    $granularityMinutes = $diff / 60
                                    Write-Host "    Granularity: $granularityMinutes minutes" -ForegroundColor White
                                }

                                # Sample candle
                                Write-Host ""
                                Write-Host "    Sample candle:" -ForegroundColor DarkGray
                                Write-Host "    $($newest | ConvertTo-Json -Compress)" -ForegroundColor DarkGray

                                # Store in results
                                $productId = $json.events[0].candles[0].product_id
                                if (-not $productId) { $productId = "unknown" }

                                $results.snapshots[$productId] = @{
                                    candle_count = $candleCount
                                    oldest_timestamp = $oldest.start
                                    newest_timestamp = $newest.start
                                    oldest_datetime = $oldestTime.ToString("o")
                                    newest_datetime = $newestTime.ToString("o")
                                    time_span_hours = [math]::Round($timeSpan.TotalHours, 2)
                                    granularity_minutes = $granularityMinutes
                                    sample_candle = $newest
                                }
                            }
                        }
                        elseif ($eventType -eq "update") {
                            $updateCount++
                            if ($updateCount -le 5) {
                                Write-Host "Update #$updateCount received" -ForegroundColor DarkGray
                            }
                            elseif ($updateCount -eq 6) {
                                Write-Host "... (suppressing further update logs)" -ForegroundColor DarkGray
                            }

                            # Store first few updates
                            if ($results.updates.Count -lt 10) {
                                $results.updates += @{
                                    timestamp = (Get-Date -Format "o")
                                    event = $event
                                }
                            }
                        }
                    }
                }
                elseif ($channel -eq "subscriptions") {
                    Write-Host "Subscription confirmed: $message" -ForegroundColor DarkGray
                }
                else {
                    Write-Host "Other message (channel: $channel): $($message.Substring(0, [Math]::Min(100, $message.Length)))..." -ForegroundColor DarkGray
                }
            }
            elseif ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                Write-Host "Server closed connection" -ForegroundColor Yellow
                break
            }
        }
    }

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "Test complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Summary:" -ForegroundColor White
    Write-Host "  Total messages: $messageCount"
    Write-Host "  Snapshots: $snapshotCount"
    Write-Host "  Updates: $updateCount"

    # Add observations
    foreach ($productId in $results.snapshots.Keys) {
        $snapshot = $results.snapshots[$productId]
        $results.observations += "Product $productId : $($snapshot.candle_count) candles, $($snapshot.granularity_minutes)m granularity, $($snapshot.time_span_hours) hours of history"

        if ($snapshot.candle_count -ge 100) {
            $results.observations += "SUFFICIENT: $($snapshot.candle_count) candles meets 100-candle requirement for MACD-V"
        } else {
            $results.observations += "INSUFFICIENT: $($snapshot.candle_count) candles does NOT meet 100-candle requirement"
        }
    }

    # Close WebSocket
    if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        $closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Test complete", $cts.Token)
        $closeTask.Wait(5000) | Out-Null
    }
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
    $results.errors += $_.ToString()
    $results.connection_status = "error"
}
finally {
    if ($ws) { $ws.Dispose() }
    if ($cts) { $cts.Dispose() }
}

# Save results
$results | ConvertTo-Json -Depth 10 | Out-File -FilePath $OutputFile -Encoding UTF8
Write-Host ""
Write-Host "Results saved to: $OutputFile" -ForegroundColor Green

# Display key findings
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " KEY FINDINGS" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
foreach ($obs in $results.observations) {
    Write-Host "  - $obs" -ForegroundColor White
}
Write-Host ""
