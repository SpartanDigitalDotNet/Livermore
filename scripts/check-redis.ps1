# Load environment variables from Windows User environment
$env:REDIS_URL = [Environment]::GetEnvironmentVariable('REDIS_URL', 'User')

Write-Host "Using REDIS_URL: $($env:REDIS_URL)"

Set-Location 'C:\Dev\claude\Livermore'
pnpm tsx scripts/check-redis.ts
