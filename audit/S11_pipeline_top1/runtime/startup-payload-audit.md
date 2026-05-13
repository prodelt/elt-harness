# Startup Payload And Config Drift Audit

## Мета

Закрыть Task 47 воспроизводимым audit по реальным Claude JSONL и отделить реальные startup/config проблемы от noisy sandbox harness failures.

Этот отчёт опирается на:
- helper: `audit/S11_pipeline_top1/runtime/startup-payload-audit.js`
- primary session `Pipeline-setupper`: `cf23b3b8-3f2d-4347-ac91-7f2584b3d182`
- primary session `Izi-tracker`: `9e15dffd-5840-40af-b52d-4faa77717220`
- cold-cache reference `Izi-tracker`: `5ffa7388-f2b0-418d-b4ee-ac2767a53261`
- drift sources: `C:\Users\user\.claude\settings.json`, `C:\Users\user\.claude.json`, `.claude/settings.local.json`
- runtime noise quarantine: `audit/S11_pipeline_top1/runtime/HOOK_FRICTION_2026-04-24.md`

## Repro

```bash
node audit/S11_pipeline_top1/runtime/startup-payload-audit.js --json
node audit/S11_pipeline_top1/runtime/startup-payload-audit.js
rg -n -i -m 20 "mammoth erp system" "C:\Users\user\.claude.json"
```

## Breakdown По Проектам

| Project | Session | `deferred_tools_delta` | `mcp_instructions_delta` | `skill_listing` | `cache_creation_input_tokens` | `cache_read_input_tokens` | Startup attachments total |
|---|---|---:|---:|---:|---:|---:|---:|
| Pipeline-setupper | `cf23b3b8-3f2d-4347-ac91-7f2584b3d182` | 120 / 10,463 B | 2 / 748 B | 87 / 19,517 B | 34,645 | 0 | 96,695 B |
| Izi-tracker | `9e15dffd-5840-40af-b52d-4faa77717220` | 93 / 6,873 B | 2 / 748 B | 84 / 18,530 B | 16,447 | 14,882 | 86,145 B |

Дополнительная cold-cache reference для `Izi-tracker`:
- session `5ffa7388-f2b0-418d-b4ee-ac2767a53261`
- `cache_creation_input_tokens: 30,834`
- `cache_read_input_tokens: 0`

## Top Offenders

### Pipeline-setupper

1. `hook_success` SessionStart persisted output: `56,206` bytes
2. `skill_listing`: `19,837` bytes
3. `deferred_tools_delta`: `10,463` bytes
4. attached `audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md`: `6,983` bytes
5. `hook_additional_context` with Vercel/plugin advisory: `1,088` bytes

### Izi-tracker

1. `hook_success` SessionStart persisted output: `56,211` bytes
2. `skill_listing`: `18,845` bytes
3. `deferred_tools_delta`: `6,873` bytes
4. `hook_additional_context` with Vercel/plugin advisory: `1,088` bytes
5. `mcp_instructions_delta`: `748` bytes

## Что Подтверждено

- Подтверждено: главный startup offender сейчас не только hooks сами по себе, а тяжёлый `SessionStart` persisted payload примерно на `56 KB` в обоих проектах.
- Подтверждено: `skill_listing` остаётся вторым крупным tax, даже после project-level trim, на уровне `18.5-19.5 KB`.
- Подтверждено: `deferred_tools_delta` даёт ещё `6.9-10.5 KB` и отражает слишком широкий global/deferred inventory.
- Подтверждено: в `C:\Users\user\.claude\settings.json` есть `25` global plugin keys, из них `11` truthy-enabled.
- Подтверждено: в `C:\Claude playground\Pipiline setupper\.claude/settings.local.json` накопилось `147` allow rules и `0` deny rules.
- Подтверждено: в `C:\Users\user\.claude.json` есть `1` duplicate project group для `D:/Mammoth ERP system` с тремя разными case-вариантами:
  - line `1352`: `D:/Mammoth ERP system`
  - line `1507`: `D:/Mammoth erp system`
  - line `1544`: `D:/mammoth erp system`

## Что Не Считается Product Finding

- `exit=null` массовые падения `test-all-hooks.js` и `test-codex-hooks.js` в текущем sandbox не засчитываются как config drift или regression proof.
- `15/37 PASS` в `test-hooks-behavior.js` в этой же среде рассматривается как contaminated harness run, пока нет отдельного preflight health check.
- Следовательно, Task 47 фиксирует runtime tax и config drift, но не смешивает их с broken harness noise из Task 46 friction log.

## Exact Cleanup Knobs

1. Урезать или вынести из SessionStart тяжёлый persisted output. Сейчас именно он забирает около `56 KB` до первого assistant event.
2. Перевести Vercel/plugin best-practice injections из global startup в on-demand trigger или post-prompt advisory.
3. Сжать `skill_listing` дальше: снижать `skillListingBudgetFraction`, ужимать descriptions и не показывать редко используемые global skills на каждом старте.
4. Разгрузить `deferred_tools_delta`: убрать из global-by-default browser/project/vendor tools, оставить minimal core и включать остальное per-project или on-demand.
5. Нормализовать `C:\Users\user\.claude.json` и схлопнуть duplicate project keys в один canonical path/case.
6. Пересобрать `C:\Claude playground\Pipiline setupper\.claude/settings.local.json` из минимального allow baseline, а не продолжать копить historical debug exemptions.
7. Для следующего шага держать отдельно remediation runtime friction:
   - transport-agnostic Context7 proof
   - hook-suite preflight before mass test execution
   - proactive output limiter before large reads

## Вердикт

Task 47 можно считать закрытой.

Есть reproducible audit по двум проектам с breakdown `deferred_tools_delta / mcp_instructions_delta / skill_listing / cache_creation_input_tokens`, top offenders показаны отдельно, config drift findings подтверждены, а noisy `exit=null` harness output специально вынесен за пределы product findings.
