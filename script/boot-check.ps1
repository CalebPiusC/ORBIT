<#
.SYNOPSIS
  Orbit boot check for Windows — proves the CLI still builds and starts after a change.

.DESCRIPTION
  Run from anywhere after `bun install` has completed:

    powershell -ExecutionPolicy Bypass -File .\script\boot-check.ps1
    powershell -ExecutionPolicy Bypass -File .\script\boot-check.ps1 -Tui

  Exit code 0 means every check passed.

.PARAMETER Tui
  Also open the Orbit TUI after the non-interactive checks (press Ctrl+C to return).
#>
[CmdletBinding()]
param(
  [switch]$Tui
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$script:failures = 0

function Pass([string]$message) { Write-Host "  PASS  $message" -ForegroundColor Green }
function Fail([string]$message) { Write-Host "  FAIL  $message" -ForegroundColor Red; $script:failures++ }
function Info([string]$message) { Write-Host "  $message" -ForegroundColor DarkGray }

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  Write-Host "Orbit boot check (Windows $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture))"

  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bun) {
    Fail "bun is not installed - install it with: npm i -g bun"
    Write-Host "1 check failed." -ForegroundColor Red
    exit 1
  }
  Pass ("bun " + (& bun --version | Out-String).Trim())

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { Pass ("node " + (& node --version | Out-String).Trim()) }
  else { Info "node not found (optional: only the published npm package wrapper needs it)" }

  if (-not (Test-Path "node_modules")) {
    Fail "dependencies are missing - run: bun install"
    Write-Host "1 check failed." -ForegroundColor Red
    exit 1
  }
  Pass "dependencies installed"

  $version = (& bun run dev --version 2>&1 | Out-String)
  if ($version -match "orbit v") {
    $matched = [regex]::Match($version, "orbit v\S+").Value
    Pass "orbit --version -> $matched"
  }
  else {
    Fail "orbit --version did not print an Orbit version"
    Info (($version -split "`r?`n" | Select-Object -Last 3) -join " / ")
  }

  $help = (& bun run dev --help 2>&1 | Out-String)
  if ($help -match "USAGE" -and $help -match "orbit <subcommand>") {
    Pass "orbit --help prints the Orbit command line interface"
  }
  else {
    Fail "orbit --help did not print the expected usage line"
    Info (($help -split "`r?`n" | Select-Object -First 5) -join " / ")
  }

  $paths = (& bun run dev debug paths 2>&1 | Out-String)
  $configDir = Join-Path $HOME ".config\orbit"
  if ($paths -match [regex]::Escape($configDir)) {
    Pass "config and data folders resolve to Orbit ($configDir)"
  }
  else {
    Fail "global folders do not resolve to Orbit"
    Info (($paths -split "`r?`n" | Select-Object -First 8) -join " / ")
  }

  if ($Tui) {
    Info "starting the TUI - press Ctrl+C to finish the check"
    & bun run dev --standalone
    if ($LASTEXITCODE -le 1) { Pass "TUI exited without a crash" }
    else { Fail "TUI exited with code $LASTEXITCODE" }
  }

  if ($script:failures -ne 0) {
    Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
    exit 1
  }
  Write-Host "All checks passed." -ForegroundColor Green
}
finally {
  Pop-Location
}
