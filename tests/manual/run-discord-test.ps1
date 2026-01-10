# Load Discord webhook from Windows User environment
$env:DISCORD_LIVERMORE_BOT = [Environment]::GetEnvironmentVariable('DISCORD_LIVERMORE_BOT', 'User')

Write-Host "DISCORD_LIVERMORE_BOT: $(if ($env:DISCORD_LIVERMORE_BOT) { 'set' } else { 'NOT SET' })"

Set-Location 'C:\Dev\claude\Livermore'
npx tsx tests/manual/test-discord-webhook.ts
