param([string]$Message)
$webhook = [Environment]::GetEnvironmentVariable('DISCORD_LIVERMORE_BOT', 'User')
if (-not $webhook) {
    Write-Error "DISCORD_LIVERMORE_BOT not set"
    exit 1
}

$body = @{ content = $Message } | ConvertTo-Json -Depth 2
Invoke-RestMethod -Uri $webhook -Method Post -ContentType 'application/json' -Body $body
Write-Host "Posted to Discord"
