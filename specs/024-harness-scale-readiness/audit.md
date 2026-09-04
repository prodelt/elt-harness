# 024 — доказательная база аудита (2026-09-03)

Файл существует отдельно от `spec.md` потому, что спека обязана быть читаемой как решение, а
не как протокол. Здесь — сырые воспроизведения: команда, вывод, вывод. Каждый пункт спеки
ссылается сюда номером.

Окружение замера: Linux 6.18.44, node v22.22.2, git 2.43.0, чистое дерево на
`claude/harness-analysis-optimization-z5xtwm` (= `main`).

---

## E1. `treeHash` хеширует ФОРМУ вывода git, а не содержимое дерева

Корень трёх независимых симптомов сразу. `treeHash()` (`tools/elt.js:293`) складывает в
sha256 строки `git status --porcelain -uall` ДОСЛОВНО, вместе с двухсимвольной колонкой
статуса. Колонка статуса меняется от индексации, а не от содержимого:

```
$ printf 'b\n' > f.txt; printf 'new\n' > g.txt
--- ДО git add -A (момент записи пруфа) ---
 M f.txt$
?? g.txt$
--- ПОСЛЕ git add -A (момент проверки хуком) ---
M  f.txt$
A  g.txt$
```

`elt commit` вызывает `git add -A` (`tools/elt.js:2078`) ПЕРЕД `git commit` (`:2084`), а
хук `elt gate` пересчитывает `treeHashNormalizingTaskMarks()` уже после индексации
(`:1881`). Обе строки изменились → хеш не совпадёт НИКОГДА.

**Следствие E1a.** В режиме `verify: "background"` (его ставит `project-bootstrap apply`
по умолчанию) `elt commit` при включённом хуке не может пройти в принципе:
`elt gate: доверенный пруф не про это дерево — изменения вне маркера задачи`, exit 4.
Тот же слайс с `git config --unset core.hooksPath` коммитится с exit 0.

**Следствие E1b.** Вторая поломка того же корня. `git()` (`tools/elt.js:67`) делает
`.trim()` всего stdout, срезая ведущий пробел ПЕРВОЙ строки статуса. Дальше
`line.slice(3)` (`:331`) отрезает от пути один символ:

```
$ node -e "...git status --porcelain..."
"M specs/999-x/tasks.md" -> slice(3)= "pecs/999-x/tasks.md" planPath= false
```

`planPath()` не узнаёт файл плана → нормализация маркера задачи не срабатывает на первой
строке статуса → `hashTaskMarksNormalized` теряет своё единственное назначение ровно в том
случае, ради которого он написан.

**Почему автор этого не видит.** В самом репозитории `core.hooksPath` не задан
(`git config --get core.hooksPath` → exit 1). Гейт выключен у автора и включён у всех, кто
прошёл `project-bootstrap apply`.

## E2. Хук гейта закоммичен неисполняемым — на POSIX он молча игнорируется

```
$ git ls-files -s .githooks/pre-commit
100644 7d059c61a9747a8f20a8092d78d51e9962f07b25 0	.githooks/pre-commit
```

Проба на чистом репозитории с `core.hooksPath .githooks` и режимом 644:

```
hint: The '.githooks/pre-commit' hook was ignored because it's not set as executable.
[master (root-commit) 930285f] test
COMMIT EXIT=0
```

`hint:` — не ошибка. Коммит проходит, гейта нет, никто не предупреждён. Документированная
в самом хуке инструкция (`Enable once per clone: git config core.hooksPath .githooks`) на
Linux и macOS даёт ложное чувство защиты.

Класс шире одного файла: **ни один файл репозитория не имеет исполняемого бита.**

```
$ git ls-files -s | awk '$1=="100755"'
(пусто)
```

При этом 24+ файла начинаются с shebang (`bin/doctor.js`, `bin/l0.js`, `bin/oracle.js`,
`bin/ledger.js`, `bin/session-start.js`, `bin/session-stop.js`, все `benchmarks/*.js`,
`.claude/hooks/*.js`, большая часть `tools/*.js`). Shebang в них — украшение.

