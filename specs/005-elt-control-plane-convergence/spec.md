# 005 — ELT Control Plane Convergence

> **Статус:** затверджено користувачем 2026-07-15; реалізацію не розпочато.  
> **Режим:** ELT Mode 0 — ця специфікація + `tasks.md`, без окремого `plan.md`.  
> **Пріоритет:** спочатку механічна чесність і bootstrap, потім міграція та видалення legacy, і лише після цього Fleet/eval.

## 1. Проблема

У репозиторії одночасно живуть три покоління control plane:

1. **ELT v2** — реально використовується (`tools/elt.js`, `tools/elt-loop.ps1`, `.harness/harness.json`, `specs/*/tasks.md`).
2. **Pipeline v3 / Agent Harness v1** — великий старий runtime (`harness-runner`, `harness-gates`, `pipeline-state`), який майже не викликається, але досі впливає на `doctor` і документацію.
3. **Старий project bootstrap / RAG / Graphify** — генерує артефакти, які суперечать актуальному CodeGraph + ELT шляху.

Через це система виглядає зрілою за кількістю компонентів, але може давати хибно-зелені результати:

- `judge.enabled` записується в конфіг, але `elt commit` не вимагає доказу роботи судді; `--verdict` є необов'язковим і невалідованим;
- `elt commit` дописує tracked `.harness/run-log.jsonl` після коміту й сам залишає дерево брудним;
- solo-драйвер перед суддею використовує mutating `git add -N`; на `judge-dead`/`block` він може залишити брудний git index;
- старі gates приймають відсутні або skipped lint/test як допустимий стан;
- `project-docs verify` може завершитися успішно при `coreIdentical=false`;
- `project-bootstrap` skill та CLI описують різні системи, а YAML frontmatter skill зараз не проходить строгий парсинг;
- глобальні Claude hooks сильніші за Codex surface, а Codex може запускатися з небезпечним full-access профілем без окремого сигналу;
- Fleet має тести, але його економічні та A/B твердження не можна вважати прийнятими без чесного ledger і повторюваного live proof.

## 2. Підтверджений baseline аудиту

Зріз за останні 7 днів і live-перевірки 2026-07-15:

| Сигнал | Підтверджений стан |
|---|---|
| Claude Code журнали | 379 JSONL, 294 session IDs, 36 384 записи, 0 invalid |
| Реальне використання | ELT: 260 викликів / 53 сесії; project-docs: 29; CodeGraph: 17 |
| Legacy runtime | harness-runner/gates: 0; RAG: 0; install-harness-teeth: 0 |
| ELT commits у run-log | 98; `verdict=pass`: 72; `verdict=null`: 26 |
| Registry fleet | 43 записи; 38 існують; 27 Git; лише 3 мають валідний harness і повний цикл |
| `doctor --fleet` | PASS=0, WARN=43 |
| Supply chain | 26 skills перевіряються, але критичні `elt` і `project-bootstrap` не входять у coverage |
| Репозиторій | `.planning` ≈33.9k рядків; `audit` ≈26.3k; `amos` ≈5.1k; `tools` ≈22.3k |
| Поточне дерево | до цієї спеки вже було dirty: tracked `.harness/run-log.jsonl` |

Зелені unit-тести старих компонентів не спростовують знахідки: частина тестів кодифікує слабкий контракт, а не fail-closed поведінку.

## 3. Ціль

Залишити **один** активний code control plane:

```text
project-bootstrap inspect → plan → apply → verify → live-fire
                                  │
                                  ▼
spec.md + tasks.md → ELT oracle → judge proof → guarded commit → clean tree
                                  │
                                  ▼
                          doctor / fleet report
```

Система вважається зрілою не тоді, коли файли існують, а коли кожен перехід має машинний proof, негативний тест і чесний exit code.

## 4. Канонічні компоненти після міграції

| Відповідальність | Канон | Контракт |
|---|---|---|
| Слайс і commit | `tools/elt.js` | oracle green + актуальний judge proof + task/spec binding + guarded commit |
| Fresh-context loop | `tools/elt-loop.ps1` | один bounded процес на слайс; STOP; без прихованого bypass |
| Bootstrap | `tools/project-bootstrap.js` | `inspect`, `plan`, `apply`, `verify`, `live-fire`; ідемпотентно |
| AI docs | `tools/project-docs-core.js` | 9 секцій; AGENTS.md priority; semantic verify fail-closed |
| Health | `tools/doctor.js` / `doctor-core.js` | domain-aware readiness, а не наявність файлів |
| Skills | `elt`, `project-bootstrap`, `harness-method` | тонкі orchestration skills; логіка у тестованому repo CLI |
| Parallel mode | `tools/fleet/*` | experimental до чесного ledger + A/B verdict |

