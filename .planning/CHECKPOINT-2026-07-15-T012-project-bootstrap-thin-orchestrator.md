# CHECKPOINT 2026-07-15 — T012 закрыт (project-bootstrap thin orchestrator + strict YAML)

## Что сделано в этом чате

`specs/005-elt-control-plane-convergence` (23 слайса). Закрыт **T012** (`84786bf`).

Проблема: `project-bootstrap` skill жил ТОЛЬКО как три вручную редактируемых копии
(`~/.claude/skills/project-bootstrap/SKILL.md`, `~/.codex/...`, `~/.gemini/...`, 217 строк /
23017 байт каждая, идентичные), не отслеживался репозиторием, и его YAML frontmatter реально
**не проходил строгий YAML-парсинг**: многострочный `changelog:` (folded plain scalar) ловил
`ScannerError`/`ParserError` в PyYAML — подтверждено эмпирически на живом файле до правки.

Сделано:
- **Новый канонический источник** — `skills/project-bootstrap/SKILL.md` (в этом репо, по
  прецеденту `skills/harness-method/`). Тело сокращено с 217 до ~60 строк: тонкий orchestrator
  над `tools/project-bootstrap.js` (команды `inspect`/`plan`/`apply`/`verify`), без дублирования
  политики (контракты docs/harness/oracle/gate/supply-chain уже в CLI, T008-T011). Убрана
  устаревшая ссылка на `install-harness-teeth.js`/`judge-closeout-gate` (реально снят раньше).
- **Frontmatter чинится под настоящий strict YAML**: старый многострочный changelog заменён
  одной цитированной (`"..."`) записью на версию 2.0.0; проверено PyYAML `safe_load` — парсится
  чисто (было: `ScannerError: while scanning a simple key ... could not find expected ':'`).
- **`agent-skills.lock.json`** (новый файл, корень репо) — плоский lock: source-путь, sha256,
  targets (relative-to-home пути для claude/codex/gemini). Отдельно от `config/agent-skill-sources.json`
  (та манифест с review-workflow для другого набора скилов) — этот lock специально под
  критический control-plane набор, который T013 подключит к doctor.
- **Sync через штатный инструмент** — `tools/sync-agent-surface.js` (не руками): скопировал
  новый файл в 3 домашних зеркала, прогнал `--dry-run --json` по codex и gemini — оба репортят
  `project-bootstrap` как `upToDate` (zero diff). sha256 всех 4 копий (репо + 3 клиента)
  идентичен: `de8ca413...17bc5`.

Судья (Agent, `model: sonnet`, свежий контекст, независимо перепроверил PyYAML-парс, byte-diff
зеркал, `inspect`/`plan` smoke, git-статус на соответствие Guard, зелёный оракул) — **pass**.
Полный оракул (`node tools/elt-oracle-runner.js`) — **43/43** (не менялся, репо-код тулов не
трогали — Guard слайса ограничивал diff двумя файлами: `skills/project-bootstrap/SKILL.md`,
`agent-skills.lock.json`; `git status --porcelain` перед коммитом это подтвердил).

## Проверка (Proof)
```
py yamlcheck.py skills/project-bootstrap/SKILL.md   → PARSED OK (PyYAML, было ScannerError)
sha256sum (repo, ~/.claude, ~/.codex, ~/.gemini)     → все de8ca413...17bc5 (identical)
node tools/sync-agent-surface.js --dry-run --target codex --json  → project-bootstrap: upToDate
node tools/sync-agent-surface.js --dry-run --json (gemini)        → project-bootstrap: upToDate
node tools/project-bootstrap.js inspect --root .    → project-bootstrap-inspect: code
node tools/project-bootstrap.js plan --root .       → project-bootstrap-plan: code
node tools/elt-oracle-runner.js                      → 43/43 passed
git status --porcelain (перед коммитом)              → только 2 новых файла (Guard OK)
```

## Git state
- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое.
- Коммит: `84786bf` (T012, `[X]` в tasks.md).

## Дальше
`elt status` → next: **T013** — розширити supply-chain manifest/audit (`agent-skills.lock.json`
+ `tools/doctor-core.js` + `tools/doctor.test.js`) так, щоб `elt`/aliases/`project-bootstrap` були
обов'язковими critical targets; invalid YAML, missing mirror або content drift → fail. Это
последний слайс P0-B — закрывает P0-B целиком, дальше P1-A (T014-T017).

## Resume prompt

```text
elt
Продолжай specs/005-elt-control-plane-convergence с T013 (supply-chain manifest/audit critical
set для elt/aliases/project-bootstrap; wire agent-skills.lock.json в tools/doctor-core.js +
tools/doctor.test.js — invalid YAML/missing mirror/content drift → fail). T001-T012 закрыты
(P0-A целиком + T008-T012 из P0-B), см.
.planning/CHECKPOINT-2026-07-15-T012-project-bootstrap-thin-orchestrator.md.
Порядок закрытия слайса: failing/зелёный оракул → судья (Agent, model:sonnet, свежий
контекст) → elt oracle → elt judge-proof write → elt commit --task T0xx --skip-oracle.
⚠ elt commit --skip-oracle: treeHash считается по `git status --porcelain -uall` + diff HEAD +
содержимое untracked-файлов ВО ВСЁМ дереве — если между judge-proof write и commit
запустить что-то ещё (даже read-only типа полного оракула, который может оставить temp-файлы
внутри репо), proof протухает (stale-tree). Держать judge-proof write → commit --skip-oracle
как две команды подряд без ничего между ними, либо просто `elt commit --task T0xx` без
--skip-oracle (перегоняет оракул сам).
agent-skills.lock.json — НОВЫЙ параллельный к config/agent-skill-sources.json файл (не путать):
там review-workflow-манифест для другого набора скилов, здесь — плоский lock под critical
control-plane набор (elt/project-bootstrap). T013 читает именно lock.json.
Fleet не запускать до T021. Не менять global Codex/Claude config, не делать writes в
registry-проекты без отдельного подтверждения.
```
