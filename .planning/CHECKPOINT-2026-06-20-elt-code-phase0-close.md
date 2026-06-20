## Checkpoint - 2026-06-20 15:20

### Build Status
- Compiles: не применимо (авторинг скила — markdown, не код)
- Lint: не настроен для skill-markdown
- Type check: не запускался (N/A)

### Test Metrics
- Нет автотестов для skill-файлов (это инструкции для агента, не код)
- Proof получен через live-fire дрин-ран на реальных файлах проекта (см. Completed Tasks), не unit-тестами
- New tests this sprint: 0 (не применимо к артефакту)

### Code Modifications Since Last Checkpoint
- Created: `~/.claude/skills/elt-code/SKILL.md` (новый скил, вне этого репо — глобальный каталог скилов Claude)
- Modified: `~/.claude/projects/C--Claude-playground-Pipiline-setupper/memory/project_elt_code_design_2026-06-20.md` (статус Фазы 0), `memory/MEMORY.md` (строка индекса)
- Deleted: none
- Lines added/removed: N/A (вне git-трекинга этого репо)

### Git State
- Branch: `feature/doc-hygiene-phase2`
- Uncommitted changes: 13 файлов — все **пред-существующие до этой сессии** (`.planning/handoffs/*.yaml`, `CLAUDE.md`, `.planning/ARCHITECTURE-PHASE0-SLICE0.md`, `WORKING-SYSTEM.md` и т.д.), эта сессия их не трогала
- Last commit: `797cab7` feat(skills): add harness-method skill (Step 2 of WORKING-SYSTEM packaging)

### Completed Tasks
- Фаза 0 `/elt-code`: скил-диспетчер (детект интента из текста + меню-fallback на голый вызов + контекст входа on-demand [pipeline-state.json по cwd + последний checkpoint + mem-search] + таблица 6 маршрутов → существующие скилы) — Claude
- Live-fire proof, 3 кейса на реальных данных проекта: «почини баг» → `/pipeline`(BUG)→`diagnose`; голый вызов → меню с реальным Resume Pointer из `CHECKPOINT-2026-06-17-audit-limits-codegraph.md`; «проверь в браузере e2e» → `qa`+`agent-browser` — Claude
- Побочная находка: `pipeline-state.json` проекта (`pipiline-setupper-eb257e8d`) истёк (`expiresAt` 2026-06-19) — не баг elt-code, рефреш стейла остаётся ответственностью `/pipeline` при роутинге, не дублируется в диспетчере
- Memory обновлена: `project_elt_code_design_2026-06-20.md` (секция «Статус») + `MEMORY.md` индекс — Claude

### Remaining Work
- Фаза 1 (следующая, наибольшая ценность): судья-субагент — рубрика H0-H2 (твёрдый пол, блок) + S1-S4 (мягкое качество, совет+лог); Sonnet дефолт, Opus на COMPLEX; вшить в pipeline closeout (MEDIUM+) и per-слайс sprint (COMPLEX); лог `judge_verdict` → существующий `session-ledger.jsonl`; standalone-режим = интент «аудит качества»; в не-Claude — инлайн без субагента
- Фаза 2: интеграция spec-kit (`specify init` per-project, `constitution.md` = принципы + рубрика, H1 enforce adherence).
  **Предусловие:** в этом репо `constitution.md` ещё НЕ создан (`/harness-method` тут не запускался) —
  сначала прогнать `/harness-method` (или `/project-bootstrap`), потом конвергенция рубрики. Без этого
  Фаза 2 ссылается на несуществующий файл.
- Фаза 3: зеркало скила в `~/.codex/skills` + `~/.gemini/skills`, проверка инлайн-судьи там
- Фаза 4: проверка шва к B (накопление `judge_verdict` в ledger как seed eval-корпуса)

### Blockers
- None.

### Cost Snapshot (AMOS)
- AMOS декомиссирован 2026-06-18 — раздел пропущен по правилу скила («Skip silently if AMOS is unavailable»).

### Next Steps
1. Открыть `.planning/ELT-CODE-DESIGN.md` → раздел «Фаза 1 — Судья-субагент».
2. Прочитать текущий `~/.claude/skills/elt-code/SKILL.md` (Фаза 0, диспетчер уже живой) — судья встраивается поверх, не переписывая диспетчер.
3. Добавить в скил рубрику H0-H2/S1-S4 + логику вызова Sonnet-субагента (Opus на COMPLEX) на closeout MEDIUM+ и per-слайс COMPLEX.
4. Подключить лог `judge_verdict` в `session-ledger.jsonl` (путь берётся из `pipeline-state.json.ledgerPath`).
5. Live-fire proof: блок-кейс (H1 спека не совпала → blocked) + совещательный кейс (S-оценки в логе) на реальном изменении.

### Resume Pointer
- Focus: Фаза 1 `/elt-code` — судья-субагент (H0-H2 твёрдый пол + S1-S4 совет, Sonnet/Opus, лог в `session-ledger.jsonl`)
- Resume: открыть `.planning/ELT-CODE-DESIGN.md` раздел «Фаза 1»; читать `~/.claude/skills/elt-code/SKILL.md` перед правкой
