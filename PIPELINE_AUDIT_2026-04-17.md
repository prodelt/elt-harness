# Pipeline Audit — 2026-04-17

Audit основан на S1 evidence (`audit/S1_evidence/`) + прямой code-review хуков, skills, settings.
Метод: trust-but-verify. Каждый bug имеет pruf (file:line или команда воспроизведения).

---

## TL;DR — 19 багов

| # | Severity | Category | Bug |
|---|---|---|---|
| B01 | 🔴 P0 | Observability | `hooks/errors.log` никогда не создаётся — logger.js не импортится хуками |
| B02 | 🔴 P0 | Context mgmt | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=65` + threshold 80k = window 50k недостаточен |
| B03 | 🔴 P0 | Tooling | Edit tool_result содержит `originalFile` → 30K tokens burn/edit |
| B04 | 🔴 P0 | Docs automation | `/init-project` не вызывается автоматически — 0 вызовов в sudovoi, 0 в Izi |
| B05 | 🟡 P1 | Token burn | `persisted tool-results/` = 6.9MB без cleanup policy |
| B06 | 🟡 P1 | Hooks | lowercase `d--` path encoding для Izi tracker — path-match в хуках может ломаться |
| B07 | 🟡 P1 | Hooks | edit-enforcer не в metrics.json — либо не стреляет, либо не инкрементирует |
| B08 | 🟡 P1 | Skills | `/pipeline` SKILL.md декларативный (89 строк текста) без верификационных gates |
| B09 | 🟡 P1 | Skills | contract-review/mikrotik-audit по 184K/120K — загружаются даже когда не нужны |
| B10 | 🟡 P1 | Loops | edrsr_v2_client.py edited 16x в одной sudovoi сессии без escalation |
| B11 | 🟡 P1 | Loops | CLAUDE.md edited 16x в tg_bot — ручное поддержание вместо автогенерации |
| B12 | 🟡 P1 | Settings | autocompact settings в `settings.json`, hook config в `hooks/config.json` — разрозненно |
| B13 | 🟢 P2 | UX | context-budget-gate escalation текст >200 chars — шумит в контекст |
| B14 | 🟢 P2 | Skills | `/pipeline` ссылается на Skill() вызовы которые не передают context |
| B15 | 🟢 P2 | Hooks | loop-guardian: `repeatWarn=3` слишком высокий — 16 дубль-edits просочились |
| B16 | 🟢 P2 | Verification | stop-verification не форсит запуск теста перед commit |
| B17 | 🟢 P2 | Cross-tool | Codex/Antigravity hooks используют .js файлы Claude Code напрямую — зависимость без isolation |
| B18 | 🟢 P2 | Scale | skill_listing передаётся в каждую сессию полностью (все 70+ скиллов) |
| B19 | 🟢 P2 | Memory | memory/ содержит ~30 файлов — semantic relevance windowing отсутствует |

---

## DETAILED FINDINGS

### B01 🔴 hooks/errors.log не создаётся — logger.js dead code

**Evidence:**
```bash
$ ls C:/Users/espad/.claude/hooks/errors.log
No such file or directory
$ grep -l "require.*logger" C:/Users/espad/.claude/hooks/*.js | head
# → Ни один хук не импортит logger
```

`C:\Users\espad\.claude\hooks\lib\logger.js` (полноценная реализация с rotation, 42 строки) импортируется только в `hook-stats.js` (CLI) и тестах. **27 продакшн хуков тихо падают без трейсов.**

**Impact:** При bug-repro невозможно диагностировать — нет аудит-логов. Объясняет почему `/init-project`, loop-guardian и другие баги невидимы пока пользователь не пожалуется.

**Fix (S4):** Массовый import `const logger = require('./lib/logger')` + `logger.error/warn` в catch-блоки. Wrap top-level try/catch в каждом хуке.

---

### B02 🔴 Autocompact 65% срабатывает преждевременно

**Evidence:**
```bash
$ grep CLAUDE_AUTOCOMPACT C:/Users/espad/.claude/settings.json
"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "65"
```
+ `hooks/config.json:contextBudget.thresholdTokens=80000, repeatIntervalTokens=20000`

**Математика:**
- Opus 4.7 context = 200K → autocompact @ 65% = **130K tokens**
- context-budget-gate первый warning @ 80K → второй @ 100K → третий @ 120K
- **Window между warning и autocompact ~10-50K** — юзер не успевает сохранить memory
- Для Sonnet 4.6 (1M): autocompact @ 650K, но 80K warning — слишком ранний шум

**Impact:** Пользователь теряет контекст сессии после 3 запросов (подтверждено в жалобе "сессия отлетает в лимиты за 3 запроса"). context-budget-gate орёт слишком рано для Sonnet, autocompact бьёт слишком рано для Opus.

**Fix (S3):**
- Убрать `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (вернуть дефолт 92%) **или** поднять до 85%
- threshold в hook переместить на **85%** фактического лимита модели, а не фиксированное число
- Сделать хук model-aware: читать `model` из input и расчитывать threshold динамически

---

### B03 🔴 Edit tool_result тащит весь файл

**Evidence:** `audit/S1_evidence/sudovoi_burn.md:12-18`
```
Edit(filePath=telegram_bot.py) tool_result = 119,630 bytes (~29.9K tokens)
Contains: oldString + newString + ПОЛНЫЙ originalFile (2500+ строк)
```

**Impact:** Edit на 2KB изменение тратит 30K tokens контекста. В sudovoi 16 edits одного файла = 480K tokens — полный autocompact trigger сам по себе.

**Note:** Это **поведение Claude Code harness**, не хуков. Fix возможен только через:
1. Hook который компрессирует tool_result (через PostToolUse перехват) — сложно
2. Избегать больших файлов (разбивать >500 строк) — организационная мера
3. Использовать `replace_all` вместо множественных Edit — скилл-level правило

**Fix (S6):** Добавить правило в `/architect-first` + `/cto-playbook`: файлы >500 строк = red flag, требуют разбиения перед Edit.

---

### B04 🔴 /init-project не вызывается на новых проектах

**Evidence:**
```bash
$ grep -l "<command-name>/init-project</command-name>" sudovoi/*.jsonl
# → 0 файлов
$ ls "D:/Ametrin projects/Izi tracker/"
.env  TZ/  izi-tracker/  .claude/settings.local.json
# → НИ CLAUDE.md, НИ AGENTS.md, НИ GEMINI.md
```

**Root cause:** `project-docs-gate.js` (SessionStart) — только предупреждает, не форсит skill execution. `/init-project` — ручная команда. Пользователь не помнит её вызвать.

**Impact:** Проекты стартуют без доков → тот же файл создаётся **вручную** 16 раз (tg_bot CLAUDE.md) → burn.

**Fix (S5):** `project-docs-gate.js` должен при отсутствии CLAUDE.md + наличии >10 файлов проекта → **автоматически запускать `/init-project` (Skill tool)**, не просто warning.

---

### B05 🟡 persisted tool-results без cleanup

**Evidence:** `audit/S1_evidence/sudovoi_burn.md:27-33`
```
Output too large (6.9MB). Full output saved to:
  ~/.claude/projects/.../tool-results/bm8v50lbj.txt
```

**Impact:** Диск растёт бесконтрольно. Через 6 месяцев активной работы = десятки GB.

**Fix (S4):** cron-хук или запуск через `graphify-session-init.js`: удалить `tool-results/*.txt` старше 7 дней.

---

### B06 🟡 lowercase `d--` path encoding

**Evidence:**
```
C:/Users/espad/.claude/projects/D--Ametrin-projects-sudoviy-master-try-3
C:/Users/espad/.claude/projects/d--Ametrin-projects-Izi-tracker  ← lowercase d
```

**Repro:** Открыть проект из cmd где `cd d:\...` (lowercase) vs PowerShell `cd D:\...` (auto-capitalize).

**Impact:** Хуки которые матчат по `input.cwd` могут не видеть session (например `session-focus-gate`). Хук `context-budget-gate.js:46-55` `readdirSync(projectsDir)` + `sessionId` lookup — ему всё равно. Но project-specific хуки могут ломаться.

**Fix (S4):** Все хуки нормализуют `cwd.toLowerCase()` или `path.resolve()` перед сравнением.

---

### B07 🟡 edit-enforcer отсутствует в metrics.json

**Evidence:** `hooks/metrics.json` содержит loop-guardian, secret-scanner, quality-gate-runner, verification-tracker, secret-output-scanner, inline-review-tracker, graphify-read-gate — но **нет edit-enforcer**.

При этом edit-enforcer — один из центральных хуков (Context7 warn/block). Либо:
- Он не стреляет (regression)
- Он стреляет но не вызывает `metrics.inc()`

**Fix (S4):** Grep `metrics.inc` в edit-enforcer.js → добавить если нет. Repro: сделать 3 edits на .ts файл → проверить metrics.json.

---

### B08 🟡 /pipeline SKILL.md декларативный

**Evidence:** `~/.claude/skills/pipeline/SKILL.md` — 89 строк текста с инструкциями типа "Step 1: Read context". Нет никаких **runtime gates**: нечем проверить, реально ли Claude выполнил Step 1, или пропустил.

**Impact:** Skills в Claude Code — это **prompt text**, не runtime pipeline. Зависят от того что LLM решит следовать инструкциям. На больших контекстах или распараллеливании — скипают шаги.

**Fix (S5 + S8):** Переписать `/pipeline` как orchestrator который **реально** вызывает sub-skills через Skill tool: `Skill("architect-first") → Skill("sprint") → Skill("inline-review") → Skill("ship")`. Добавить сheckpoint после каждого шага.

---

### B09 🟡 Тяжёлые skills грузятся всегда

**Evidence:**
```
184K  skills/contract-review/
120K  skills/mikrotik-audit/
76K   skills/clone-research/
40K   skills/agents/
32K   skills/learned/
28K   skills/awwwards-web-design/
24K   skills/red-team/
```

**Impact:** Claude Code `ENABLE_TOOL_SEARCH=auto:10` помогает с tools, но SKILL.md файлы всё равно индексируются при `skill_listing` attachment (виден в каждой сессии Izi).

**Fix (S3):** `ENABLE_SKILL_SEARCH=auto:5` (если поддерживается) или вынести узкоспециализированные skills в отдельный namespace/директорию.

---

### B10-B11 🟡 Loop patterns без escalation

- `sudovoi: edrsr_v2_client.py edited 16 times in session`
- `tg_bot: CLAUDE.md edited 16 times in session`
- `loop-guardian.repeatWarn=3` — должен был сработать на 3-м повторе

**Evidence:** `metrics.json:loop-guardian.fired=16` — хук реально стрелял 16 раз, но **warnings не эскалировались в block**. Либо fingerprint логика пропускает, либо warn не переходит в block никогда.

**Fix (S4):** Добавить `blockAt=6` в config (6 повторов = bug, не нормальная работа). Прочитать `loop-guardian.js` и проверить логику escalation.

---

### B12 🟡 Конфиг разбит на 2 файла

`settings.json` (~9.9KB) содержит `env`, `permissions`, `hooks`, `enabledMcpjsonServers`.
`hooks/config.json` (~1.4KB) содержит threshold'ы хуков.

**Impact:** При изменении autocompact % надо помнить про `settings.json`. При tuning loop-guardian — `config.json`. Пользователь и Claude путаются, где что.

**Fix (S8):** Консолидация в один `~/.claude/config.yaml` с секциями. Или явная ссылка в обоих файлах.

---

### B13 🟢 context-budget-gate verbose warnings

`context-budget-gate.js:109-112` пушит 3-строчный `additionalContext` ~**200 chars**:
```
CONTEXT BUDGET: ~85k tokens used. MANDATORY: 1) Save to MEMORY.md 2) Update CLAUDE.md if needed 3) Summary of done/pending. Repeats every 30k tokens until memory is saved.
```

Повторяется каждые 20k → 5 репетиций на 180k контекста = **1K tokens burn на сами warnings**.

**Fix (S3):** Сжать до 80 chars: `"Budget ~85k/200k. Save memory soon."`

---

### B14 🟢 /pipeline → Skill() pointers без context

`/pipeline/SKILL.md:44,45,50,51`:
```
Run `Skill("inline-review")` automatically
Run `Skill("ship")` if tests pass
```

Но skill invocation — это prompt re-injection. Каждый Skill() добавляет новый SKILL.md в контекст. 4 skills = 4×SKILL.md. Nested skill calls усиливают burn.

**Fix (S5 + S8):** `/pipeline` должен передавать minimal shared context через shared `~/.claude/pipeline-state.json` вместо перезагрузки всего в каждый saubskill.

---

### B15 🟢 loop-guardian threshold слишком высокий

`config.json: loopGuardian.repeatWarn=3` но **нет blockAt**. 16 loops в sudovoi/tg_bot говорят что warn не эскалируется.

**Fix (S4):** Добавить `blockAt=6` + проверить что escalation логика работает.

---

### B16 🟢 stop-verification не требует test-run

`stop-verification.js` проверяет что были Edit'ы и есть uncommitted changes — но не требует показать вывод test команды. Pipeline `/pipeline` MEDIUM говорит "Verify: run build/test", но stop-gate не enforce'ит.

**Fix (S8):** stop-gate парсит последние 50 tool_use — ищет `npm test|pytest|go test|cargo test`. Если не найдено → BLOCK с reminder.

---

### B17 🟢 Codex/Antigravity зависят от Claude .js

`~/.codex/hooks.json` ссылается на `C:\Users\espad\.claude\hooks\*.js`. Если Claude hooks ломаются → Codex тоже. Нет isolation.

**Fix (S8):** shared logic в `~/.claude/hooks/lib/`, per-tool entry points в `hooks/claude/`, `hooks/codex/`, `hooks/antigravity/`. Сейчас это частично так, но вход всё равно через Claude hooks/ директорию.

---

### B18 🟢 skill_listing передаётся полностью

**Evidence:** Izi `07e74b52...jsonl:16` — attachment `skill_listing` содержит описания всех ~70 skills.

**Size:** Оценочно 5-10KB на сессию × каждая новая сессия. За 72 сессии = 360-720KB burn только на skill descriptions.

**Fix (S3):** lazy skill listing — включать только skills с `alwaysOn: true` или топ-10 по recent usage. Остальные только по query (ToolSearch-подобный механизм).

---

### B19 🟢 memory/ без windowing

**Evidence:** `~/.claude/projects/C--/memory/` содержит ~30 файлов (project_*.md, feedback_*.md, reference_*.md). Все индексируются через MEMORY.md (100-line limit), но когда задача "пофикси bug в izi-tracker", нерелевантные project_ametrin_website / project_elt_studio всё равно в index.

**Fix (S3):** Semantic windowing — при session start хук читает первое сообщение юзера, keyword-match с memory/*.md filenames, подключает ТОЛЬКО top-5 relevant + alwaysOn категорию. Остальные доступны через explicit fetch.

---

## Fix Priority Matrix (для S3-S8)

| Sprint | Bugs | Ожидаемый token-saving |
|---|---|---|
| **S3** (token opt) | B02, B09, B13, B18, B19 | **30-50%** (измерим в S8) |
| **S4** (hook fixes) | B01, B05, B06, B07, B10, B11, B15 | — (observability + stability) |
| **S5** (/pipeline refactor) | B04, B08, B14 | **15-25%** (избавление от loops) |
| **S6** (/cto + /architect) | B03 (частично) | 10-15% (через правило о файлах >500 LOC) |
| **S7** (/red-team) | — | — (feature work) |
| **S8** (methodology + consolidation) | B12, B16, B17 | 5-10% |

**Aggregate ожидание:** 50-80% снижение burn (это **2-5x**, не заявленные 50x, но реально достижимо).

---

## Critical Evidence Summary (для презентации)

1. **`errors.log` не существует** — 27 хуков работают вслепую
2. **0 вызовов `/init-project` в 2 из 3 проектов** — вся документация пишется вручную
3. **Edit = 30K tokens burn** из-за `originalFile` в tool_result
4. **65% autocompact + 80K warning = 50K window** → юзер не успевает реагировать
5. **Loops не эскалируются** — 16 повторов одного edit проходят без block

---

**Status:** S2 COMPLETE.
**Next:** S3 — Token optimization wave 1 (B02, B09, B13, B18, B19).
**Дата:** 2026-04-17.
