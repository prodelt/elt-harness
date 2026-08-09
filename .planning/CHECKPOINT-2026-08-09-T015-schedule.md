# CHECKPOINT 2026-08-09 — 014/T015: ретро-разметка ходит по расписанию

## ЧТО СДЕЛАНО

`tools/elt-retro-label.js` получил два режима:

- `--daily [--project <path>]` — разметить вердикты → `judge-bench-ingest` → отчёт
  `.harness/judge-bench/retro-report.json` (каталог уже в `.gitignore:75`);
- `--install-schedule [--at HH:MM]` — регистрация задачи Windows Task Scheduler, идемпотентно
  (`/F` перезаписывает существующую, повторный запуск не плодит дублей и чинит устаревший путь).

`propose` в расписание **не** входит — так требует текст T015: автомат готовит данные, правку
гейта предлагает человек или слайс.

## ПРУФ

```
> node tools/elt-retro-label.js --install-schedule
elt retro-label: задача ELT-retro-label зарегистрирована
  "C:\Program Files\nodejs\node.exe" "…\tools\elt-retro-label.js" --daily --project "…"
  SUCCESS: The scheduled task "ELT-retro-label" has successfully been created.

> schtasks /Run /TN ELT-retro-label   (отчёт предварительно удалён с диска)
> schtasks /Query /TN ELT-retro-label /FO LIST /V
Last Result:    0
Schedule Type:  Daily
Start Time:     3:00:00

> cat .harness/judge-bench/retro-report.json
{
  "ts": "2026-08-09T09:36:11.635Z",
  "total": 196,
  "labels": { "false-block": 19, "missed-defect": 16, "correct": 157, "unknown": 4 },
  "unknownShare": 0.0204,
  "benchAdded": 0,
  "benchTotal": 35
}
```

Тесты: `node --test tools/elt-retro-label.test.js` — 8/8 pass (добавлен тест на `daily()`).

## Замер контура (обязательная строка с T007)

Возврат управления `elt commit`: оракул 282 c (impact 57/78, кэш промахнулся — правился
`elt.js`, high-fanin), сам коммит мгновенный. Фоновый вердикт по предыдущему слайсу (T014,
`2dfb927`) **пришёл**: `background-verify-pass`, 294 c, судья 1.0 c (`l0-clean`).

## ДЕФЕКТ, НАЙДЕННЫЙ ПО ХОДУ (починен здесь же)

`judge-bench-ingest` требует `elt-retro-label` обратно — цикл require. `module.exports`
стоял ПОСЛЕ main-ветки, поэтому `--daily` падал `TypeError: label is not a function`, а юниты
самого `label()` этого не видели. Экспорт поднят над main-веткой; тест на `daily()` теперь
ловит регресс.

## ЧИСЛО, КОТОРОЕ ТРЕБУЕТ ВНИМАНИЯ (не решаю сам)

`unknown` = 2% (4 из 196). Комментарий самого T012 гласит: «разметка, уверенная во всём, врёт».
2% — это заявка на почти полную уверенность по 196 историческим вердиктам. Либо эвристика
действительно так хороша, либо `RETRY_LIMIT = 0` слишком легко объявляет `false-block`
(19 штук). Калибровка порогов — отдельное решение пользователя, в scope T015 её нет.
