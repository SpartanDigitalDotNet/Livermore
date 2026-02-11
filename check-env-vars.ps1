#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Check required environment variables for Livermore

.DESCRIPTION
    Checks all required environment variables stored in Windows User scope
    and shows which ones are missing.

.EXAMPLE
    .\check-env-vars.ps1
#>

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Livermore - Environment Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Define all required environment variables with descriptions
# These match the Zod schema in packages/schemas/src/env/config.schema.ts
$envVars = @(
    @{ Name = "DATABASE_HOST"; Desc = "PostgreSQL host (e.g., mydb.postgres.database.azure.com)"; Secret = $false; Required = $true },
    @{ Name = "DATABASE_PORT"; Desc = "PostgreSQL port (usually 5432)"; Secret = $false; Required = $true },
    @{ Name = "DATABASE_LIVERMORE_USERNAME"; Desc = "PostgreSQL username"; Secret = $false; Required = $true },
    @{ Name = "DATABASE_LIVERMORE_PASSWORD"; Desc = "PostgreSQL password"; Secret = $true; Required = $true },
    @{ Name = "LIVERMORE_DATABASE_NAME"; Desc = "Database name (e.g., livermore)"; Secret = $false; Required = $true },
    @{ Name = "LIVERMORE_REDIS_URL"; Desc = "Redis connection URL (rediss://:password@host:port)"; Secret = $true; Required = $true },
    @{ Name = "Coinbase_ApiKeyId"; Desc = "Coinbase API Key ID"; Secret = $true; Required = $true },
    @{ Name = "Coinbase_EcPrivateKeyPem"; Desc = "Coinbase EC Private Key (PEM format)"; Secret = $true; Required = $true },
    @{ Name = "DISCORD_LIVERMORE_BOT"; Desc = "Discord webhook URL for notifications"; Secret = $true; Required = $true },
    @{ Name = "CLERK_PUBLISHABLE_KEY"; Desc = "Clerk publishable key (pk_test_... or pk_live_...)"; Secret = $false; Required = $true },
    @{ Name = "CLERK_SECRET_KEY"; Desc = "Clerk secret key (sk_test_... or sk_live_...)"; Secret = $true; Required = $true },
    @{ Name = "CLERK_WEBHOOK_SIGNING_SECRET"; Desc = "Clerk webhook signing secret (whsec_...)"; Secret = $true; Required = $false }
)

# Optional: For debug scripts that access Redis directly via Docker
$debugVars = @(
    @{ Name = "REDIS_PASSWORD"; Desc = "Redis password (for debug scripts only)"; Secret = $true }
)

$missingRequired = @()
$missingOptional = @()
$found = @()

Write-Host "Checking Windows User environment variables..." -ForegroundColor Yellow
Write-Host ""

Write-Host "=== Required Variables ===" -ForegroundColor White
Write-Host ""

foreach ($var in $envVars) {
    $value = [Environment]::GetEnvironmentVariable($var.Name, 'User')

    if ([string]::IsNullOrWhiteSpace($value)) {
        if ($var.Required) {
            $missingRequired += $var
            Write-Host "  [ ] " -NoNewline -ForegroundColor Red
            Write-Host "$($var.Name)" -ForegroundColor Red
        } else {
            $missingOptional += $var
            Write-Host "  [ ] " -NoNewline -ForegroundColor Yellow
            Write-Host "$($var.Name) (optional)" -ForegroundColor Yellow
        }
        Write-Host "      $($var.Desc)" -ForegroundColor Gray
    }
    else {
        $found += $var
        Write-Host "  [x] " -NoNewline -ForegroundColor Green
        Write-Host "$($var.Name)" -ForegroundColor Green

        # Show value preview (masked for secrets)
        if ($var.Secret) {
            $preview = $value.Substring(0, [Math]::Min(8, $value.Length)) + "..."
            Write-Host "      = $preview (hidden)" -ForegroundColor DarkGray
        }
        else {
            Write-Host "      = $value" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "=== Debug Script Variables (optional) ===" -ForegroundColor White
Write-Host ""

foreach ($var in $debugVars) {
    $value = [Environment]::GetEnvironmentVariable($var.Name, 'User')

    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  [ ] " -NoNewline -ForegroundColor DarkGray
        Write-Host "$($var.Name)" -ForegroundColor DarkGray
        Write-Host "      $($var.Desc)" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  [x] " -NoNewline -ForegroundColor Green
        Write-Host "$($var.Name)" -ForegroundColor Green
        $preview = $value.Substring(0, [Math]::Min(8, $value.Length)) + "..."
        Write-Host "      = $preview (hidden)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Gray

if ($missingRequired.Count -eq 0) {
    Write-Host ""
    Write-Host "  All required environment variables are set!" -ForegroundColor Green
    if ($missingOptional.Count -gt 0) {
        Write-Host "  ($($missingOptional.Count) optional variable(s) not set)" -ForegroundColor Yellow
    }
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "  MISSING REQUIRED: $($missingRequired.Count) variable(s)" -ForegroundColor Red
    Write-Host "  SET:              $($found.Count) variable(s)" -ForegroundColor Green
    if ($missingOptional.Count -gt 0) {
        Write-Host "  OPTIONAL:         $($missingOptional.Count) not set" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  How to Set Missing Variables" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Run these commands in PowerShell:" -ForegroundColor Cyan
    Write-Host ""

    foreach ($var in $missingRequired) {
        $example = switch ($var.Name) {
            "DATABASE_HOST" { "your-db.postgres.database.azure.com" }
            "DATABASE_PORT" { "5432" }
            "DATABASE_LIVERMORE_USERNAME" { "your_username" }
            "DATABASE_LIVERMORE_PASSWORD" { "your_password" }
            "LIVERMORE_DATABASE_NAME" { "livermore" }
            "LIVERMORE_REDIS_URL" { "rediss://:your_password@your-redis.redis.cache.windows.net:6380" }
            "Coinbase_ApiKeyId" { "your_api_key_id" }
            "Coinbase_EcPrivateKeyPem" { "-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----" }
            "DISCORD_LIVERMORE_BOT" { "https://discord.com/api/webhooks/..." }
            "CLERK_PUBLISHABLE_KEY" { "pk_test_..." }
            "CLERK_SECRET_KEY" { "sk_test_..." }
            "CLERK_WEBHOOK_SIGNING_SECRET" { "whsec_..." }
            default { "your_value_here" }
        }

        Write-Host "[Environment]::SetEnvironmentVariable('$($var.Name)', '$example', 'User')" -ForegroundColor White
        Write-Host ""
    }

    Write-Host "----------------------------------------" -ForegroundColor Gray
    Write-Host ""
    Write-Host "NOTE: After setting variables, close and reopen PowerShell" -ForegroundColor Yellow
    Write-Host "      or run this script again to verify." -ForegroundColor Yellow
    Write-Host ""
}

# Return exit code based on missing REQUIRED vars only
if ($missingRequired.Count -gt 0) {
    exit 1
}
