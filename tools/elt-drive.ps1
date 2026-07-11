<#
  elt-drive.ps1 — T007: session-rotation драйвер на НАТИВНЫХ примитивах (T014).
  В отличие от elt-loop.ps1 (спек-план, слайс = отдельный fresh `claude -p`), это
  "авто new+elt" для СВОБОДНОЙ цели (не tasks.md): bounded `-p`-раунд (один headless
  вызов, границу ставит сам claude, завершая ответ) → чекпоинт (`elt status`) →
  следующий раунд СВЕЖИМ session-id (дефолт — избегаем context-rot) ИЛИ тем же
  session-id через `--resume` (флаг -Resume). PS 5.1: без && / ||, here-string '@
  в колонке 0, -Encoding utf8. Kill-switch: <Project>/.harness/STOP.
#>
param(
  [string]$Project = ".",
  [Parameter(Mandatory = $true)][string]$Goal,
  [int]$Rounds = 4,
  [int]$MaxMinutes = 120,
  [switch]$Resume,
  [switch]$DryRun
)

$ErrorActionPreference = "Continue"
# PS5.1 console stdout по умолчанию не UTF-8 (портит кириллицу при захвате execFileSync
# encoding:'utf8' в тестах/из Node) — тот же класс BOM-ловушки, что и Out-File, но на выходе.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$eltCli = Join-Path $env:USERPROFILE ".claude\bin\elt.js"
$Project = (Resolve-Path $Project).Path
$logDir = Join-Path $Project ".harness\loop-logs"
$stopFile = Join-Path $Project ".harness\STOP"

if (-not $DryRun) {
  if (-not (Test-Path $eltCli)) { Write-Error "нет elt CLI: $eltCli"; exit 1 }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "нет node в PATH"; exit 1 }
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Error "нет claude в PATH"; exit 1 }
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$claudeInvoke = Join-Path $PSScriptRoot "claude-invoke.js"
function Invoke-ClaudeSession {
  param([string]$Prompt, [string]$LogPath, [string]$SessionId, [bool]$ResumeSession)
  $desc = @{ prompt = $Prompt; cwd = (Get-Location).Path; logPath = $LogPath; sessionId = $SessionId; resume = $ResumeSession }
  $descFile = [System.IO.Path]::GetTempFileName()
  try {
    ($desc | ConvertTo-Json -Depth 6 -Compress) | Out-File -FilePath $descFile -Encoding utf8
    return (& node $claudeInvoke $descFile 2>$null | Out-String)
  } finally {
    Remove-Item -Path $descFile -ErrorAction SilentlyContinue
  }
}

# Короткое резюме между раундами — источник данных `elt status` (T001 single-source),
# не отдельный парсер git/tasks.md. Живёт рядом с loop-логами (не .planning/ — тот
# формат владеет T006 для интерактивных сессий, у драйвера свой раундовый артефакт).
function Write-RoundCheckpoint {
  param([int]$Round)
  $statusJson = & node $eltCli status 2>$null
  $checkpointPath = Join-Path $logDir ("drive-{0}-round{1}-checkpoint.md" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $Round)
  $summary = "нет данных elt status"
  try {
    $s = $statusJson | ConvertFrom-Json
    $next = if ($s.plan.next) { $s.plan.next } else { "план закрыт" }
    $lastCommit = if ($s.lastRun.commit) { $s.lastRun.commit } else { "(none)" }
    $summary = "последний коммит: $lastCommit`nследующий слайс: $next"
  } catch { }
  Set-Content -Path $checkpointPath -Value $summary -Encoding utf8
  return $summary
}

Push-Location $Project
$start = Get-Date
$sessionId = [guid]::NewGuid().ToString()
$roundsRun = 0
$lastCheckpoint = $null
try {
  for ($i = 1; $i -le $Rounds; $i++) {

    if (Test-Path $stopFile) { Write-Host "elt-drive: STOP-файл найден — стоп."; break }
    if (((Get-Date) - $start).TotalMinutes -ge $MaxMinutes) { Write-Host "elt-drive: бюджет $MaxMinutes мин исчерпан — стоп."; break }

    $useResume = ($Resume.IsPresent -and $i -gt 1)
    if (-not $useResume -and $i -gt 1) { $sessionId = [guid]::NewGuid().ToString() }

    if ($i -eq 1) {
      $prompt = @"
Автономная цель (не spec-план): $Goal
Работай через /elt-дисциплину: если цель требует нескольких шагов — сначала спека+tasks.md
(Режим 0), затем слайсы; каждый слайс закрывай `elt commit` (оракул зелёный + судья pass).
Не выходи за границы цели.
"@
    } else {
      $prompt = @"
Продолжение автономной цели: $Goal
Резюме предыдущего раунда:
$lastCheckpoint
Продолжай через /elt-дисциплину (см. выше).
"@
    }

    Write-Host "elt-drive: раунд $i/$Rounds session-id=$sessionId resume=$useResume"

    if ($DryRun) {
      Write-Host "elt-drive: [DryRun] промпт →`n$prompt"
      Write-Host "elt-drive: [DryRun] чекпоинт между раундами: elt status → .harness/loop-logs/*checkpoint.md (пропущено, DryRun, живой claude не зовём)"
      $roundsRun++
      continue
    }

    $roundLog = Join-Path $logDir ("{0}-round{1}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $i)
    Write-Host "elt-drive: раунд $i — вызов claude…"
    Invoke-ClaudeSession -Prompt $prompt -LogPath $roundLog -SessionId $sessionId -ResumeSession $useResume | Out-Null

    $lastCheckpoint = Write-RoundCheckpoint -Round $i
    $roundsRun++
  }
}
finally {
  Pop-Location
}

$elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host "`n=== elt-drive итог: раундов $roundsRun/$Rounds, время ${elapsed} мин ==="
