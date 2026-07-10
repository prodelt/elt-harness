<#
  elt-loop.ps1 — автономный драйвер ELT v2 (спека: .planning/CHECKPOINT-2026-07-08-elt-v2-core-built-next-driver.md).
  Свежий `claude -p` на КАЖДЫЙ слайс (анти-context-rot) → оракул (+1 retry) → судья sonnet (обязателен,
  REJECT-default) → `elt commit`. Инварианты живут в elt.js (exit-коды), тут только оркестровка.
  PS 5.1: без && / ||, here-string '@ в колонке 0, -Encoding utf8, LASTEXITCODE после native exe.
  Kill-switch: файл <Project>/.harness/STOP. Логи: <Project>/.harness/loop-logs/.
#>
param(
  [string]$Project = ".",
  [int]$Slices = 4,
  [int]$MaxMinutes = 120,
  [string]$JudgeModel = "sonnet",
  [switch]$DryRun
)

# Continue (НЕ Stop): claude.exe пишет безвредный warning в stderr; при Stop+2>&1 PS 5.1
# обернул бы его в терминирующий NativeCommandError. Ошибки native-команд ловим по $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$eltCli = Join-Path $env:USERPROFILE ".claude\bin\elt.js"
$Project = (Resolve-Path $Project).Path
$logDir  = Join-Path $Project ".harness\loop-logs"
$runLog  = Join-Path $Project ".harness\run-log.jsonl"
$stopFile = Join-Path $Project ".harness\STOP"

if (-not (Test-Path $eltCli))              { Write-Error "нет elt CLI: $eltCli"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue))   { Write-Error "нет node в PATH"; exit 1 }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Error "нет claude в PATH"; exit 1 }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Ts { (Get-Date).ToString("yyyyMMdd-HHmmss") }
function Append-RunLog($obj) {
  ($obj | ConvertTo-Json -Compress -Depth 6) | Add-Content -Path $runLog -Encoding utf8
}
# Вызов headless claude. stderr → $null (безвредный stdin-warning не оборачивается в
# терминирующий NativeCommandError). Возвращает stdout строкой, пишет её в лог.
function Invoke-Claude([string[]]$ClaudeArgs, [string]$LogPath, [switch]$Append) {
  $out = (& claude @ClaudeArgs 2>$null | Out-String)
  if ($Append) { $out | Out-File -FilePath $LogPath -Append -Encoding utf8 }
  else         { $out | Out-File -FilePath $LogPath -Encoding utf8 }
  return $out
}

