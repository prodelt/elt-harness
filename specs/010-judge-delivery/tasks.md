# 010 — Доставка контура качества: слайсы

Спека: `specs/010-judge-delivery/spec.md`. Repo `specApproval:true` — без `elt spec approve`
`slice next`/`commit` откажут (exit 4).

## Фаза A — разведка D0 (порог объявлен заранее: N≥2 → smoke в эту спеку, N≤1 → спека 011)

- [ ] **T001** Разведка D0: по трём уехавшим регрессам (27.07 doc2md-tauri «ocr missing»,
  29.07 doc2md-tauri «перестало считать токены», 27.07 Route_API_1C «визиком не участвует»)
  восстановить из git-истории проектов, какой дифф их внёс, и вынести вердикт «поймал бы
  smoke-контракт / нет» с обоснованием. Выход — `.planning/D0-smoke-feasibility.md` с секцией
  на каждый регресс (симптом / коммит / вердикт / обоснование) и итоговой строкой `N=<0..3>`.
  Проверяемо: тест валидирует структуру отчёта (3 секции + парсится `N=`). [AC9]

## Фаза B — D1: мост доезжает до проектов

- [ ] **T002** `tools/sync-bin.js`: копирует замыкание моста в `~/.claude/bin/judge/`
  (`judge-invoke.js`, `red-proof.js`, `elt-config.js`, `fleet/{gate,providers,exec,plan,router}.js`).
  Тест: мост грузится из копии во временном HOME и `require` резолвится целиком внутри неё
  (репо на пути загрузки отсутствует). [AC3]
  [files: tools/sync-bin.js, tools/sync-bin.test.js]

- [ ] **T003** Fallback-резолв в `tools/elt.js:606`: `<cwd>/tools/judge-invoke.js` → иначе
  `~/.claude/bin/judge/judge-invoke.js` → иначе exit 4 с инструкцией `node tools/sync-bin.js`.
  Явный `--invoke` перебивает оба. Тест на все три ветки. Синхронить `~/.claude/bin/elt.js`. [AC1]
  [files: tools/elt.js, tools/elt-judge-contract.test.js]

- [ ] **T004** `doctor`: WARN, если глобальная копия моста расходится с репо или отсутствует
  при `judge.enabled`. Тест. [R1]
  [files: tools/doctor-core.js, tools/doctor.test.js]

## Фаза C — D2: люка самозаверения больше нет

- [ ] **T005** Удалить `--skip-attest` из `tools/elt.js` (флаг, ветку `attest-skipped` в
  run-log, поле `attestSkipped` в proof). При `attest:true` ручной `judge-proof write`
  отвергается безусловно, exit 4 с подсказкой про `elt judge run`. Тест: флаг больше не
  распознаётся и не ослабляет гейт. [AC2]
  [files: tools/elt.js, tools/elt-judge-attest.test.js]

## Фаза D — D4: bootstrap проверяет то, что важно, и молчит про шум

- [ ] **T006** Контракт `judgeBridge` в `project-bootstrap verify`: при `judge.enabled:true`
  мост обязан резолвиться (локально или глобально), иначе `ok:false` с причиной
  `judge bridge is not resolvable`. Тест на оба исхода. [AC4]
  [files: tools/project-bootstrap.js, tools/project-bootstrap.test.js]

- [ ] **T007** `checkOracleVerifierContract` исполняемый: при `--deep` оракул реально
  запускается (таймаут, код возврата в отчёт), без `--deep` — проверяется резолв команды,
  а не только непустота строки. Тест на обе ветки. [AC6]
  [files: tools/project-bootstrap.js, tools/project-bootstrap.test.js]

- [ ] **T008** Шум вон из красного: причина `unknownSections` пробрасывается наружу
  (`project-bootstrap.js:197`) и понижается до warn (`project-docs-core.js:242` fail-closed →
  warn), deprecated-инсталлы (`pipeline`) исключаются из drift. Тест на `Route_API_1C`-подобном
  фикстуре: `ok:true`, причина видна. [AC5]
  [files: tools/project-bootstrap.js, tools/project-docs-core.js, tools/project-bootstrap.test.js]

## Фаза E — периметр (хук + скиллы)

- [ ] **T009** Авто-чекпоинт молчит во время гейта: `elt` выставляет маркер на время
  оракул→судья→commit, `checkpoint-writer.js` его уважает и не пишет в `.planning/`. Тест на
  обе стороны (маркер есть → не пишет; снят → пишет). [AC7]
  [files: tools/elt.js, tools/checkpoint-writer.js, tools/elt-checkpoint.test.js]

- [ ] **T010** Скиллы точечно: убрать из `elt/SKILL.md`, `elt-onboard`, `harness-method` ветки,
  разрешающие писать вердикт руками при `attest:true` и ссылки на `--skip-attest`. Контракт-тест
  на текст скиллов (в стиле `skills-frontgate-contract.test.js`). Зеркала — `sync-agent-surface`. [AC8]
  [files: tools/elt-skill-frontgate-contract.test.js]

## Фаза F — приёмка

- [ ] **T011** Живой блок в чужом проекте: в `C:/Ametrin projects/Route_API_1C` без единой
  правки — `elt judge run` через глобальный резолв, `block` на диффе с внесённым нарушением
  scope и `pass` на чистом. Судья `codex`/`agy` (не Claude, R3). Пруф — две записи в его
  `.git/elt/run-log.jsonl`, приложить в чекпоинт. [AC1]
