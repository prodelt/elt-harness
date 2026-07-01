# CHECKPOINT — 2026-07-01: доказательство харнесса + CLAUDE.md/Memory split

## Что сделано в этой сессии
1. **Факт-аудит харнесса** (не по памяти): `just test` на AWE3 (`C:\Ametrin projects\Ametrin web ecosystem 3`) прогнан живьём — 45/56 tasks.md закрыто (US1+US2 полностью), тест-оракул зелёный после убийства зависшего демо-процесса (gateway.exe держал файловый лок на Windows).
2. **`SYSTEM-SCHEMA.html`** (корень репо) — визуальная схема elt-code→elt-loop→судья, проверена скриншотом через agent-browser.
3. **Разделение CLAUDE.md / память** («эталон Бориса Черни» — подтверждено веб-поиском: CLAUDE.md короткий/actionable/ruthlessly-edited, не журнал):
   - Найдено: `AGENTS.md`/`.gemini/GEMINI.md` несли буквальный журнал с датами в «Current State» (устаревшее упоминание claude-mem).
   - `tools/project-docs-core.js`: `CORE_SECTIONS` → `[Commands, Stack, Gotchas, Memory]` (было `[Overview, Stack, Commands, Architecture, Gotchas, Current State]`). `Memory` — контрактно ТОЛЬКО указатель на `.planning/STATE.md`+`PROJECT-HISTORY.md`.
   - Новая проверка `memory-leak` в `verifyProjectDocs()`/`auditProjectDocs()` — датированные буллеты в Memory-секции → WARN.
   - `tools/doctor-core.js` — `SECTIONS` теперь импортируется из `project-docs-core.js` (не дублируется), repair-строка обновлена.
   - `tools/docs-gate.js` — 2 repair-строки обновлены (Current State→Memory).
   - Тесты обновлены: `project-docs.test.js` (+ testAuditFlagsMemoryLeak), `doctor.test.js` (fixture `coreDoc()`). Все зелёные.
   - `~/.claude/skills/doc-hygiene/SKILL.md`→v1.1.0, `~/.claude/skills/project-bootstrap/SKILL.md`→v1.4.0 (вне этого репо, не в git).
   - Этот репо: `CLAUDE.md`/`AGENTS.md`/`.gemini/GEMINI.md` синхронизированы (45 строк, идентичны).

## Доказательства
- `node tools/project-docs.test.js` → PASS
- `node tools/doctor.test.js` → PASS
- `node tools/docs-gate.test.js` → 42 passed, 0 failed
- `node tools/project-docs.js audit --root .` → **PASS, no issues** (было WARN missing-section: Overview/Architecture/Current State)
- `node tools/project-docs.js verify --root .` → PASS, core sections identical
- `node tools/doctor.js` → WARN «CLAUDE.md incomplete» исчез

## Важно — это НЕ автоматически применилось к другим проектам
Правка тулинги (`project-docs-core.js` + 2 SKILL.md) — это новый контракт для ВСЕХ проектов,
но применяется только явным прогоном на каждом проекте:
```bash
node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" audit --root <project>
# или ритуал целиком:
/project-bootstrap   # (на целевом проекте)
# или кросс-проектный аудит (какие проекты вообще нуждаются):
node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" audit-all \
  --dirs "C:/Ametrin projects" "D:/Ametrin projects" "D:/Mammoth ERP system" \
         "C:/Claude playground/Fasoli 2.0/fasoli-2.0" --exclude Garvis
```
Ничего не бежит в фоне. Другие проекты, где раньше стоял старый 6-секционный шаблон
(Overview/Architecture/Current State), скорее всего сейчас дадут `drift`/`missing-section` —
это ожидаемо и чинится одним прогоном `/doc-hygiene` или `/project-bootstrap` на каждом.

## Resume Pointer (следующая сессия)
- Если юзер хочет реально «привести в порядок» остальные проекты — запустить
  `audit-all` (выше) в НОВОМ чате (не в этом, контекст переполнен), показать ranked-таблицу,
  чинить по одному через `/doc-hygiene` workflow (drift→sync, missing-doc→init, и т.д.),
  показывая verify PASS до/после каждого.
- Харнесс AWE3: US3 (Phase 5, T046-T052) не начата — 11 задач. DB test-pollution (нет
  `TEST_DATABASE_URL`) и отсутствие CSS на демо-странице — открытые пункты, юзер знает.
- P5 (elt-onboard живой грилл) и P7 (loop-audit score) — нужен юзер вручную.
