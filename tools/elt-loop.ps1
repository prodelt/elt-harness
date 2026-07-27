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
  [string]$JudgeModel = "",
  [string]$JudgeProvider = "",
  [string]$SpecDir = "",
  [int]$Batch = 0,
  [switch]$DryRun
)

# Continue (НЕ Stop): claude.exe пишет безвредный warning в stderr; при Stop+2>&1 PS 5.1
# обернул бы его в терминирующий NativeCommandError. Ошибки native-команд ловим по $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$eltCli = Join-Path $env:USERPROFILE ".claude\bin\elt.js"
$Project = (Resolve-Path $Project).Path
$logDir  = Join-Path $Project ".harness\loop-logs"
$gitDir = (& git -C $Project rev-parse --git-dir 2>$null | Select-Object -First 1)
if (-not [string]::IsNullOrWhiteSpace($gitDir) -and -not [System.IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $Project $gitDir }
$runLog  = if ([string]::IsNullOrWhiteSpace($gitDir)) { $null } else { Join-Path $gitDir "elt\run-log.jsonl" }
$stopFile = Join-Path $Project ".harness\STOP"

# Судья — из harness.json проекта (единый источник, tools/elt-config.js judgeSettings);
# явные -JudgeProvider/-JudgeModel перебивают. Раньше здесь был литерал "sonnet", из-за
# которого правка harness.json молча не действовала на solo-драйвер.
$harnessJson = Join-Path $Project ".harness\harness.json"
if (Test-Path $harnessJson) {
  $hj = (Get-Content $harnessJson -Raw | ConvertFrom-Json)
  if ([string]::IsNullOrWhiteSpace($JudgeProvider) -and $hj.judge.provider) { $JudgeProvider = $hj.judge.provider }
  if ([string]::IsNullOrWhiteSpace($JudgeModel)    -and $hj.judge.model)    { $JudgeModel    = $hj.judge.model }
}
if ([string]::IsNullOrWhiteSpace($JudgeProvider)) { $JudgeProvider = "claude" }
if ([string]::IsNullOrWhiteSpace($JudgeModel))    { $JudgeModel    = "sonnet" }

# Батч (2026-07-22): сколько задач имплементируется ПОДРЯД до одного прогона гейта.
# Оракул (~96с) + судья (~40-90с) платятся раз на батч, а не раз на задачу — на мелких
# слайсах гейт стоил дороже самой работы. Инвариант тот же: зелёный оракул + судья по
# объединённому диффу + hash-связанный proof. harness.json → "batch": N; -Batch перебивает.
if ($Batch -le 0 -and (Test-Path $harnessJson) -and $hj.batch) { $Batch = [int]$hj.batch }
if ($Batch -le 0) { $Batch = 1 }

if (-not (Test-Path $eltCli))              { Write-Error "нет elt CLI: $eltCli"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue))   { Write-Error "нет node в PATH"; exit 1 }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Error "нет claude в PATH"; exit 1 }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if ($runLog) {
  New-Item -ItemType Directory -Force -Path (Split-Path $runLog -Parent) | Out-Null
  Push-Location $Project
  try { & node $eltCli status | Out-Null; $migrationExit = $LASTEXITCODE }
  finally { Pop-Location }
  if ($migrationExit -ne 0) { Write-Error "elt-loop: не удалась проверенная миграция run-log"; exit $migrationExit }
}

function Ts { (Get-Date).ToString("yyyyMMdd-HHmmss") }
function Append-RunLog($obj) {
  if ($runLog) { ($obj | ConvertTo-Json -Compress -Depth 6) | Add-Content -Path $runLog -Encoding utf8 }
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
    [int]$TimeoutMs = 1200000,
    [string]$Effort = $null,
    [string]$Phase = $null
  )
  $desc = @{ prompt = $Prompt; cwd = (Get-Location).Path; model = $Model; jsonSchema = $JsonSchema; timeoutMs = $TimeoutMs; logPath = $LogPath; effort = $Effort; phase = $Phase }
  $descFile = [System.IO.Path]::GetTempFileName()
  try {
    ($desc | ConvertTo-Json -Depth 6 -Compress) | Out-File -FilePath $descFile -Encoding utf8
    return (& node $claudeInvoke $descFile 2>$null | Out-String)
  } finally {
    Remove-Item -Path $descFile -ErrorAction SilentlyContinue
  }
}

