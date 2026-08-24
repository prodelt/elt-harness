# Pipeline Setupper — ELT v3 command center

## Overview

Pipeline Setupper керує локальним ELT v3 для Claude Code, Codex і Antigravity. Єдиний активний шлях для коду — `elt`; `elt-code` та `elt-loop` лише аліаси. За замовчуванням `agy` пише код, а поточна поверхня Claude Code або Codex керує роботою: читає diff, запускає перевірки, виправляє за потреби й виступає єдиним суддею. Старий `judge.verify` і старі harness-команди не є частиною виконання.

## Stack

Node.js 18+, PowerShell 5.1+, Git, Claude Code CLI, Codex CLI, Antigravity (`agy`) і локальний `codegraph`.

## Structure

- `tools/elt.js` — єдиний CLI та гейти слайса.
- Драйвер знято (019/T007): слайс веде поточна поверхня, паралельність — субагенти і `--worktree`.
- `tools/fleet/providers.js` — спільний транспорт до Claude, Codex і `agy`.
- `.harness/harness.json` — механічний oracle, smoke, impact-вибір і один judge.
- `specs/*/{spec,tasks}.md` — затверджені плани; без `--spec` береться найновіший план.
- `.planning/STATE.md` — живий стан; `PLAYBOOK.md` — коротка карта маршрутизації.

## Commands

```powershell
node tools/doctor.js
node tools/sync-bin.js                    # синхронізувати ELT runtime у ~/.claude/bin
node "$env:USERPROFILE\.claude\bin\elt.js" status
node tools/elt-oracle-runner.js --full

# ланцюжок гейта: між кроками в дерево не писати
node tools/sync-bin.js
node tools/elt.js oracle --full
node tools/elt.js judge run --task T001
node tools/elt.js commit --task T001 --skip-oracle -m "feat: опис"

node tools/agent-skill-supply-chain.js install-skills --target all --json
agent-skills.cmd                         # ширший supply-chain audit
```

## Code style

Спочатку виправляти спільну першопричину, а не окремий виклик. Використовувати наявні helper-и та стандартну бібліотеку, не додавати залежності або абстракції без потреби. На Windows не використовувати `&&`; шляхи будувати через `path.join()`. Перед зміною коду шукати через `codegraph`, якщо є `.codegraph/`; перед зовнішньою бібліотекою отримувати актуальні docs через `ctx7`.

## Testing

Слайс закритий лише коли named oracle має exit 0, один judge дав `pass`/`inconclusive`, а `elt commit` створив commit і run-log. Для нового нетривіального розгалуження залишити найменший runnable regression test. Перед фінальним закриттям цього репо запускати `node tools/elt-oracle-runner.js --full`.

## Commit & PR

Одна задача — одна `feature/<slug>` або `fix/<slug>` гілка. Коміт лише через `elt commit`, повідомлення `<type>: <description>`. PR title до 70 символів; body містить Summary і Test plan. Не force-push у main і не комітити секрети, `.env`, `node_modules`, caches або build artifacts.

## Gotchas

- `agy` не завантажує skill автоматично: у його prompt треба прямо вимагати прочитати `C:\Users\espad\.gemini\skills\elt\SKILL.md`.
- `judge.verify` у старих конфігах ігнорується runtime; `project-bootstrap apply` видаляє поле.
- `harness-runner`, `harness-gates`, `pipeline-state` і `/pipeline` видалені; deprecated shims завершуються з exit 64 та показують маршрут `elt`.
- Fleet знято (019/T006), PowerShell-драйвери — (019/T007). Прапорця `doctor --fleet` нема.
- Старий план не підхоплюється автоматично; для нього обов'язковий `--spec specs/NNN-name`.
- `C:\` не є git worktree; `graphify` і `codegraph` — різні продукти.
- Для PowerShell 5.1 файли `.ps1` із не-ASCII текстом мають бути UTF-8 з BOM.

## Memory

Живий стан — `.planning/STATE.md` і найновіший `CHECKPOINT-*.md`; історія — `.planning/PROJECT-HISTORY.md`. Пам'ять є вказівником, а не журналом: актуальні runtime-факти завжди перевіряти командами вище.
