# Checkpoint - 2026-07-11 21:35

## Задача
Резюме A/B-бенча fleet vs solo (Ametryn Protocol Bot Rust-переписывание,
`specs/001-rust-local-ai-rewrite`, см. [[project_fleet_vs_solo_ab_ametryn_2026-07-11]] и
`CHECKPOINT-2026-07-11-fleet-vs-solo-ab-ametryn.md`). Rate-limit к моменту резюме уже
не был проблемой — вместо этого solo-трек систематически ловил `judge BLOCK` с пустым
логом на T002 ("Инцидент №3" из прошлой памяти повторился один-в-один). В этой сессии
инцидент раскопан до конца и ПОЧИНЕН — это главный результат сессии, отдельный от
самого A/B-бенча.

### Найденный и починенный баг (elt-loop.ps1)
Корень: Windows PowerShell 5.1 (`& $exe @ArgsArray`) не умеет корректно маршалить
argv-элементы с embedded `"` в нативный `.exe` (не только через `.cmd`-шим — это
отдельный, более глубокий дефект, чем уже пофикшенный баг #10 из T016). `--json-schema`
судьи и промпты с git-диффами реального кода (где кавычки почти неизбежны) ломались
молча: ошибка `claude.exe` уходила в stderr, которая глушилась `2>$null` в
`Invoke-Claude`, оставляя пустой лог — REJECT-default блокировал ЛЮБОЙ слайс, неотличимо
от реального reject. По пути найден и второй, компаундирующий баг: `Out-File -Encoding
utf8` в PS5.1 пишет BOM (U+FEFF), из-за чего `JSON.parse` на стороне Node падал бы даже
после первого фикса.

Диагностика заняла 3 итерации (каждая подтверждена ЛИБО безопасным non-agentic вызовом,
ЛИБО релончем уже авторизованного драйвера — НЕ повторными ручными `claude -p
--dangerously-skip-permissions`, auto-mode классификатор верно ограничил это одним
разовым разрешением юзера):
1. Резолв `.cmd`→`.exe` + литеральные (не backslash-escaped) кавычки — недостаточно,
   тот же симптом.
2. Обнаружено: сам PowerShell 5.1, независимо от `.cmd`/cmd.exe, не маршалит кавычки
   корректно в нативный `.exe`. Решение: делегировать реальный spawn в Node
   (`tools/claude-invoke.js`, новый файл) — переиспользует уже проверенный живым
   fleet-прогоном `tools/fleet/providers.js:run()`. Промпт/схема идут в JSON-дескрипторе
   через временный файл (без argv вообще).
3. BOM-баг найден и пофикшен тем же заходом (обрезка `U+FEFF` при чтении дескриптора в
   Node).

Судья (sonnet, explicit) на diff нашёл один legit-косяк первой версии фикса (heal писался
в отдельный `-heal.log` вместо append в `$implLog` — незапрошенная смена поведения),
исправлено, второй проход — **PASS**. Закоммичено `3e73423` на `feature/elt-loop-driver`
(Pipeline Setupper repo).

### Живая валидация фикса
Релонч solo-драйвера на T002 после фикса: судья реально доехал до Claude (29.9с
round-trip, `rate_limit_info:{status:"allowed"}`, полный structured output) и вынес
**легитимный** `verdict:block` — solo-имплементатор реально вылез за scope T002
(добавил `protocol.rs`, относящийся к будущему слайсу). Судья теперь корректно отличает
инфраструктурный сбой от настоящего reject — раньше не мог.

### Побочная находка: fleet T004 abandoned легитимно
Параллельно fleet-трек (T004, whisper-rs FFI, L-размер) 3 раза подряд получил
**настоящий** `judge block` (не `judge-unavailable`-парковку, как раньше при
5-минутном таймауте компиляции) и был корректно заброшен после исчерпания попыток
(`.harness/fleet/events.jsonl`: `heal-failed` → 2×`gate-reject verdict:block` →
`batch-abandoned`). Это штатная работа REJECT-default на трудном слайсе, не баг —
отдельный факт для итогового вердикта A/B.

### Build Status
- Pipeline Setupper: `node --test tools/fleet/*.test.js` — 93/93 зелёные (не менялся
  functionally, только переиспользован из claude-invoke.js). `node --check
  tools/claude-invoke.js` + PS AST parse `tools/elt-loop.ps1` — оба чисты.
- Target repo (оба трека): `cargo build --workspace` зелёный на всех смёрженных слайсах.

### Git State (три места)
- **Pipeline Setupper** (этот репо): branch `feature/elt-loop-driver`, commit `3e73423`
  (фикс, судья pass). 1 uncommitted: `.harness/run-log.jsonl` (M, ожидаемо — драйвер сам
  дописывает при каждом прогоне, не относится к фиксу).
- **Fleet track**: `D:\Ametrin projects\Ametryn_protocol_bot-fleet`, branch
  `fleet/001-rust-local-ai-rewrite`, last commit `74a994a` (merge T003), fleet 3/14.
  T004 (тот же whisper-rs слайс, что и у solo) прошёл ДРУГОЙ путь провала: 2×legit
  judge-block, затем `limit-hit` (rate-limit) → `all-providers-cooling` → драйвер
  остановился сам (`stoppedReason:"all-providers-cooling"`), T004 requeued (не abandoned
  в этом заходе). **Не запущен повторно в конце сессии** — ждёт следующего релонча.
- **Solo track**: `D:\Ametrin projects\Ametryn_protocol_bot-solo`, branch
  `solo/001-rust-local-ai-rewrite`. **Финал сессии:** T002 `6e00282`, T003 `49d1645` —
  solo 3/14 закрыто. T004 (`crates/transcribe`, whisper-rs) — **red-stop, НЕ баг харнесса**:
  `cargo build` реально красный (`error[E0277]` `?`-оператор не на `Try`-типе,
  `error[E0599]` метод `full_get_segment_text` не существует на `WhisperState` в
  установленной версии `whisper-rs` — implementer использовал устаревший/неверный API).
  Self-heal (2 попытки) не справился, драйвер корректно остановился НЕ коммитя красное.
  Uncommitted: `crates/transcribe/{Cargo.toml,src/lib.rs}`, `Cargo.lock`,
  `.harness/run-log.jsonl` — оставлено как есть для следующей сессии (не коммитить,
  не откатывать — рабочее состояние implementer'а, нужно либо чинить API руками/новым
  implementer-прогоном, либо позволить драйверу самому продолжить retry на T004 при
  следующем релонче).

### Completed Tasks
- Диагностирован и починен PowerShell 5.1 native-argv-marshalling баг в
  `tools/elt-loop.ps1` (весь `Invoke-Claude`, все 3 call sites: имплементатор, self-heal,
  судья) — новый `tools/claude-invoke.js`, коммит `3e73423`.
- Диагностирован и починен компаундирующий BOM-баг в том же коммите.
- Судья (sonnet) прошёл фикс после одной итерации правки.
- Live-подтверждено: судья реально работает после фикса (T002 solo — настоящий вердикт,
  не тишина).
- Отмечена легитимность fleet T004 abandonment (не баг, для итогового вердикта A/B).

### Remaining Work
- Дождаться завершения текущих прогонов fleet (`bcl3ewizp`) и solo (`b68re5wox`) —
  оба ещё in-flight на момент записи.
- Продолжать релончить оба трека до исчерпания 13/14 оставшихся слайсов каждого
  (`elt-loop.ps1 -Slices N` / `elt-fleet.ps1 -Action run`), используя PATH-префикс
  cmake+cargo при каждом запуске из персистентной PS/Bash-сессии.
- После прохождения ЗНАЧИТЕЛЬНОГО числа слайсов на обоих треках — сравнить: wall-clock,
  Claude call count/spend, judge pass/block rate, итоговое качество/паритет функций;
  записать вердикт fleet-vs-solo как память, продолжающую
  `project_elt_fleet_003_hardening_2026-07-11`.
- (Опционально) обновить память `project_fleet_vs_solo_ab_ametryn_2026-07-11.md` новым
  инцидентом (PowerShell argv marshalling + BOM) — сейчас есть только этот чекпоинт,
  память ещё не тронута.

### Blockers
Нет активных. Rate-limit не является блокером на момент чекпоинта
(`rate_limit_info:{status:"allowed"}` подтверждён живым вызовом).

### Next Steps
1. Проверить итог фонового `bcl3ewizp` (fleet) и `b68re5wox` (solo) — оба должны
   уведомить по завершении (Monitor task `bjwi953yc` уже слушает merge/block/error
   сигналы в реальном времени).
2. Если T002 solo снова заблокируется на реальном scope creep — это ожидаемо (REJECT-
   default работает верно), просто релончить драйвер заново (фреш имплементатор
   каждый раз, нет автоматического retry на judge-block по дизайну).
3. Копить прогоны до значимого числа слайсов на обоих треках, затем писать итоговый
   A/B-вердикт.

### Сессия завершена (юзер попросил закрыть)
Оба трека остановлены НЕ вручную — оба сами упёрлись в легитимные блокеры (solo:
красная компиляция whisper-rs API на T004; fleet: rate-limit cooling). Ничего фонового
не осталось запущенным, монитор `bjwi953yc` остановлен, дерево Pipeline Setupper чистое
после коммита этого чекпоинта.

### Resume Pointer
- Focus: продолжать fleet vs solo A/B на Ametryn Protocol Bot Rust-rewrite —
  инфраструктура (судья) теперь честно работает на обоих треках (главный результат этой
  сессии), T004 (whisper-rs) — общий для обоих треков затык на реальном API компиляции,
  не на харнессе.
- Resume: (1) починить/уточнить `whisper-rs` API для `full_get_segment_text` (проверить
  актуальную версию crate — возможно нужен другой метод или `?` требует `From`-конверсию
  ошибки) — либо руками в обоих worktree, либо дать implementer-прогону ещё попытку.
  (2) Релончить оба драйвера с PATH-префиксом:
  `$env:PATH = "C:\Program Files\CMake\bin;$env:USERPROFILE\.cargo\bin;" + $env:PATH`
  затем `tools/elt-loop.ps1 -Project "...-solo" -Slices N -MaxMinutes 600 -JudgeModel sonnet`
  и `tools/elt-fleet.ps1 -Action run -Project "...-fleet" -Tasks specs/001-rust-local-ai-rewrite/tasks.md -Workers 3`.