`project-bootstrap` пишет хук в ЧУЖОЙ проект правильно (`mode: 0o755`,
`tools/project-bootstrap.js:270`), поэтому дефект живёт ровно в поставке самого харнеса.

## E3. Кэш оракула не покрывает два из трёх корней сьюта → ложные попадания

`elt-oracle-runner.js:147` зовёт `oracleCache.computeEntry({root, testFile, runnerVersion,
cmd, readFile})` — без `scanDirs`. Дефолт параметра — `scanDirs = ['tools']`
(`tools/elt-oracle-cache.js:70`), а `TEST_ROOTS = ['tools','bin','benchmarks']`
(`elt-oracle-runner.js:171`). Значит замыкание теста НИКОГДА не содержит исходников из
`bin/` и `benchmarks/`.

Воспроизведено на копии репозитория:

```
closure size: 12 | key: a3e720997e2d0580
после правки bin/l0.js -> key: a3e720997e2d0580
КЛЮЧ ИЗМЕНИЛСЯ? НЕТ — ЛОЖНОЕ ПОПАДАНИЕ КЭША
```

Правка `bin/l0.js` не сдвигает ключ `bin/l0.test.js`. Кэш отдаёт попадание, тест не
гоняется, оракул печатает `N/N passed` и exit 0 — **на сломанном коде точки входа плагина.**
Ровно тот сценарий, ради запрета которого `bin/` и делали корнем оракула в 019/T011.

Второй слой той же дыры: `RUNNER_VERSION` (`elt-oracle-runner.js:36`) хеширует себя и
`elt-oracle-cache.js`, но НЕ `elt-oracle-select.js`, откуда берутся `needlesFor`, `walkJs` и
`INERT` — то есть все правила вычисления замыкания. Правка правил выборки оставляет весь
старый кэш валидным.

## E4. Named oracle красный на Linux — exit 1

```
$ node tools/elt-oracle-runner.js --full ; echo "EXIT=$?"
elt-oracle-runner: 110/112 passed in 39.8s
FAILED: benchmarks/gemini-3.7-flash-high/runner.test.js, tools/elt-verify-bg.test.js
EXIT=1
```

CLAUDE.md объявляет `exit 0` полного оракула условием закрытия слайса. На Linux и macOS
это условие недостижимо, то есть **вклад извне механически заблокирован**.

- `tools/elt-verify-bg.test.js` — exit 1, 14 тестов `cancelled`:
  `Promise resolution is still pending but the event loop has already resolved`. Тот же
  класс, что уже записанный D24 (`elt-checkpoint.test.js` под `node --test`).
- `benchmarks/gemini-3.7-flash-high/runner.test.js` — `26 tests: 25 passed, 1 failed`,
  причина: `ModuleNotFoundError: No module named 'pytest'`. Тест жёстко требует системную
  зависимость и краснеет вместо честного skip; в CI она ставится отдельным шагом
  (`.github/workflows/test.yml`), у контрибьютора — нет.

## E5. Русский язык — не оформление, а требование валидатора

`tools/elt.js:489`:

```js
const SPEC_REQUIRED_SECTIONS = ['Проблема', 'Решения', 'User stories', 'Критерии приёмки', 'Риски', 'Вне scope'];
```

Англоязычная команда не может написать спеку, проходящую `elt spec lint`. Обхода нет:
поля в `.harness/harness.json` для этого не существует.

Замер языка пользовательской поверхности (не-тестовые файлы `tools/` + `bin/`):

| измерение | кириллица | латиница | доля кириллицы |
| --- | --- | --- | --- |
| строки `console.error` + `die()` | 73 | 44 | **62.4 %** |
| вся консольная проза (`log`+`error`+`warn`+`die`) | 112 | 66 | 62.9 % |
| `tools/elt.js` — CLI, с которым говорит пользователь | 90 | 54 | 62.5 % |
| печатающие модули, где есть ≥1 кириллическое сообщение | 10 из 11 | — | 91 % |