`Pipeline v3`, `harness-runner`, `harness-gates`, `pipeline-state`, старий bootstrap advisor, `.rag` і Graphify не отримують нових функцій. Вони лише підтримуються до завершення міграційних задач, після чого видаляються або архівуються поза active runtime.

## 5. Механічні інваріанти

### 5.1 Oracle

- Для code-проєкту `oracle` — непорожня команда, що завершується exit 0/!=0.
- Для docs/office-проєкту потрібен явний artifact verifier; порожній oracle заборонений.
- Oracle proof зберігає `baseHead`, `treeHash`, команду, exit code і timestamp.
- Після будь-якої зміни дерева proof стає невалідним.

### 5.2 Judge

- Judge proof зберігається поза tracked tree у `.git/elt/judge-proof.json`.
- Мінімальна схема: `taskId`, `specPath`, `baseHead`, `treeHash`, `oracleProofHash`, `verdict`, `reasons`, `model`, `createdAt`.
- `elt commit` не приймає вільний `--verdict` як доказ. Він читає та валідує proof.
- Missing, stale, malformed, `block` або dead judge → nonzero exit, без commit.
- `elt checkpoint` — окремий вузький шлях лише для `.planning/**` і `specs/**`; зміни коду через нього заборонені.

### 5.3 Git gate і clean tree

- Repo-native механічний gate викликає ту саму перевірку ELT у pre-commit/CI; hooks клієнта залишаються UX-шаром, не є єдиним enforcement.
- Прямий code commit без актуальних oracle/judge proofs блокується локальним managed git gate.
- Runtime state і ledger не можуть залишати tracked tree брудним після успішного commit.
- `pass`, `block`, `judge-dead` і `oracle-red` завершуються без прихованих staged/intent-to-add змін.
- Існуючий `.harness/run-log.jsonl` мігрується без втрати даних; новий runtime log живе в git-dir (`.git/elt/`).

### 5.4 Bootstrap

- `inspect` і `plan` read-only; `apply` показує та виконує лише заплановані дії; `verify` нічого не ремонтує.
- Проєкт явно класифікується як `code`, `docs/office` або `unknown`; `unknown` не отримує вигаданий oracle.
- CodeGraph не вмикається мовчки: interactive skill питає користувача, CLI потребує явного прапора.
- Bootstrap не створює `.rag`, `.graphifyignore`, legacy pipeline-state або obsolete judge-closeout hooks.
- Повторний `apply` дає no-op і не переписує локальні protected blocks.

### 5.5 Безпека Codex/Claude

- Проєкт не змінює глобальні config без окремого підтвердження користувача.
- Документуються два явні профілі: safe default (`workspace-write`, approvals on-request) та privileged emergency profile.
- `danger-full-access + approval=never` ніколи не подається як рекомендований default; `doctor` має це показувати як high-risk signal.

## 6. Scope

У scope:

- schema та fail-closed enforcement ELT;
- oracle/judge proof binding;
- run-log hygiene;
- repo-native gate;
- повна заміна `project-bootstrap` CLI + skill contract;
- semantic project-docs verifier;
- supply-chain coverage для `elt` і `project-bootstrap`;
- domain-aware doctor/fleet migration report;
- documented safe Codex profiles і surface parity checks;
- deprecation та видалення неактивних Pipeline/Harness/RAG/Graphify шарів;
- правдивий Fleet ledger, контрольований A/B і фінальний release verdict.

Поза scope:

- новий agent framework або нова runtime dependency;
- переписування control plane на Rust до вимірювання Node/CLI bottleneck;
- автоматична масова зміна 43 проєктів без dry-run і підтвердження;
- feature-робота в product repositories;
- zero-touch зміна глобальних Claude/Codex/Gemini settings;
- новий UI або dashboard до стабілізації exit codes і ledger.

## 7. Фази roadmap

### P0 — механічна чесність (T001–T007)

Закрити judge bypass, зв'язати oracle/judge з одним tree hash, відокремити docs checkpoint, прибрати self-dirty і поставити repo-native gate.

### P0 — канонічний bootstrap (T008–T013)

Один CLI та один skill contract: inspect → plan → apply → verify → deterministic live-fire. Виправити YAML і додати критичні skills до supply chain.

### P1 — docs, doctor і міграція (T014–T017)

Зробити semantic docs verification, domain-aware fleet health, read-only migration plan для registry та безпечні Codex profiles.

### P1 — convergence і видалення (T018–T020)

Спочатку прибрати active references, потім видалити legacy runtime двома контрольованими слайсами. Не залишати compatibility layer без реального caller.

### P2 — Fleet economics і release proof (T021–T023)

Виправити ledger semantics, повторити контрольований A/B і провести фінальний fresh-repo + pilot live-fire. Fleet або доводить користь, або лишається experimental / спрощується.

## 8. Критерії приймання