# 009 T004 — park & continue. Слайс, не прошедший гейт (red-stop / judge-block / judge-dead /
# пустой дифф), раньше убивал ВЕСЬ прогон: одна упрямая задача съедала автономку целиком, а
# остальной план оставался нетронутым. Теперь он паркуется (`elt park` → .harness/parked.json,
# `slice next` его пропускает), дерево откатывается в stash, петля берёт следующий слайс.
# Жёсткие стопы остаются жёсткими: STOP-файл, бюджет, slice next, approval, codegraph-guard.
function Park-Slice {
  param([string]$Ids, [string]$Reason, [string]$LogPath)
  # Откат первым, парковка после. `stash -u` забирает untracked, но НЕ игнорируемое —
  # поэтому parked.json (его игнор пишет `elt park` в .git/info/exclude) переживает откат;
  # иначе парковка уехала бы в stash и петля взяла бы тот же павший слайс по кругу.
  & git stash push -u -m "elt-park $Ids" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    # Откат не состоялся: правки павшего слайса остались в дереве и утекли бы в дифф
    # следующего (судья вменил бы их ему как чужой scope creep). Жёсткий стоп.
    Write-Host "elt-loop: git stash вернул $LASTEXITCODE — дерево НЕ откачено, СТОП (правки $Ids загрязнили бы следующий слайс)."
    return $false
  }
  & node $eltCli park --task $Ids --reason $Reason --log $LogPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    # Парковка не записалась → `slice next` снова отдаст этот же слайс, и петля будет
    # молотить его до конца бюджета. Это поломка харнесса, а не слайса — жёсткий стоп.
    Write-Host "elt-loop: elt park вернул $LASTEXITCODE — парковка НЕ записана, СТОП (иначе петля зациклится на $Ids)."
    return $false
  }
  Write-Host "elt-loop: $Ids ПРИПАРКОВАН ($Reason) — беру следующий слайс. Лог: $LogPath"
  return $true
}

