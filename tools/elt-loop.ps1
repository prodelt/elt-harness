<#
  elt-loop.ps1 — автономный драйвер ELT v3.
  Antigravity пишет → активный Claude/Codex исправляет красный oracle → один независимый judge
  (REJECT-default) → `elt commit`. Инварианты живут в elt.js; здесь только оркестровка.
  PS 5.1: без && / ||, here-string '@ в колонке 0, -Encoding utf8, LASTEXITCODE после native exe.
  Kill-switch: файл <Project>/.harness/STOP. Логи: <Project>/.harness/loop-logs/.
#>
param(
  [string]$Project = ".",
  [int]$Slices = 4,
  [int]$MaxMinutes = 120,
  [string]$WriterProvider = "agy",
  [string]$WriterModel = "",
  [string]$FixProvider = "",
  [string]$FixModel = "",
  [string]$JudgeModel = "",
  [string]$JudgeProvider = "",
  [string]$SpecDir = "",
  [int]$Batch = 0,
  [switch]$DryRun
)

# Continue (НЕ Stop): agent CLI может писать безвредный warning в stderr; при Stop+2>&1 PS 5.1
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
if ([string]::IsNullOrWhiteSpace($JudgeModel)) {
  $JudgeModel = switch ($JudgeProvider) { "agy" { "gemini-3.6-flash-high" } "codex" { "gpt-5.6-sol" } default { "sonnet" } }
}
if ([string]::IsNullOrWhiteSpace($WriterModel)) {
  $WriterModel = switch ($WriterProvider) { "agy" { "gemini-3.6-flash-high" } "codex" { "gpt-5.6-sol" } default { "sonnet" } }
}
if ([string]::IsNullOrWhiteSpace($FixProvider)) { $FixProvider = $JudgeProvider }
if ([string]::IsNullOrWhiteSpace($FixModel))    { $FixModel = $JudgeModel }
if ($WriterProvider -eq $JudgeProvider -or $WriterProvider -eq $FixProvider) {
  Write-Error "ELT v3 разводит роли: writer ($WriterProvider) не может проверять/исправлять сам себя. Укажите -JudgeProvider claude|codex."
  exit 4
}

# Батч (2026-07-22): сколько задач имплементируется ПОДРЯД до одного прогона гейта.
# Оракул (~96с) + судья (~40-90с) платятся раз на батч, а не раз на задачу — на мелких
# слайсах гейт стоил дороже самой работы. Инвариант тот же: зелёный оракул + судья по
# объединённому диффу + hash-связанный proof. harness.json → "batch": N; -Batch перебивает.
if ($Batch -le 0 -and (Test-Path $harnessJson) -and $hj.batch) { $Batch = [int]$hj.batch }
if ($Batch -le 0) { $Batch = 1 }

