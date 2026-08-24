# PLAYBOOK — практичний ELT v3

## Одна схема

Для коду є один маршрут: `elt`. `agy` пише першу версію, поточний Claude Code або Codex читає diff, запускає oracle, виправляє за потреби й є єдиним judge. Це реалізація схеми A+C з `ELT v3 — протокол замера и три схемы харнесса.html`: L0 → impact oracle → smoke → risk routing → один `pass|block|inconclusive` → накопичення evidence.

З 09.08.2026 (спека 014, фаза B) до цього маршруту додано **спекулятивний контур**: поле
`verify: "background"` у `.harness/harness.json`. `elt commit` робить L0 + швидкий oracle і
**повертає керування**; повний сьют, мутатор, smoke і суддя йдуть у фон на detached-worktree
`.fleet-wt/bg-<hash>`. Червоне з фону — запис `kind: "bg-red"` у `.harness/review-queue.jsonl`
(розбір: `elt review` / `elt review close --task`), мовчання фону довше `backgroundTimeoutMin` —
інцидент `bg-silent` у `.harness/health.jsonl`. `verify: "sync"` лишається умовчанням.

Auto-revert зі схеми B так і не взято: черга й задача — так, автоматичний відкат чужої роботи —
ні, він небезпечніший за червоний рядок у черзі.

## Звичайна робота

1. Тривіальна правка — просто зробити й запустити найменшу релевантну перевірку.
2. Один нетривіальний слайс — короткий regression test, oracle, один judge, `elt commit`.
3. Велика нова ціль — `specs/NNN-name/spec.md` + `tasks.md`, показати користувачу, отримати «затверджую», виконати `elt spec approve --spec specs/NNN-name` (з 018 це власний коміт із трейлерами
   `Spec-Approved:`/`Spec-Hash:`/`Tasks-Hash:`, без оракула й судді), потім працювати слайсами.
4. Продовження — `elt status`; без `--spec` він бере найновіший план. Старий план завжди вказувати явно.

```powershell
node "$env:USERPROFILE\.claude\bin\elt.js" status
node "$env:USERPROFILE\.claude\bin\elt.js" brief tools/elt.js   # ПЕРЕД слайсом, не після
node "$env:USERPROFILE\.claude\bin\elt.js" slice next --json --count 3 --spec specs/NNN-name
node "$env:USERPROFILE\.claude\bin\elt.js" judge run --task T001 --spec specs/NNN-name
node "$env:USERPROFILE\.claude\bin\elt.js" commit --task T001 --spec specs/NNN-name --skip-oracle
```

## Автономний прогін

PowerShell-драйвер знято спекою 019 (T007) разом із усім `tools/*.ps1`, окрім `doctor.ps1`
і `skill.ps1`. Заміна — штатні засоби Claude Code: субагенти для паралельних слайсів і
`--worktree` для ізоляції. Транспорт до `agy`/Codex НЕ знято: він живий у
`tools/providers.js`, і саме поверх нього T012 повертає писателя командою плагіна.
Контракт промпту писателя v3 виписаний у `specs/019-elt-v5-phases-2-5/writer-prompt-v3.md`,
щоб при поверненні його не писали заново.

До T012 автономний прогін виглядає так: слайс веде поточна поверхня (Claude Code або Codex),
паралелізм — субагентами, гейт — тією самою ланцюжком нижче. Stop-файл `.harness/STOP`
і логи `.harness/loop-logs/` лишаються: їх пише сам `elt`, а не драйвер.

```powershell
node tools/sync-bin.js
node tools/elt.js oracle --full
node tools/elt.js judge run --task T001
node tools/elt.js commit --task T001 --skip-oracle -m "feat: опис"
```

## Proof

`Done` означає одночасно:

- oracle exit 0;
- smoke exit 0, якщо налаштований;
- рівно один judge `pass` або `inconclusive`;
- `elt commit` створив commit і запис у `.harness/run-log.jsonl`.

`judge.verify` зі старих конфігів runtime ігнорує. Для очищення конфіга достатньо `project-bootstrap apply`.

## Інші маршрути

- Офісний документ, таблиця, презентація або PDF → `elt-work`.
- Новий еталонний проєкт → `project-bootstrap`.
- Зовнішня бібліотека → актуальні docs через `ctx7` перед кодом.
- Паралельність → штатні субагенти Claude Code і `--worktree`. Fleet знято (019/T006),
  прапорця `doctor --fleet` більше нема.

## Знято спекою 019 (фаза 3) — без мовчазних втрат

Кожен сценарій, що спирався на видалене, має або заміну, або явний запис «знято»:

| Було | Стало |
| --- | --- |
| `elt-loop.ps1` — петля agy→oracle→суддя→commit | ланцюжок вручну (вище) + субагенти; писатель повертається в T012 |
| `elt-drive.ps1` — session-rotation на N раундів | `--worktree` і окремі сесії; ротація сесій більше не наша справа |
| `elt-selfheal*.ps1` — watchdog і авто-merge | ЗНЯТО без заміни: авто-merge чужої роботи небезпечніший за червоний рядок у черзі `elt review` |
| `elt-fleet.ps1` + `tools/fleet/**` | штатні субагенти (знято ще в T006) |
| `approval-guard.js` | підпис спеки живе трейлерами коміта (спека 018), сторож більше не потрібен |
| `elt harness sync-all` — розкатка схеми v4 по реєстру чужих проєктів | ЗНЯТО: розкатку робить установка плагіна (T015), до неї — вручну |
| `elt harness propose` — judge-bench-гейт на правку судді | ЗНЯТО (D16: був недосяжний); еволюцію контуру доводить ledger із T019 |
| `sync-agent-surface.js` — дзеркало скілів у три CLI | ЗНЯТО: скіли ставить `agent-skill-supply-chain.js install-skills` |
| `codegraph-guard.js` + `codegraphGuard` у конфізі | ЗНЯТО: єдиний виклик жив у драйвері; codegraph лишається довідкою, не воротами |
| `doctor --fleet`, `surface:sync` у докторі | ЗНЯТО разом із підсистемами, які вони перевіряли |
| `research*.js`, `hook-diet`, `agent-library`, `stuck-detector`, `probe-primitives`, `amos-baseline/`, `rag*.py` | ЗНЯТО: нуль викликів із живого шляху (перевірено грепом поіменно) |

## Видалені маршрути

`/pipeline`, `harness-runner`, `harness-gates`, `pipeline-state` та `install-harness-teeth` не запускати. Compatibility shims лише пояснюють міграцію та завершуються з exit 64. Єдиний code control plane — `elt`.

## Живий стан

`.planning/STATE.md` — поточний стан, найновіший `CHECKPOINT-*.md` — точка відновлення, `.planning/PROJECT-HISTORY.md` — історія. Реальний runtime перевіряється `node tools/doctor.js`, а не старими нотатками.
