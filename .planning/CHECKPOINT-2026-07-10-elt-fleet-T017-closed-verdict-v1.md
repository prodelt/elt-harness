# Checkpoint — 2026-07-10 ~21:46 — T017 closed, ELT Fleet MVP Verdict v1

## Build Status
- **Оракул зелёный**: `node tools/doctor.test.js && node --test tools/fleet/*.test.js` → doctor PASS + **60 тестов** (все 60 тестов зелёные), EXIT=0.
- Ветка: `feature/elt-loop-driver`.

## Сделано (проверено)

### 1. Интеграция роутера и failover в `fleet.js`
- `fleet.js` импортирует `router.js` и считывает `fleet.json` политику.
- На старте прогона создаётся состояние роутера (`cooldowns`).
- Выбор провайдера осуществляется с помощью `router.pick` на основе цепочки провайдеров для размера слайса (`S/M/L`), сдвигая лимитированных провайдеров в cooldown.
- В случае детекта лимита (429/quota):
  - Провайдер уходит в cooldown.
  - Слайс возвращается в очередь без инкремента счётчика попыток провала (не тратит лимит `maxAttempts`).
  - Логгируется лимит-событие и failover-провайдер.
- Написан юнит-тест `провайдер возвращает 429 → failover на следующего в цепочке`, доказывающий логику end-to-end.

### 2. Запись метрик и счётчиков в Ledger (`run-log.jsonl`)
- Каждый запуск провайдера оставляет детальный след в `.harness/run-log.jsonl`:
  - `provider`
  - `durationSec`
  - `failoverFrom`
  - `limitHit`
  - `verdict`
- Счётчик вызовов `agy` и других провайдеров теперь легко извлекается агрегацией записей ledger по полю `provider`.

### 3. Исправление кросс-платформенной среды тестов
- Тесты `fleet.test.js`, `gate.test.js` и `merge.test.js` создавали временный `harness.json` с фиксированным `'shell': 'bash'`. На Windows-системах, где `bash` указывает на WSL2 (без Node.js в PATH), это приводило к ложным падениям оракула (exit 127, `node: command not found`).
- Исправлено на динамический выбор шелла: `process.platform === 'win32' ? 'powershell' : 'bash'`. Все тесты теперь нативно запускают оракул в Windows PowerShell, где Node.js присутствует на PATH.
- Для поддержки PowerShell 5.1 в `.harness/harness.json` исправлен разделитель `&&` на условный PowerShell-блок с проверкой `$LASTEXITCODE`.

## Вердикт v1
Архитектура ELT Fleet MVP полностью реализована и покрыта 60 тестами. Мульти-агентная параллельная петля с автоматическим роутингом, failover, сбором метрик и защитой от бесконечных retry готова к слиянию в `main`.

## Next Steps
1. Запустить `elt commit --task T017` для фиксации последнего слайса.
2. Влить ветку `feature/elt-loop-driver` in `main`.
