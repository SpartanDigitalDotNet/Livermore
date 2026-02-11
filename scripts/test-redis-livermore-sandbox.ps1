#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test connection to Azure Redis instance

.DESCRIPTION
    Tests connection to Azure Redis using the LIVERMORE_REDIS_URL from environment variables.

.EXAMPLE
    .\scripts\test-redis-livermore-sandbox.ps1
#>

# Get Redis URL from environment variable
$RedisUrl = [Environment]::GetEnvironmentVariable('LIVERMORE_REDIS_URL', 'User')

if ([string]::IsNullOrWhiteSpace($RedisUrl)) {
    Write-Host "LIVERMORE_REDIS_URL environment variable not set" -ForegroundColor Red
    Write-Host "   Set it in User environment variables and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Redis Connection Test - Azure                            " -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# Parse Redis URL - escape brackets for PowerShell
if ($RedisUrl -match 'rediss?://:[^@]+@([^:]+):(\d+)') {
    $redisHost = $matches[1]
    $redisPort = $matches[2]

    Write-Host "Connection Details:" -ForegroundColor Yellow
    Write-Host "   Host: $redisHost" -ForegroundColor Gray
    Write-Host "   Port: $redisPort" -ForegroundColor Gray
    Write-Host "   Auth: [FROM ENV]" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "Invalid Redis URL format" -ForegroundColor Red
    exit 1
}

Write-Host "Testing connection with TypeScript..." -ForegroundColor Cyan
Write-Host ""

# Change to project root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

# Set environment for the subprocess
$env:LIVERMORE_REDIS_URL = $RedisUrl

# Create a simple test script
$testScript = @'
import Redis from 'ioredis';

const url = process.env.LIVERMORE_REDIS_URL!;
const hostMatch = url.match(/@([^:]+):/);
const host = hostMatch?.[1];

const redis = new Redis(url, { tls: host ? { servername: host } : undefined });

redis.ping()
    .then(() => {
        console.log('Connection successful! Redis responded with PONG');
        return redis.info('server');
    })
    .then((info) => {
        const lines = info.split('\n').slice(0, 10);
        console.log('Server Info (first 10 lines):');
        lines.forEach(l => console.log('  ' + l.trim()));
        redis.disconnect();
        process.exit(0);
    })
    .catch((err) => {
        console.error('Connection failed:', err.message);
        redis.disconnect();
        process.exit(1);
    });
'@

$testScript | Out-File -FilePath "test-redis-temp.ts" -Encoding utf8

try {
    pnpm exec tsx test-redis-temp.ts
    $exitCode = $LASTEXITCODE
    Remove-Item "test-redis-temp.ts" -ErrorAction SilentlyContinue

    Write-Host ""
    if ($exitCode -eq 0) {
        Write-Host "===========================================================" -ForegroundColor Green
        Write-Host "  Test Complete - Connection Successful                    " -ForegroundColor Green
        Write-Host "===========================================================" -ForegroundColor Green
    } else {
        Write-Host "===========================================================" -ForegroundColor Red
        Write-Host "  Test Failed                                              " -ForegroundColor Red
        Write-Host "===========================================================" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "Error running test: $_" -ForegroundColor Red
    Remove-Item "test-redis-temp.ts" -ErrorAction SilentlyContinue
    exit 1
}
