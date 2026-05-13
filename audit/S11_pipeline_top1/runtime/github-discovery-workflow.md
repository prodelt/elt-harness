# GitHub-First Tool Discovery Workflow

## Мета

Закрити Task 48 через відтворюваний workflow, у якому агент спочатку шукає готові рішення через GitHub та skills.sh, а не invent/read-everything вручну. Результатом кожного discovery-run має бути структурований verdict без автоматичного встановлення у global roots.

## Чому це потрібно

- зменшити startup tax і token burn на ручний пошук;
- відсіяти abandoned або risky репозиторії до clone/install;
- не допускати auto-promote у `~/.claude`, `~/.codex`, `~/.gemini`;
- прив'язати discovery до вже наявних перевірок `skill-registry.js` і `skill-quarantine-scan.js`.

## Варіанти

### Варіант A - Manual research each time

Агент щоразу сам відкриває GitHub, README, issues та вирішує ad hoc.

Вердикт: reject. Дає найбільший token cost, не масштабується і не залишає стабільного audit trail.

### Варіант B - Auto-install from first promising repo

Після `gh search repos` одразу йде clone/install у глобальний scope.

Вердикт: reject. Це суперечить Layered Knowledge OS, підвищує ризик drift і обходить quarantine.

### Варіант C - GitHub-first gated discovery

`gh search repos` -> `gh repo view` -> evidence review -> optional skills overlap check -> quarantine clone -> read-only spike -> structured verdict.

Вердикт: accept. Дає дешевий first-pass, зберігає audit evidence і не дозволяє тихий global install.

## Phase 2.5 Evidence

Task 46 already recorded the relevant implementation anchors for Wave 9:

| Candidate | Source | Keep / Change | Decision |
|---|---|---|---|
| OpenCLI | `opencli.org` spec | Keep as descriptor format, not runtime dependency | Підходить як machine-readable contract для CLI capability registry. |
| LightRAG | Context7 `/hkuds/lightrag` | Keep as project-scoped pilot | Підходить для project RAG, але не для global-by-default install. |
| Playwright / browser pilot family | Context7 `/microsoft/playwright`, GitHub browser-harness readme | Keep as on-demand only | Browser tooling не має жити у global startup path. |
| Hermes Agent | GitHub README | Research only | Патерни можуть бути корисні, але Windows runtime/promotion поки не проходять gate. |

## Discovery Protocol

1. `gh search repos "<query>" --limit N`
2. Вибрати shortlist з 1-3 кандидатів.
3. `gh repo view owner/repo --json ...`
4. Перевірити:
   - README / install path
   - releases
   - issues / maintenance signal
   - license
   - Windows або WSL support
   - overlap з уже наявними tools
   - rough token/read cost
5. Якщо це skill/marketplace-related candidate:
   - прогнати `skill-registry.js` для overlap/adoption snapshot;
   - перед будь-яким promotion прогнати `skill-quarantine-scan.js`.
6. Якщо кандидат виглядає promising:
   - clone only into quarantine/workspace;
   - тільки read-only spike;
   - ніяких writes у global roots.
7. Сформувати structured verdict:
   - `adopt-spec`
   - `quarantine-readonly-spike`
   - `research-only`
   - `reject`

## Gating Criteria

| Gate | Pass | Warn | Deny |
|---|---|---|---|
| Adoption | strong stars/forks, або trusted registry overlap | low adoption but plausible niche fit | no visible usage and no strategic reason |
| Maintenance | active push/release, not archived | stale but still viable for read-only research | archived or abandoned |
| License | MIT/Apache/BSD/ISC/MPL-2.0 | LGPL/custom but readable | missing/unknown/restricted |
| Security | no dangerous install path, rollback exists, no secret requirement | partial evidence | quarantine scan deny or install requires unsafe writes |
| Windows/WSL | documented Windows or WSL path | unknown support | explicitly unsupported on target environment |
| Token cost | cheap GitHub metadata route | medium due README/issues depth | expensive full-code read without prior signal |
| Overlap | fills a real gap | partially overlaps existing tools | duplicate of existing capability without advantage |

## Structured Verdict Contract

Every run must return:

```json
{
  "success": true,
  "candidate": "OpenCLI",
  "repo": "opencli/opencli",
  "verdict": "adopt-spec",
  "scope": "project",
  "autoPromote": false,
  "criteria": [],
  "nextActions": [],
  "proof": []
}
```

Required invariants:

- `autoPromote` is always `false` unless there is an explicit manifest + rollback plan;
- global roots are never touched during discovery;
- dry-run must be possible from fixtures alone;
- verdict must cite evidence for adoption, maintenance, license, security, Windows support, token cost, and overlap.

## Integration Points

### `skill-registry.js`

Use to:

- detect marketplace overlap before inventing a new tool path;
- reuse adoption signals from `skills-cli` or `skills.sh` snapshots;
- reduce duplicate installs when an existing high-trust skill already covers the capability.

### `skill-quarantine-scan.js`

Use to:

- block direct promotion from quarantine;
- deny dangerous install scripts, global-root writes, embedded secrets, and missing success criteria;
- require manifest + rollback before any future promotion.

## Dry-Run Targets

Task 48 is considered closed only if structured dry-run verdicts exist for:

- `OpenCLI`
- `browser-harness`
- `hermes-agent`
- `LightRAG`

Expected direction:

- `OpenCLI` -> `adopt-spec`
- `browser-harness` -> `quarantine-readonly-spike`
- `hermes-agent` -> `research-only`
- `LightRAG` -> `quarantine-readonly-spike`

## Rollback Rule

Discovery itself creates no global state. If a later task promotes a candidate, promotion must require:

1. explicit manifest,
2. rollback command/path,
3. quarantine scan pass,
4. scope decision (`project` before `global` by default),
5. user approval.
