# Checkpoint - 2026-07-12

## Задача
Продолжение `specs/004-elt-selfdrive` (ELT Self-Drive роадмап) — взять оставшиеся открытые
слайсы T010/T012/T013 через `/elt`.

## Build Status
- Compiles: n/a (Node.js, no build step)
- Lint: not configured
- Type check: not run

## Test Metrics
- Оракул проекта: `node tools/doctor.test.js; if ($LASTEXITCODE -eq 0) { node --test tools/fleet/*.test.js }`
- doctor.test.js: PASS (все тесты, включая новые за эту сессию)
- fleet: 107/107 pass, 0 fail
- Новые тесты этой сессии: `testFleetExperimentalLabelHonest`, `testHarnessSelfcheck`, `testSelfDriveInvariantsCheck`; `testFleetWorkersCheck` расширен идемпотентностью

## Git State
- Branch: `feature/elt-loop-driver`
- Uncommitted: 1 файл (`.harness/run-log.jsonl` — ожидаемо, дописывается ПОСЛЕ git commit внутри `elt commit`, попадёт в следующий коммит)
- Коммиты этой сессии: `7c1deb9` (T010), `4d82aaf` (T012), `a27c1e4` (T013)

## Completed Tasks (эта сессия)
- **T010** — `tools/harness-selfcheck.js`: watchdog собственного оракула харнесса. Гоняет `.harness/harness.json` `oracle`; красный → механически заводит/дополняет `specs/NNN-selfheal/tasks.md` (следующий `T00X`) + маркер `harness-selfcheck-red` в run-log; зелёный/нет конфига → no-op. Паттерн — как `codegraph-guard.js` (T009): testable runner-инъекция. Коммит `7c1deb9`, судья pass. (Прошлая автономная попытка была легитимно заблокирована судьёй — implementer не произвёл дифф; в этой сессии реализовано с нуля.)
- **T012** — честность experimental-метки Fleet: `CLAUDE.md` нёс УСТАРЕВШУЮ ложь "пока specs/003-elt-fleet-hardening не закрыт" (003 давно закрыта, verdict 2.66×/3.31×). Заменено на честный текст: 003 закрыта технически, но живой прогон на реальном проекте (Fleet-vs-solo A/B, Ametryn Protocol Bot) ещё не завершён (пауза на rate-limit) — метка держится по ПРАВИЛЬНОЙ причине. Новый regex-тест в `doctor.test.js` ловит регрессию на старую ложь. `~/.claude/skills/elt/SKILL.md` НЕ тронут — отдельный грязный репо (несвязанное удаление AMOS-слоя), судья подтвердил легитимность сужения scope. Коммит `4d82aaf`, судья pass.
- **T013** — единый self-drive-обзор в `doctor`: новый `checkSelfDriveInvariants()` в `doctor-core.js` — статически проверяет, что `fleet/effort-policy.js` (`effortFor`, T004) и `fleet/gate.js` (`runOk`-инвариант, T002) реально на месте, id `selfdrive:effort`/`selfdrive:judge-liveness` в общем отчёте `runDoctor()`. `checkFleetWorkers()` залежавшиеся claims теперь реально ПОДМЕТАЕТ (`fleetClaims.sweep()`, self-heal) вместо пассивного warn-репорта — идемпотентно. По пути пойман и починен баг: `readText()` возвращает `{ok,value}`, не строку — первая версия чек-функции делала `readText(...) || ''` (всегда truthy-object, regex никогда не матчился); тест поймал до коммита. codegraph-live и git-workflow-audit уже были подключены раньше (T008/T009) — не трогались. Коммит `a27c1e4`, судья pass.

## План `specs/004-elt-selfdrive` ЗАКРЫТ ЦЕЛИКОМ
13/14 done. Единственный открытый — **T011 OPTIONAL** (Gated self-repair: связать watchdog T010 → драйвер по self-heal спеке с судьёй; merge в main по умолчанию РУКАМИ человека, не авто). Легитимно открыт — помечен OPTIONAL в tasks.md, не блокирует.

## Blockers
Нет активных. T011 может быть взят отдельной сессией `/elt` (план ещё технически "открыт" на 1 слайс) либо явно закрыт как "не делаем" по решению юзера.

## Next Steps
1. Если юзер хочет T011 — `/elt` подхватит его как последний открытый слайс плана 004.
2. Иначе — начать новый план (`specs/005-...`) через Режим 0 «План-шаг», или взять живую работу (напр. resume Fleet-vs-solo A/B на Ametryn Protocol Bot, ждёт сброса rate-limit — см. `.planning/CHECKPOINT-2026-07-11-fleet-vs-solo-ab-ametryn.md`).
3. Опционально: перенести честную формулировку fleet-experimental-метки (T012) в `~/.claude/skills/elt/SKILL.md` — сейчас там всё ещё старый текст (другой репо, не тронут по scope-дисциплине этой сессии).

## Resume Pointer
- Focus: `specs/004-elt-selfdrive` закрыт (13/14, T011 optional остался). Следующий шаг — решить с юзером T011 vs новая задача.
- Resume: `elt` (голый вызов) → покажет T011 как единственный открытый слайс плана 004, либо явно спроси юзера новую задачу.