Языков при этом два: 4 902 строки `.js` несут только-русские буквы (`ы ъ э ё`) и 435 —
только-украинские (`і ї є ґ`). Английский — только витрина: README, CONTRIBUTING, SECURITY,
`docs/{INSTALL,USAGE,EVIDENCE,CODEX-PROFILES}.md`. Всё, что грузится в рантайме —
`skills/elt/SKILL.md` (65 %), `commands/*.md` (56–68 %), `agents/*.md` (52–62 %),
`CLAUDE.md`/`AGENTS.md` (57 %) — кириллица.

## E6. Путь новичка не заканчивается зелёным гейтом ни разу

Пройден живьём в песочнице, три чистых репозитория.

| путь | результат |
| --- | --- |
| буквально по `docs/INSTALL.md`, без сессии Claude Code | **никогда** — в INSTALL нет CLI-пути вовсе, конфиг создаёт только `/elt` |
| CLI + `project-bootstrap apply --apply` (документированный «настрой мой проект») | **никогда** — дедлок (E7), затем E1a |
| CLI без bootstrap, рабочий agent CLI, секции спеки угаданы по-русски | ~10–15 мин, из них ~8 — обратная разработка формата `tasks.md` |

Прочие подтверждённые точки отказа на этом пути:

- `node tools/project-bootstrap.js` без аргументов печатает `project-bootstrap: bounded-grep-first`
  и exit 1. Шесть подкоманд видны только из `parseArgs` (`:820`).
