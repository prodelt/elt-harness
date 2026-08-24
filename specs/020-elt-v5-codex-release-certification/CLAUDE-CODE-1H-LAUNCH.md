# Claude Code — запуск реалізації ELT v5 за spec 020

> Статус: користувач явно затвердив spec 020 у чаті 2026-08-24. Канонічна механічна
> фіксація — approval trailer коміта, створений `elt spec approve` після цього документа.

## Мета сесії

Claude Code є оркестратором, fixer і єдиним фінальним judge. Почати з `T001`, виконувати
`specs/020-elt-v5-codex-release-certification/tasks.md` у зафіксованому порядку та довести
ELT v5 до максимально можливого перевіреного стану за 60 хвилин. Цільовий продукт працює
однаково для Claude Code і Codex. Timebox не дозволяє false-green: якщо всі release gates не
встигли, результат — приватний RC з exact blocker і resume-командою, а не tag `v5.0.0`.

Працювати дозволено лише у dedicated clean worktree
`C:\Claude playground\ELT-v5-one-hour`, створеному від approval commit. Початковий checkout
`C:\Claude playground\Pipiline setupper` містить користувацькі dirty-файли й є read-only
reference для цієї implementation session.

## Канонічні входи — прочитати повністю

1. `AGENTS.md` і `CLAUDE.md`; у Claude Code канонічним project-doc є `CLAUDE.md`.
2. `spec.md`, `tasks.md` і цей файл.
3. `.planning/ELT-V5-CONCEPT-2026-08-22.html` — первинна концепція Earth / Loop / Mirror.
4. `upstreams.lock.json` — immutable upstream та benchmark revisions.
5. `diagrams/elt-v5-graph-harness.mmd`, `elt-v5-batch-certification.mmd` і
   `elt-v5-safe-update.mmd`; PNG/SVG/Excalidraw лежать поруч.

Не використовувати старий auto-checkpoint як план: він посилається на spec 019. Для кожної
task/spec-команди, яка підтримує цей прапорець, передавати
`--spec specs/020-elt-v5-codex-release-certification`. `oracle` читає project harness і не має
`--spec` у поточному CLI.

## Непорушні межі

- Не видаляти, не reset/checkout/stash/pop і не перезаписувати наявні dirty/untracked файли.
- Не виконувати implementation commits у початковому checkout. Dedicated worktree мусить бути
  clean перед T001; будь-який несподіваний dirty path — blocker до зʼясування.
- Користувацькі зміни `.planning/STATE.md`, `.planning/PROJECT-HISTORY.md` і
  `.planning/CHECKPOINT-2026-08-24-auto.md` лишаються тільки у початковому checkout. У T006
  спочатку прочитати їх через read-only diff/reference і перенести лише потрібні additive факти,
  не перезаписуючи оригінал.
- Не stage-ити локальні `Пересборка ELT.html`, `Пересборка ELT_files/` або верхню `diagrams/`;
  їх canonical копії вже збережені у spec 020.
- Не використовувати `~/.claude/bin/elt.js`, старий `elt-loop.ps1`, Fleet або AMOS.
  Runtime-двері цієї роботи — `node tools/elt.js`.
- Не змінювати затверджений intent `spec.md`/`tasks.md`. Якщо потрібна semantic зміна —
  зупинитися, показати diff і запросити нове approval.
- Не self-attest. Dead, timeout, malformed, unknown або inconclusive не є pass.
- Не force-push, не публікувати repo, не додавати secrets/.env/caches/generated dependencies.

## Перші команди

```powershell
Set-Location 'C:\Claude playground\ELT-v5-one-hour'
if (git status --porcelain) { throw 'Dedicated ELT v5 worktree is not clean' }
node specs/020-elt-v5-codex-release-certification/verify-packet.js
node tools/elt.js spec status --spec specs/020-elt-v5-codex-release-certification
node tools/elt.js status --spec specs/020-elt-v5-codex-release-certification
node tools/elt.js slice next --json --count 3 --spec specs/020-elt-v5-codex-release-certification
```

Очікування: approval `approved`, next `T001`. Якщо ні — не обходити gate, а встановити
точну причину. Перед кодом перевірити `.codegraph/`; якщо індекс є, почати зі structural
context. Перед API зовнішньої бібліотеки — pinned docs через ctx7.

## Оркестрація субагентів

До трьох субагентів одночасно, лише для незалежних bounded scopes без перетину файлів:

1. read-only recon/tests/evidence;
2. isolated adapter або parity slice з явним file ownership;
3. REJECT-default review поточного batch.

