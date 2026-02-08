# Load environment variables from Windows User environment
$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')

Write-Host "Using LIVERMORE_REDIS_URL: $($env:LIVERMORE_REDIS_URL)"

Set-Location 'C:\Dev\claude\Livermore'
pnpm tsx scripts/check-redis.ts
