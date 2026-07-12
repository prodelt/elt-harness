# CHECKPOINT 2026-07-08 — ELT v2: драйвер + live-fire ЗАКРЫТЫ (Задачи A+B)

> Продолжение `CHECKPOINT-2026-07-08-elt-v2-core-built-next-driver.md`. Ядро было собрано;
> эта сессия закрыла **Задачу A (драйвер)** и **Задачу B (live-fire на AWE4)**. Осталось **C+D**.

## СДЕЛАНО (Opus 4.8, live-проверено)

| Что | Где | Доказательство |
|---|---|---|
| **Драйвер `tools/elt-loop.ps1`** (160 стр, PS5.1) | Pipeline setupper, ветка `feature/elt-loop-driver` коммит `59cb4d3` | PSParser чисто + DryRun + судья sonnet=pass |
| **Live-fire AWE4** — 2 слайса АВТОНОМНО | `C:\Ametrin projects\Ametrin web ecosystem 4`, ветка `feature/t001-2026-07-08` коммиты `512b8a5`(T001)+`4d44d68`(T002) | run-log.jsonl 2×`verdict:pass`, `[X]`×2, дерево чистое, драйвер exit 0 |

Драйвер: свежий `claude -p` per-слайс → оракул(+1 self-heal) → судья sonnet (обязателен,
REJECT-default) → `elt commit`. Kill-switch `.harness/STOP`, `-DryRun`, бюджет `-MaxMinutes`.

## 4 живых бага, найдены и починены в live-fire (ВАЖНО — durable уроки)

1. **PS5.1 читает .ps1 без BOM как ANSI** → мојибейк кириллицы ломал here-strings. Фикс: писать
   драйвер UTF-8 **с BOM** (`New-Object System.Text.UTF8Encoding($true)` → WriteAllText). После
   каждой правки Edit'ом пере-утвердить BOM.
2. **`claude.exe` warning в stderr + `$ErrorActionPreference='Stop'` + `2>&1`** → PS5.1 оборачивает
   в терминирующий NativeCommandError, драйвер умирал на имплементаторе. Фикс: `Continue` +
   хелпер `Invoke-Claude` со `2>$null` (stderr в null, не merge). Ошибки ловим по `$LASTEXITCODE`.
3. **elt.js `spawnSync('bash')` из PowerShell резолвит WSL bash** (`C:\Windows\system32\bash.exe`),
   где Windows-`just`/`cargo` не видны → оракул `just test` = exit 127. Bash-ТУЛ использует git-bash
   (потому вручную было зелено). Фикс: оракул на **PowerShell-shell без bash** — прямые
   `cargo`/`pnpm`. (git-bash хуки git запускает СВОИМ bash — там ок.)
4. **Оракул ⊉ commit-гейт.** Оракул был `test+build`, а pre-commit хук AWE4 (`core.hooksPath
   .githooks`) гоняет `cargo fmt --check`+clippy+boundaries+eslint. Имплементатор написал тест
   в 1 строку → fmt-check в pre-commit отклонил `git commit` (elt commit exit 1) при зелёном
   оракуле. **Урок: оракул ОБЯЗАН субсумить commit-гейт**, иначе зелёный оракул ≠ commit пройдёт.
   Фикс: оракул = fmt+clippy+test+build; self-heal причёсывает fmt до коммита.

Доп: судья-агент (`claude -p` sonnet) пишет **прозу**, не голый JSON («**Вердикт: pass**»).
Парсер двухуровневый: JSON-ключ `"verdict"` → иначе проза `(verdict|вердикт)\W{0,5}(pass|block)`.
НЕ ловить любой `{...}` (Rust-литералы). Мониторинг: `tail -f` на Windows ЛОЧИТ run-log →
`Add-Content`/`appendFileSync` падают; НЕ тейлить run-log во время прогона.

## AWE4 setup (для повторного прогона)
- `.harness/harness.json`: oracle = `$env:DATABASE_URL='postgres://postgres:postgres@localhost:5544/ecosystem'; cargo fmt --all --check; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}; cargo clippy --workspace --all-targets -- -D warnings; ...; cargo test --workspace; ...; pnpm --dir apps/web build`, shell=powershell, judge sonnet.
- Оракул требует Docker Desktop UP + `just dev-db` (postgis на :5544).
- specs/001-elt-v2-livefire/tasks.md: T001+T002 закрыты `[X]`. Для нового прогона — новые задачи.

## ОСТАЛОСЬ (следующая сессия)
- **Задача C: project-bootstrap v2** (см. исходный чекпоинт, раздел «ЗАДАЧА C»): git init + `elt
  init` + эталонизация доков + реестр `~/.claude/harness-projects.json` + снятие устаревшей
  обвязки + doctor `--fleet`. Прогнать по tg-bot/PDV/Marketing/Route_API/lawyer/Itstep/Fasoli/AWE4.
- **Задача D (хвосты):** CHEATSHEET.html строка про v2; PDV 59 dirty files разобрать С юзером;
  презентации/checkpoints этого репо закоммитить по команде юзера.
- Драйвер: смержить `feature/elt-loop-driver` в main (по команде юзера).
- Занести оракул-субсумит-гейт как правило в bootstrap v2 и, возможно, в /elt SKILL.

## Грабли (доп к исходному чекпоинту)
- git-guard блокирует `git restore .`, `git branch -D`, `reset --hard` даже в интерактиве —
  чистить по ИМЕНАМ файлов (`git restore --staged <path>`) + `git branch -d` (строчная).
- Фоновый Bash-враппер `cmd; echo` показывает exit от `echo` (0), НЕ от `cmd` — реальный exit
  оракула читать из лога, не из враппера.