- `node tools/doctor.js` на чистом репозитории: `PASS=6 WARN=12 FAIL=9`, exit 2. Требует от
  ЧУЖОГО проекта файлы самого харнеса (`tools/agent-skill-supply-chain.js`,
  `agent-skills.lock.json`), читает `/root/.claude/skill-registry/`, печатает пути через
  `\` и `cmd /c` на Linux и советует `init-project` — команды, которой в репозитории нет
  (`tools/doctor-core.js:105`).
- `elt judge run` при недоступном провайдере: `"verdict": "dead"`, exit 4, без причины и без
  пути к логу. Причина лежала в непечатаемом файле: `--dangerously-skip-permissions cannot be
  used with root/sudo privileges`. Поле `judgeLog` доводится до `elt.js:1671`, но не печатается.
- `judge.enabled: false` валидируется (`tools/elt-config.js:48`) и НЕ читается `elt commit`.
  Закрыть кодовый слайс без обращения к модели нельзя.
- Нет команды создания спеки; `templates/` содержит один несвязанный файл. Формат
  восстанавливается из регулярного выражения `TASK_LINE_RE` (`tools/elt.js:74`).

## E7. `project-bootstrap apply --apply` оставляет проект в дедлоке

Воспроизведено дважды с нуля. После `apply` включён `core.hooksPath` и обычный
`git commit` отказывает. Дальше:

```
elt commit        → elt: спека не подписана: elt spec approve --spec specs/001-first
elt spec approve  → elt: git commit не прошёл — elt gate: нет оракул-пруфа (verify:"background")
elt commit        → (снова строка 1)
```

`elt spec approve` делает собственный коммит (`elt.js:1790`), который отвергает
установленный тем же bootstrap хук. Документированного выхода нет: `git commit --no-verify`
и `git config --unset core.hooksPath` не упомянуты ни в одном документе.

## E8. Неудачный `elt commit` портит состояние плана

`elt commit` помечает задачу `[X]` и создаёт ветку ДО `git commit`. Когда коммит падает
(E1a), правка `tasks.md` и ветка остаются. Повтор:

```
elt: elt commit: батч отвергнут (closed-task) — уже закрыты: T001
elt: не смог создать ветку: fatal: a branch named 'feature/t002-2026-09-03' already exists
```

Имя ветки содержит дату — одна попытка на задачу в сутки. Восстановление требует ручной
правки `tasks.md` обратно в `[ ]` и `git branch -D`; об этом не сообщает ни одно сообщение.

## E9. Мёртвые проверки, которые не могут сработать

- `unresolvedReview` (`tools/elt.js:1300`) фильтрует по `!r.resolved` — поле, которое
  никто никогда не пишет: строки очереди закрываются полем `closedAt`. Счётчик ревью в
  `elt run` не убывает. То же неверное поле — `tools/graph-state.js:165`, где оно способно
  навсегда заблокировать `elt cutover`.
- Гард публикации `--push` (`tools/elt.js:2203`) читает `c.commitHash`, а батч-сертификаты
  несут `commit` (`commitHash` есть только у релизных). Проверка привязки к коммиту не
  срабатывает никогда. Наивное переименование поля переключит её в «всегда блокировать»:
  сертификат хранит КОРОТКИЙ sha, а сверка берёт полный `git rev-parse HEAD`.
- `tools/elt-verify-bg.js:302`: проверка отсутствующего `oracle` и `ensureWorktree()`
  выполняются ДО `try/finally`, который обязан гарантировать терминальную запись. Отказ
  `worktree add` не оставляет ни строки run-log, ни строки очереди — неотличимо от «фон ещё идёт».

## E10. Пробелы функциональности, ожидаемой от «ядра для команд»

| пробел | доказательство |
| --- | --- |
| нет переиспользуемой CI-интеграции | нет `action.yml`, нет reusable workflow; `.github/workflows/test.yml` — сьют самого харнеса |
| нет машиночитаемых отчётов | ноль вхождений `sarif`, `junit`, `checkstyle` по всему репозиторию; `--json` есть у 9 команд из 26, у `commit`/`gate`/`judge run`/`spec *` его нет |
| коды выхода не документированы нигде | `0/1/3/4/5/10`; код 4 означает одновременно «задача не найдена», «спека не подписана», «пруф протух» и «судья мёртв» — CI не может их различить |
| `.harness/harness.json` не документирован | 14 ключей (`kind`, `verify`, `redProof`, `oracleSelect`, `background.layers`, `l0.*`, …) не упомянуты ни на одной странице `docs/` |
| нет монорепо | один `.harness/harness.json` в корне, один оракул, `treeHash` по всему дереву |
| не-Node проекты работают, но не описаны | `elt init --oracle "python3 -m pytest -q"` проходит; при этом эвристики L0 разбирают `package.json` и tsconfig-алиасы (`tools/elt-gate-l0.js:16,167,403`), а `elt init` жёстко пишет `kind: "code"` |

## E11. `shell: "powershell"` в поставочном конфиге — гейт молча красный вне Windows

В `.harness/harness.json` этого репозитория стоит `"shell": "powershell"`. `sh()`
(`tools/elt.js:43`) спавнит его без единой проверки, а при ENOENT `r.status === null`
превращается в код 1, и `r.error` не печатается никогда.

```
$ node tools/elt.js oracle
elt oracle: node tools/elt-oracle-runner.js
elt oracle: exit 1 (0s)
EXIT=1
```

Ноль секунд, ноль строк диагностики. Тот же оракул, запущенный напрямую
(`node tools/elt-oracle-runner.js`), отрабатывает 34 секунды и печатает результат.

Значит **первый же шаг документированной в CLAUDE.md цепочки гейта** (`elt oracle --full` →
`elt judge run` → `elt commit`) на Linux и macOS отказывает без объяснения. Поле `shell` не
входит в список валидируемых `validateHarnessConfig` (`tools/elt-config.js:20`), поэтому ни
`elt init`, ни `elt doctor` об этом не скажут.

Класс шире одного поля: диспетчер шелла скопирован пятью независимыми экземплярами —
`elt.js:45`, `elt-verify-bg.js:173`, `harness-selfcheck.js:26`, `project-bootstrap.js:406`,
плюс безусловный `spawnSync('powershell')` в `elt-retro-label.js:196`.

## E12. Конфигурация: 33 читаемых поля, 8 валидируемых — опечатка меняет поведение гейта

```js
validateHarnessConfig({ shel: 'bash', oracelSelect: 'impact', batch: 'three',
                        specApproval: 'no', redProof: 'OFF' })