Push-Location $Project
$start = Get-Date
$done = 0
$committed = 0
$parked = 0
try {
  # 0. pre-run approval guard (006 T004, opt-in via harness.json
  # specApproval:true) — громкий стоп ДО первого слайса вместо тихого
  # "elt slice next вернул 4" внутри цикла (T002's per-task gate).
  # env var, not a positional arg: PS5.1 silently DROPS an empty-string ("")
  # positional when marshalling argv to a native exe (node.exe) — passing
  # $Project "" $eltCli here would shift $eltCli into the specDir slot and
  # silently no-op the whole guard (found live: unapproved fixture, exit 0).
  $env:ELT_CLI = $eltCli
  # -SpecDir (006 T019): pin the guard (and slice next below) to one spec when
  # another specs/*/tasks.md also has open boxes — otherwise both auto-detect
  # via the alphabetically-first one, which can block an unrelated active spec.
  if ($SpecDir -ne "") {
    & node (Join-Path $PSScriptRoot "approval-guard.js") $Project $SpecDir
  } else {
    & node (Join-Path $PSScriptRoot "approval-guard.js") $Project
  }
  $approvalOk = ($LASTEXITCODE -eq 0)
  if (-not $approvalOk) {
    Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $null; result = "approval-guard-stop" }
    Write-Host "elt-loop: спека не утверждена — СТОП (см. вывод approval-guard выше)."
  }

  $i = 0
  while ($i -lt $Slices) {
    if (-not $approvalOk) { break }

    # 1. kill-switch + budget
    if (Test-Path $stopFile) { Write-Host "elt-loop: STOP-файл найден — стоп."; break }
    if (((Get-Date) - $start).TotalMinutes -ge $MaxMinutes) { Write-Host "elt-loop: бюджет $MaxMinutes мин исчерпан — стоп."; break }

    # 2. следующие слайсы батча (exit 3 = план закрыт). --count 1 отдаёт объект (не массив) —
    # @() нормализует обе формы в массив, парсер не зависит от размера батча.
    $take = [Math]::Min($Batch, $Slices - $i)
    if ($SpecDir -ne "") {
      $sliceJson = & node $eltCli slice next --json --count $take --spec $SpecDir
    } else {
      $sliceJson = & node $eltCli slice next --json --count $take
    }
    $sliceExit = $LASTEXITCODE
    if ($sliceExit -eq 3) { Write-Host "elt-loop: план закрыт — открытых [ ] задач нет."; break }
    if ($sliceExit -ne 0) { Write-Error "elt slice next вернул $sliceExit"; break }
    # PS 5.1: ConvertFrom-Json отдаёт массив ОДНИМ объектом (Object[] без развёртывания) —
    # `@(...)` вокруг него даёт массив-из-одного, и весь батч склеивается в один промпт
    # (поймано DryRun'ом 2026-07-22). foreach-statement разворачивает по IEnumerable честно,
    # и одиночный объект (--count 1) проходит через него без изменений.
    $parsed = $sliceJson | ConvertFrom-Json
    $picked = @()
    foreach ($x in $parsed) { $picked += $x }
    if ($picked.Count -eq 0) { Write-Host "elt-loop: slice next вернул пусто — стоп."; break }
    $id   = ($picked | ForEach-Object { $_.id }) -join ','
    $text = ($picked | ForEach-Object { "$($_.id): $($_.text)" }) -join '; '
    Write-Host "`n=== батч $($i + 1)-$($i + $picked.Count)/$Slices : $id ==="

    # 2.5 pre-slice codegraph guard (T009, opt-in via .harness/harness.json
    # codegraphGuard:true) — громкий стоп на мёртвом/устаревшем индексе вместо
    # тихой деградации имплементатора на Read.
    & node (Join-Path $PSScriptRoot "codegraph-guard.js")
    if ($LASTEXITCODE -ne 0) {
      Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "codegraph-guard-stop" }
      Write-Host "elt-loop: codegraph-гард не прошёл — СТОП перед $id (см. вывод выше)."
      break
    }

    # 3-4. имплементатор: СВЕЖИЙ claude на КАЖДУЮ задачу батча (анти-context-rot),
    # но гейт (шаги 5-7) один на весь батч.
    $logTag = ($picked | ForEach-Object { $_.id }) -join '-'
    $implLog  = Join-Path $logDir ("{0}-{1}-impl.log"  -f (Ts), $logTag)
    $judgeLog = Join-Path $logDir ("{0}-{1}-judge.log" -f (Ts), $logTag)

    foreach ($p in $picked) {
      $pid_ = $p.id; $ptext = $p.text
      # Дерево уже содержит незакоммиченную работу предыдущих задач батча — имплементатор
      # обязан её НЕ трогать, иначе батч съедает сам себя (первая задача откатывается второй).
      $batchNote = if ($picked.Count -gt 1) { "`nВ рабочем дереве уже есть НЕЗАКОММИЧЕННЫЕ правки предыдущих задач этого батча ($id) — не откатывай и не переписывай их, дополняй." } else { "" }
      $implPrompt = @"
Ты выполняешь ОДИН слайс spec-driven плана. Задача ${pid_}: ${ptext}.
Прочитай .specify/memory/constitution.md и spec.md рядом с tasks.md, если они есть.
Сделай МИНИМАЛЬНУЮ имплементацию ТОЛЬКО этой задачи.
НЕ коммить. НЕ правь tasks.md. Тесты не ослаблять и не удалять. Scope не расширять.
Тест обязан ЛОВИТЬ поломку: если замокано ровно то, что проверяется, такой тест не считается доказательством.
После правок приведи код форматтером проекта (cargo fmt / prettier), чтобы пройти pre-commit хук.$batchNote
"@

      if ($DryRun) {
        Write-Host "[DryRun] impl-промпт ($pid_) →`n$implPrompt"
        continue
      }
      Write-Host "elt-loop: имплементатор $pid_… (эффорт high)"
      Invoke-Claude -Prompt $implPrompt -LogPath $implLog -Phase "impl" | Out-Null
    }
    if ($DryRun) {
      Write-Host "[DryRun] оракул/судья/commit пропущены. Одна итерация — стоп."
      break
    }

    # 5. оракул + до 2 попыток self-heal (009 T005). Раньше heal получал ТОЛЬКО хвост
    # impl-лога — что имплементатор делал, но не текст ошибки, на которую он должен
    # реагировать; чинил вслепую. Теперь первым в промпт идёт вывод самого оракула
    # (.harness/oracle-tail.log), impl-лог — вторичной секцией. Вторая попытка на эффорте max.
    & node $eltCli oracle
    if ($LASTEXITCODE -ne 0) {
      $oracleTail = Join-Path $Project ".harness\oracle-tail.log"
      $healed = $false
      foreach ($attempt in 1..2) {
        $errTail = (Get-Content $oracleTail -Tail 120 -ErrorAction SilentlyContinue) -join "`n"
        $tail = (Get-Content $implLog -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
        $effort = if ($attempt -eq 1) { "high" } else { "max" }
        $healPrompt = @"
Оракул красный. ВЫВОД ОРАКУЛА (это и есть ошибка, чини по нему):
$errTail

Хвост лога имплементатора (контекст, что он делал):
$tail
Почини МИНИМАЛЬНО только то, на что указывает ошибка. Тесты не ослаблять и не удалять. НЕ коммить.
"@
        Write-Host "elt-loop: self-heal попытка $attempt/2 (эффорт $effort)…"
        Invoke-Claude -Prompt $healPrompt -LogPath $implLog -Phase "heal" -Effort $effort | Out-Null
        & node $eltCli oracle
        Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "heal"; healAttempt = $attempt; effort = $effort; oracle = @{ exit = $LASTEXITCODE } }
        if ($LASTEXITCODE -eq 0) { $healed = $true; break }
      }
      if (-not $healed) {
        Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; oracle = @{ exit = $LASTEXITCODE }; result = "red-stop" }
        Write-Host "elt-loop: оракул всё ещё красный — НЕ коммичу. Лог: $implLog"
        if (-not (Park-Slice -Ids $id -Reason "red-stop" -LogPath $implLog)) { break }
        $parked += $picked.Count; $i += $picked.Count; continue
      }
    }

    # 6. СУДЬЯ (обязателен, REJECT-default) — делегирован в tools/judge-invoke.js → gate.runJudge().
    # T002 (004-elt-selfdrive): inline-PS парсинг раньше НЕ отличал «судья не отработал»
    # (пустой вывод/timeout/spawn-fail) от block → REJECT-default оставлял $verdict="block" →
    # judge-block, неотличимо от реального reject (баг 3e73423 — судья молча блокировал ВСЁ).
    # Теперь runOk:false = judge-dead (ERROR-STOP), а не тихий block. Один протестированный
    # источник истины (gate.runJudge, инвариант runOk), а не хрупкий PS-дубль парсинга/рубрики.
    $porcelain = (& git status --porcelain) -join "`n"
    if ([string]::IsNullOrWhiteSpace($porcelain)) {
      Write-Host "elt-loop: имплементатор ничего не изменил — нечего судить/коммитить."
      if (-not (Park-Slice -Ids $id -Reason "empty-diff" -LogPath $implLog)) { break }
      $parked += $picked.Count; $i += $picked.Count; continue
    }
    Write-Host "elt-loop: судья ($JudgeProvider/$JudgeModel)…"
    # Дескриптор через файл (без argv-кавычек, PS5.1). judge-invoke сам грузит рубрику spec.md
    # рядом с tasks.md слайса и строит промпт (gate.runJudge/loadRubric — уже под тестом).
    $jDesc = @{ cwd = (Get-Location).Path; tid = $id; taskText = $text; provider = $JudgeProvider; model = $JudgeModel; specFile = $picked[0].file }
    $jDescFile = [System.IO.Path]::GetTempFileName()
    $judgeRaw = ""
    try {
      ($jDesc | ConvertTo-Json -Compress) | Out-File -FilePath $jDescFile -Encoding utf8
      $judgeRaw = (& node (Join-Path $PSScriptRoot "judge-invoke.js") $jDescFile 2>$null | Out-String)
    } finally {
      Remove-Item -Path $jDescFile -ErrorAction SilentlyContinue
    }
    $j = $null
    try { $j = $judgeRaw | ConvertFrom-Json } catch { }
    if (-not $j -or -not $j.runOk) {
      # judge-dead: судья не отработал (нет JSON / runOk:false) — ERROR-STOP, НЕ молчаливый block.
      $jl = if ($j) { $j.judgeLog } else { "(нет JSON от judge-invoke)" }
      Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "judge-dead"; judgeLog = $jl }
      Write-Host "elt-loop: судья НЕ отработал (judge-dead) — НЕ коммичу. Лог: $jl"
      if (-not (Park-Slice -Ids $id -Reason "judge-dead" -LogPath $jl)) { break }
      $parked += $picked.Count; $i += $picked.Count; continue
    }
    if ($j.verdict -ne "pass") {
      Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; verdict = "block"; result = "judge-block" }
      Write-Host "elt-loop: судья BLOCK по $id — НЕ коммичу. Лог: $($j.judgeLog)"
      if (-not (Park-Slice -Ids $id -Reason "judge-block" -LogPath $j.judgeLog)) { break }
      $parked += $picked.Count; $i += $picked.Count; continue
    }

    # 7. Persist the judge result against this exact green-oracle tree, then commit.
    # judges[]/grounding/redProof (008 T004) идут временным файлом, не argv — JSON с
    # embedded-кавычками бьётся о тот же PS5.1 native-marshalling баг, что и Invoke-Claude
    # выше (claude.exe/node.exe не маршалят `"` внутри аргумента корректно).
    # reasons верхнего уровня — тем же файлом. Раньше здесь стоял литерал `--reasons-json "[]"`,
    # и обоснования живого судьи в пруф НЕ попадали: файл, ради которого весь протокол
    # доказательности, был содержательно пуст (видно в proof T002/T003 — `"reasons": []`
    # при судье с развёрнутым разбором).
    $extra = @{ judges = $j.judges; grounding = $j.grounding; redProof = $j.redProof; reasons = $j.reasons }
    $extraFile = [System.IO.Path]::GetTempFileName()
    try {
      ($extra | ConvertTo-Json -Compress -Depth 8) | Out-File -FilePath $extraFile -Encoding utf8
      & node $eltCli judge-proof write --task $id --verdict pass --model $JudgeModel --extra-file $extraFile
    } finally {
      Remove-Item -Path $extraFile -ErrorAction SilentlyContinue
    }
    if ($LASTEXITCODE -ne 0) { Write-Error "judge proof вернул $LASTEXITCODE"; break }
    & node $eltCli commit --task $id --skip-oracle
    if ($LASTEXITCODE -ne 0) { Write-Error "elt commit вернул $LASTEXITCODE"; break }
    $done += $picked.Count; $committed++
    $i += $picked.Count
  }
}
finally {
  Pop-Location
}

