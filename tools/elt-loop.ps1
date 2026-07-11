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
# Баг #10 (T016) чинили резолвом .cmd-шима в claude.exe — но остался баг глубже: Windows
# PowerShell 5.1 (`& $exe @ArgsArray`) сам не умеет корректно маршалить argv-элементы с
# embedded `"` в НАТИВНЫЙ .exe (не только через cmd.exe-шим) — известный дефект легаси
# native-parameter-binding PS5.1. --json-schema и промпты с diff'ами реального кода (где
# кавычки почти неизбежны) молча ломались, ошибка claude.exe уходила в stderr → глушилась
# `2>$null` → пустой лог → REJECT-default блокировал ЛЮБОЙ слайс (обнаружено 2026-07-11,
# A/B fleet-vs-solo, solo T002 — 2 независимых воспроизведения). Обходим маршалинг
# ПОЛНОСТЬЮ: делегируем реальный spawn в tools/claude-invoke.js → tools/fleet/providers.js
# (Node сам корректно экранирует Windows argv, проверено live тем же прогоном на fleet).
# Промпт/схема идут в JSON-дескрипторе через временный файл (без argv вообще) — до node
# долетает только путь к файлу, простая строка без единой кавычки внутри.
$claudeInvoke = Join-Path $PSScriptRoot "claude-invoke.js"
function Invoke-Claude {
  param(
    [string]$Prompt,
    [string]$LogPath,
    [string]$Model = $null,
    [string]$JsonSchema = $null,
    [int]$TimeoutMs = 1200000
  )
  $desc = @{ prompt = $Prompt; cwd = (Get-Location).Path; model = $Model; jsonSchema = $JsonSchema; timeoutMs = $TimeoutMs; logPath = $LogPath }
  $descFile = [System.IO.Path]::GetTempFileName()
  try {
    ($desc | ConvertTo-Json -Depth 6 -Compress) | Out-File -FilePath $descFile -Encoding utf8
    return (& node $claudeInvoke $descFile 2>$null | Out-String)
  } finally {
    Remove-Item -Path $descFile -ErrorAction SilentlyContinue
  }
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
    Invoke-Claude -Prompt $implPrompt -LogPath $implLog | Out-Null

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
      Invoke-Claude -Prompt $healPrompt -LogPath $implLog | Out-Null
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
ID задачи (T00X) — это порядковый номер ВНУТРИ одной spec-папки и МОЖЕТ повторяться в других
spec-папках того же проекта (T001 в specs/001-foo — не то же самое, что T001 в specs/002-bar).
НЕ ищи историю/другие коммиты/другие ветки по этому ID (git log, gh run view и т.п.) — суди
ИСКЛЮЧИТЕЛЬНО дифф текущего рабочего дерева, приложенный ниже. Пустой или нерелевантный дифф —
повод для block, а не повод искать подтверждение где-то ещё.
Стойка REJECT-default: ищи причины ОТКЛОНИТЬ:
(1) сделано не то или больше, чем требует спека/задача; (2) тесты удалены/ослаблены/замоканы до пустоты;
(3) side-effects вне scope (сверься с секцией «вне scope» спеки); (4) оверинжиниринг.
Дай вердикт pass или block с обоснованием — формат ответа проверяется автоматически (structured output).
$rubric

--- git status --porcelain ---
$porcelain

--- git diff HEAD ---
$diff
"@
    Write-Host "elt-loop: судья ($JudgeModel)…"
    # --json-schema/--output-format json (T016 live-fire): prose-парсер регулярно мимо —
    # модель пишет "принято"/"зачёт" вместо литерального pass/block, REJECT-default тогда
    # блокирует легитимные слайсы. Structured output — надёжный путь, regex ниже — фолбэк.
    # Литеральные кавычки, доставляются через claude-invoke.js (см. Invoke-Claude выше) —
    # PowerShell 5.1 сам их не маршалит, поэтому JSON идёт через дескриптор-файл, не argv.
    $verdictSchema = '{"type":"object","properties":{"verdict":{"type":"string","enum":["pass","block"]},"reasons":{"type":"array","items":{"type":"string"}}},"required":["verdict","reasons"]}'
    $judgeOut = Invoke-Claude -Prompt $judgePrompt -LogPath $judgeLog -Model $JudgeModel -JsonSchema $verdictSchema -TimeoutMs 300000

    # Парс вердикта: (0) structured_output из JSON-массива --output-format json (надёжный путь);
    # (1) JSON-ключ "verdict":"pass|block"; (2) проза «Вердикт/Verdict: pass|block» (фолбэк).
    # НЕ ловим любой {...} — в прозе бывают Rust-литералы { status: "ok" }. REJECT-default: не нашли → block.
    $verdict = "block"
    try {
      $parsed = $judgeOut | ConvertFrom-Json
      $last = if ($parsed -is [array]) { $parsed[$parsed.Count - 1] } else { $parsed }
      if ($last.structured_output -and $last.structured_output.verdict) {
        $sv = [string]$last.structured_output.verdict
        if ($sv -eq "pass" -or $sv -eq "block") { $verdict = $sv }
      }
    } catch { }
    if ($verdict -ne "pass") {
      $mJson = [regex]::Match($judgeOut, '"verdict"\s*:\s*"(pass|block)"', 'IgnoreCase')
      if ($mJson.Success) {
        $verdict = $mJson.Groups[1].Value.ToLower()
      } else {
        $mProse = [regex]::Match($judgeOut, '(?i)(?:verdict|вердикт)\W{0,5}(pass|block)')
        if ($mProse.Success) { $verdict = $mProse.Groups[1].Value.ToLower() }
      }
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
