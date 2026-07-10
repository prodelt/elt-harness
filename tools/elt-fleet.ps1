<#
.SYNOPSIS
  Обёртка запуска/просмотра ELT Fleet (tools/fleet/fleet.js).
.DESCRIPTION
  Action:
    run    — запустить оркестратор на плане (--Tasks путь к tasks.md, -Workers N).
    status — таблица слайс/провайдер/статус/время из claims+events.
    stop   — выставить .harness/STOP (воркеры гаснут между батчами).
  -Panes (только с run, нужен Windows Terminal wt): запускает прогон в фоне и открывает
  split-pane с Get-Content -Wait по логам воркеров (.harness/fleet/logs).
.EXAMPLE
  ./elt-fleet.ps1 -Action run -Tasks specs/002-elt-fleet/tasks.md -Workers 2 -Panes
  ./elt-fleet.ps1 -Action status -Tasks specs/002-elt-fleet/tasks.md
  ./elt-fleet.ps1 -Action stop
#>
param(
  [ValidateSet('run', 'status', 'stop')][string]$Action = 'status',
  [string]$Project = (Get-Location).Path,
  [int]$Workers = 2,
  [string]$Tasks = '',
  [string]$Integration = '',
  [switch]$Panes
)

$fleet = Join-Path $PSScriptRoot 'fleet\fleet.js'
if (-not (Test-Path $fleet)) { Write-Error "нет fleet.js: $fleet"; exit 1 }

$fleetArgs = @($fleet, $Action)
if ($Tasks) { $fleetArgs += @('--tasks', $Tasks) }
if ($Action -eq 'run') {
  $fleetArgs += @('--workers', $Workers)
  if ($Integration) { $fleetArgs += @('--integration', $Integration) }
}

Push-Location $Project
try {
  if ($Panes -and $Action -eq 'run') {
    if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
      Write-Warning "-Panes требует Windows Terminal (wt) — запускаю без панелей"
      & node @fleetArgs
    }
    else {
      Start-Process node -ArgumentList $fleetArgs
      $logs = Join-Path $Project '.harness\fleet\logs'
      wt split-pane powershell -NoExit -Command "Get-Content -Wait -Path '$logs\*.log'"
    }
  }
  else {
    & node @fleetArgs
  }
}
finally { Pop-Location }