Головний Claude розподіляє задачі, читає результати, перевіряє diff і лишається єдиним judge.
Субагенти не commit/push/tag, не змінюють spec approval і не оголошують task завершеною.
`agy` допустимий лише як writer першої версії; prompt прямо вимагає спочатку прочитати
`C:\Users\user\.gemini\skills\elt\SKILL.md`. Writer не може бути reviewer/fixer/judge.

## Виконання і batch-gates

Порядок: bootstrap batch `T001+T007` → `T002–T004 → T008–T012 → T013–T022 → T005 → T006`.

- Почати саме з T001, потім до першого landing реалізувати T007 у тому самому bootstrap batch:
  так перший post-commit background уже fail-closed. До T015 діє описаний у spec `legacy-v1`
  epoch; не вигадувати напівреалізований journal і не втрачати старі proof.
- Для кожної T виконати найменший focused regression test у `build`.
- Batch — 2–4 близькі незалежні T однієї spec. Залежні або high-risk architecture T не
  обʼєднувати лише заради швидкості.
- Не запускати full oracle та model review після кожної T. На landing batch — один L0/поточний
  legacy gate; після реалізації T013–T017 — рівно один hash-bound Mirror на batch SHA.
- Між oracle, judge/certificate і commit не писати у bound tree.
- Red ремонтує ту саму generation; не відкривати новий batch поверх uncertified commit.

Перший bootstrap batch у поточному `verify:background` використовує один post-commit Mirror.
Sync `judge run` тут заборонений: його proof background commit ігнорує та запустив би judge
вдруге. Після focused tests T001/T007:

```powershell
node tools/elt.js oracle --full
node tools/elt.js commit --task T001,T007 --spec specs/020-elt-v5-codex-release-certification --skip-oracle -m 'fix: close fail-closed v5 bootstrap batch'
node tools/doctor.js
node tools/elt.js review --json
```

Не починати наступний batch, доки T007 terminal proof не conclusive green. Наступні legacy
background batches так само не запускають окремий sync judge: один commit створює один Mirror.
Після graph cutover
canonical route стає `elt run|advance|status --json`; старі низькорівневі команди лишаються
diagnostic façade, а не другим control plane.

## 60-хвилинний бюджет

- 00–05: status, codegraph/recon, dependency/file ownership, перший batch.
- 05–45: implementation + focused tests; субагенти лише на незалежних paths.
- 45–52: batch Mirror/conformance, Claude/Codex parity, fresh-install smoke.
- 52–57: full oracle, queues/background/CI check, benchmark plumbing або release gate.
- 57–60: evidence snapshot, exact blockers, RC/release decision і resume prompt.

На 52-й хвилині не відкривати новий широкий refactor. Не скорочувати oracle, lenses, CI або
benchmark semantics, щоб встигнути до таймера.

## Release definition

`v5.0.0` дозволений лише якщо одночасно:

- T001–T022 мають authoritative certified state;
- graph conformance, full oracle і всі пʼять release lenses green на одному tree;
- Windows і Ubuntu CI green без ambient home skills;
- clean Claude plugin install та Codex-native parity доведені exact hashes;
- preregistered benchmark pilot має raw results і чесну межу claim;
- background queue/orphans/bg-silent для release scope дорівнюють нулю;
- final `prepare-release` tree не змінений після certificate;
- remote tag SHA перевірений receipt; доступна tag/no-force policy увімкнена, а якщо plan/API
  її не дозволяє — збережена точна відмова і немає claim remote immutability.

Якщо будь-який пункт не виконано, не створювати/пересувати `v5.0.0`. Позначити RC, записати
блокер, останній green SHA, відкриті task identities і одну exact resume-команду.

## Обовʼязковий фінальний звіт

```text
STATUS: RELEASED | RC | BLOCKED
HEAD/branch:
approved spec hash:
certified/open task IDs:
oracle command + exit + duration:
review/certificate identity:
Claude/Codex parity proof:
benchmark dataset/image/result paths:
remote CI/tag/release receipts:
untouched pre-existing dirty files:
exact blockers:
resume command:
```

## Короткий prompt для запуску

```text
Прочитай полностью AGENTS.md, CLAUDE.md и
specs/020-elt-v5-codex-release-certification/CLAUDE-CODE-1H-LAUNCH.md.
Это утверждённая spec 020. Ты оркестратор и единственный judge; используй bounded subagents,
начни с T001, работай batch 2–4 без тяжёлого judge/oracle после каждой T. У тебя 60 минут:
доведи Claude+Codex ELT v5 до доказанного release либо честного RC; ничего не удаляй и не
создавай false-green/tag без всех release gates. Не останавливайся после плана — выполняй.
```
