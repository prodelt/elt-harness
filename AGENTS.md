<!-- СГЕНЕРИРОВАНО из CLAUDE.md командой `node tools/gen-agents-md.js`. Читатель: Codex CLI.
     Правки вносить в CLAUDE.md — этот файл перезаписывается, и тест на дрейф краснеет. -->

# Pipeline Setupper — ELT v5 command center

## Overview

Pipeline Setupper — це сам харнес ELT, упакований плагіном Claude Code (`elt@elt`). Єдиний
активний шлях для коду — `elt`; `elt-code` та `elt-loop` лише аліаси. Слайс веде поточна
поверхня (Claude Code або Codex): читає diff, запускає перевірки, виправляє за потреби й
виступає єдиним суддею. Писати першу версію коду може `agy` за контрактом
`specs/019-elt-v5-phases-2-5/writer-prompt-v3.md`. Старий `judge.verify` і старі
harness-команди не є частиною виконання.

## Stack

Node.js 18+, PowerShell 5.1+, Git, Claude Code CLI, Codex CLI, Antigravity (`agy`) і локальний
`codegraph`.

## Structure

- `.claude-plugin/{plugin,marketplace}.json` — маніфести плагіна і власний маркетплейс.
- `bin/` — точки входу плагіна: `oracle.js`, `l0.js`, `ledger.js`, `doctor.js`.
- `commands/` — `/elt-verify`, `/elt-defects`, `/elt-doctor`; `skills/elt/SKILL.md` — вхід `/elt`.
- `agents/review-*.md` — пʼять лінз ревʼю; `agents/confidence-scorer.md` — оцінювач упевненості.
- `tools/elt.js` — CLI та гейти слайса; `tools/providers.js` — транспорт до Claude, Codex і `agy`;
  `tools/judge-core.js` — суддя.
- `.harness/harness.json` — механічний oracle, smoke, impact-вибір і один judge.
- `specs/*/{spec,tasks}.md` — затверджені плани; без `--spec` береться найновіший план.
- `.planning/STATE.md` — живий стан; `PLAYBOOK.md` — коротка карта маршрутизації.

## Commands

```powershell
node bin/doctor.js                        # діагностика плагіна
node tools/doctor.js                      # діагностика проєкту
node tools/elt-oracle-runner.js --full
node tools/gen-agents-md.js --check       # дрейф інструкцій
node bin/ledger.js summary                # журнал розходжень вердикту з реальністю

# ланцюжок гейта: між кроками в дерево не писати
node tools/elt.js oracle --full
node tools/elt.js judge run --task T001
node tools/elt.js commit --task T001 --skip-oracle -m "feat: опис"

# установка в чистому проєкті
claude plugin marketplace add "C:\Claude playground\Pipiline setupper"
claude plugin install elt@elt
```

## Code style

Спочатку виправляти спільну першопричину, а не окремий виклик. Використовувати наявні helper-и
та стандартну бібліотеку, не додавати залежності або абстракції без потреби. На Windows не
використовувати `&&`; шляхи будувати через `path.join()`. Перед зміною коду шукати через
`codegraph`, якщо є `.codegraph/`; перед зовнішньою бібліотекою отримувати актуальні docs через
`ctx7`.

## Testing

Слайс закритий лише коли named oracle має exit 0, один judge дав `pass`/`inconclusive`, а
`elt commit` створив commit і run-log. Для нового нетривіального розгалуження залишити найменший
runnable regression test. Механічний оракул сканує ТРИ корені — `tools/`, `bin/` і `benchmarks/`. Перед фінальним
закриттям цього репо запускати `node tools/elt-oracle-runner.js --full`.

## Commit & PR

Одна задача — одна `feature/<slug>` або `fix/<slug>` гілка. Коміт лише через `elt commit`,
повідомлення `<type>: <description>`. PR title до 70 символів; body містить Summary і Test plan.
Не force-push у main і не комітити секрети, `.env`, `node_modules`, caches або build artifacts.

## Gotchas

- `agy` не завантажує skill автоматично: у його prompt треба прямо вимагати прочитати
  `C:\Users\espad\.gemini\skills\elt\SKILL.md`.
- Інструкції живуть в ОДНОМУ файлі — цьому. `AGENTS.md` і `.gemini/GEMINI.md` генеруються
  (`node tools/gen-agents-md.js`); правка копії руками червонить тест на дрейф.
- `judge.verify` у старих конфігах ігнорується runtime; `project-bootstrap apply` видаляє поле.
- `harness-runner`, `harness-gates`, `pipeline-state` і `/pipeline` видалені; deprecated shims
  завершуються з exit 64 та показують маршрут `elt`.
- Fleet знято (019/T006), PowerShell-драйвери — (019/T007), `sync-bin.js` і deploy-копія в
  `~/.claude/bin` — (019/T015). Прапорця `doctor --fleet` нема. Копія, що лежить у
  `~/.claude/bin` сьогодні, більше не оновлюється: проєкти переходять на плагін.
- Старий план не підхоплюється автоматично; для нього обовʼязковий `--spec specs/NNN-name`.
- `C:\` не є git worktree; `graphify` і `codegraph` — різні продукти.
- Підпис спеки живе в трейлерах коміта, а не у файлі: `approval.json` знято спекою 018.
  `elt spec approve` робить власний вузький коміт (pathspec по директорії спеки), тому брудне
  дерево навколо в нього не потрапляє, а worktree бачить той самий підпис, що основне дерево.
- Для PowerShell 5.1 файли `.ps1` із не-ASCII текстом мають бути UTF-8 з BOM.
- Тест `tools/elt-checkpoint.test.js` зелений під `node <file>` (як його гонить оракул) і
  зависає під `node --test` на Linux — див. D24 у реєстрі дефектів.

## Memory

Живий стан — `.planning/STATE.md` і найновіший `CHECKPOINT-*.md`; історія —
`.planning/PROJECT-HISTORY.md`. Памʼять є вказівником, а не журналом: актуальні runtime-факти
завжди перевіряти командами вище.
