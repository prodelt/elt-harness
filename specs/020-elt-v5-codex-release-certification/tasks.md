# Tasks — 020 ELT v5 Codex release certification

- [ ] **T001** Закрити D25 чотирма регресами: `opus-5` → 1M і small-моделі → 200k;
  ручний хвіст checkpoint переживає повторну ротацію; deployed hook знаходить CLI проєкту;
  gateActive блокує запис під час oracle/judge/commit. Розгорнути source у
  `~/.claude/hooks/checkpoint-writer.js` і довести SHA-256 equality.
  [files: tools/checkpoint-writer.js tools/elt-checkpoint.test.js .planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md]

- [ ] **T002** Закрити background finding T018: language-aware import scan не гасить JS
  private field `#client = require('pkg')` і `${require('pkg')}`, але ігнорує текст у
  звичайній quoted/template string та справжні коментарі. Після green proof закрити
  `elt review close --task T018`.
  [files: tools/elt-gate-l0.js tools/elt-gate-l0.test.js .elt/ledger.jsonl]

- [ ] **T003** Замкнути README на versioned KPI snapshot: усі поточні відсотки мають
  фіксований `--as-of`, окремі LOC/defect counts або власну команду, або прибрані; regression
  порівнює README зі snapshot. Після green proof закрити `elt review close --task T016`.
  [files: README.md tools/kpi-commit-share.js tools/kpi-commit-share.test.js tools/kpi-release-snapshot.json]

- [ ] **T004** Аудит глобальних `~/.claude/hooks/`: зіставити активні hooks із settings/config,
  знайти посилання на видалені `fleet`, `elt-loop`, `sync-bin` і локальні source-копії.
  Відомий source drift синхронізувати; невідомі/сторонні hooks не видаляти. Зберегти
  відтворюваний звіт із командами й exact counts.
  [files: .planning/ELT-V5-GLOBAL-HOOKS-AUDIT-2026-08-24.md]

- [ ] **T005** Codex live certification: у чистому окремому git-проєкті встановити приватний
  marketplace/plugin, ініціалізувати harness із `judge.provider=codex`, виконати реальну
  кодову задачу до ELT commit. Артефакт доказу: шлях проєкту, task, SHA, oracle exit 0,
  verdict, run-log entry; mocks не приймаються.
  [files: .planning/ELT-V5-CODEX-LIVE-CERT-2026-08-24.md]

- [ ] **T006** Release engineering і фінальне закриття: додати SemVer/runbook і механічну
  перевірку узгодженості version; повний oracle; дочекатися фонів; закрити поточні release
  queue items; закрити 019/T020; створити `main`, tag `v5.0.0`, GitHub Release, push усіх
  refs і перевірити CI. Branch protection увімкнути, якщо API/тариф дозволяє, інакше
  записати точну відмову.
  [files: README.md CHANGELOG.md .planning/STATE.md .planning/PROJECT-HISTORY.md docs/RELEASING.md tools/version-check.js tools/version-check.test.js]
