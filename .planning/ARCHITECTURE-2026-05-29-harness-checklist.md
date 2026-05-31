# ARCHITECTURE — Harness Self-Audit Checklist (S54)

**Date:** 2026-05-29
**Slug:** harness-checklist
**Sprint:** Agent Harness (continuation of S51/S52)

## Problem

Запрос: «установить наш собственный глобальный Agent harness с помощью `ai-boost/awesome-harness-engineering`».
Реальность (проверено по primary source — GitHub tree + LICENSE): репозиторий — **awesome-list под CC0 1.0** + 4 markdown-шаблона. Устанавливаемого кода нет. Намерение в реальной форме: взять production-readiness чеклист, прогнать им наш существующий harness (`tools/harness-runner.js`, S51/S52), закрепить проверку в `doctor`, адаптировать шаблоны.

## Decision

Audit-and-adopt инкремент, **harness не переписываем**. Три компонента:

1. **`tools/harness-checklist.js`** — гибрид `agent-surface-audit.js` (аудит-структура + `--markdown`) и `docs-gate.js` (`checkArtifact` + TTL + `writeArtifact`). 6 категорий ai-boost, каждая с auto- и manual-пунктами.
2. **`doctor` интеграция** — `checkHarnessChecklist` (калька `checkDocsGate`), читает свежесть `.planning/harness-checklist-latest.json`.
3. **Вендоринг 4 шаблонов** (CC0, адаптированы под наш стек) + заполненный self-review.

## Key design: auto vs manual + justification

Чеклист ai-boost — **ручной** (для человека-ревьюера). Принцип источника: *failing item = blocker; skipped item needs written justification.* Маппинг:

| Тип пункта | Механизм | Статусы |
|---|---|---|
| **auto** | программная проверка факта против репо | `pass` / `warn` / `fail` |
| **manual** | поиск обоснования в `.planning/harness-checklist-justifications.json` | есть → `pass` (justified); нет → `needs-justification` → агрегируется как `warn` |

`needs-justification` НЕ блокирует (`warn`, не `fail`) — это «нужно написать обоснование», а не «провал».

## Categories (ai-boost) → auto-checks против нашего репо

| Категория | Представительные auto-проверки | Manual-пункты |
|---|---|---|
| `agent-instructions` | AGENTS.md/CLAUDE.md/.gemini/GEMINI.md есть; `permissions` в settings.json; verification gates в docs | «no ambiguous instructions» |
| `tool-design` | harness-runner тесты pass; `validateSchema` есть (консистентный возврат) | «no tool does more than one thing»; «error messages tell next step» |
| `context-delivery` | `.planning/` непустой; compaction-хуки (`context-budget-gate`/`session-size-guard`/`active-window.js`); secret-scanner Bash-gate | «context scoped to task», «no sensitive data» |
| `planning-artifacts` | PLAN/IMPLEMENT шаблоны есть; свежий ARCHITECTURE-*.md; milestones с verify | «scope boundaries written» |
| `permissions-sandbox` | `permissions` определён; destructive-confirm (`/careful`,`/freeze`,secret-scanner); fs-scope (`-- .`) | «minimum permissions», «network scoped» |
| `verification-loop` | harness тесты pass; `doctor` запускается; verification-gates в docs | «eval criteria before task», «runs on completion» |

## Aggregation

`summary.status` = худший из всех пунктов: `fail` если любой `fail`, иначе `warn` если любой `warn`/`needs-justification`, иначе `pass`. Каждая категория тоже агрегируется отдельно.

## Reuse (existing patterns)

- `tools/docs-gate.js:checkArtifact` (стр. 295) — дословный паттерн TTL/freshness.
- `tools/docs-gate.js:writeArtifact/toMarkdown/parseArgs` — I/O + CLI.
- `tools/agent-surface-audit.js:runAudit/formatMarkdown/writeReports` — аудит-структура + markdown.
- `tools/doctor-core.js:checkDocsGate` (стр. 537) — калька для `checkHarnessChecklist`.
- `tools/doctor-core.js:result()` (стр. 35) — `{ status, id, title, detail, repair, data }`.

## Acceptance tests (пишутся ДО кода)

`tools/harness-checklist.test.js` (node `assert`, без фреймворка):
- 6 категорий возвращают корректную классификацию;
- manual без justification → `needs-justification`; с justification → `pass`;
- `checkArtifact`: ok / missing / stale (TTL);
- `--json` валиден; `--write` создаёт оба артефакта; `--markdown` непустой;
- `summary.status` = худший из категорий.

## Verification gates

```bash
node tools/harness-checklist.test.js
node tools/harness-checklist.js --root . --json
node tools/harness-checklist.js --root . --write
node tools/doctor.test.js
node tools/doctor.js --root .
node ~/.claude/hooks/test-all-hooks.js
node tools/project-docs.js verify --root .
```

## When this component can be removed

Чеклист-аудитор — костыль под текущее ограничение: модель не гарантирует консистентность harness между правками. Удаляем, когда harness-инварианты проверяются типами/схемой на этапе сборки, а не пост-фактум скриптом.

## Out of scope

- P2.2 Agent Harness Gate Integration (отдельный спринт).
- Физический промоушн в `~/.claude` (выбрано «оставить в репо»).
- Закрытие выявленных пробелов (аудит → список; закрытие отдельно).
