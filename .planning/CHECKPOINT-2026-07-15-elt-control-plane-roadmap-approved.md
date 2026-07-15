# CHECKPOINT 2026-07-15 — ELT control plane roadmap затверджено

## Рішення користувача

Глибокий аудит harness loop, повного pipeline, Claude Code/Codex surface і `project-bootstrap` прийнято. Користувач підтвердив план: зараз зафіксувати executable roadmap, реалізацію почати в новому чаті.

Канонічний артефакт:

- `specs/005-elt-control-plane-convergence/spec.md` — контракт, scope, інваріанти, acceptance criteria;
- `specs/005-elt-control-plane-convergence/tasks.md` — 23 атомарні слайси T001–T023 у dependency order;
- цей checkpoint — точка входу нового чату.

Окремий `plan.md` свідомо не створювався: ELT Mode 0 вимагає лише `spec.md + tasks.md`.

## Що затверджено

### P0 — спочатку

1. Fail-closed harness config.
2. Oracle/judge proof, прив'язаний до task/spec/baseHead/treeHash.
3. `elt commit` без free-form verdict bypass.
4. Вузький `elt checkpoint` лише для planning/spec docs.
5. Усунення `git add -N` dirty-index path і tracked run-log self-dirty.
6. Repo-native mechanical gate + повний control-plane oracle.
7. Один `project-bootstrap`: `inspect → plan → apply → verify → live-fire`.
8. Валідний thin `project-bootstrap` skill і mandatory supply-chain coverage для нього та `elt`.

### P1 — після стабільного solo/bootstrap path

1. Project docs: 9 секцій, real drift failure, без auto-RAG.
2. Domain-aware `doctor --fleet` і read-only migration plan для current registry.
3. Safe Codex profiles як явний контракт; жодних silent global mutations.
4. ELT — єдина active route; Pipeline v3/old harness deprecated.
5. Zero-caller proof → видалення old harness/pipeline і RAG/Graphify/bootstrap legacy.

### P2 — останнім

1. Truthful Fleet ledger.
2. Контрольований Fleet-vs-solo A/B з однаковим corpus/start/oracle/judge.
3. Fresh-repo + real-pilot live-fire і фінальний release verdict.

## Важливі підтверджені дефекти для T001

- `tools/elt.js` не вимагає judge proof; `--verdict` optional/unvalidated.
- `tools/elt-loop.ps1` використовує `git add -N` перед суддею й може лишити index dirty на block/dead.
- `.harness/run-log.jsonl` tracked і змінюється після commit; це вже видно в поточному `git status`.
- `project-bootstrap` skill має invalid YAML frontmatter у Claude/Codex/Gemini mirrors.
- Skill обіцяє modern live-fire, а CLI створює old Graphify/RAG artifacts.
- `project-docs` знає 4 секції, зберігає uncontrolled non-core і створює `.rag`; verify ігнорує `coreIdentical=false` у CLI exit.
- Old harness gates приймають skipped/missing lint/tests/git audit; тести це кодифікують.
- Current repo oracle не включає ELT/bootstrap/project-docs tests — лише doctor + Fleet.
- Supply-chain critical set не містить `elt` і `project-bootstrap`.
- Fleet doctor перевіряє переважно наявність файлів, не schema/domain readiness.

## Git state на момент handoff

- Branch: `feature/slice-2026-07-12`.
- До створення roadmap уже був user/system dirty-файл: `.harness/run-log.jsonl`.
- Roadmap-файли й оновлення STATE створені навмисно та не закоммічені в цьому planning turn.
- Не скидати й не перезаписувати legacy run-log. Його безпечна міграція — T006.
- Перед T001 створити/перейти на окрему branch `feature/elt-control-plane-convergence`, зберігши roadmap changes.

## Межі наступного чату

- Почати тільки з **T001**; один слайс = один доказаний commit.
- Не запускати Fleet до T021.
- Не робити mass writes у registered projects; T016 — тільки dry-run.
- Не змінювати глобальний Codex/Claude config без нового явного підтвердження користувача.
- Не видаляти legacy до T018 zero-caller/deprecation proof.
- Для зовнішніх бібліотек використовувати ctx7; для цієї P0 роботи нові залежності не потрібні.
- Judge обов'язковий для code slices навіть до того, як T004 зробить це механічним.

## Resume prompt для нового чату

```text
$ui-ux-pro-max:elt
Продовжуй затверджений roadmap з
.planning/CHECKPOINT-2026-07-15-elt-control-plane-roadmap-approved.md і
specs/005-elt-control-plane-convergence/{spec.md,tasks.md}.

Почни з T001. Спершу збережи наявні uncommitted roadmap files і pre-existing
.harness/run-log.jsonl, створи branch feature/elt-control-plane-convergence.
Працюй строго по одному слайсу: failing negative test → мінімальна реалізація →
повний oracle → незалежний judge → commit. Fleet не запускай до T021.
Не змінюй global Codex/Claude config і не роби writes у registry projects без мого
окремого підтвердження.
```

## Validation цього planning turn

Структурна перевірка:

- `T001–T023`: 23 послідовні open tasks, duplicate/gap немає;
- `plan.md` відсутній, як вимагає ELT Mode 0;
- `node tools/elt.js slice next` → `T001` із нового `tasks.md`;
- `git diff --check` → exit 0;
- status містить лише pre-existing `.harness/run-log.jsonl` та навмисні roadmap/STATE зміни.

Baseline tests (фіксація вихідної точки, **не** доказ майбутніх fixes):

- `node tools/doctor.test.js` → PASS;
- `node tools/project-bootstrap.test.js` → PASS;
- `node tools/project-docs.test.js` → PASS;
- `node tools/elt-oracle-proof.test.js` → 3/3 pass;
- `node --test tools/fleet/*.test.js` → 107/107 pass;
- весь baseline command → exit 0.

Ці зелені тести сумісні з аудитом: частина чинних тестів прямо кодифікує legacy/RAG/false-green контракти. Реалізаційні acceptance T001–T023 ще не виконані, код у planning turn навмисно не змінювався.
