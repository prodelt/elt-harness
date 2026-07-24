# CHECKPOINT 2026-07-25 — спека 009 ELT v3: фаза A закрыта, resume T004

## Состояние
- Ветка `feature/judge-bench-parallel-oracle`, дерево чистое, последний коммит `20b9a4f`.
- Спека `specs/009-elt-v3-thinking-harness` **утверждена** (approval.json hash-связан, перевыпущен после `[X]`).
- ⚠ `elt slice next` без `--spec` берёт **005** (алфавитный скан, там 3 открытых). Для 009 всегда:
  `elt slice next --spec specs/009-elt-v3-thinking-harness`.

## Закрыто в этой сессии (фаза A)
| Слайс | Коммит | Суть |
|---|---|---|
| T001 | `5037378` | Пофайловый бюджет диффа судье (приоритет тестам/зоне), пометка обрезки, «НЕ ПОКАЗАНЫ»; grounding спрашивает только за показанное |
| T002 | `0ac3a36` | `elt judge run --task Txxx[,Tyyy]` — судья как шаг кода; `judge.attest:true` рубит ручной `judge-proof write` (exit 4); `--skip-attest` = громкий след |
| T003+T019 | `6debde7` | Контур в `elt init` + `project-bootstrap apply` + 3 живых конфига; внешний репо режется по зоне `[files:]` |
| — | `20b9a4f` | Перевыпуск approval после `[X]` |

Оракул на каждом гейте 53/53. Контур 008+009 **впервые отработал живьём**: agy pass → codex verify pass → red-proof `red` (fails-on-base).

## Что включено в живых проектах
`Pipiline setupper`, `C:/Claude playground/project_social_analysis`, `C:/Ametrin projects/Route_API_1C`:
`judge.attest:true` + `judge.verify {codex, gpt-5.6-sol}` + `redProof:"on"` → `circuitEnabled()=true` у всех.

## Гочты, найденные в бою
- **`tools/elt.js` ≡ `~/.claude/bin/elt.js`** — две копии, синхронизировать вручную (`cp`) после каждой правки CLI. Тесты гоняют репо-копию, работает живая.
- **Ничего не писать в рабочее дерево во время гейта** — любой файл меняет treeHash и мгновенно делает оракул-пруф stale (дескриптор судьи ушёл в `.git/elt/`, стабы тестов — в `os.tmpdir()`).
- **Батч ломается о коллизию ID между спеками**: `findTaskItem` берёт первую спеку с этим ID, `judge run`/`judge-proof` не принимают `--spec`. T014 из 009 пришлось переименовать в T019, т.к. в `specs/006` открыт свой T014. Кандидат в отдельный слайс.
- Судья agy иногда отдаёт вердикт без reasons → безусловный `grounding:no-reasons` → просто перезапустить `judge run`.

## ДАЛЬШЕ — T004 (фаза B, park & continue)
Слайс не прошёл гейт (red-stop / judge-block / judge-dead / пустой дифф) → запись в
`.harness/parked.json` (`{tid, reason, ts, logPath, attempts}`), откат дерева (`git stash` с
пометкой слайса), петля берёт **следующий** слайс вместо `break`. Жёсткие стопы остаются:
STOP-файл, бюджет, `slice next` exit 3, approval/codegraph-guard. Итог прогона печатает
закрытые и припаркованные раздельно, ненулевой exit при непустой парковке. `elt status`
показывает секцию `parked`.
Файлы: `tools/elt-loop.ps1`, `~/.claude/bin/elt.js` (+ копия `tools/elt.js`), `tools/elt-parked.test.js`.
Точки правки в драйвере: `break` на строках ~162 (codegraph-guard), ~213 (red-stop), ~226
(пустой дифф), ~247 (judge-dead), ~252 (judge-block).

Порядок дальше: T004 → T005 (heal видит вывод оракула) → T006 (промпт impl v2) → фаза C.
