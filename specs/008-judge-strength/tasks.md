# 008 — Усиление судьи: задачи

Порядок обязателен: T001 (механика grounding) → T002 (второй судья) → T003 (red-proof) →
T004 (проводка в proof/commit/драйвер) → T005 (замер + живой прогон). T001-T003 трогают
разные функции `gate.js`, но T004 связывает их в один контракт proof — параллелить нельзя.

- [X] **T001** Grounding-чек: промпт судьи требует `filesReviewed` (+ секция «ФАЙЛЫ ДИФФА» из `git status`, не зависящая от cap диффа); `judgeDiff` механически сверяет — файл не из диффа → `block` `grounding:phantom-file`, непокрытый файл диффа → `block` `grounding:unreviewed-file`, пустой `reasons` → `block` `grounding:no-reasons`. Схема structured output и JSON-хвост для codex/agy расширены полем. Тесты на все три отказа + на честный вердикт. [files: tools/fleet/gate.js, tools/judge-grounding.test.js]

- [X] **T002** Двойной судья: `harness.json.judge.verify = {provider, model}` читается `elt-config`; `runJudge` при `pass` первичного зовёт второго тем же `judgeDiff` (чистый контекст, тот же дифф), `block` первичного второго НЕ зовёт; итог — `block` если любой `block`, `judge-dead` если второй `runOk=false`; возвращается `judges[]` с обоими вердиктами/моделями/временем. Тесты: pass+pass, pass+block, block-короткое-замыкание, verify-dead. [files: tools/fleet/gate.js, ~/.claude/bin/elt-config.js, tools/judge-verify.test.js]

- [ ] **T003** Red-proof: `tools/red-proof.js` — из диффа берёт новые/изменённые тестовые файлы, создаёт `git worktree` на `baseHead`, копирует туда эти файлы, гоняет `harness.json.testCmd` (дефолт-детект: node → `node --test <files>`), ожидает ненулевой exit; возвращает `{status:'red'|'green'|'skipped', reason, files, tail}`; `green` = слайс не доказан. Нет тестовых файлов → `skipped:no-new-tests`, нет команды → `skipped:no-test-cmd`. Worktree удаляется всегда (включая падение). Тесты: красный тест, зелёный тест, отсутствие тестов. [files: tools/red-proof.js, tools/red-proof.test.js]

- [ ] **T004** Проводка контракта: `elt judge-proof write` принимает и хранит `judges[]`, `grounding`, `redProof`; валидация proof в `elt commit` требует их при включённом контуре (`judge.verify` задан / `redProof != "off"`) → иначе exit 4; `judge-invoke.js` и `elt-loop.ps1` прокидывают новые поля из `runJudge`+red-proof; обратная совместимость со старым proof при выключенном контуре. Тесты: полный proof проходит, урезанный отвергается, выключенный контур = старое поведение. [files: ~/.claude/bin/elt.js, tools/judge-invoke.js, tools/elt-loop.ps1, tools/elt-judge-contract.test.js]

- [ ] **T005** Доказательство контура: прогнать `judge-bench` (14 кейсов) на усиленном судье, сравнить с прошлым отчётом через `judge-bench-compare` (recall не ниже, ложные pass не выросли); затем живой прогон усиленного гейта на реальном слайсе 006 (не стаб); включить контур в `harness.json` репо; результат + цифры в `.planning/CHECKPOINT-*-008-judge-strength.md`. [files: .harness/harness.json, .planning/]
