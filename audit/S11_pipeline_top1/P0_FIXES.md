# S11 — 5 критических проблем (P0)

## P0-1: Session bloat 1–5 MB → compaction loss

**Evidence**
- Claude 30d: avg **1.33 MB**, max **5.4 MB** (Izi-tracker 2026-04-19)
- 20+ сессий >1 MB за последние 7 дней
- Codex: avg 1.07 MB, max 4.4 MB — симметрично

**Root cause**
- Нет механизма warn на раннем этапе роста сессии
- SessionStart дампит тонну контекста (ecosystem graph 48.3 KB, CLAUDE.md 4 KB, hooks announce, system reminders)
- Хуки не блокируют большие Read-операции пока `limit < 150`

**Fix (задача 03)**
`~/.claude/hooks/session-size-guard.js` — UserPromptSubmit, читает размер `transcript_path`, при >500KB инжектит:
```
⚠ Сессия XXXKB (>500KB). Выполни /checkpoint, затем /clear и продолжи в свежей сессии.
```
Регистрируется и в Claude, и в Codex.

**Verify**
```bash
node ~/.claude/hooks/test-all-hooks.js           # 30/30
node ~/.codex/test-codex-hooks.js                # 29/29
# найти сессию >500KB искусственно и проверить вручную
```

---

## P0-2: Session amnesia (PROBLEM A)

**Evidence**
- `/prime` требует ручного объяснения "где остановились"
- Нет файла типа `~/.claude/session-handoff/latest.md`, читаемого при SessionStart
- После compaction в длинной сессии ранний контекст теряется

**Root cause**
- `/checkpoint` сохраняет memory, но не структурированный handoff
- SessionStart хуки инжектят _статику_ (ecosystem, CLAUDE.md), не _динамику_ (последний checkpoint)

**Fix (задачи 07, 08, 11)**
- `session-harvest` skill + `harvest.js` — собирает briefing из JSONL
- `harvest-injector.js` — SessionStart хук инжектит latest.md (<500 токенов)
- `stop-auto-checkpoint.js` — при Stop без /checkpoint сохраняет briefing автоматически

**Verify**
```bash
node ~/.claude/skills/session-harvest/harvest.js 7
cat ~/.claude/session-harvest/latest.md | wc -c    # <2000 байт
# старт новой сессии — в additionalContext видна секция HARVEST
```

---

## P0-3: Cross-tool skill drift (PROBLEM C)

**Evidence**
- Claude Code: 20 custom skills
- Codex: 18 (пропущены: `careful, freeze, fix-issue, prime, contract-review, ship`)
- Antigravity (`~/.gemini/skills/`): 18 (свой diff)
- `/sync-docs` синкает только 3 markdown (CLAUDE.md / AGENTS.md / GEMINI.md)

**Root cause**
- Нет single source of truth для skills
- Нет авто-mirror хука при редактировании SKILL.md

**Fix (задачи 02, 05, 13)**
1. `~/.claude/skills/` = SoT
2. `skill-sync-mirror.js` (PostToolUse[Edit|Write] на `*/SKILL.md`) → copy в Codex + Gemini
3. SemVer в frontmatter — отслеживать drift

**Verify**
```bash
diff -rq ~/.claude/skills/ ~/.codex/skills/ | wc -l    # 0
diff -rq ~/.claude/skills/ ~/.gemini/skills/ | wc -l   # 0
```

---

## P0-4: Нет best-practices loop (PROBLEM H)

**Evidence**
- `ctx7` даёт docs, но нет шага «сравни с top-3 реализациями»
- `/architect-first` и `/sprint` не имеют обязательного compare-step
- Риск: token-взрыв если искать каждый раз без кеша

**Root cause**
- Workflow-проблема, не инструментная
- Нет кеша ctx7 → дубликаты запросов

**Fix (задачи 17, 18)**
- `architect-first/SKILL.md` Phase 2.5: обязательный `ctx7 search "<pattern>" | head -40` + анализ 3 реализаций
- `~/.claude/hooks/lib/ctx7-cache.js` — кеш 24h по hash запроса

**Verify**
```bash
# повторный ctx7 запрос:
MSYS_NO_PATHCONV=1 ctx7 docs /vercel/next.js "app router"  # 1-й раз — сеть
MSYS_NO_PATHCONV=1 ctx7 docs /vercel/next.js "app router"  # 2-й — cache hit <50ms
```

---

## P0-5: Git-discipline отсутствует (НОВЫЙ)

**Evidence**
- Git-root на `C:\` (весь диск — монорепо)
- Last 5 commits → все в `main` напрямую (`bd2b8c3, 699ba9b, 6cfca3d, d67bf41, eac0e51`)
- Untracked файлы в root: `.claude/, .gemini/, .tmp/, AUDIT_REPORT.md, audit/, tools/`
- Только 1 проект (Law-assistant) использует git worktree; остальные 6 работают «как получится»
- Нет protected branches, нет PR enforcement, нет pre-commit gate
- Conventional Commits формат применяется неровно (видно в recent commits: `feat:`, `audit:` — нестандарт)

**Root cause**
- Никогда не было standards-document
- Нет хуков-стражей (git-branch-guard / conventional-commit-validator / branch-name-validator / pre-commit-gate)
- Скилл `/git-flow` не существует

**Fix (задачи 29–35 — вся WAVE 6)**
1. **29**: per-project git audit — 7 активных проектов получают свой `.git/`
2. **30**: `git-branch-guard.js` — deny commit в main/master
3. **31**: `conventional-commit-validator.js` — deny не conv-commits формат
4. **32**: `branch-name-validator.js` — deny плохие имена веток
5. **33**: `pre-commit-gate.js` — lint + tests перед коммитом
6. **34**: `/git-flow` skill — оркестратор start/sync/finish
7. **35**: `session-branch-advisor.js` — SessionStart советует ветку

**Verify**
```bash
cd "/d/Ametrin projects/Izi-tracker"
git checkout main
git commit --allow-empty -m "test"              # → DENY (branch-guard)
git checkout -b weird-name                      # → DENY (name-validator)
git checkout -b feature/valid-name              # → OK
git commit --allow-empty -m "fix bug"           # → DENY (conv-commits)
git commit --allow-empty -m "fix(x): update"    # → OK
```

---

## Порядок выполнения P0

Вариант A (идеальный, 2 дня): все 35 задач по волнам.

Вариант B (1 день MVP, закрывает все P0):
1. Baseline (01) — 60m
2. P0-1 (03) — 60m
3. P0-3 (02, 05) — 105m
4. P0-2 (07, 08, 11) — 180m
5. Dashboard (09) — 60m
6. P0-5 (29, 30, 31) — 165m
7. Verify (28) — 30m

**Всего**: ~11h, закрывает 5/5 P0.
