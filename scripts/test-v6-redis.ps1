$env:LIVERMORE_REDIS_URL = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')
$env:NODE_ENV = 'development'
pnpm exec tsx scripts/test-v6-redis.ts
