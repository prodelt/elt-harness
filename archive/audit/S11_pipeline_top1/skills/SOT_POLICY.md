# Skills Single Source of Truth (SoT) — политика

**Дата**: 2026-04-21
**Задача**: S11 — ЗАДАЧА 02
**Статус**: принято

## Решение

`~/.claude/skills/` — **единственный источник правды** для всех скиллов в экосистеме
Claude Code / Codex CLI / Antigravity (Gemini-fork).

Все остальные дистрибутивы — зеркала:

| Дистрибутив | Путь | Режим |
|---|---|---|
| Claude Code | `~/.claude/skills/` | **SoT (read+write)** |
| Codex CLI | `~/.codex/skills/` | mirror (auto-sync, read-only by humans) |
| Antigravity | `~/.gemini/skills/` | mirror (auto-sync, read-only by humans) |

## Правила

1. **Редактировать — только в `~/.claude/skills/`**. Любое изменение в `.codex/` или
   `.gemini/` будет затёрто при следующем mirror-цикле.
2. **Mirror-синхронизация** — хук `skill-sync-mirror` (ЗАДАЧА 05 из PLAN.md).
   PostToolUse[Edit|Write] на путях `~/.claude/skills/*/SKILL.md` → rsync в Codex/Gemini.
3. **Drift-мониторинг** — артефакты `~/.claude/skill-drift-codex.txt` и
   `~/.claude/skill-drift-gemini.txt` (обновляются при каждом прогоне задачи 02).
4. **Формат скилла**: каталог `skills/<name>/SKILL.md` (+ опциональные ресурсы).
   Одиночные .md-файлы в корне `~/.claude/skills/` **не допускаются** — пост-миграция
   перечислена ниже.
5. **Платформо-зависимые скиллы** (Claude-only / Codex-only / Gemini-only) — помечаются
   frontmatter-полем `platforms: [claude, codex]`. Mirror игнорирует скиллы без целевой
   платформы в списке.

## Baseline-снимок (2026-04-21)

- Claude: 29 entries (`/tmp/claude-skills.txt`)
- Codex: 18 entries (`/tmp/codex-skills.txt`)
- Gemini: 18 entries (`/tmp/gemini-skills.txt`)

Drift:

- **Отсутствуют в Codex (5 полноценных скиллов)**: `careful`, `contract-review`,
  `fix-issue`, `freeze`, `prime`
- **Отсутствуют в Codex (7 одиночных .md)**: `checkpoint.md`, `learn.md`, `model-route.md`,
  `nextjs-16.md`, `postgres-patterns.md`, `supabase-best-practices.md`, `supabase-schema.md`
  — требуют конверсии в каталог-форму (см. §Миграция)
- **Gemini имеет свою модель** (роли/агенты: `architect`, `backend`, `frontend`, `qa`,
  `devops`, `security`, `security-agent`, `graphify`, `nextjs`, `supabase`) — drift не
  исправляется до ЗАДАЧИ 06 (sync AGENTS.md/GEMINI.md).

## Миграция одиночных .md → каталог

```bash
# Пример для checkpoint.md:
mkdir -p ~/.claude/skills/checkpoint
mv ~/.claude/skills/checkpoint.md ~/.claude/skills/checkpoint/SKILL.md
```

Применить к: `checkpoint.md`, `learn.md`, `model-route.md`, `nextjs-16.md`,
`postgres-patterns.md`, `supabase-best-practices.md`, `supabase-schema.md`.

**НЕ делать автоматически** — часть из них может быть deprecated или промежуточными
черновиками. Ручное решение по каждому в рамках WAVE 3 (ЗАДАЧА 13 — SemVer).

## Проверка drift

```bash
ls ~/.claude/skills/ | sort > /tmp/claude-skills.txt
ls ~/.codex/skills/  | sort > /tmp/codex-skills.txt
ls ~/.gemini/skills/ | sort > /tmp/gemini-skills.txt
diff /tmp/claude-skills.txt /tmp/codex-skills.txt  > ~/.claude/skill-drift-codex.txt
diff /tmp/claude-skills.txt /tmp/gemini-skills.txt > ~/.claude/skill-drift-gemini.txt
```

Exit code `0` — drift нет. `1` — есть drift, см. файлы.

## Зависимости следующих задач

- **ЗАДАЧА 05** (skill-sync-mirror) — реализует авто-mirror на основе этой политики.
- **ЗАДАЧА 06** (sync AGENTS.md/GEMINI.md) — документирует политику в файлах проектов.
- **ЗАДАЧА 13** (SemVer frontmatter) — затрагивает миграцию одиночных .md.
- **ЗАДАЧА 24** (SkillAnything workflow) — использует SoT как source для мульти-дистрибутив
  генерации.
