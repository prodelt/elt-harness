# /learn + /checkpoint Integration Check (S7)

## Current state

**Pipe 1 (declarative via /ship):**
`~/.claude/skills/ship/SKILL.md:77-81` Step 6 после commit:
1. Run `/learn` — extract patterns
2. Ask "Checkpoint? [y/n]" → `/checkpoint`

**Pipe 2 (hook-enforced):**
`~/.claude/hooks/stop-verification.js:75-108` — при >20 edits в сессии:
- Вставляет warning "LEARN RECOMMENDED: run /learn"
- Имеет анти-loop protection (8h cooldown через `~/.tmp/claude-learn-gate/`)

**Артефакты:**
- `~/.claude/projects/{project}/memory/instincts-{date}.md` — per-project snapshots (есть 1 файл)
- `~/.claude/skills/learned/*.md` — global playbooks (5 файлов, включая `multi-round-api-redteam-probing.md` от 2026-04-17)

## Gap найден

`/learn` SKILL.md описывал только per-project instincts, не упоминал **promotion** в global `skills/learned/`. Но файлы там есть (из sudovi-master сессии 2026-04-17). Значит promotion происходила вручную или pipe не задокументирован.

## Fix applied

`~/.claude/skills/learn.md:50-58` — добавлена секция "After Learning — Promote to Global Patterns":
- Для instincts с confidence >=0.9 + cross-project применимостью
- Писать playbook в `~/.claude/skills/learned/{slug}.md`
- Skip если playbook уже существует

## Checkpoint pipe

`~/.claude/skills/checkpoint.md` — declarative формат output (build/test/diff/tasks/next). Сохранение в `.planning/CHECKPOINT-{date}.md`.

Нет hook который форсит /checkpoint — только рекомендация в /ship Step 6. Это приемлемо (checkpoint — ручной контроль, не автоматический).

## Verdict

- `/ship` → `/learn` pipe задокументирован (Step 6).
- `/learn` → `skills/learned/` pipe **был missing**, теперь добавлен.
- `/checkpoint` — опциональный, остаётся ручным.
- stop-verification hook реально стреляет на 20+ edits (подтверждено кодом, не regression).
