# /prime Smoke Test Results (S7)

## Test setup
Проверил `/prime` в 2 cold-start проектах: Izi tracker (Next.js) и sudovi-master (Python).

## Izi tracker (`D:\Ametrin projects\Izi tracker\izi-tracker`)

**CLAUDE.md:** есть (6.9KB) — полное покрытие stack, архитектура, gotchas.
**Stack detection:** ✅ `package.json` → Next.js 16.2.4, React 19.2.4.
**Struct:** ✅ `src/` (app, components, lib, hooks, types, __tests__).
**Git:** ✅ 7 commits видны.
**Env vars:** ❌ **GAP** — /prime читал только `.env.example` и `.env`, но проект использует `.env.local` (Next.js стандарт).
  - Файлы: `.env.local` (2 keys: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
  - /prime бы вывел "none found" → ложная информация.

**Fix applied:** patched `~/.claude/skills/prime/SKILL.md:39-42` — loop через `.env.example`, `.env`, `.env.local`, `.env.development`.

## sudovi-master (`D:\Ametrin projects\sudoviy master try 3\sudovi-master`)

**CLAUDE.md:** есть (11.1KB) + `README.md` 11.1KB.
**Stack detection:** ✅ `pyproject.toml` присутствует.
**Struct:** ✅ `src/` (api_clients, core, integrations, runners).
**Git:** ✅ 5 commits видны.
**Env vars:** ✅ `.env` и `.env.example` — /prime читал корректно до фикса.
**После фикса:** работает без регрессии (скрипт loop'а пропускает несуществующие файлы).

## Verdict

- Обе cold-start сессии подхватывают CLAUDE.md, git, stack.
- Context7 не триггерится в /prime (это read-only info-load, правильно).
- **Баг найден и исправлен:** `.env.local` для Next.js.
- Nodes: при желании можно добавить авто-`/init-project` когда CLAUDE.md отсутствует — уже есть hard-block через `project-docs-gate` (S5).

## Token estimate

Размер /prime output: ~40-50 строк, ~2-3K tokens. Приемлемо для cold-start.
