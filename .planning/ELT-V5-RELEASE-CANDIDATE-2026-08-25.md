# ELT v5 — release candidate evidence

Спека `specs/021-gemini-benchmark-release-readiness`, задача T005. Здесь лежат ТОЧНЫЕ команды,
их коды возврата и хеши — не пересказ. Всё выполнено живьём 2026-08-26 на Windows 10 Pro,
node 24.14.0, git 2.51.0.windows.2.

Правило этого файла: строка попадает сюда, только если команда реально запускалась и её вывод
прочитан. Ни одного числа «по памяти».

## 1. Чистое окружение: плагин в чужом проекте

Свежий git-репозиторий во временном каталоге, ничего от автора рядом нет.

| шаг | команда | exit |
| --- | --- | --- |
| doctor до бутстрапа | `node <plugin>/bin/doctor.js` | **0** |
| первый bootstrap | `node <plugin>/tools/elt.js init --oracle "node --test"` | **0** |
| doctor после бутстрапа | `node <plugin>/bin/doctor.js` | **0** |

Вывод доктора до бутстрапа — `PASS=12 WARN=0 INFO=3 FAIL=0`; отсутствие `.harness/harness.json`
это `INFO`, а не отказ. После `init` — `PASS=13 WARN=0 INFO=2 FAIL=0`, строка проекта
становится `[PASS] проект: .harness/harness.json — oracle: node --test`.

Записанный конфиг (дословно):

```json
{ "kind": "code", "oracle": "node --test", "shell": "bash", "branchPolicy": "feature",
  "push": false, "judge": { "enabled": true, "provider": "claude", "model": "sonnet", "attest": true },
  "redProof": "on" }
```

**Что это закрывает:** «работает только у автора». Оба состояния теперь воспроизводятся
механически — `node tools/smoke-elt-deploy.js` гоняет их сам (слои `plugin` и `fresh-project`),
регрессы в `tools/smoke-elt-deploy.test.js` (6/6 зелёных). До T005 этот путь проверялся только
руками, то есть не проверялся.

```
smoke-elt-deploy [plugin]: ok — plugin 5.0.0, PASS=12
smoke-elt-deploy [fresh-project]: ok — чистый проект: doctor PASS=13, оракул 'node --test'
exit=0
```

## 2. Паритет Codex/Gemini — найден дрейф и устранён

`node tools/host-surface.js` показал **drift**: источник `5.0.0 c520c61ee8fe`, а все три
клиента — `5.0.0 c107b1e4953f`. Версия совпадала, содержимое нет: проверка «файл есть» такой
дрейф не видит в принципе, поэтому сверка идёт по SHA-256.

```powershell
node tools/host-surface.js --sync-clients --dry-run   # изменений 3
node tools/host-surface.js --sync-clients             # applied, изменений 3
node tools/host-surface.js                            # проверка
```

После синхронизации:

```
  [ok           ] паритет клиентов — источник 5.0.0 c520c61ee8fe
      claude: ok (5.0.0 c520c61ee8fe) — C:\Users\espad\.claude\skills\elt\SKILL.md
      codex:  ok (5.0.0 c520c61ee8fe) — C:\Users\espad\.codex\skills\elt\SKILL.md
      gemini: ok (5.0.0 c520c61ee8fe) — C:\Users\espad\.gemini\skills\elt\SKILL.md
```

Прежние копии сохранены рядом как `SKILL.md.bak-2026-08-26T08-32-05-782Z`; ничего не удалено,
включая снятую развёртку `~/.claude/bin/elt.js` (она остаётся на диске, но маршрутом быть не
может).

## 3. Живой headless `agy` на Gemini 3.7 Flash High — без Claude API

Реальный вызов через тот же транспорт, которым пользуется харнес (`tools/providers.js`),
из каталога чистого проекта:

| параметр | значение |
| --- | --- |
| провайдер / модель | `agy` 1.1.20 / `gemini-3.7-flash-high` |
| промпт | `Reply with exactly this one word and nothing else: ELTSMOKEOK` |
| результат | `ok: true`, `reason: ok` |
| ответ | `"ELTSMOKEOK"` — дословно, без обвязки |
| время | **83,5 с** |

Ни одного вызова Claude или Codex как модели в этом прогоне не было — критерий приёмки спеки
про Gemini-only выполняется буквально.

## 4. Механический гейт на момент кандидата

| проверка | команда | результат |
| --- | --- | --- |
| оракул | `node tools/elt-oracle-runner.js --full` | **108/108 passed** (~240 с) |
| smoke | `node tools/smoke-elt-deploy.js` | exit **0**, оба слоя |
| доктор плагина | `node bin/doctor.js` | exit **0** |
| дрейф инструкций | `node tools/gen-agents-md.js --check` | копии совпадают |

## 5. Что этот файл НЕ доказывает

* **Установку через marketplace по имени репозитория.** Проверялся локальный путь
  (`claude plugin marketplace add "<repo>"`) и прямой запуск точек входа. Путь
  `claude plugin marketplace add prodelt/elt-harness` требует, чтобы репозиторий уже был
  доступен читателю — а он приватный, и до смены visibility этот шаг непроверяем в принципе.
* **Зелёный CI.** На момент записи ветка не отправлена на GitHub: `git push` заблокирован
  защитным хуком машины и выполняется пользователем вручную. Матрица Windows/Linux — предмет
  T006, а не этого файла.
* **Поведение на Linux.** Всё выше снято на Windows. Linux-половину доказывает только матрица
  GitHub Actions.

## 6. Открытые дефекты на момент кандидата

Блокирующих — **ноль**. Открыты два, оба не блокируют релиз:

| № | что | почему не блокирует |
| --- | --- | --- |
| D12 | `agent-browser eval --stdin` возвращает `null` | чужой инструмент, есть обход |
| D24 | `elt-checkpoint.test.js` зависает под `node --test` на Linux | под `node <file>` — как его гонит оракул и CI — проходит |

## История дефектов, найденных самим гейтом в ходе 021

Записано как есть: судья дважды заблокировал работу автора спеки, и оба раза по делу.

1. **CRLF ломал hash-lock у каждого нового пользователя** (найдено фоновым судьёй на `c5950b1`).
   При `core.autocrlf=true` git отдавал `gate-runner.js` с 198 CRLF, sha256 на диске расходился
   с зарегистрированным, и сторонний рецензент на Windows получал `exit 3 HASH-LOCK MISMATCH`
   вместо прогона бенчмарка. Подтверждено живым клоном, а не рассуждением. Починено
   `.gitattributes` (`af05db6`, `ecb8d38`).
2. **Первый фикс был и слишком широк, и неполон одновременно** (судья на `af05db6`).
   `benchmarks/** text` меняло checkout-семантику чужих наборов и объявляло текстовым любой
   будущий бинарный артефакт; сузив правило, я пропустил `.jsonl` — а `*.json` их не матчит,
   и три raw-лога остались бы без правила. Итог: правило по фактическому содержимому
   `checksums.sha256`, и регресс, который идёт ОТ этого списка, а не от захардкоженного
   расширения.
3. **Смешение задач в одном дереве** (судья на попытке закрыть T003 вместе с T004). Работа
   T004 лежала в том же дереве, что ремонт T003, — судья назвал это scope creep'ом и
   заблокировал слайс целиком. Разнесено на отдельные слайсы, оба закрыты по отдельности.