if (-not (Test-Path $eltCli))              { Write-Error "нет elt CLI: $eltCli"; exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue))   { Write-Error "нет node в PATH"; exit 1 }
$writerOverride = [Environment]::GetEnvironmentVariable("FLEET_BIN_$($WriterProvider.ToUpperInvariant())")
$fixOverride = [Environment]::GetEnvironmentVariable("FLEET_BIN_$($FixProvider.ToUpperInvariant())")
if (-not $DryRun) {
  if ([string]::IsNullOrWhiteSpace($writerOverride) -and -not (Get-Command $WriterProvider -ErrorAction SilentlyContinue)) { Write-Error "нет writer CLI '$WriterProvider' в PATH"; exit 1 }
  if ([string]::IsNullOrWhiteSpace($fixOverride) -and -not (Get-Command $FixProvider -ErrorAction SilentlyContinue))       { Write-Error "нет fixer CLI '$FixProvider' в PATH"; exit 1 }
}
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
# Windows PowerShell 5.1 некорректно маршалит сложные argv в native agent CLI. Поэтому
# PowerShell 5.1 (`& $exe @ArgsArray`) сам не умеет корректно маршалить argv-элементы с
# embedded `"` в НАТИВНЫЙ .exe (не только через cmd.exe-шим) — известный дефект легаси
# native-parameter-binding PS5.1. --json-schema и промпты с diff'ами реального кода (где
# кавычки почти неизбежны) молча ломались, ошибка claude.exe уходила в stderr → глушилась
# `2>$null` → пустой лог → REJECT-default блокировал ЛЮБОЙ слайс (обнаружено 2026-07-11,
# A/B fleet-vs-solo, solo T002 — 2 независимых воспроизведения). Обходим маршалинг
# реальный spawn делегирован совместимому мосту tools/claude-invoke.js → providers.js.
# Промпт/схема идут в JSON-дескрипторе через временный файл (без argv вообще) — до node
# долетает только путь к файлу, простая строка без единой кавычки внутри.
$agentInvoke = Join-Path $PSScriptRoot "claude-invoke.js"
function Invoke-Agent {
  param(
    [string]$Provider,
    [string]$Prompt,
    [string]$LogPath,
    [string]$Model = $null,
    [string]$JsonSchema = $null,
    [int]$TimeoutMs = 1200000,
    [string]$Effort = $null,
    [string]$Phase = $null
  )
  $desc = @{ provider = $Provider; prompt = $Prompt; cwd = (Get-Location).Path; model = $Model; jsonSchema = $JsonSchema; timeoutMs = $TimeoutMs; logPath = $LogPath; effort = $Effort; phase = $Phase }
  $descFile = [System.IO.Path]::GetTempFileName()
  try {
    ($desc | ConvertTo-Json -Depth 6 -Compress) | Out-File -FilePath $descFile -Encoding utf8
    return (& node $agentInvoke $descFile 2>$null | Out-String)
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
  if ($SpecDir -ne "") {
    & node $eltCli park --task $Ids --reason $Reason --log $LogPath --spec $SpecDir | Out-Null
  } else {
    & node $eltCli park --task $Ids --reason $Reason --log $LogPath | Out-Null
  }
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

    # 2.2 watchdog между слайсами (009 T008): детекторы поверх run-log/parked/config,
    # решения — из закрытого списка. `park` и `judge-fallback` применяются; `cooldown`
    # драйвер применить НЕ МОЖЕТ (у него один writer, цепочки нет), поэтому
    # он его не молча глотает, а печатает и пишет в run-log: инцидент виден, действие честно
    # помечено неприменимым. ponytail: появится -Worker с цепочкой — здесь и переключать.
    # --judge-provider — ТЕКУЩИЙ судья прогона (флаг запуска или уже применённый фолбэк),
    # а не тот, что записан в harness.json: иначе лимит настоящего судьи признаётся
    # воркерным и уходит в noop, а фолбэк заявляется не от того провайдера.
    $watchRaw = (& node (Join-Path $PSScriptRoot "harness-watch.js") --once --json --judge-provider $JudgeProvider 2>$null | Out-String)
    $watch = $null
    try { $watch = $watchRaw | ConvertFrom-Json } catch { }
    if ($watch -and $watch.actions) {
      # ack ТОЛЬКО за фактически применённое: ключ добавляется внутри ветки, после успеха.
      # Неприменённое (cooldown без цепочки, упавший `elt park`) остаётся неподтверждённым
      # и будет выдано снова — иначе решение теряется молча.
      $watchAcked = @()
      $watchParked = @()
      foreach ($a in $watch.actions) {
        if ($a.action -eq "judge-fallback" -and $a.to) {
          # Провайдер И модель: codex с моделью agy = fatal config, а не фолбэк.
          Write-Host "elt-loop: watchdog — судья $($a.from) мёртв, переключаюсь на $($a.to) до конца прогона."
          $JudgeProvider = $a.to
          if ($a.toModel) { $JudgeModel = $a.toModel }
          Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "watchdog-judge-fallback"; from = $a.from; to = $a.to; model = $JudgeModel }
          $watchAcked += $a.key
        }
        elseif ($a.action -eq "cooldown") {
          # Маршрут в решении есть только у subject=judge (цепочка судей). Имплементатор
          # у драйвера один writer (цепочки нет), поэтому cooldown на него применить нечем:
          # пишем явный noop, а не глотаем решение молча.
          if ($a.subject -eq "judge" -and $a.from -eq $JudgeProvider -and $a.to) {
            Write-Host "elt-loop: watchdog — судья $($a.from) в лимите, увожу на $($a.to)."
            $JudgeProvider = $a.to
            if ($a.toModel) { $JudgeModel = $a.toModel }
            Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "watchdog-judge-cooldown"; from = $a.from; to = $a.to; model = $JudgeModel }
            $watchAcked += $a.key
          } else {
            Write-Host "elt-loop: watchdog — $($a.from) в лимите; у имплементатора драйвера нет цепочки. Записано, не применено."
            Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "watchdog-cooldown-noop"; provider = $a.from }
          }
        }
        elseif ($a.action -eq "park" -and $a.from) {
          Write-Host "elt-loop: watchdog — $($a.from) повторно красный, паркую без новой попытки."
          if ($SpecDir -ne "") {
            & node $eltCli park --task $a.from --reason $a.reason --spec $SpecDir | Out-Null
          } else {
            & node $eltCli park --task $a.from --reason $a.reason | Out-Null
          }
          if ($LASTEXITCODE -eq 0) { $watchAcked += $a.key; $watchParked += ($a.from -split ',') }
          else { Write-Host "elt-loop: watchdog — парковка $($a.from) НЕ удалась (exit $LASTEXITCODE), решение остаётся неподтверждённым." }
        }
      }
      # Подтверждаем ПОСЛЕ применения: упади драйвер раньше — решение выдастся снова.
      if ($watchAcked.Count -gt 0) {
        & node (Join-Path $PSScriptRoot "harness-watch.js") --ack ($watchAcked -join ',') | Out-Null
      }
      # Парковка могла закрыть задачу(-и) из выбранного батча — выбрасываем ИМЕННО их,
      # а не весь батч: остальные слайсы состава ни в чём не виноваты и должны исполниться.
      if ($watchParked.Count -gt 0) {
        $kept = @($picked | Where-Object { $watchParked -notcontains $_.id })
        $dropped = $picked.Count - $kept.Count
        if ($dropped -gt 0) {
          $parked += $dropped; $i += $dropped
          if ($kept.Count -eq 0) { continue }
          $picked = $kept
          $id   = ($picked | ForEach-Object { $_.id }) -join ','
          $text = ($picked | ForEach-Object { "$($_.id): $($_.text)" }) -join '; '
          Write-Host "elt-loop: батч сузился до $id (припарковано $dropped)."
        }
      }
    }

    # 2.5 pre-slice codegraph guard (T009, opt-in via .harness/harness.json
    # codegraphGuard:true) — громкий стоп на мёртвом/устаревшем индексе вместо
    # тихой деградации имплементатора на Read.
    & node (Join-Path $PSScriptRoot "codegraph-guard.js")
    if ($LASTEXITCODE -ne 0) {
      Append-RunLog @{ ts = (Get-Date).ToString("o"); task = $id; result = "codegraph-guard-stop" }
      Write-Host "elt-loop: codegraph-гард не прошёл — СТОП перед $id (см. вывод выше)."
      break
    }

    # 3-4. writer: свежий Antigravity на КАЖДУЮ задачу батча (анти-context-rot),
    # но гейт (шаги 5-7) один на весь батч.
    $logTag = ($picked | ForEach-Object { $_.id }) -join '-'
    $implLog  = Join-Path $logDir ("{0}-{1}-impl.log"  -f (Ts), $logTag)

    foreach ($p in $picked) {
      $pid_ = $p.id; $ptext = $p.text
      # Дерево уже содержит незакоммиченную работу предыдущих задач батча — имплементатор
      # обязан её НЕ трогать, иначе батч съедает сам себя (первая задача откатывается второй).
      $batchNote = if ($picked.Count -gt 1) { "`nВ рабочем дереве уже есть НЕЗАКОММИЧЕННЫЕ правки предыдущих задач этого батча ($id) — не откатывай и не переписывай их, дополняй." } else { "" }
      # Промпт v3 — agy сначала делает разведку, потом пишет код; текущая поверхность проверяет.
      # имплементатор жёг 52 turns и до 205K контекста на слепой Read (codegraph — 0.4% вызовов),
      # потому что промпт открывался запретами и «сделай минимально» — то есть требованием
      # действия до понимания. Порядок секций здесь и есть механизм: разведка названа первой
      # и явно перечислена (зона, спека, существующие тесты), запреты не убраны, а сдвинуты.
      $psize = if ($ptext -match '\[(S|M|L)\]') { $matches[1] } else { $null }
      $agySkillNote = if ($WriterProvider -eq "agy") {
        "ОБЯЗАТЕЛЬНО до работы прочитай C:\Users\user\.gemini\skills\elt\SKILL.md и следуй ему: Antigravity не загружает этот skill автоматически."
      } else { "" }
      $implPrompt = @"
Ты выполняешь ОДИН слайс spec-driven плана. Задача ${pid_}: ${ptext}.
$agySkillNote

1. СНАЧАЛА РАЗБЕРИСЬ (до единой правки):
   - зона задачи: посмотри её через codegraph (codegraph_context по теме задачи, codegraph_explore по символам зоны) — это индекс, он дешевле чтения файлов целиком;
   - рубрика: spec.md рядом с tasks.md и .specify/memory/constitution.md, если они есть — по ним тебя будет судить судья;
   - существующие тесты в зоне: как здесь принято доказывать поведение, какой хелпер/фикстуру переиспользовать вместо своей.
2. ПОТОМ РЕШИ, что именно менять, и сделай МИНИМАЛЬНЫЙ дифф ТОЛЬКО по этой задаче.
3. Тест обязан ЛОВИТЬ поломку: если замокано ровно то, что проверяется, такой тест не считается доказательством.

ЗАПРЕТЫ: НЕ коммить. НЕ правь tasks.md. Тесты не ослаблять и не удалять. Scope не расширять.
После правок приведи код форматтером проекта (cargo fmt / prettier), чтобы пройти pre-commit хук.$batchNote

В САМОМ КОНЦЕ ответа выведи одну строку JSON — заявку о сделанном (пути от корня репо, ровно этот формат):
{"filesChanged":["path/a.js"],"testsAdded":["path/a.test.js"]}
"@

      if ($DryRun) {
        Write-Host "[DryRun] impl-промпт ($pid_) →`n$implPrompt"
        continue
      }
      # Эффорт резолвит effort-policy.js (единый источник уровней), драйвер лишь передаёт тег.
      $implEffort = (& node -e "process.stdout.write(require(process.argv[1]).effortFor('impl', process.argv[2]))" (Join-Path $PSScriptRoot "fleet/effort-policy.js") "$psize")
      Write-Host "elt-loop: writer $WriterProvider/$WriterModel — $pid_ (тег '$psize', эффорт $implEffort)…"
      Invoke-Agent -Provider $WriterProvider -Model $WriterModel -Prompt $implPrompt -LogPath $implLog -Phase "impl" -Effort $implEffort | Out-Null
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
        Write-Host "elt-loop: fixer $FixProvider/$FixModel, попытка $attempt/2 (эффорт $effort)…"
        Invoke-Agent -Provider $FixProvider -Model $FixModel -Prompt $healPrompt -LogPath $implLog -Phase "heal" -Effort $effort | Out-Null
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

    # 6-7. СУДЬЯ + persist (обязателен, REJECT-default) — `elt judge run` (код elt.js), НЕ
    # tools/judge-invoke.js + `judge-proof write` напрямую: при harness.json.judge.attest:true
    # ручная запись вердикта отвергается БЕЗУСЛОВНО (elt.js "вердикт пишет только elt judge
    # run" — обнаружено live 2026-08-05, драйвер стопался exit 4 на первом же слайсе на любом
    # проекте с attest:true). `elt judge run` — тот же путь (тот же judge-invoke.js мост,
    # gate.runJudge: рубрика, один judge, red-proof) и САМ пишет proof + run-log
    # (pass/block/dead/inconclusive, l0-clean) — здесь дублировать нечего.
    $porcelain = (& git status --porcelain) -join "`n"
    if ([string]::IsNullOrWhiteSpace($porcelain)) {
      Write-Host "elt-loop: имплементатор ничего не изменил — нечего судить/коммитить."
      if (-not (Park-Slice -Ids $id -Reason "empty-diff" -LogPath $implLog)) { break }
      $parked += $picked.Count; $i += $picked.Count; continue
    }
    Write-Host "elt-loop: судья ($JudgeProvider/$JudgeModel)…"
    if ($SpecDir -ne "") {
      & node $eltCli judge run --task $id --provider $JudgeProvider --model $JudgeModel --spec $SpecDir | Out-Null
    } else {
      & node $eltCli judge run --task $id --provider $JudgeProvider --model $JudgeModel | Out-Null
    }
    $judgeExit = $LASTEXITCODE
    # Вердикт/лог — из run-log.jsonl (elt judge run уже дописал последнюю строку туда),
    # не из stdout: PS5.1 не маршалит stderr native-процесса в пайплайн надёжно (см. шапку
    # файла), а run-log — тот же протестированный источник истины, что использует `elt stats`.
    $jEntry = $null
    if ($runLog -and (Test-Path $runLog)) {
      try { $jEntry = (Get-Content $runLog -Tail 1 -Encoding utf8 | ConvertFrom-Json) } catch { }
    }
    $jl = if ($jEntry) { $jEntry.judgeLog } else { $null }
    if ($judgeExit -ne 0) {
      $reason = if ($jEntry -and $jEntry.verdict -eq "dead") { "judge-dead" } else { "judge-block" }
      Write-Host "elt-loop: судья $reason по $id — НЕ коммичу. Лог: $jl"
      if (-not (Park-Slice -Ids $id -Reason $reason -LogPath $jl)) { break }
      $parked += $picked.Count; $i += $picked.Count; continue
    }

    if ($SpecDir -ne "") {
      & node $eltCli commit --task $id --skip-oracle --spec $SpecDir
    } else {
      & node $eltCli commit --task $id --skip-oracle
    }
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
