# S7 — Red-team refactor + /prime smoke + /learn pipe + Codex sync

**Date:** 2026-04-18
**Scope:** скиллы для audit/security + cold-start workflows + cross-tool синк.

---

## Changes

### 1. `skills/red-team/SKILL.md` (предыдущая сессия)
Refactor: split defensive vs offensive responsibility.
- Red-team = OWASP Top 10 scanners, exploit verification, MITRE ATT&CK mapping.
- Security-best-practices = defensive-by-default coding (separate skill).
- Added `references/` folder для vendored methodology (2026).
- Before: `before/red-team-SKILL.md` | After: production SKILL.md (with References section).

### 2. `skills/prime/SKILL.md` — env file coverage
**Bug:** /prime не читал `.env.local` (Next.js стандарт). В Izi tracker (`.env.local` с Supabase keys) /prime бы вывел "env: none found" — ложная информация.

**Fix:** заменён linear `cat .env.example` + `cat .env` на loop:
```bash
for f in .env.example .env .env.local .env.development; do
  [ -f "$f" ] && grep -E '^[A-Z_]+=' "$f" 2>/dev/null | sed 's/=.*/=***/' | head -10
done
```

### 3. `skills/learn.md` — promotion pipe
**Gap:** `~/.claude/skills/learned/` содержит 5 global playbooks, но `/learn` SKILL.md описывал только per-project `instincts-*.md`. Pipe для promotion был недокументирован.

**Fix:** добавлена секция "After Learning — Promote to Global Patterns":
- Для confidence >=0.9 + cross-project применимости → `skills/learned/{slug}.md`
- Skip existing slug.
- Format: problem → why linear fails → recipe → example.

### 4. Codex cross-tool sync — no changes needed
Verified: `diff hooks/settings vs codex hooks.json` показывает только 2 ожидаемые разницы (`env-change-watcher`, `task‑completed‑gate` — Claude-only events).

### 5. `skills/learn.md` cleanup  
Убрана одна устаревшая строка про cross-pollination (перепрошла в новый раздел "Promote to Global Patterns").

---

## Test Results

```
test-all-hooks.js        26/26 PASS
test-codex-hooks.js      25/25 PASS
test-hooks-behavior.js   29/29 PASS
Total:                   80/80 PASS ✅
```

## Artifacts

- `prime-smoke-test.md` — /prime smoke результаты в Izi + sudovi-master
- `learn-checkpoint-pipe.md` — /learn + /checkpoint integration verification
- `codex-sync.md` — cross-tool sync verification
- `after/red-team-SKILL.md` + `after/security-best-practices-SKILL.md` — refactor artifacts (from prev session)

## Scope followed

✅ Red-team refactored (prev session)
✅ /prime cold-start smoke в 2 проектах + fix .env.local gap
✅ /learn promotion pipe документирована
✅ Codex sync проверен (no drift)
✅ 80/80 тестов
✅ Один коммит

## Out of scope (S8)

- settings.json + hooks/config.json consolidation (B12)
- stop-verification test-run enforcement (B16)
- Codex/Antigravity hooks isolation (B17)
- skill_listing lazy loading (B18)
- memory/ semantic windowing (B19)