- **AC01:** один canonical route для code work: `elt`; Pipeline v3 не згадується як активна точка входу.
- **AC02:** harness config зі missing/empty oracle або malformed judge config fail-closed у `elt`, bootstrap і doctor.
- **AC03:** code commit без актуального `verdict=pass` judge proof неможливий через `elt commit` і managed git gate.
- **AC04:** oracle proof і judge proof прив'язані до того самого `baseHead + treeHash + taskId + specPath`.
- **AC05:** `elt checkpoint` відхиляє будь-який змінений файл поза `specs/**` і `.planning/**`.
- **AC06:** `pass`, `block`, `judge-dead` і `oracle-red` не залишають прихованих staged/intent-to-add змін; успішний commit завершується clean tree, runtime log не є tracked mutation.
- **AC07:** fresh temp repo проходить bootstrap двічі (другий раз no-op), red→green→judge→commit і закінчує з clean tree.
- **AC08:** `project-bootstrap` skill проходить strict YAML parsing у Claude/Codex/Gemini mirrors і делегує логіку одному CLI.
- **AC09:** supply-chain audit падає при drift або invalid YAML `elt` / `project-bootstrap`.
- **AC10:** project-docs verify вимагає 9 канонічних секцій і `coreIdentical=true`; legacy `.rag` більше не створюється.
- **AC11:** `doctor --fleet` відрізняє missing, non-git, code, docs/office, unknown, invalid harness і ready; не видає false PASS за наявність файлу.
- **AC12:** dry-run для всього registry не змінює жодного проєкту і дає machine-readable plan.
- **AC13:** dangerous Codex default видимий як high-risk; зміна global config можлива лише окремим user-approved кроком.
- **AC14:** після видалення legacy `rg` не знаходить active imports/callers `harness-runner`, `harness-gates`, `pipeline-state`, `.rag`, Graphify або old bootstrap advisor.
- **AC15:** skipped/absent lint або tests не можуть бути доказом closeout.
- **AC16:** Fleet ledger рахує кожен implement/heal/judge spawn; unknown tokens/cost лишаються `unknown`, а не `0`.
- **AC17:** A/B використовує однаковий task corpus, oracle і start commit; звіт містить quality, wall time, calls, tokens/cost та невизначеність.
- **AC18:** фінальний live-fire: один fresh fixture і один реальний pilot, два повтори, усі negative-path тести зелені, checkpoint містить команди й exit codes.

## 9. Бюджет спрощення

Очікуваний напрямок — видалення, не нарощування:

- old Pipeline v3 / Agent Harness runtime + тести: приблизно 2k production LOC;
- old project-bootstrap advisor / installer: приблизно 0.8k LOC;
- codemap / RAG / memory legacy: приблизно 1.7k LOC;
- `amos` і великі audit/history артефакти: архівувати поза active path після перевірки посилань.

Нова логіка має жити в існуючих `elt`, `project-bootstrap`, `project-docs`, `doctor` модулях. Новий модуль дозволений лише коли прибирає щонайменше три дублікати; speculative abstraction заборонена.

## 10. Rollout і rollback

1. Спочатку characterization/negative tests, потім зміна контракту.
2. На час P0 legacy runtime frozen, але не видалений.
3. Bootstrap перевіряється на temp fixtures, потім на одному pilot, лише потім fleet dry-run.
4. Масова міграція запускається окремим підтвердженим кроком; ця спека створює plan, але не авторизує writes у 43 проєкти.
5. Кожна destructive cleanup задача має перед видаленням довести zero active callers і мати git rollback.

## 11. Джерела та існуючі API

### Репозиторій

- `tools/elt.js`: `treeHash()`, oracle proof, `runOracle()`, `appendRunLog()`, commit flow.
- `tools/elt-loop.ps1`: current `git add -N` judge snapshot треба замінити non-mutating diff/status capture.
- `tools/fleet/gate.js`: structured judge parsing, rubric loading, judge prompt, gate flow.
- `tools/fleet/providers.js`: bounded provider spawn і process ownership.
- `tools/project-bootstrap.js`: поточні `scanProject()`, `applySafeActions()`, CLI parsing — перевикористати назви/fixtures, не legacy policy.
- `tools/project-docs-core.js`: section parser, protected blocks, doc selection, registry helpers.
- `tools/doctor-core.js`: skill YAML parsing, supply-chain checks, fleet registry, CodeGraph checks.
- `specs/003-elt-fleet-hardening` і `specs/004-elt-selfdrive`: regression contracts; завершені `[X]` не вважати доказом нових AC без повторної перевірки.

### OpenAI engineering baseline

- [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md): короткі постійні інструкції, а не журнал runtime state.
- [Build skills](https://learn.chatgpt.com/docs/build-skills): один чіткий job на skill, progressive disclosure, мінімальний initial surface.
- [Sandboxing](https://learn.chatgpt.com/docs/sandboxing): least-privilege профіль для повсякденної локальної автоматизації; privileged режим — явний виняток.
