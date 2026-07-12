<#
  elt-selfheal.ps1 — T011 OPTIONAL (004-elt-selfdrive): gated self-repair.
  Связывает watchdog (T010 harness-selfcheck.js) с драйвером (elt-loop.ps1): красный
  оракул харнесса → watchdog заводит self-heal слайс → elt-loop.ps1 чинит его тем же
  гейтом (оракул+судья, REJECT-default) → коммит идёт на feature-ветку (elt.js branch
  policy, НЕ main). Merge починки в main — ПО УМОЛЧАНИЮ ЧЕЛОВЕКОМ: скрипт сам не мержит,
  пока не задан явный флаг конфига `.harness/harness.json` → `selfHeal.autoMerge:true`
  ИЛИ CLI-переключатель -AutoMerge. Не самопереписывающийся демон (spec.md, вне scope).
  Merge-механика вынесена в elt-selfheal-lib.ps1 (тестируется реальным git, отдельно
  от watchdog/driver — те живого claude требуют только вне DryRun).
  PS 5.1: без && / ||, -Encoding utf8. Kill-switch: <Project>/.harness/STOP (через elt-loop.ps1).
#>
param(
  [string]$Project = ".",
  [int]$Slices = 1,
  [switch]$AutoMerge,
  [switch]$DryRun
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Project = (Resolve-Path $Project).Path
$watchdog = Join-Path $PSScriptRoot "harness-selfcheck.js"
$driver = Join-Path $PSScriptRoot "elt-loop.ps1"
. (Join-Path $PSScriptRoot "elt-selfheal-lib.ps1")

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "нет node в PATH"; exit 1 }

Push-Location $Project
try {
  Write-Host "elt-selfheal: watchdog — гоняю оракул харнесса…"
  $watchdogOut = (& node $watchdog 2>&1 | Out-String)
  $watchdogExit = $LASTEXITCODE
  Write-Host $watchdogOut.TrimEnd()

  if ($watchdogExit -eq 0) {
    Write-Host "elt-selfheal: оракул харнесса зелёный — чинить нечего, стоп."
    exit 0
  }

  Write-Host "elt-selfheal: оракул харнесса красный — self-heal слайс заведён, зову driver (elt-loop.ps1)…"

  $driverArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $driver, "-Project", $Project, "-Slices", $Slices)
  if ($DryRun) { $driverArgs += "-DryRun" }
  $driverOut = (& powershell @driverArgs 2>&1 | Out-String)
  Write-Host $driverOut.TrimEnd()

  # Merge в main — ТОЛЬКО по явному флагу (config ИЛИ CLI), и НИКОГДА под -DryRun
  # (dry-run не должен трогать репозиторий, даже если AutoMerge включён по ошибке).
  $wantMerge = $AutoMerge.IsPresent -or (Get-AutoMergeConfig -Project $Project)
  if ($DryRun) {
    Write-Host "elt-selfheal: merge в main пропущен — DryRun (driver сам был вызван в DryRun-режиме, ничего не закоммичено — мержить нечего)."
    exit 0
  }
  if (-not $wantMerge) {
    Write-Host "elt-selfheal: merge в main пропущен (нужен --AutoMerge или .harness/harness.json selfHeal.autoMerge:true) — по умолчанию мержит человек."
    exit 0
  }

  $healBranch = (& git branch --show-current).Trim()
  Write-Host "elt-selfheal: --AutoMerge — мержу $healBranch в main…"
  $result = Invoke-SelfHealMerge -Project $Project -HealBranch $healBranch
  if (-not $result.merged) {
    if ($result.reason -eq "no-branch") {
      Write-Host "elt-selfheal: driver не создал новую ветку (нечего коммитить?) — merge пропущен."
      exit 0
    }
    Write-Error "elt-selfheal: merge провалился ($($result.reason))"
    exit 1
  }
  Write-Host "elt-selfheal: $healBranch смержена в main."
}
finally {
  Pop-Location
}
