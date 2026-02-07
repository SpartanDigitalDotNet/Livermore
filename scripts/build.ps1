$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Path $PSScriptRoot -Parent)
pnpm turbo build
if ($LASTEXITCODE -ne 0) { exit 1 }
