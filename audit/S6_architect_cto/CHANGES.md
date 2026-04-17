# S6 — Architect-first + CTO-playbook + File-size rule (B03)

**Date:** 2026-04-17
**Scope:** organizational rules для core development workflow + proof в dev-проекте.

---

## Changes

### 1. `hooks/config.json`
Добавлен блок для B03:
```json
"editEnforcer": {
  ...
  "fileSizeWarnLoc": 500,
  "fileSizeBlockLoc": 1200
}
```

### 2. `hooks/edit-enforcer.js`
Новый **CHECK 5 (B03)** перед CHECK 4:
- `loc >= 1200` → DENY с сообщением "SPLIT first, invoke Skill(architect-first)"
- `loc >= 500` → WARN "file is NNN LOC, each Edit burns ~NK tokens"
- `loc < 500` → silent
- Skip уже-существующих правил (skipExtensions, skipPaths) применяются ДО этого check.

### 3. `skills/cto-playbook/SKILL.md`
- Добавлена строка в §1 Code Quality Standards: `Files ≤ 500 LOC (red flag), 800 hard ceiling`
- Добавлен scope-разделитель с `architect-first`: «standards catalog vs workflow».
- Размер: 125 → 127 строк (target ≤150 достигнут).

### 4. `skills/architect-first/SKILL.md`
- В Non-Negotiable: `File size >500 LOC = red flag — split before Edit`.
- В Hard Stop Rules: `Target file >500 LOC and task requires structural edits`.
- Добавлен scope-разделитель с `cto-playbook`.
- Размер: 110 → 113 строк.

### 5. `skills/pipeline/SKILL.md`
- В Step 0 Precheck добавлен пункт 3: file-size precheck (wc -l → warn + confirm).
- Пункт «otherwise → fresh pipeline» смещён на §4.

---

## Proof

### B03 hook-level check (unit test)
```
# 602-line file → additionalContext warning:
{"...": "FILE SIZE: big_file.js is 602 LOC (>500 red flag). Each Edit burns ~12K tokens..."}

# 1302-line file → permissionDecision=deny:
{"...": "FILE SIZE: huge_file.js is 1302 LOC (hard ceiling 1200)... BLOCKED."}

# 7-byte small.js → silent allow (empty stdout)
```

### Hook test suites (80/80 green)
```
test-all-hooks.js        : 26/26 PASS
test-hooks-behavior.js   : 29/29 PASS
test-codex-hooks.js      : 25/25 PASS
```

### Real-world pipeline-state test (Izi tracker)
- Project: `D:/Ametrin projects/Izi tracker/izi-tracker` (Next.js 16 + Supabase)
- State written in `~/.claude/pipeline-state.json`: cwd, stack, commands, domain=frontend.
- Sub-skill simulation: architect-first → inline-review → ship
- Checkpoints appended correctly: classified → architected → reviewed → shipped
- Ship step cleared state to `{ phase: shipped, ts: ... }` minimal record.
- Largest .ts/.tsx: 323 LOC (workDay.test.ts) — ни один файл не триггерит 500 LOC warn, что подтверждает здоровое состояние проекта.

---

## What NOT done (scope S7+)
- `/red-team` refactor → S7
- `settings.json` / `hooks/config.json` consolidation → S8
- `/pipeline` file-size precheck is advisory (Claude-enforced); hook-level CHECK 5 is automatic
