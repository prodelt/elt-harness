# Spec 021 — Gemini-only benchmark і готовність ELT v5 до GitHub-релізу

## Проблема

ELT v5 формально закрив план 020, але релізне твердження не витримує незалежної перевірки:

- останній GitHub Actions run червоний на `ubuntu-latest`; у робочому дереві вже лежать
  незакомічені кандидати виправлень D27, але вони не пройшли ELT-гейт і CI;
- розширений A/B-прогін зупинений на 106/120, а його preregistration змішує
  `gemini-3.7-flash-high` із Claude Sonnet. Через вичерпаний ліміт Claude 15 результатів є
  транспортними відмовами, тому цей прогін не можна дописати іншою моделлю і публікувати як
  порівняння ELT;
- окремий judge-benchmark має 152/240 транспортних відмов Claude і також не придатний для
  публічного claim;
- GitHub-репозиторій `prodelt/elt-harness` приватний, не має release, topics або homepage,
  default branch вказує на `feature/judge-bench-parallel-oracle`, а сторінка не доступна
  неавторизованому читачеві;
- README та install guide існують, але не доведені свіжим clean-install smoke і зеленою
  двоплатформною CI після останніх виправлень.

## Решения

Підготувати один відтворюваний release candidate без жодного модельного виклику Claude:

1. Закрити D27 як окремий ELT-слайс і довести однакову поведінку на Windows та Linux.
2. Зберегти попередні незавершені прогони як чесно позначені архівні артефакти, але не
   використовувати їх у headline-метриках.
3. До першого нового результату зафіксувати Gemini-only preregistration. В обох руках кожен
   модельний виклик виконує `agy --model gemini-3.7-flash-high`; різниця між руками — тільки
   ELT-контур.
4. Прогнати два взаємодоповнювальні вимірювання:
   - writer A/B на всіх 30 Rust-задачах зафіксованого commit
     `Aider-AI/polyglot-benchmark`: один виклик без ELT проти того самого writer з механічним
     oracle, бойовим `judgeDiff` і максимум двома repair-раундами;
   - gate A/B на збалансованій детермінованій вибірці публічно розмічених SWE-bench patches:
     bare Gemini verdict проти бойового `judgeDiff` з тією самою моделлю.
5. Опублікувати raw results, checksums, transport-failure ledger, агрегати та межі claim;
   transport можна повторити, змістовний провал — ні.
6. Перебудувати GitHub front page навколо короткого value proposition, 5-хвилинного quick
   start, реального workflow, доказів, обмежень і troubleshooting; перевірити clean install та
   реальну роботу `agy`.
7. Пропустити все через повний oracle, smoke, одного Codex-judge, ELT commit і свіжу
   Windows/Linux CI. Зміну visibility на public та створення tag/GitHub Release виконувати
   лише після окремого фінального підтвердження користувача.

## User stories

1. Як розробник, я можу клонувати репозиторій, встановити ELT за README і отримати зелений
   doctor/smoke без прихованої локальної конфігурації автора.
2. Як технічний читач GitHub, я за перший екран розумію, що робить ELT, для кого він і як
   запустити перший захищений слайс.
3. Як скептичний рецензент, я можу відтворити benchmark із зафіксованого dataset commit і
   перевірити кожен агрегат із raw JSONL.
4. Як власник продукту, я бачу чесну відповідь, чи покращує ELT результат Gemini, а не
   маркетинговий claim із неповної або змішаної вибірки.
5. Як maintainer, я не можу назвати release ready commit, доки named oracle, smoke і обидві
   GitHub CI-матриці не зелені.

## Критерии приёмки

- Жоден benchmark runner або release gate не викликає Claude чи Codex як модель; `agy models`
  підтверджує точне ім'я `gemini-3.7-flash-high`.
- Новий preregistration має hash runner'а, dataset commit, детерміноване правило вибірки,
  точні руки, таймаути, retry/exclusion policy та межі claim і створений до першого result row.
- Writer benchmark має по 30 валідних paired outcomes у кожній руці; gate benchmark має
  однакову збалансовану вибірку для bare та ELT рук. Неповна рука не входить у headline.
- Hidden grader/reference solutions не потрапляють у prompt або workspace моделі; integrity
  hashes збігаються до/після кожного завдання.
- Summary відтворюється командою з raw JSONL і показує pass rate, paired delta, fail-open,
  false-block, latency, model-call count, transport failures та 95% confidence intervals.
- Старі incomplete/Claude-contaminated результати явно позначені як `invalid-for-claim` і не
  змішані з новими.
- D27 має regression-тести; targeted tests, повний `node tools/elt-oracle-runner.js --full`,
  `node tools/smoke-elt-deploy.js` і `node bin/doctor.js` завершуються exit 0.
- Clean-install smoke виконується у новому тимчасовому проєкті за командами README та
  підтверджує Claude plugin packaging, Codex/Gemini surface parity і реальний headless
  `agy`-виклик на Gemini 3.7 Flash High без Claude API.
- GitHub metadata має release-ready description, `main` як default branch і релевантні topics;
  README не містить непідтверджених KPI та веде до install/benchmark reproduction guide.
- Свіжий push release-candidate commit дає зелений GitHub Actions на `windows-latest` і
  `ubuntu-latest`; blocking review queue порожня.
- Кожен кодовий слайс має рівно одного Codex-judge і commit через `elt`; ручний `git commit`
  для закриття задач не використовується.

## Риски

- `agy` може мати rate limit або стохастичні транспортні відмови. Вони зберігаються окремо і
  повторюються лише за preregistered transport policy.
- 30 Rust-задач дають directional, а не універсальний claim; результат не переноситься на всі
  мови й реальні monorepo без додаткової вибірки.
- SWE-bench public submissions мають неоднорідні історичні схеми. Рядки без однозначної
  resolved/apply семантики виключаються детермінованим правилом до запуску, а не після verdict.
- Повний прогін може бути довгим. Runner має resume-by-key і append-only raw log, щоб ліміт
  сесії не втрачав уже завершені пари.
- Private visibility не дозволяє фінальну перевірку анонімної GitHub-сторінки. Public toggle і
  release publication залишаються окремим незворотним рішенням користувача.

## Вне scope

- Заміна Gemini на іншу модель після першого result row.
- Твердження про якість Claude або Codex на підставі цього прогону.
- Автоматичне переведення приватного репозиторію в public, створення tag або GitHub Release без
  фінального підтвердження користувача.
- Переписування 20k LOC release-core або досягнення відкладеної мети latency p95 <5 с.
- Terminal-Bench: він вимірює повну агентську оболонку і не ізолює внесок ELT-гейта.
