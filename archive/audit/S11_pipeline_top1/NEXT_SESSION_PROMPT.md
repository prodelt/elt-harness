# Промпт для нової сесії (після S11-session7 / 2026-04-27)

Скопіюй все між === в нову сесію Claude Code в проекті Pipeline-setupper.

===

Focus: GAP-4 (skills.sh snapshot) + GAP-6 (RAG izi+law) + Tasks 40-41
Done when: skills.sh weekly snapshot є; izi+law RAG переіндексований; Tasks 40+41 закриті

## Що зроблено в S11-session7 (2026-04-27)

### GAP-2 ✅ — tool-policy-gate.js
- `~/.claude/hooks/tool-policy-gate.js` PreToolUse[mcp__claude-in-chrome] — блокує всі mcp chrome tools
- Commit: a0305a2

### GAP-1 ✅ — skill-selector-gate.js (ranker → pipeline)
- `~/.claude/hooks/skill-selector-gate.js` PreToolUse[Skill] — ranker вбудований
- Delta >0.15 → additionalContext з топ-3 альтернативами
- skill-distiller.js: YAML block scalar (`>`) fix
- 24 скіли дистильовані → ~/.claude/skill-registry/digests.jsonl
- SKIP_SKILLS для meta-skills (checkpoint/learn/prime/verify)
- Commit: a0305a2, fix: b6qav52h

### GAP-5 ✅ — Codex sync
- careful, contract-review, fix-issue, freeze, prime скопійовані в ~/.codex/skills/

### GAP-7 ✅ — CLAUDE.md оновлено (34→46 хуків)

### GAP-3 ✅ — pipeline Step 0.3 gh discovery (v1.3.0)
- Перед новим tool/lib integration → gh search repos <keywords> --limit 5
- Якщо >100★ → пропонує топ-3, чекає відповіді. Fix → silent.
- Synced: codex + gemini

## Тести
- 32/32 sanity + 37/37 behavioral + 42/42 codex = 111/111 PASS

## Залишилось (GAPs)
- GAP-4: skills.sh live search не працює (weekly snapshot як fallback)
- GAP-6: RAG izi+law відсутній (izi❌ law❌ — Gemini Flash 503)

## Наступна сесія — пріоритети
1. GAP-4: додати weekly snapshot для skills.sh (node script, cron) — 20min
2. GAP-6: переіндексувати izi+law RAG — 60min
3. Tasks 40+41 (gstack bridge + research autopilot) — 60min

## Що зроблено в S11-session6 (2026-04-27)

### Task 38 ✅ — skill-distiller.js (15/15 тестів)
- `audit/S11_pipeline_top1/skills/skill-distiller.js` — детерміністичний digest для кожного SKILL.md:
  use_when, avoid_when, requires_network, risk, verified, token_estimate, category
- budget governor: блокує >1 orchestrator + >1 domain + >1 verifier одночасно
- TTL cache 48h у `~/.claude/skill-registry/digests.jsonl`
- 24 реальних скіли успішно дистильовані (smoke-run)
- Коміт: 07e36be

### Task 39 ✅ — skill-ranker.js (19/19 тестів)
- `audit/S11_pipeline_top1/skills/skill-ranker.js` — ранжування за 6 критеріями:
  relevance(0.35) + sourceTrust(0.20) + verified(0.15) + tokenCost(0.15) + risk(0.10) + successRate(0.05)
- rankSkills() → top-N скорингом, high-risk expensive завжди внизу
- recordOutcome()/loadHistory() для feedback loop
- Коміт: 2b582fb

### Harvest ✅ — оновлено вручну (було 6 днів застарілим)
- Причина: harvest-injector тільки ЧИТАЄ latest.md (MAX_AGE_H=24h), НЕ запускає harvest
- Потрібна автоматизація — або cron, або хук

### Аудит системи (важливо!)
- Хуків в settings.json: **44** (CLAUDE.md застарів — написано "34")
- JS файлів хуків на диску: **50**
- Всі тести: 32/32 sanity + 37/37 behavioral + 42/42 codex = **111/111 PASS**

## ⚠ КРИТИЧНІ ПРОГАЛИНИ (знайдені в цій сесії)

