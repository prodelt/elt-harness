# S11 Checkpoint — 2026-04-22

## Статус

**MVP-10 прогресс**: 5 из 11 задач закрыто (~45%).

| № | Задача | Статус | Commit | Ветка |
|---|---|---|---|---|
| 01 | Baseline метрики | ✅ | `050339c` + `fc4c21f` | `feature/s11-task-01-baseline` |
| 03 | session-size-guard hook | ✅ | `e95c4d0` | ← (та же цепочка) |
| 02 | SoT skills (diff-артефакты) | ✅ | `ff8d954` | `feature/s11-task-02-sot-skills` |
| 05 | skill-sync-mirror hook | ✅ | `6816704` | `feature/s11-task-05-skill-sync-mirror` |
| 07 | skill session-harvest | ✅ | `2e7409f` | `feature/s11-task-07-session-harvest` **(HEAD)** |
| 08 | harvest-injector hook | ⏳ next | — | — |
| 09 | projects-dashboard | ⏳ | — | — |
| 11 | auto-checkpoint on Stop | ⏳ | — | — |
| 29 | per-project git audit | ⏳ | — | — |
| 30 | git-branch-guard hook | ⏳ | — | — |
| 31 | conv-commit-validator | ⏳ | — | — |
| 28 | final verification | ⏳ | — | — |

## Тест-метрики

- **test-all-hooks**: 30/30 PASS (+1 с baseline 29/29 за счёт session-size-guard)
- **test-codex-hooks**: 30/30 PASS (+2 с baseline 28/28 за счёт session-size-guard + skill-sync-mirror)
- **test-hooks-behavior**: 29/29 PASS (не расширялся)
- **Итого**: **89/89 PASS** (+3 vs 86/86 на старте S11)

## Ключевые артефакты

### Код (в `~/.claude/`)

- `hooks/session-size-guard.js` — UserPromptSubmit, порог 500KB/1MB advisory
- `hooks/skill-sync-mirror.js` — PostToolUse[Edit|Write] на `skills/*/*`, mirror в Codex/Gemini с адаптацией
- `skills/session-harvest/SKILL.md` + `harvest.js` — `/harvest [days]` → `latest.md` (<2KB, <5s)

### Документы (в `audit/S11_pipeline_top1/`)

- `baseline/` — 6 per-session отчётов + SUMMARY.md
- `skills/SOT_POLICY.md` — политика SoT для скиллов
- `skills/DRIFT_2026-04-21.md` — snapshot drift
- `PLAN.md` — обновлён: задачи 01, 02, 03, 05, 07 помечены `[x]` с результатами
- `CHECKPOINT_2026-04-22.md` — этот файл

### Рантайм-артефакты (вне git)

- `~/.claude/skill-drift-codex.txt` (24 строки), `~/.claude/skill-drift-gemini.txt` (45 строк)
- `~/.claude/session-harvest/latest.md` — последний briefing
- `~/.claude/baseline-2026-04-21/` — 6 сессий baseline метрики

## Известные gap'ы (deferred)

1. **session-harvest `lastFocus`** парсит только string content. Claude Code пишет массив —
   регекс не ловит. Фикс: итерировать `ev.message.content[]` и искать Focus в text-элементах.
   → Делать в рамках задачи 08 (harvest-injector), раз смежная область.
2. **session-harvest Token trend** секция — требует истории предыдущего окна.
   → Делать в задаче 26 (token-budget dashboard).
3. **Codex/Gemini drift** — 5 каталог-скиллов отсутствуют в Codex + 7 одиночных `.md`
   требуют миграции в каталог-форму.
   → Делать в задаче 13 (SemVer frontmatter).

## Конфигурация

- `~/.claude/settings.json` — добавлены: session-size-guard (UserPromptSubmit),
  skill-sync-mirror (PostToolUse[Edit|Write])
- `~/.codex/hooks.json` — те же добавления, параллельно
- ⚠ settings.json сегодня линтер отформатировал (убрал `model`, `enabledPlugins` и пр.
  поля), но новые хуки сохранились

## Git-граф

```
main ─── b82d50e (docs(audit): S11 pipeline TOP-1 audit)
         │
         └── feature/s11-task-01-baseline (050339c, fc4c21f, e95c4d0)
              │
              └── feature/s11-task-02-sot-skills (ff8d954)
                   │
                   └── feature/s11-task-05-skill-sync-mirror (6816704)
                        │
                        └── feature/s11-task-07-session-harvest (2e7409f) ← HEAD
```

Все 4 feature-ветки — линейная цепочка (не fork'и). При merge в main —
squash либо merge по порядку, либо всё одной PR.

## Планируемые действия для следующей сессии

1. Прочитать этот файл + `PLAN.md` (задачи 08–31).
2. Создать ветку `feature/s11-task-08-harvest-injector` от `feature/s11-task-07-session-harvest`.
3. Выполнить задачу 08 (30m LOW) — готовый код в `audit/S11_pipeline_top1/hooks/harvest-injector.js`.
4. Далее по MVP-порядку: 09 → 11 → 29 → 30 → 31 → 28.

## Отложено до новой сессии (из аргументов /checkpoint)

- `/sync-docs` — проверить синхронность `~/.claude/CLAUDE.md` ↔ `~/.claude/AGENTS.md` ↔
  `~/.gemini/GEMINI.md` (это ЗАДАЧА 06 из плана, LOW MED, 30m).
- `/ship` — push всех feature-веток + PR. **Рекомендация**: не push'ить до закрытия MVP-10
  (задача 28 — final verification), чтобы одна PR закрывала все 5 P0. Alternative: push
  каждую ветку отдельной PR сразу сейчас, если нужен incremental review.

## Сессия

- Размер jsonl к моменту checkpoint: **681KB** (до порога compaction ≤ 20%).
- Токен-расход: по отчёту ~1.5× baseline на задачу — допустимо.

---

**Рекомендация**: закончить эту сессию, начать новую с промпта `audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md` (обновлён для задачи 08).