→ {"ok": true, "errors": []}
```

Каждое из этих значений МЕНЯЕТ поведение, а не отклоняется:

| написано | что происходит |
| --- | --- |
| `specApproval: "no"` | строка truthy → гейт подписи **включён** |
| `redProof: "OFF"` | `!== 'off'` → контур red-proof **включён** (`elt.js:768`) |
| `batch: "three"` | `Number()` → NaN → тихий дефолт 3 (`elt.js:1441`) |
| `shel`, `oracelSelect` | поле проигнорировано, работает дефолт |

Схемы нет, `schemaVersion` нет, миграций нет. Один и тот же файл читается **14 независимыми
точками**, каждая со своим `try/catch`-дефолтом: `elt-config.js:67,87,97`, `judge-core.js:729,924`,
`elt-verify-bg.js:123,129,148`, `elt-oracle-runner.js:42,114`, `red-proof.js:58`,
`harness-watch.js:32`, `judge-invoke.js:27`, `host-surface.js:127`. Битый конфиг для одного
потребителя — ошибка, для другого — тихий дефолт.

## E13. Расширяемость закрыта: ни провайдера, ни линзы без форка

- Провайдеры — закрытый литерал `PROVIDERS` (`tools/providers.js:40`) и
  `JUDGE_PROVIDERS = new Set(['claude','codex','agy'])` (`tools/elt-config.js:8`).
  `validateHarnessConfig({judge:{provider:'gemini-cli'}})` →
  `judge.provider must be one of: claude, codex, agy`.
- Линзы ревью — `review-runtime.js:97`: `if (lenses.length !== LENS_NAMES.length) return dead`.
  Воспроизведено: положить ШЕСТУЮ линзу в `lensesDir` →
  `verdict: dead, reasons: ["ожидалось 5 линз, найдено 6"]` → судья мёртв → **каждый слайс
  заблокирован**. Добавление своей линзы ломает харнес целиком.
- `tools/capability-broker.js` (298 стр. + 339 стр. теста) объявлен в `docs/ARCHITECTURE.md:127`
  границей безопасности для внешних паков, но не требуется НИ ОДНИМ production-модулем.
  Заявленная песочница не существует в рантайме.

## E14. ≈6 000 строк (15 %) кода не подключены ни к одному маршруту

Файлы, чей единственный импортёр — собственный тест: `capability-broker.js`,
`tools/adapters/{spec-kit,mattpocock,openshell,rtk,skillspector}.js`, `component-update.js`,
`component-promote.js`, `token-impact.js`, `judge-bench-compare.js`, `graph-kpi.js`,
`measure-noise.js`, `kpi-commit-share.js`. Плюс `.claude/hooks/block-dangerous-git.js` и
`.claude/hooks/judge-closeout-gate.js` — в репозитории **нет `.claude/settings.json`**, эти
хуки не зарегистрированы ничем.

Стоимость не только в чтении: их тесты входят в те самые 112 файлов оракула и в каждый его
прогон.

## E15. Замер выборки и масштабирование оракула

| замер | сейчас | при 10× |
| --- | --- | --- |
| полный оракул, jobs=4 | 34–40 с wall (~138 с CPU) | ~23 мин wall на 4 ядрах |
| impact-выборка при правке `tools/elt.js` | **133 из 197 файлов (68 %)**, 107 мс | подстрочный скан ~2 000 файлов на каждом слайсе |
| та же выборка, список ×5 | 359 мс (3.4×) | растёт быстрее линейного: needles растут вместе с frontier |

`dependents()` (`tools/elt-oracle-select.js:83`) — подстрочный поиск по всему тексту всех
файлов, 2 раунда. В комментарии самого файла записано: «глубина 6 → 58/58 — вырождается в
„гнать все"». Экономия слоя стремится к нулю по мере роста связности проекта.

## E16. Прочее, подтверждённое запуском

- **Один настоящий цикл require:** `tools/elt-retro-label.js:150` ⇄ `tools/judge-bench-ingest.js:15`
  — работает только потому, что одна сторона ленивая.
- **EOL:** `.gitattributes` покрывает только `benchmarks/gemini-3.7-flash-high/*`. При
  `core.autocrlf=true` (дефолт Git for Windows) `tools/`, `agents/`, `bin/` приезжают с CRLF.
  Это уже стоило дефекта D23 (`review-lenses.js:29` нормализует `\r\n` вручную, потому что
  фронтматтер линз не матчился и ревью не стартовало ни разу у нового пользователя).
  При этом `doctor-core.js:488`, `component-store.js:23`, `agent-skill-supply-chain.js:102`,
  `elt-oracle-cache.js:48` хешируют СЫРЫЕ байты — один и тот же файл на Windows и Linux даёт
  разный digest.
- **Планировщик `elt-retro-label.js:180`** — `Register-ScheduledTask` + `process.env.USERNAME`;
  ветки cron/launchd нет вовсе, фича отсутствует на POSIX.
- **`agent-surface-audit.js:160`** — безусловный `cmd.exe /c where`; на Linux аудит всегда
  рапортует `missing-or-failed`, то есть врёт. Там же захардкожен путь памяти
  `~/.claude/projects/C--/memory/` — ключ проекта, выведенный из буквы диска `C:\`.
- **`tools/graph-compiler.js:218`** содержит литеральный байт `\u0000`; `file` определяет
  файл как `data`, `grep`/`rg` пропускают его по умолчанию — включая любой аудит поставки.
- **`red-proof.js:64`** определяет `package.json` для выбора `node --test`. В не-JS проекте
  без него слой доказательства красного теста молча выключается (`no-test-cmd`).

---

# Дыры гейта: «зелёный» без единого исполненного теста

## E17. Кэш оракула — gitignored, неподписан и невидим `treeHash`: подделка делает оракул no-op с зелёным пруфом

`.harness/oracle-cache.json` лежит в `.gitignore:86`. `treeHash()` строится из
`git status --porcelain -uall` + `git diff HEAD` + содержимого untracked-файлов — **игнорируемого
файла нет ни в одном из трёх источников**. Значит запись кэша не двигает ни `treeHash`, ни
дифф L0, ни дифф судьи. Ключ — обычный sha256 по файлам, которые писатель и так может прочесть.

Воспроизведено от начала до конца: сломать `tools/review-lenses.js` (его тест
`tools/review-runtime.test.js` → exit 1), посчитать ключи всех 112 тестов на ЭТОМ сломанном
дереве через экспортируемый самим раннером `partitionByCache`, записать в кэш:

```
elt-oracle-runner: кэш оракула — 65 попаданий, 0 к прогону
elt-oracle-runner: 65/65 passed in 0.0s          exit 0
```

Ноль исполненных тестов. Дальше `writeOracleProof` штампует `exit: 0`, привязанный ровно к
этому `treeHash`, и `elt commit --skip-oracle` (`elt.js:1933`) его принимает.

Того же класса: `.git/elt-oracle-proof.json` — неподписанный обычный JSON.

**Вывод:** кэш — оптимизация, а не доказательство, но сейчас он неотличим от доказательства.
Пруф обязан нести, сколько файлов исполнено и сколько взято из кэша, а `ran === 0` не может
быть основанием для `--skip-oracle`.

## E18. Гард таймаута судьи `unref()`-нут: зависший судья выходит с кодом 0 — без run-log, без строки очереди

`tools/elt-verify-bg.js:266` — `if (typeof timer.unref === 'function') timer.unref();` внутри
`withJudgeTimeout`. Гард существует ровно для «судьи, который не вернулся НИКОГДА» (комментарий
там же). `unref()` означает, что таймер не держит event loop: пока промис судьи pending и
больше нечего ждать, Node осушает цикл и выходит **до срабатывания таймаута**. `try/finally`
в `runBackgroundVerify` не выполняется — ни `finish()`, ни `appendRunLog`, ни `enqueueBgRed`,
плюс осиротевший `.fleet-wt/bg-<hash>`. Ветка `require.main` (`:534`) зовёт `process.exit(exit)`
только из `.then()`, поэтому процесс выходит **нулём**.

```
PROCESS EXIT code= 0 / run-log exists = false / queue exists = false
```

Коммит остаётся спекулятивным и НЕпомеченным. Единственная оставшаяся сеть — `bg-silent` от
`harness-watch` через 20 минут, и только если его кто-то запускает.

**Та же строка — корневая причина красноты на Linux.** `tools/elt-verify-bg.test.js:518`
(`T007: таймаут судьи`) — собственная регрессия этого гарда. Она виснет, node:test печатает
`Promise resolution is still pending but the event loop has already resolved` и отменяет 13
тестов после неё (35 pass / 14 cancelled, exit 1). Доказательство причинности: удаление ОДНОЙ
этой строки в копии репозитория → **49/49 pass, exit 0**.

## E19. Сьют оракула сам фабрикует ctx7-пруфы в гейтуемый проект

`tools/context7-cli.js:19` — `appendCtx7Proof(..., cwd = process.cwd())` зовётся на каждом
успешном резолве. `tools/context7-cli.test.js:59,67,75,84` гоняет его фейковыми раннерами,
возвращающими `status: 0`. Оракул запускает каждый файл с `cwd: ROOT`
(`elt-oracle-runner.js:75`).

```
$ cd /empty/dir && node /home/user/elt-harness/tools/context7-cli.test.js
$ cat .harness/ctx7-proof.jsonl      # 5 строк: vercel-ai, /microsoft/playwright-mcp, …
```

Чистый прогон `--full` в свежем клоне создаёт в дереве ровно ОДИН новый файл — этот.

Живой реестр репозитория: **35 строк, 100 % фабрикации** (7 прогонов оракула × 5 фейковых
строк, ноль настоящих резолвов). `elt-gate-l0.js:180 ctx7Covered()` матчит **подстрокой** по
`library`/`query`, поэтому с текущим реестром L0 не заблокирует новый импорт `ai`,
`playwright`, `cli`, `mcp`, `agents`, `vercel`:

```
ai → COVERED (L0 НЕ заблокирует)   playwright → COVERED   cli → COVERED
mcp → COVERED   agents → COVERED   react/lodash/zod/express → not covered
```

Каждый прогон оракула проштамповывает их заново, поэтому 30-дневное окно свежести не истекает
никогда. Файл гитигнорен, поэтому в дифф слайса он тоже не попадает.

## E20. Impact-выборка пропускает по-настоящему зависимые тесты

Построен эталонный граф `require()` неограниченной глубины по `tools/`, `bin/`, `benchmarks/`
и сверен с `selectTests(mode:'impact')`. **15 модулей** имеют хотя бы один зависимый тест,
который не выбирается. Контрпример:

- правка `tools/review-lenses.js` → `tools/judge-core.test.js` **не выбран**, хотя цепочка
  `judge-core.test.js → judge-core.js → review-runtime.js → review-lenses.js` — 3 шага
  (`MAX_ROUNDS = 2`, `elt-oracle-select.js:56`). Саботаж `review-lenses.js` делает
  `node tools/judge-core.test.js` красным.
- ещё: `tools/exec.js` теряет `elt-oracle-runner.test.js`; `tools/providers.js` — 8 тестов;
  `bin/ledger.js` — 3.

Честная оговорка: ни один модуль не слеп ПОЛНОСТЬЮ — для каждого из 15 хотя бы один зависимый
тест всё же выбирается (нестрогая эвристика `needlesFor` перевыбирает в других местах). Сам по
себе E20 зелёного гейта не даёт; он становится ложным зелёным в связке с E3/E17 — ровно случай
`bin/l0.js`.

## E21. Вторичное, найдено чтением кода (не воспроизводилось)

1. **Оракул-пруф привязывает дерево ПОСЛЕ прогона, а не до.** `elt.js:634` зовёт
   `writeOracleProof(exit, cfg)`, который считает `treeHash()` заново (`:527`). Правка,
   приехавшая во время прогона оракула, оказывается покрыта зелёным пруфом, под которым её
   не тестировали.
2. **`readBatchState`'s `catch { return { batches: {} } }`** (`elt.js:646`) молча опустошает
   `quarantinedBatches()` (`:708`): усечённый или удалённый `.git/elt/batch-state.json`
   отключает блок карантина красных батчей в `elt commit`, при том что строки `bg-red`
   продолжают лежать в очереди ревью.
3. **`ensureWorktree` переиспользует worktree по вхождению подстроки** —
   `elt-verify-bg.js:64` делает `listed.includes(p)` по `.fleet-wt/bg-<short-sha>`, а
   `elt.js:2176` передаёт КОРОТКИЙ sha. Если git расширит один короткий sha (`abc1234` vs
   `abc12345`), более короткий путь совпадёт префиксом с более длинной регистрацией, и слои
   фона проверят ЧУЖОЙ коммит.
4. **`treeHashNormalizingTaskMarks` нормализует только `specs/<dir>/tasks.md`** — `planPath`
   (`elt.js:333`), тогда как `findTasks()` (`:113`) принимает ещё корневой `tasks.md` и
   `specs/tasks.md`. В такой раскладке `[X]` от `markDone()` остаётся в диффе, доверенный
   путь (`:1881`) видит расхождение и умирает с `доверенный пруф не про это дерево` — задача
   уже помечена закрытой, а коммит отвергнут.
5. **Атомарности записи нет нигде.** `saveCache`, `writeOracleProof`, `writeJudgeProof`,
   `writeBatchState`, `certification.js:185,245` — голый `fs.writeFileSync` без write+rename.
   Усечение fail-closed для двух пруфов (`JSON.parse` → `null`) и fail-**open** для
   batch-state (пункт 2). Единственный настоящий лок в дереве — `graph-journal.js:106`
   (mkdir-based, со сметанием протухших через 30 с), и он выглядит корректным.
6. **Аудит пустых `catch`:** 53 пустых/только-с-комментарием `catch` в `tools/` и `bin/`.
   Кроме перечисленных выше — безопасные подавления (best-effort логи, удаление уже
   отсутствующих файлов, `windows lock` в `rmSync`, `JSON.parse` одной битой строки, которая
   ниже становится явным отказом). `circuitEnabled` (`judge-core.js:926`) fail-open на битом
   `harness.json` из гейта недостижим: `loadConfig()` (`elt.js:24`) умирает на невалидном
   конфиге раньше.

---

# E22. Назначение харнеса: серверные автоматические агенты

Уточнение владельца (2026-09-04): харнес предназначен не только для разработки софта, но и для
**создания агентов на автоматических серверах**. Это переставляет приоритеты, потому что
серверный агент не может ни прочитать подсказку, ни переспросить, ни посмотреть в лог руками.

| находка | стоимость у человека | стоимость у серверного агента |
| --- | --- | --- |
| E11 `exit 1 (0s)` без причины | 10 минут разбора | **петля перезапусков навсегда**: причина не в выводе |
| E18 зависший судья → exit 0 | замечен на глаз | **непроверенный коммит уезжает молча**, run-log пуст |
| E6 `verdict: dead` без причины и пути к логу | посмотреть лог руками | **нечего логировать**: единственная причина в непечатаемом файле |
| E17 подделываемый кэш | нужен злой умысел | **достаточно битого тома**: `ran = 0` неотличим от «всё зелено» |
| коды выхода 0/1/3/4/5/10, где 4 = четыре разных отказа | видно из текста | **невозможно ветвление**: «спека не подписана» и «судья мёртв» — один код |
| `--json` у 9 команд из 26 (нет у `commit`, `gate`, `judge run`, `spec *`) | читает глазами | **нечего парсить** на самых важных командах |
| Linux — единственная серверная платформа | обходится Windows-машиной | **обхода нет** |

Отдельно: провайдер судьи на сервере запускается от root, и живой отказ выглядит так —
`--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`
(поймано в E6). Строка есть в логе провайдера и не печатается никогда.
