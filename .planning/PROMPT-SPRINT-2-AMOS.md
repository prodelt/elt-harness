# PROMPT — AMOS Sprint 2: Континуальність + Інтеграція хуків

**Статус:** Sprint 0 ✅ Sprint 1 ✅ → **Sprint 2 — СТАРТ**
**Гілка реалізації:** `amos/sprint2-continuity` від `amos/sprint1-kernel`

---

## Контекст (прочитай перед стартом)

**Що вже зроблено:**
- `C:\Users\user\.amos` — git-репо, гілка `amos/sprint1-kernel`
- `bin/amos.js` — CLI ядро: `event session-start|stop`, `status`, `report`, `doctor`, `version`
- `lib/db.js` — SQLite (node:sqlite), 4 таблиці: `sessions`, `events_metrics`, `projects`, `handoffs`
- `tests/amos.test.js` — 45/45 PASS
- `~/.claude/bin/amos.cmd` — глобальна обгортка через `%USERPROFILE%`
- **KPI Sprint 1:** 133ms холодний старт, 185 bytes stdout

**Архітектура (source of truth):**
`.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md` §3.4, §5.2

---

## Sprint 2 — що потрібно зробити

### S2.1 — Handoff Write/Read

`amos event stop` записує handoff в SQLite + зеркало `.planning/handoffs/<sessionId>.yaml`:

task: "<опис поточного завдання>"
phase: "<поточна фаза>"
project: "<cwd>"
changed_files: [...]
open_steps: [...]
resume_cmd: "amos resume <handoffId>"
timestamp: "2026-06-10T..."

`amos resume <handoffId>` читає handoff з SQLite, виводить compact ≤1.5KB.

### S2.2 — `amos status --markdown`

Портативний снапшот (≤2KB): задача, фаза, проект, змінені файли (git diff --stat), незакриті кроки, команда відновлення.

### S2.3 — SessionStart хук всіх 3 клієнтів → `amos event session-start`

Claude Code (~/.claude/settings.json), Codex (~/.codex/hooks.json), Gemini (~/.gemini/settings.json).

⚠️ НЕ видаляти існуючі v3 хуки — тільки додавати. Решта хуків — Sprint 6.

### S2.4 — Stop хук → `amos event stop`

Аналогічно: Stop hook для всіх 3 клієнтів.

### S2.5 — E2E Proof: Claude → Codex Cross-Client Resume

1. Claude Code в Law_assistant → 2-3 дії → закрити
2. `amos event stop` записує handoff
3. Codex в тій же папці → SessionStart підтягує handoff
4. Codex бачить "AMOS Resume: ..." без ручного введення

---

## Git Branch Strategy

Команди старту:
  git -C "C:\Users\user\.amos" checkout amos/sprint1-kernel
  git -C "C:\Users\user\.amos" checkout -b amos/sprint2-continuity

Агенти: amos/sprint2-handoff | amos/sprint2-hooks | amos/sprint2-tests
Злиття — координатор після верифікації.

---

## Acceptance Criteria — Sprint 2 Done When

- [ ] `amos event stop` → записує handoff в SQLite та `.planning/handoffs/X.yaml`
- [ ] `amos resume X` → ≤1.5KB JSON {hookSpecificOutput:{additionalContext:...}}
- [ ] `amos status --markdown` → ≤2KB портативний снапшот
- [ ] SessionStart Claude викликає `amos event session-start` (`amos report` показує подію)
- [ ] Stop Claude викликає `amos event stop` (`.planning/handoffs/` містить YAML)
- [ ] E2E: handoff Claude → прочитаний в Codex (транскрипт або скріншот)
- [ ] Тести ≥55, всі PASS
- [ ] `amos doctor` → SessionStart/Stop hooks OK для Claude/Codex

---

## Hard Constraints

- НЕ редагувати ~/.claude/settings.json напряму — тільки approved hook additions
- Windows PowerShell: `;` замість `&&`
- Жодних зовнішніх npm-залежностей в ядрі
- v3-хуки продовжують працювати паралельно
- `os.homedir()` скрізь — жодних hardcoded шляхів
- Fail-soft: будь-яка помилка → exit 0, лог в `~/.amos/errors.log`
- Кожен агент у ВЛАСНІЙ гілці

---

## Довідка: структура ядра Sprint 1

  C:\Users\user\.amos\
  ├── bin\amos.js          (301 рядок — CLI ядро)
  ├── lib\db.js            (197 рядків — SQLite state)
  ├── tests\amos.test.js   (45 тестів — 45/45 PASS)
  └── state.sqlite

  C:\Users\user\.claude\bin\
  └── amos.cmd             (%USERPROFILE%\.amos\bin\amos.js %*)

---

## KPI Sprint 2

| Метрика              | Sprint 1  | Ціль Sprint 2          |
|----------------------|-----------|------------------------|
| SessionStart latency | 133ms     | <200ms (з handoff)     |
| SessionStart stdout  | 185 bytes | ≤1.5KB (з handoff)     |
| Node-процесів        | 21 (v3)   | 1 (AMOS)               |
| Cross-client resume  | немає     | E2E доказ, 2 клієнти   |
| Unit тести           | 45        | ≥55                    |
