# S11 — Pipeline TOP-1 Audit (2026-04-21)

## Цель
Довести AI coding pipeline (Claude Code + Codex CLI + Antigravity) до уровня TOP-1 GitHub репозитория за 1–2 дня.

## Контекст старта
- Developer: solo, 7 активных проектов (Law-assistant, Izi-tracker, sudoviy-master-try-3, Pipeline-setupper, tg-bot-reclamaties-master, CV, + Ametrin-platform)
- OS: Windows 10 Pro + Git Bash
- Самооценка до S11: ~82/100
- После пересчёта с git-discipline: **32/90 (35%)** → target **78/90 (87%)**

## Критические находки (5 P0)
| # | Проблема | Wave | Задачи |
|---|----------|------|--------|
| P0-1 | Сессии 1–5 MB → compaction loss контекста | 1 | 03 |
| P0-2 | Нет cross-session handoff (PROBLEM A) | 2 | 07, 08 |
| P0-3 | Skill drift Claude/Codex/Antigravity (PROBLEM C) | 1, 3 | 05, 13, 24 |
| P0-4 | Нет best-practices loop (PROBLEM H) | 3 | 17, 18 |
| P0-5 | **Коммиты в `main` без веток, git-root на `C:\`** | 6 | 29, 30, 31 |

## Real session data (свежие цифры 2026-04-21)
- Claude 30 дней: **313 JSONL, 407 MB, avg 1.33 MB** (×3.3 от нормы)
- Claude 7 дней top: **Law-assistant 34 сессии** (не Izi-tracker, как думали)
- Codex 14 дней: **58 JSONL, 60 MB, avg 1.07 MB, max 4.4 MB**
- Sessions >1MB за 7 дней: **20+ штук**
- Project dirs: **62** в `~/.claude/projects/`, активных реально **7**

## Файлы в этой папке
| Файл | Содержимое |
|------|------------|
| `README.md` | этот индекс |
| `ANALYSIS.md` | данные анализа сессий, выводы, SCORE CARD |
| `PLAN.md` | 35 задач в 6 волнах с командами |
| `GIT_STANDARDS.md` | GitHub Flow + Conventional Commits правила |
| `P0_FIXES.md` | детали по 5 критическим проблемам |
| `SUCCESS_CRITERIA.md` | 12 измеримых метрик |
| `VERDICTS.md` | claude-context, MCP аудит, creative UI |
| `skills/session-harvest/` | production-ready код нового скилла |
| `hooks/` | production-ready код новых хуков (30, 31, 32, 33, session-size-guard) |

## Как использовать в следующей сессии
1. `cat audit/S11_pipeline_top1/README.md` — вернуть контекст
2. `cat audit/S11_pipeline_top1/PLAN.md` — взять следующую задачу
3. Работать по одной задаче из `PLAN.md`, отмечая статус в commit message
4. После каждой задачи: `git add -p && git commit -m "feat(pipeline): S11 task NN — <cel>"`

## Статус (обновлять после каждой волны)
- [ ] WAVE 1 — Foundation (задачи 01–06)
- [ ] WAVE 2 — Memory (07–12)
- [ ] WAVE 3 — Skills (13–18)
- [ ] WAVE 4 — TDD (19–22)
- [ ] WAVE 5 — Self-improvement (23–27)
- [ ] WAVE 6 — Git discipline (29–35)
- [ ] ЗАДАЧА 28 — финальная верификация тестов

## Связанные документы
- `CLAUDE.md` (root) — текущее состояние pipeline
- `../S9_burn_wave2/CHANGES.md` — предыдущая волна оптимизации
- `../../MEMORY.md` — глобальная память сессий
- `../../HOOK_SYSTEM.md` — архитектура хуков
