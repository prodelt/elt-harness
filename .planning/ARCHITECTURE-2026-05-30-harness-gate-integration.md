# ARCHITECTURE — P2.2 Agent Harness Gate Integration

**Date:** 2026-05-30  
**Scope:** tools/harness-gates.js + Stop hook + doctor + pipeline-state + skill v3.1.0

## Problem

`tools/harness-runner.js` реализует чистый state-machine (82 теста), но не подключён к реальным командам. `transition(runId, passed)` принимает `passed` вручную — кто-то должен вызвать CLI без evidence за переходами.

## Solution

**Новый `tools/harness-gates.js`** оркеструет неизменный `harness-runner.js`:
- для текущей фазы run-а запускает проверочную команду (spawnSync),
- пишет `gateEvidence` в `run.phases[last]` ДО перехода,
- вызывает `transition` или `submitReview`.

`verifyCloseout` отклоняет run, где хотя бы одна phase-запись без `gateEvidence`.

## Phase → Gate Mapping

| Фаза | Команда | Что пишется |
|---|---|---|
| `fetch_context` | нет | `{skipped: 'auto-pass'}` |
| `plan_design` | артефакт/arch-файл | `{skipped}` или `{passed: false}` |
| `implement` | нет | `{skipped: 'always-fwd'}` |
| `linter` | `commands.lint` или skip | `{command, exitCode}` или `{skipped}` |
| `tests` | `commands.test` или skip | `{command, exitCode}` или `{skipped}` |
| `code_review` | docs-delta + submitReview | findings → submitReview |
| `git_push` | git-workflow-audit artifact | `{command, exitCode, status}` |

## Key Decisions

1. **Evidence ordering**: `readRun → mutate phases[last].gateEvidence → writeFileSync → transition/submitReview` (transition делает свой readRun с диска).
2. **code_review**: только `submitReview`, без отдельного `transition` (submitReview авто-переходит).
3. **verifyCloseout**: run.status === 'complete' AND каждая phase-запись имеет `gateEvidence` (auto-pass фазы пишут `{skipped: reason}`).
4. **docs-delta**: COMPLEX + нет docs → finding `high` (блокирует). MEDIUM + нет docs → `low` (не блокирует).
5. **Stop-хук**: advisory warn, читает `.planning/harness-run-latest.json` + `.planning/docs-gate-latest.json`, никогда не блокирует.

## New Files

- `tools/harness-gates.js` — gate layer (runGate, verifyCloseout, buildGatePlan, resolveCommands, writeRunPointer)
- `tools/harness-gates.test.js` — 3 acceptance criteria + unit tests
- `~/.claude/hooks/harness-run-gate.js` — Stop advisory hook

## Changed Files

- `tools/doctor-core.js` — `checkHarnessRun` + register in `runDoctor` + exports
- `tools/doctor.test.js` — `testHarnessRunCheck`
- `tools/pipeline-state.js` — `attachHarnessRun(state, runId)` + exports
- `tools/pipeline-state.test.js` — runId linking
- `~/.claude/skills/pipeline/SKILL.md` — v3.1.0 (Agent Harness section)
- `AGENTS.md` — S55 + commands + architecture delta

## Non-Goals

- harness-runner.js не трогаем (82/82 должны остаться)
- Не вводить hard-block
- Harness не обязателен для TRIVIAL/MEDIUM