# финал: закрытые и припаркованные — РАЗДЕЛЬНО, и ненулевой exit при непустой парковке
# (иначе «прогон прошёл, exit 0» скрывает, что половина плана не сделана).
$elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host "`n=== elt-loop итог: слайсов закрыто $done, коммитов $committed, припарковано $parked, время ${elapsed} мин ==="
# Источник истины про парковку — файл, а не счётчик прогона: парковки прошлых прогонов
# так же означают «план не сделан», и exit 0 при них врал бы вызывающему (CI/обёртке).
$parkedFile = Join-Path $Project ".harness\parked.json"
$parkedAll = @()
if (Test-Path $parkedFile) { foreach ($p in (Get-Content $parkedFile -Raw | ConvertFrom-Json)) { $parkedAll += $p } }
if ($parkedAll.Count -gt 0) {
  Write-Host ("припаркованы, всего {0} (снять: elt park --clear --task Txxx):" -f $parkedAll.Count)
  foreach ($p in $parkedAll) {
    Write-Host ("  {0} — {1} (попыток {2}) {3}" -f $p.tid, $p.reason, $p.attempts, $p.logPath)
  }
}
if (Test-Path $runLog) { Write-Host ("последний run-log: " + (Get-Content $runLog -Tail 1)) }
if ($parkedAll.Count -gt 0) { exit 1 }
