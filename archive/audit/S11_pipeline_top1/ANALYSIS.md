# S11 — Session Analysis & Score Card

## 1. Real session data (2026-04-21)

### Claude Code — 30 дней
| Метрика | Значение | Норма | Отклонение |
|---------|----------|-------|------------|
| JSONL файлов | 313 | — | — |
| Суммарный объём | 407 MB | — | — |
| Средняя сессия | **1.33 MB** | <400 KB | ×3.3 хуже |
| Максимум | 5.4 MB | <1 MB | ×5.4 хуже |
| Project dirs | 62 | <10 | ×6 хуже |

### Claude Code — 7 дней (сессий по проектам)
| Проект | Сессий | Приоритет claude-context |
|--------|--------|--------------------------|
| Law-assistant | **34** | 🥇 TOP-1 |
| Izi-tracker | 16 | 🥈 |
| sudoviy-master-try-3 | 16 | 🥉 |
| Pipeline-setupper | 15 | — (Graphify достаточно) |
| tg-bot-reclamaties-master | 5 | следить |
| Law-assistant (worktree great-archimedes) | 1 | единственный с git worktree |
| CV | 1 | нет |

### Codex — 14 дней
| Метрика | Значение |
|---------|----------|
| JSONL файлов | 58 |
| Суммарно | 60 MB |
| Средняя | 1.07 MB |
| Максимум | 4.4 MB (2026-04-18) |

### Сессии >1 MB за 7 дней — ТОП-10
```
5.1 MB  Izi-tracker/cf26bae6...
3.8 MB  Pipiline-setupper/6fb81abc...
2.1 MB  Pipiline-setupper/361ed66d...
2.1 MB  Law-assistant/7fa6ce78...
2.0 MB  Izi-tracker/f77045b7...
2.0 MB  Pipiline-setupper/d7b553d8...
1.9 MB  Law-assistant/14064e67...
1.9 MB  sudoviy-master-try-3/77eb24bc...
1.8 MB  Pipiline-setupper/4788c911...
1.7 MB  Law-assistant/1053c34a...
```

## 2. Key findings (что изменилось vs первоначальный отчёт)

1. **Law-assistant — главный потребитель токенов**, не Izi-tracker. Переориентировать приоритеты для claude-context.
2. **62 project-dirs** из которых активно только 7 → `~/.claude/projects/` засорён (55+ папок мусора >30 дней).
3. **sudoviy-master-try-3 + tg-bot-reclamaties-master** — пропущены в первом списке «5 активных». Реально активных **7**.
4. **Единственный git worktree** — Law-assistant/great-archimedes. Остальные 6 проектов работают всё в main.
5. **Codex bloat симметричен Claude** (avg 1.07 MB vs 1.33 MB): проблема системная, нужны session-size-guard в **обоих**.
6. **Git-root = `C:\`** — все коммиты идут в один моно-git без веток (critical debt).

## 3. Score Card

| Dimension | Current | Target | Gap | Evidence |
|-----------|---------|--------|-----|----------|
| Token Efficiency | 5/10 | 9/10 | 4 | 90K/сессию, 5.1 MB max |
| Memory Continuity | 3/10 | 9/10 | 6 | Нет cross-session handoff |
| Skill Quality | 5/10 | 9/10 | 4 | Нет версий, /learn не патчит |
| Cross-Tool Sync | 4/10 | 9/10 | 5 | 20/18/18 скиллов в 3 инструментах |
| TDD Depth | 4/10 | 8/10 | 4 | Тесты на syntax, не business |
| Best Practices Loop | 2/10 | 8/10 | 6 | ctx7 есть, но "compare top-3" отсутствует |
| Self-Improvement | 3/10 | 8/10 | 5 | metrics.json копится без анализа |
| Project Clarity | 4/10 | 9/10 | 5 | 62 dirs, 7 активных, нет dashboard |
| **Git Discipline** | **2/10** | **9/10** | **7** | Прямые коммиты в main, без PR |
| **ИТОГО** | **32/90** | **78/90** | **46** | **35% → 87% target** |

## 4. 8 подтверждённых проблем (из первого отчёта, остаются)

- **PROBLEM A — Session Amnesia** → WAVE 2 (задачи 07-08)
- **PROBLEM B — Skill Drift** → WAVE 3 (13-16)
- **PROBLEM C — Cross-Tool Рассинхрон** → WAVE 1 (02, 05, 06)
- **PROBLEM D — Browser Tool Bloat** → решено в S10 (awwwards, claude-in-chrome удалены)
- **PROBLEM E — TDD Поверхностный** → WAVE 4 (19-22)
- **PROBLEM F — Нет Self-Improvement Loop** → WAVE 5 (23-27)
- **PROBLEM G — Project Sprawl** → WAVE 2 (09)
- **PROBLEM H — Нет Best Practices Search** → WAVE 3 (17-18)

## 5. Новый контрольный показатель

**Баланс по 7 проектам**:
| Проект | Git-repo? | Ветки? | CLAUDE.md? | Priority |
|--------|-----------|--------|------------|----------|
| Law-assistant | TBD | 1 worktree | TBD | HIGH |
| Izi-tracker | TBD | нет | TBD | HIGH |
| sudoviy-master-try-3 | TBD | нет | TBD | HIGH |
| Pipeline-setupper | C:\ shared | нет | YES | MED |
| tg-bot-reclamaties-master | TBD | нет | TBD | MED |
| CV | TBD | нет | TBD | LOW |
| Ametrin-platform | TBD | нет | TBD | LOW |

Проверить per-project git status — это задача 29.