### GAP-1: Distiller + Ranker НЕ підключені до pipeline
- Живуть тільки в `audit/S11_pipeline_top1/skills/` — НЕ в `~/.claude/skills/`
- Pipeline досі вибирає скіли "на відчуття", ranker не викликається
- **FIX**: скопіювати в `~/.claude/skills/` або підключити як хук PreToolUse[Skill]

### GAP-2: tool-policy-gate відсутній
- `browser-harness ONLY` — написано в CLAUDE.md, але НЕ блокується хуком
- `gh` CLI only для GitHub — тільки текст в GLOBAL_RUNTIME_POLICY.md
- mcp__claude-in-chrome__* можна викликати без блокування
- **FIX**: новий хук `tool-policy-gate.js` (PreToolUse[mcp__claude-in-chrome*])

### GAP-3: GitHub discovery не в pipeline
- gh search repos перед написанням коду — є в GLOBAL_RUNTIME_POLICY.md §6
- Але pipeline НЕ запитує "чи є open-source рішення?" автоматично
- **FIX**: додати до pipeline/SKILL.md Step 0 перевірку через gh

### GAP-4: skills.sh live search не працює
- skill-registry.js вимагає snapshot-file, живого fetch немає
- **FIX**: додати HTTP fetch до skills.sh API або зберегти weekly snapshot

### GAP-5: Codex drift — 5 скілів відсутні
- Відсутні в ~/.codex/skills/: careful, contract-review, fix-issue, freeze, prime
- **FIX**: запустити skill-promote.ps1 для кожного

### GAP-6: RAG для izi-tracker та law-assistant відсутній
- pipeline✅ sudoviy✅ | izi❌ law❌
- Gemini Flash 503 при навантаженні → rag-context-injector повертає None
- **FIX**: переіндексувати izi+law; додати fallback на cached overview

### GAP-7: CLAUDE.md застарів
- Написано "34 хуки" → реально 44 зареєстровано, 50 JS файлів
- Відсутні нові хуки в архітектурному блоці
- **FIX**: оновити architecture section + Current State

## S11 залишок (Tasks 40-41)

### Task 40 — gstack bridge як optional council mode
Місце: `audit/S11_pipeline_top1/gstack/gstack-bridge.md`
Map gstack commands/roles на /pipeline (office-hours, plan review, QA, CSO).

### Task 41 — Research Autopilot skill-pack
Місце: `audit/S11_pipeline_top1/research/research-autopilot.md`
Intent router: market research, competitor teardown, pricing, ICP, GTM, regulatory.

## Пріоритети наступної сесії (у порядку)

1. **GAP-2** — tool-policy-gate.js (новий хук, ~30min) — найвища цінність
2. **GAP-1** — підключити ranker до pipeline/SKILL.md (~45min)
3. **GAP-5** — Codex sync (5 скілів, ~15min)
4. **GAP-7** — оновити CLAUDE.md (~15min)
5. **Task 40** — gstack bridge (документ, ~60min)
6. **Task 41** — research autopilot (документ, ~60min)
7. **GAP-3** — gh discovery в pipeline (~45min)
8. **GAP-6** — RAG izi+law (довго, Gemini ліміт 5 RPM)

## RAG стан
```
pipeline: graph=True vdb=True (але Gemini Flash 503 при навантаженні)
izi-tracker: graph=False vdb=False ← потребує індексації
sudoviy-master: graph=True vdb=True
law-assistant: graph=False vdb=False ← потребує індексації
```

## Перевірки на початку сесії
```bash
node ~/.claude/hooks/test-all-hooks.js | grep "Result:"
node ~/.codex/test-codex-hooks.js | grep "Result:"
node ~/.claude/hooks/harvest.js 7  # якщо latest.md > 24h
```

## Rules
1. Windows: ніяких && → ; або окремі команди (PowerShell для git commit)
2. Не комітити в main (branch: feature/s11-task-43-init-project-upgrade-mode)
3. Conventional Commits: type(scope): subject
4. No console.log — тільки process.stdout.write / process.stderr.write
5. ctx7 перед будь-якою зовнішньою бібліотекою (хук блокує на 9 едитах)

===
