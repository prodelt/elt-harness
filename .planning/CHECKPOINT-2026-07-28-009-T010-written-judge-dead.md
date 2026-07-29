# CHECKPOINT 2026-07-28 — 009 T010 написан и зелёный, но НЕ закоммичен (verify-судья codex висит)

**Спека:** `specs/009-elt-v3-thinking-harness` · **ветка:** `feature/judge-bench-parallel-oracle` · **HEAD:** `232b209`
**Состояние дерева:** грязное намеренно — T010 реализован, оракул 58/58, но гейт не пройден (вердикт `dead`).

## Что сделано (всё в дереве, не в коммите)
- `tools/fleet/providers.js` — lean ВЫКЛЮЧЕН по умолчанию (`FLEET_LEAN=1` — явный откат).
- `tools/fleet/fleet.js` — три провайдерских причины отказа implement (`limit`/`timeout`/`fatal-config`)
  сведены в одну перевыдачу следующему в цепочке (`router.cool`+`pick`), `failoverFrom` в ledger,
  событие `failover-reissue`, ограничение `maxAttempts`. Фатальный конфиг больше не валит прогон,
  если есть здоровый провайдер (без альтернативы — старое громкое падение сохранено).
  Судья разводится с воркером: сначала настроенный verify-судья, потом ДОСТУПНЫЙ альтернативный CLI
  (`FLEET_BIN_*`/`where`), иначе судья остаётся + событие `judge-same-as-worker`. То же в `redoSerial`.
- `tools/fleet/gate.js` — red-proof во fleet-гейте (`stage:'red-proof'` на зелёном), полный proof
  (`judges`/`grounding`/`redProof`) через `--extra-file`, параметр `judgeVerify`. Плюс `JUDGE_TIMEOUT_MS`
  поднят 5→9 мин (утверждено юзером) — **гипотеза не подтвердилась, см. ниже**.
- `tools/elt.js` + зеркало `~/.claude/bin/elt.js` (закоммичено в ~/.claude как `231d8dd`) —
  `judge-proof write --attested-by fleet-gate`: машинное происхождение вердикта вместо лживого
  `--skip-attest`. Чужое значение флага обхода не даёт.
- Тесты: 6 новых в `tools/fleet/fleet.test.js`, 2 в `tools/elt-judge-attest.test.js`,
  обновлены lean-тесты в `tools/fleet/providers.test.js`. Оракул **58/58** (три прогона подряд).

**Главный дефект, найденный по пути:** под живым контуром репо (`redProof:"on"`, `judge.attest:true`)
fleet-гейт вообще не мог закоммитить — писал урезанный proof, `elt commit` его законно отвергал.
Теперь есть e2e-тест: гейт доходит до коммита, в proof `redProof.status:"red"`, `attested:true`.

## Почему НЕ закоммичено
Три прогона гейта: первичный судья **agy = pass** каждый раз (перечисляет все 4 требования T010).
Verify-судья **codex = dead** трижды: 301с, 301с (лимит 5 мин), затем **540с** (лимит 9 мин).
Тот же codex-CLI на коротком промпте отвечает за секунды (проверено `providers.run`, exit 0).
Вывод замера: дело НЕ во времени — codex висит на этом промпте (крупный дифф + рубрика 009).
Поднятие таймаута до 9 мин, стало быть, **лечило не ту причину**.

## ДАЛЬШЕ (порядок для нового чата)
1. **Решить с юзером**, чем закрывать T010 (он уже отверг вариант «--skip-attest» в пользу
   таймаута, но замер таймаут опроверг):
   - откатить `JUDGE_TIMEOUT_MS` 9→5 мин + убрать про него фразу из `tasks.md` (вывод неверен),
     и разбираться с зависанием codex отдельной задачей;
   - либо verify на claude/sonnet (жжёт Claude-лимит, файл `harness.json` вне зоны T010);
   - либо `--skip-attest` с громким следом.
2. После решения: правка → `elt spec approve` → `elt oracle` (~5 мин) → `elt judge run --task T010
   --spec specs/009-elt-v3-thinking-harness` → `elt commit --task T010 --skip-oracle`.
3. Открытые после T010: T011 (живой прогон, закрывает спеку), T012/T013 (фаза F, ускорение).

## Гочты сессии
- **Коллизия ID между спеками живьём**: `T010` есть и в `specs/006-elt-front-gate/tasks.md`.
  `elt judge run --task T010` без `--spec` связался с 006 и судья заблокировал по чужой рубрике.
  Всегда `--spec specs/009-elt-v3-thinking-harness` в этой спеке.
- Зеркало `~/.claude/bin/elt.js` отставало с T008 → судья видел чужие правки как scope creep
  во внешнем репо. Лечится коммитом зеркала в `~/.claude` (там своя история chore-коммитов).
- Стабы судьи в fleet-тестах НЕ должны отдавать `filesReviewed`: непустой список включает
  grounding-чек, и стаб обязан перечислить весь дифф worktree → `grounding:unreviewed-file`.
- Инвариант «судья ≠ воркер» в тестах уводит судью с claude на codex → всем fleet-тестам добавлен
  `FLEET_BIN_CODEX` (тот же стаб), иначе тесты спавнили бы реальный codex (замер: 74с на слайс).
- Зона T010 расширена дважды с утверждения юзера: `tools/elt.js` + зеркало + `elt-judge-attest.test.js`,
  затем `tools/fleet/providers.test.js` (тест поведения из зоны).