Push-Location $Project
$start = Get-Date
$done = 0
$committed = 0
try {
  for ($i = 1; $i -le $Slices; $i++) {

    # 1. kill-switch + budget
    if (Test-Path $stopFile) { Write-Host "elt-loop: STOP-файл найден — стоп."; break }
    if (((Get-Date) - $start).TotalMinutes -ge $MaxMinutes) { Write-Host "elt-loop: бюджет $MaxMinutes мин исчерпан — стоп."; break }

    # 2. следующий слайс (exit 3 = план закрыт)
    $sliceJson = & node $eltCli slice next --json
    $sliceExit = $LASTEXITCODE
    if ($sliceExit -eq 3) { Write-Host "elt-loop: план закрыт — открытых [ ] задач нет."; break }
    if ($sliceExit -ne 0) { Write-Error "elt slice next вернул $sliceExit"; break }
    $slice = $sliceJson | ConvertFrom-Json
    $id = $slice.id; $text = $slice.text
    Write-Host "`n=== слайс $i/$Slices : $id — $text ==="

    # 3. промпт имплементатора
    $implPrompt = @"
Ты выполняешь ОДИН слайс spec-driven плана. Задача ${id}: ${text}.
Прочитай .specify/memory/constitution.md и spec.md рядом с tasks.md, если они есть.
Сделай МИНИМАЛЬНУЮ имплементацию ТОЛЬКО этой задачи.
НЕ коммить. НЕ правь tasks.md. Тесты не ослаблять и не удалять. Scope не расширять.
После правок приведи код форматтером проекта (cargo fmt / prettier), чтобы пройти pre-commit хук.
"@

    $implLog  = Join-Path $logDir ("{0}-{1}-impl.log"  -f (Ts), $id)
    $judgeLog = Join-Path $logDir ("{0}-{1}-judge.log" -f (Ts), $id)

    if ($DryRun) {
      Write-Host "[DryRun] impl-промпт →`n$implPrompt"
      Write-Host "[DryRun] оракул/судья/commit пропущены. Одна итерация — стоп."
      break
    }

    # 4. имплементатор (свежий контекст)
    Write-Host "elt-loop: имплементатор…"
    Invoke-Claude @('-p', $implPrompt, '--dangerously-skip-permissions') $implLog | Out-Null

    # 5. оракул + 1 retry
    & node $eltCli oracle
    if ($LASTEXITCODE -ne 0) {
      Write-Host "elt-loop: оракул красный — 1 попытка self-heal…"
      $tail = (Get-Content $implLog -Tail 100 -ErrorAction SilentlyContinue) -join "`n"
      $healPrompt = @"
Оракул красный. Хвост лога имплементатора (до 100 строк):
$tail
Почини МИНИМАЛЬНО только то, на что указывает ошибка. Тесты не ослаблять и не удалять. НЕ коммить.
"@
      Invoke-Claude @('-p', $healPrompt, '--dangerously-skip-permissions') $implLog -Append | Out-Null
      & node $eltCli oracle
      if ($LASTEXITCODE -ne 0) {
        Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; oracle = @{ exit = $LASTEXITCODE }; result = "red-stop" }
        Write-Host "elt-loop: оракул всё ещё красный — стоп, НЕ коммичу. Лог: $implLog"
        break
      }
    }

    # 6. СУДЬЯ (обязателен, REJECT-default)
    # intent-to-add: `git diff HEAD` игнорирует untracked-файлы (новые файлы дают пустой
    # дифф → судья без реального контента блуждает по репо своими tool-calls и путает
    # задачу). Зеркало фикса из gate.js (T007/fleet) — без него diff слеп на новых файлах.
    & git add -N -- . 2>$null | Out-Null
    $diff = (& git diff HEAD) -join "`n"
    $porcelain = (& git status --porcelain) -join "`n"
    if ([string]::IsNullOrWhiteSpace($diff) -and [string]::IsNullOrWhiteSpace($porcelain)) {
      Write-Host "elt-loop: имплементатор ничего не изменил — нечего судить/коммитить, стоп."
      break
    }
    # Рубрика scope: constitution + spec.md рядом с tasks.md ($slice.file). Тогда судья меряет
    # scope creep против спеки, а не однострочного заголовка задачи (ELT v2 bridge 2026-07-09).
    $rubric = ""
    $specMd = Join-Path (Split-Path $slice.file -Parent) "spec.md"
    $constMd = Join-Path $Project ".specify\memory\constitution.md"
    if (Test-Path $constMd) { $rubric += "`n--- constitution.md (инварианты проекта) ---`n" + (Get-Content $constMd -Raw -Encoding UTF8) }
    if (Test-Path $specMd)  { $rubric += "`n--- spec.md (объём и что ВНЕ scope) ---`n" + (Get-Content $specMd -Raw -Encoding UTF8) }
    $judgePrompt = @"
Ты судья качества кода. Вход: задача "${id} ${text}", РУБРИКА SCOPE (ниже, если есть) и дифф.
Стойка REJECT-default: ищи причины ОТКЛОНИТЬ:
(1) сделано не то или больше, чем требует спека/задача; (2) тесты удалены/ослаблены/замоканы до пустоты;
(3) side-effects вне scope (сверься с секцией «вне scope» спеки); (4) оверинжиниринг.
ФОРМАТ ОТВЕТА (критично): ПОСЛЕДНЕЙ строкой выведи РОВНО один JSON-объект и ничего после:
{"verdict":"pass","reasons":["..."]}  либо  {"verdict":"block","reasons":["..."]}
Ключ "verdict" обязан присутствовать буквально в JSON. Без него вердикт считается block.
$rubric

--- git status --porcelain ---
$porcelain

--- git diff HEAD ---
$diff
"@
    Write-Host "elt-loop: судья ($JudgeModel)…"
    $judgeOut = Invoke-Claude @('-p', $judgePrompt, '--model', $JudgeModel, '--dangerously-skip-permissions') $judgeLog

    # Парс вердикта. Судья-агент часто пишет прозу вместо голого JSON, поэтому два уровня:
    # (1) JSON-ключ "verdict":"pass|block"; (2) проза «Вердикт/Verdict: pass|block».
    # НЕ ловим любой {...} — в прозе бывают Rust-литералы { status: "ok" }. REJECT-default: не нашли → block.
    $verdict = "block"
    $mJson = [regex]::Match($judgeOut, '"verdict"\s*:\s*"(pass|block)"', 'IgnoreCase')
    if ($mJson.Success) {
      $verdict = $mJson.Groups[1].Value.ToLower()
    } else {
      $mProse = [regex]::Match($judgeOut, '(?i)(?:verdict|вердикт)\W{0,5}(pass|block)')
      if ($mProse.Success) { $verdict = $mProse.Groups[1].Value.ToLower() }
    }

    if ($verdict -ne "pass") {
      Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; verdict = "block"; result = "judge-block" }
      Write-Host "elt-loop: судья BLOCK по $id — НЕ коммичу. Лог: $judgeLog"
      break
    }

    # 7. commit (оракул уже прогнан → --skip-oracle)
    & node $eltCli commit --task $id --skip-oracle --verdict pass
    if ($LASTEXITCODE -ne 0) { Write-Error "elt commit вернул $LASTEXITCODE"; break }
    $done++; $committed++
  }
}
finally {
  Pop-Location
}

# финал
$elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host "`n=== elt-loop итог: слайсов закрыто $done, коммитов $committed, время ${elapsed} мин ==="
if (Test-Path $runLog) { Write-Host ("последний run-log: " + (Get-Content $runLog -Tail 1)) }
