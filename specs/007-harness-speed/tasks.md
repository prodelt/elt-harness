# 007 — harness speed & proof (микро-план)

Живой fleet-прогон: 3 независимых слайса, воркеры agy (gemini-3.6-flash), судья agy.
Микро-план (без spec.md) — approval-гейт не применяется, рубрика судьи = строка задачи.

- [ ] **T001** [P] [M] [cli:agy] judge-bench: расширить золотой набор 4 дефектами — (1) тест удалён целиком вместо починки; (2) захардкоженный секрет/токен в коде; (3) off-by-one в денежном расчёте; (4) изменена сигнатура экспортируемой функции без обновления вызывающих — и 1 чистым слайсом (правка только комментариев/документации). Формат кейса тот же (id/expect/why/taskText/status/diff), id уникальны, у каждого дефекта expect:'block', у чистого 'pass'. [files: tools/judge-bench/cases.js]
- [ ] **T002** [P] [M] [cli:agy] E2E-тест полного гейта (сейчас все тесты гейта — на стабах): в scratch git-репо прогнать НАСТОЯЩИЙ цикл `elt oracle → judge-proof write → elt commit --task` со стаб-судьёй, и проверить фактические следы: создан коммит, слайс отмечен [X] в tasks.md, запись появилась в .git/elt/run-log.jsonl. Красный путь тоже: красный оракул → коммита НЕТ. [files: tools/elt-gate-e2e.test.js]
- [ ] **T003** [P] [S] [cli:agy] `tools/judge-bench-compare.js`: читает все отчёты `.harness/judge-bench/*.json` и печатает сводную таблицу (провайдер/модель, recall, false-positive, accuracy, медиана времени, цена, дата), новее — ниже; флаг `--json` для машиночитаемого вывода. Тест на форматирование и на пустую папку. [files: tools/judge-bench-compare.js, tools/judge-bench-compare.test.js]
