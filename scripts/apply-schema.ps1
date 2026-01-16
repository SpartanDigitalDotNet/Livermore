# Apply Atlas schema
# Load environment variables from Windows User environment
$env:DATABASE_HOST = [Environment]::GetEnvironmentVariable('DATABASE_HOST', 'User')
$env:DATABASE_PORT = [Environment]::GetEnvironmentVariable('DATABASE_PORT', 'User')
$env:DATABASE_LIVERMORE_USERNAME = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_USERNAME', 'User')
$env:DATABASE_LIVERMORE_PASSWORD = [Environment]::GetEnvironmentVariable('DATABASE_LIVERMORE_PASSWORD', 'User')
$env:LIVERMORE_DATABASE_NAME = [Environment]::GetEnvironmentVariable('LIVERMORE_DATABASE_NAME', 'User')

$url = "postgresql://${env:DATABASE_LIVERMORE_USERNAME}:${env:DATABASE_LIVERMORE_PASSWORD}@${env:DATABASE_HOST}:${env:DATABASE_PORT}/${env:LIVERMORE_DATABASE_NAME}?sslmode=disable&search_path=public"
Write-Host "Applying schema to: postgresql://${env:DATABASE_LIVERMORE_USERNAME}:****@${env:DATABASE_HOST}:${env:DATABASE_PORT}/${env:LIVERMORE_DATABASE_NAME}"

$env:DATABASE_URL = $url
Set-Location "$PSScriptRoot\..\packages\database"
& "$PSScriptRoot\..\atlas.exe" schema apply --env local --auto-approve
