# Checkpoint - 2026-07-12 15:40 — P1-1 (codegraph-мандат) + P1-2 (skip-oracle trust-hole) закрыты

> Продолжение `.planning/CHECKPOINT-2026-07-12-elt-roadmap-fixes.md` (P0 закрыт там). Эта сессия
> закрыла оба открытых P1-пункта роадмапа. Context ~235k/1000k — ротация.

### Build Status
- Compiles: not applicable (Node.js, без сборки)
- Lint: not configured
- Type check: not run (нет TS в tools/)

### Test Metrics
- Оракул проекта (`node tools/doctor.test.js; node --test tools/fleet/*.test.js`): **107/107 pass, exit 0** (прогнан живьём дважды за сессию — после P1-1 и после P1-2)
- Новый `tools/elt-oracle-proof.test.js` (3 сценария skip-oracle trust/mismatch/no-proof): **3/3 pass** — НЕ включён в оракул-команду выше (существующий паттерн репо: оракул гоняет только `doctor.test.js` + `tools/fleet/*.test.js`, остальные `tools/*.test.js` не включены — это старый гэп, не новый)
- Coverage: not measured

### Code Modifications Since Last Checkpoint
- Files created: `tools/elt-oracle-proof.test.js`
- Files modified: `tools/elt.js` (+ синхронизирована деплой-копия `~/.claude/bin/elt.js`), `.harness/harness.json`, `CLAUDE.md`
- Files deleted: —
- Lines added/removed: `tools/elt.js` +51/-3 (P1-2); `CLAUDE.md` 2 строки переписаны (P1-1); `.harness/harness.json` +1 строка (P1-1)

### Git State
- Branch: `feature/slice-2026-07-12`
- Uncommitted changes: 1 файл (`.harness/run-log.jsonl` — растёт с каждым `elt commit`, ожидаемо; `.planning/CHECKPOINT-2026-07-12-auto.md` тоже тронут авто-хуком)
- Last commit: `2890b1b chore: elt slice` (P1-2); до него `8ab5f0f chore: elt slice` (P1-1)
- ⚠ **Гигиена коммит-сообщений**: оба коммита названы generic `chore: elt slice` вместо содержательных — передавал `--msg "..."` в `elt commit`, а CLI понимает только `-m` (не `--msg`), флаг молча проигнорирован. Смысл коммитов — в run-log.jsonl (verdict/oracle exit) и в этом чекпоинте, не в git log. Не критично, но на будущее: `elt commit -m "..."`, не `--msg`.
- Ветка на 4 коммита впереди `main` (2 доковых + 2 code-фикса), не смерджена — маленькая, можно смерджить в любой момент.

### Completed Tasks
- **P1-1 · codegraph-мандат решён одним движением** — user
  - Включён `codegraphGuard: true` в `.harness/harness.json` (T009-гейт `tools/codegraph-guard.js`, уже существовал и был подключён в `elt-loop.ps1`, но был opt-in/выключен) — теперь автономный драйвер жёстко стопится на мёртвом/устаревшем codegraph-индексе.
  - `CLAUDE.md` переписан честно: строка «codegraph первым» помечена как дисциплина ИНТЕРАКТИВНОЙ сессии (adoption 4/993, авто-гейта там нет), отдельно описан гейт для автономного драйвера (проверяет только здоровье индекса, не факт вызова codegraph агентом).
  - Судья (sonnet): pass. Коммит `8ab5f0f`.
- **P1-2 · `--skip-oracle` trust-hole закрыт** — user
  - `elt commit --skip-oracle` больше не верит флагу вслепую: сверяет хеш рабочего дерева на момент последнего зелёного `elt oracle` (пруф в `.git/elt-oracle-proof.json`, per-worktree через `git rev-parse --git-dir`) с текущим. Совпал → доверяем (реальный оракул не гонится второй раз). Не совпал/пруфа нет → форсируем настоящий прогон.
  - **Найдена и починена реальная регрессия по пути**: первая версия `treeHash()` использовала `git add -N -- .` (intent-to-add) для показа untracked-файлов в diff — это МУТИРУЕТ git-индекс навсегда (до commit/reset). Когда `elt oracle` (с этим побочным эффектом) вызывался в интеграционной ветке ПОСЛЕ merge (существующий код `tools/fleet/merge.js:44-47`, не мой), пруф-механизм оставлял интеграционную ветку в грязном застейдженном состоянии → следующий merge параллельного слайса отказывал. Поймано полным прогоном оракула (`tools/fleet/fleet.test.js` T026 упал), локализовано git stash bisect + изолированным repro-скриптом (`fleet.run()` напрямую), починено: `treeHash()` теперь читает untracked-файлы через `fs.readFileSync` напрямую, НЕ трогая git-индекс вообще.
  - Судья (sonnet) поймал реальный баг в тесте на первом проходе: тест #3 удалял пруф по устаревшему пути (`.harness/oracle-proof.json` вместо `.git/elt-oracle-proof.json`), из-за чего не проверял заявленный сценарий. Починено, судья на повторном проходе: pass. Коммит `2890b1b`.

### Remaining Work (P2, из .planning/CHECKPOINT-2026-07-12-elt-roadmap-fixes.md)
- **P2-1** · Подмести 4 stale-audit WARN в doctor (agent-surface/docs-gate/harness-checklist/git-workflow) — или снять чеки, если не нужны
- **P2-2** · Fleet: снять experimental-метку — ЗАБЛОКИРОВАНО до завершения Ametryn Fleet-vs-solo A/B (на паузе, Claude rate-limit) — status
- Опционально: смерджить `feature/slice-2026-07-12` → `main` (маленькая, 4 коммита, оракул зелёный) — не сделано в эту сессию, юзер не просил

### Blockers
- P2-2 блокирована внешним фактором (Claude rate-limit пауза на Ametryn A/B) — не решается изнутри этой сессии

### Next Steps
1. Спросить юзера: P2-1 (гигиена WARN) или смердж ветки в main, или новая задача
2. Если P2-2 — сначала проверить, снялась ли пауза rate-limit на Ametryn A/B (внешняя проверка)

### Resume Pointer
- Focus: роадмап фиксов ELT — P0 и P1 закрыты целиком, остался P2 (низкий приоритет) + опциональный merge веточки в main
- Resume: `/elt продолжи P2 из .planning/CHECKPOINT-2026-07-12-p1-fixes-codegraph-skiporacle.md — P2-1 (stale WARN) или merge feature/slice-2026-07-12 → main`
