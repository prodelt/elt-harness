# Baseline 2026-04-21 — S11 Task 01

## Aggregate
| Metric | Claude (full) | Claude (maxdepth=2) | Codex |
|--------|--------------:|--------------------:|------:|
| JSONL files (30d)          | 1319     | 314      | 58   |
| Total size (30d)           | 936.4 MB | 408.3 MB | 60.6 MB |
| Avg session size (30d)     | 0.71 MB  | 1.30 MB  | 1.05 MB |
| Sessions >1 MB (7d)        | 27       | —        | 13   |
| Max session size (30d)     | 33.3 MB  | 33.3 MB  | 4.5 MB |

**Как читать**: `maxdepth=2` столбец — только main-session jsonl (без `subagents/`), совпадает с README S11 цифрами (313/407/1.33). `full` — включая subagents, это ×4.2 файлов и ×2.3 размера. Для compare-после-WAVE использовать `maxdepth=2` как каноническую базу.

## Hook test baseline (до WAVE 1)
- `test-all-hooks.js`:        **29/29 PASS**
- `test-codex-hooks.js`:      **28/28 PASS**
- `test-hooks-behavior.js`:   **29/29 PASS**
- **Итого 86/86** — pipeline зелёный до старта WAVE 1.

## TOP-1 session breakdown (Claude, 32.5 MB)
File: `C--Claude-playground-Ametrin-website-2/e8e8e383-...jsonl`
- 97.8% user messages, 2.1% assistant
- 48.4% tool-result, из которых:
  - **47.9% playwright.browser_take_screenshot** (15.5 MB!) — primary leak
  - 0.2% playwright.browser_evaluate
  - остальное <0.1% каждый
- Top 10 largest events — все `user/tool-result` 1.4–3.9 MB

## TOP-3 Codex sessions (размер, updated by Task 01b)
1. 2026-04-18 — 4.5 MB → `codex-top1-2026-04-18.txt` (3496 bytes)
2. 2026-04-22 — 4.1 MB → `codex-top2-2026-04-22.txt` (2154 bytes)
3. 2026-04-14 — 3.9 MB → `codex-top3-2026-04-14.txt` (3281 bytes)

Task 01b расширил `analyze-session.js` под Codex rollout JSONL. Новый breakdown считает `session_meta` / `event_msg` / `response_item` / `turn_context`, `payload.type`, roles, tool-call inputs, tool outputs по `call_id -> tool`, token_count и top events.

Codex findings:
- TOP-1 (2026-04-18): основной вес — `response_item/function_call_output` 35.0% и `event_msg/exec_command_end` 22.2%; tool outputs dominated by `shell_command` 596.3K.
- TOP-2 (2026-04-22): основной вес — `turn_context` 64.1% и user messages 25.5%; tool outputs отсутствуют, проблема не в tool-results.
- TOP-3 (2026-04-14): основной вес — `event_msg/exec_command_end` 23.3% и `response_item/function_call_output` 22.4%; tool outputs dominated by `shell_command` 747.5K.

## Baseline files (этот каталог)
- `claude-*.txt` — analyze-session.js output на TOP-3 Claude
- `codex-top*.txt` — analyze-session.js output на TOP-3 Codex после Task 01b (≥2KB каждый, с tool-result breakdown)
- `~/.claude/sessions-30d.txt` — полный список 1319 Claude JSONL (all)
- `~/.claude/sessions-30d-maxdepth2.txt` — 314 main-session jsonl (сравнимо с README)
- `~/.codex/sessions-30d.txt` — полный список 58 Codex JSONL
- `~/.claude/hookstats-baseline-2026-04-21.txt` — hook metrics snapshot

## Key insight для S11
P0-1 (compaction risk >500 KB) подтверждён: **27 сессий >1 MB за 7 дней** только у Claude.
Главный источник для Ametrin-website-2: playwright screenshots (до 3.9 MB/событие).
Рекомендация для WAVE 1:
1. session-size-guard (ЗАДАЧА 03) — обязателен
2. playwright screenshot policy — хук, который при >5 screenshot в сессии advisory `browser_snapshot вместо screenshot`
