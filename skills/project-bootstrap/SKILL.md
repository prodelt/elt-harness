---
name: project-bootstrap
description: Make a project reference-grade in one ritual — AI docs + a per-project harness with real blocking teeth (elt gate) + code index + per-project memory + the Context7 habit. Use when starting a new project, onboarding an existing one, or when asked to "set up / bootstrap a project", "make this project etalon/reference-grade", "навести порядок в проекте". Idempotent; a repeat run reports no-op for what is already correct.
version: 2.0.0
requires: []
changelog:
  - "2.0.0 (2026-07-15) — thin orchestrator rewrite (T012, specs/005-elt-control-plane-convergence). tools/project-bootstrap.js now owns every decision (docs contract, harness/oracle contract, git-gate install, spec-readiness, supply-chain, clean-tree) that this file used to spell out as prose; the skill body just calls inspect/plan/apply/verify and reads the report. Also fixes strict-YAML frontmatter: the pre-2.0 multi-line changelog folded across lines in a way real YAML parsers (PyYAML/js-yaml) rejected with a scanner error; entries are single-line now and quoted, so an unquoted colon-space never lands inside a plain scalar again. Canonical source moved from the three hand-edited client copies into this repo path; full pre-2.0 history is prior commits of this file plus git history of the old hand-edited copies."
---

# /project-bootstrap — один ритуал «эталонный проект»

Тонкий orchestrator над одним CLI: `node "<repo>/tools/project-bootstrap.js" <cmd> --root <project> [--json]`.
Ничего не изобретает и не дублирует в прозе — `inspect`/`plan`/`apply`/`verify` уже кодируют
контракты (доки, харнесс/оракул, git-gate, spec-readiness, supply-chain, чистое дерево).
Запускать из корня целевого проекта. Глобально ничего не трогает (анти-AMOS).

## Когда
Новый проект · онбординг существующего · «сделать эталонным / навести порядок». НЕ на каждую
мелкую задачу — для задач `/elt`. Повторный запуск на готовом проекте = серия `noop`.

## Команды

1. **`inspect`** — читает текущее состояние: тип проекта (код/доки/unknown, авто-детект по
   манифестам/расширениям), статус AI-доков, `.harness/harness.json`, codegraph-индекс, git-gate.
   ```bash
   node "<repo-root>/tools/project-bootstrap.js" inspect --root . --json
   ```
2. **`plan`** — те же данные + какие решения CLI примет (нужен ли оракул, судья, git-gate) и
   почему; ничего не пишет.
3. **`apply`** — материализует план: доки (`init-project`-движок), `.planning/STATE.md`-заглушка,
   managed pre-commit gate (`.githooks/pre-commit` → `elt.js gate`). Если для код-домена ещё нет
   валидного оракула — репортит `blocked`, ничего не выдумывает; оракул ставится юзером через
   `elt init --oracle "<test-cmd>"` (см. `/elt`).
   `apply` доставляет и поля экзоскелета v4 (014 T016) в существующий `harness.json`:
   `verify: "background"` (коммит возвращает управление, тяжёлые слои уходят в фон на хеше
   коммита), `backgroundTimeoutMin: 20` (дольше молчания → инцидент `bg-silent`),
   `background.layers` (сьют/мутатор/smoke/судья, все включены) и `smokeParallel: false`
   (параллельный smoke — только с явного разрешения владельца проекта: порты и внешние
   сервисы не терпят второго экземпляра). Существующий конфиг БЕЗ этих полей продолжает
   работать по-старому — их отсутствие означает синхронное поведение 011.
   ```bash
   node "<repo-root>/tools/project-bootstrap.js" apply --root . --json
   ```
4. **`verify`** — контракты docs/harnessConfig/oracleVerifier/gate/skillAvailability +
   сигналы specReadiness/cleanTree. `ok:true` = проект готов.
   ```bash
   node "<repo-root>/tools/project-bootstrap.js" verify --root . --json
   ```

## Что остаётся ручным (по требованию, не скаффолдится)
- **codegraph** — только код-домен: `codegraph status .` → если нет индекса, `codegraph index .`
  (дальше сам через file-watcher). CLI это не проверяет напрямую — доверять `.codegraph/codegraph.db`.
- **Передняя половина петли** (цель → `specs/NNN/{spec,tasks}.md`) — это `/elt` Режим 0, не
  бутстрап; `verify.signals.specReadiness` только репортит статус (idle/active/complete), не создаёт.
- **spec-kit toolchain** — не ставим, дублирует то же самое другим движком.
- **Context7-привычка** — убедиться, что в проектном CLAUDE.md/AGENTS.md есть строка про `ctx7`
  перед кодом с внешней либой; не MCP-плагин (токен-налог).

## Closeout — Done только с proof
Приложить вывод `verify --json` (`ok:true`) + для код-домена live-fire полного цикла:
маленькая реальная цель → `/elt` Режим 0 → один слайс (оракул → судья → `elt commit`) → запись
в `.harness/run-log.jsonl`. Полуцикл (оракул есть, `specs/` нет) ловит `doctor.js --fleet`.

## Красные линии (анти-AMOS)
Никаких новых глобальных хуков, никакого инжекта в контекст каждый ход. Конфиг per-project,
не мутировать глобальные настройки в фоне. Идемпотентность: повтор на готовом проекте — только
ретрофит недостающего, без задвоения.

## Связь
Карта — `docs/USAGE.md`. Метод харнесса — `/harness-method`. Флот-обзор по всем проектам —
`node tools/doctor.js --fleet`. Точка входа задач после bootstrap — `/elt`.
