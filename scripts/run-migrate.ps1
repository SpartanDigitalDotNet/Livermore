# Load environment variables from Windows User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

# Debug: show what we loaded
Write-Host "DATABASE_HOST: $($env:DATABASE_HOST)"
Write-Host "DATABASE_PORT: $($env:DATABASE_PORT)"
Write-Host "DATABASE_LIVERMORE_USERNAME: $($env:DATABASE_LIVERMORE_USERNAME)"
Write-Host "LIVERMORE_DATABASE_NAME: $($env:LIVERMORE_DATABASE_NAME)"

# Change to project directory
Set-Location 'C:\Dev\claude\Livermore'

# Run based on argument
if ($args[0] -eq "generate") {
    Write-Host "`nGenerating migrations..."
    pnpm --filter @livermore/database generate
} elseif ($args[0] -eq "migrate") {
    Write-Host "`nRunning migrations..."
    pnpm --filter @livermore/database migrate
} else {
    Write-Host "`nUsage: run-migrate.ps1 [generate|migrate]"
    Write-Host "  generate - Generate new migration from schema changes"
    Write-Host "  migrate  - Apply pending migrations to database"
}
