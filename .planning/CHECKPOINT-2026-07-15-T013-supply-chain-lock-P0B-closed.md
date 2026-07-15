# CHECKPOINT 2026-07-15 — T013 закрыт, P0-B закрыт целиком

## Что сделано в этом чате

`specs/005-elt-control-plane-convergence` (23 слайса). Закрыт **T013** (`85b310a`) —
последний слайс P0-B, блок закрыт целиком.

Задача: supply-chain gate обязан считать критическими targets `elt` + его алиасы
(`elt-code`, `elt-loop`) + `project-bootstrap`; invalid YAML / missing mirror / content drift →
**fail** (не warn, в отличие от общего `checkAgentSkillSupplyChain`, который warn'ит по всему
широкому набору из `config/agent-skill-sources.json`).

Сделано:
- **`agent-skills.lock.json` → v2**: добавлены `elt`, `elt-code`, `elt-loop` рядом с
  `project-bootstrap`. Новое поле `sourceKind: repo|home` — project-bootstrap канонится в репо
  (`skills/project-bootstrap/SKILL.md`), elt-семья канонится в `~/.claude/skills/*` (home).
  Хранимый `sha256` — НЕ ground truth для сравнения (иначе каждая правка SKILL.md требовала бы
  править lock.json); чекер всегда пересчитывает хеш источника живьём.
- **`tools/doctor-core.js:checkAgentSkillsLock(root, home)`** — новая функция, читает lock,
  для каждого critical skill: source exists → parseSkillFrontmatter (реюз из T012-контекста) →
  sha256 источника → сверка каждого target-mirror (exists + hash match). Любая проблема → один
  `fail`-результат с деталями (up to 10). Wired в `runDoctor` рядом с `checkAgentSkillSupplyChain`.
- **`tools/doctor.test.js`**: `writeLockFixture` + `testAgentSkillsLockCheck` — 5 сценариев
  (pass, missing mirror, content drift, invalid YAML, missing lock.json) живьём зелёные.

### Побочный инцидент (вне git-диффа репо, важно для памяти)
При проверке реального состояния обнаружился **настоящий drift** `elt` SKILL.md между
`~/.claude`/`~/.codex`/`~/.gemini` — codex-копия ушла вперёд (версия 2.3.2, добавлен раздел
«судья выбирается по поверхности: Codex → независимый Codex-агент, Claude Code → sonnet»),
которого не было в каноне claude/gemini. Смёрджил улучшение в canonical (`~/.claude/skills/elt`,
версия → 2.3.3), затем по ошибке прогнал `sync-agent-surface.js --apply --target all --force` —
это форс-перезаписало ВСЕ конфликтующие скиллы (не только elt) из claude в codex/gemini:
`agents`, `case-defense-analysis(-workspace)`, `checkpoint`, `docx`, `gstack`,
`itstep-lesson-builder`, `lifecycle`, `pm`, `session-harvest`. Спросил юзера — подтверждено
«это ожидаемо» (claude = source of truth по дизайну инструмента, drift = баг, не намеренная
правка). Предыдущий контент codex/gemini НЕ сохранён (эти домашние каталоги не под git).
**Урок:** `sync-agent-surface.js` не умеет фильтровать по одному скиллу — `--force` бьёт по
всем конфликтам разом. В следующий раз для точечного фикса одного скилла — копировать файл
руками, не гонять глобальный `--apply --target all --force`.

Судья (Agent, `model: sonnet`, свежий контекст, независимо прогнал `doctor.test.js` и
`elt-oracle-runner.js`) — **pass**: критический набор верный, invalid YAML/missing
mirror/content drift → FAIL как требуется, тесты покрывают все 5 сценариев, scope строго 3
файла, side-effects нет в самом диффе.

Полный оракул (`node tools/elt-oracle-runner.js`) — **43/43**. Живой `node tools/doctor.js` на
реальном проекте после реконсиляции elt показывает `[PASS] Critical skill lock OK`.

## Проверка (Proof)
```
node tools/doctor.test.js                    → doctor tests: PASS (5/5 сценариев lock-чека)
node tools/elt-oracle-runner.js              → 43/43 passed, exit 0 (159s)
node tools/doctor.js | grep lock             → [PASS] Critical skill lock OK
sha256sum elt/SKILL.md (claude/codex/gemini) → identical (d983dbaa...) после реконсиляции
git status --porcelain                        → clean после commit
```

## Git state
- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое.
- Коммит: `85b310a` (T013, `[X]` в tasks.md). **P0-B закрыт целиком.**

## Дальше
Следующий блок — **P1-A** (T014-T017): docs/health/rollout.
- T014 — честный project-docs semantic verifier (9 секций, `coreIdentical=true`, без `.rag`).
- T015 — `doctor --fleet` domain-aware readiness (missing/non-git/code/docs/unknown классы).
- T016/T017 — см. `specs/005-elt-control-plane-convergence/tasks.md` дальше по файлу.

`elt status` → next будет T014 автоматически.

## Resume prompt

```text
elt
Продолжай specs/005-elt-control-plane-convergence с T014 (project-docs semantic verifier: 9
секций Overview/Stack/Structure/Commands/Code style/Testing/Commit & PR/Gotchas/Memory,
coreIdentical=true входит в success, unknown sections только explicit protected/local,
прекратить создание .rag). T001-T013 закрыты — P0-A целиком + P0-B целиком (T008-T013), см.
.planning/CHECKPOINT-2026-07-15-T013-supply-chain-lock-P0B-closed.md.
Порядок закрытия слайса: failing/зелёный оракул → судья (Agent, model:sonnet, свежий
контекст) → elt oracle → elt judge-proof write → elt commit --task T0xx --skip-oracle (две
команды подряд без ничего между ними — иначе tree-hash протухнет, см. предыдущие чекпоинты).
⚠ sync-agent-surface.js --apply --target all --force бьёт по ВСЕМ конфликтующим скиллам разом,
не только по одному нужному — для точечного фикса копировать файл вручную.
Fleet не запускать до T021. Не менять global Codex/Claude config без явного подтверждения,
не делать writes в registry-проекты без отдельного подтверждения.
```
