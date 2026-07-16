# IZI Tracker Project — Token Burn Analysis

## Session Statistics
- **Total JSONL size:** 7.2 MB
- **Total sessions:** 22 JSONL files
- **Date range:** 2026-04-17 to 2026-04-17 (same day)
- **Approximate total tokens:** ~1.8M (7.2MB ÷ 4)
- **Total tool_results:** 0 found in sampled files

## Analysis Notes

### Data Quality Issue
The IZI project shows:
- 22 JSONL files created on **2026-04-17 only** (all sessions on same day)
- No tool_results detected in sampled largest file
- Directory structure indicates fresh/recent project (unlike sudovoi: 24 days, tgbot: 32 days)
- **Status:** Likely a new/bootstrapping project or incomplete data

## Top Tool Results
- No significant tool_results found in initial sampling
- Further investigation would require:
  1. Checking all 22 JSONL files for tool_result patterns
  2. Examining if project uses different transcript format
  3. Verifying if sessions are in different compression/encoding

## Hook/Skill Spam Statistics

| Feature | Status | Notes |
|---|---|---|
| additionalContext | 0 | No hook spam detected |
| memory/ directory | 1 | Present (1 found) |
| CLAUDE.md | Not created | No auto-init detected |
| AGENTS.md | Not created | No auto-init detected |

## Loop Patterns Detected
- No significant loop patterns found yet
- Project appears to be in early stages
- Requires deeper file-level analysis

## Project Docs State

- **`/init-project` called:** No
- **CLAUDE.md auto-created:** No
- **AGENTS.md auto-created:** No
- **memory/ directory:** Yes (1)
- **Manual edits:** Likely (needs verification)

## Anomalies & Issues

### A1: Single-Day Session Cluster
All 22 sessions created on 2026-04-17 suggests:
- Bulk import/creation event
- Or recovery/migration scenario
- Unusual pattern compared to gradual accumulation in sudovoi/tgbot

### A2: Missing Tool Results Data
Despite 7.2MB total data, no tool_results in samples:
- May indicate different logging format
- Or predominantly user input (minimal tool use)
- Requires deeper investigation

### A3: Zero Detected /init-project Calls
Consistent with sudovoi & tgbot pattern:
- **Impact:** Missing auto-generated docs in all 3 projects
- **Implication:** Pipeline issue with /init-project not being called at project start
- **Recommended fix:** Enforce /init-project on first session of new project

## Key Observations (vs. Other Projects)

| Metric | Sudovoi | TGBot | IZI |
|---|---|---|---|
| Size | 44MB | 5.2MB | 7.2MB |
| Sessions | 41 | 9 | 22 |
| Tool Results | 468 | 123 | 0* |
| Date Range | 24 days | 32 days | 1 day |
| Avg Tools/Session | 11.4 | 13.7 | 0* |
| /init-project | No | No | No |
| CLAUDE.md | No | No | No |

*Sampled data — requires full analysis

## Summary

**IZI project status: REQUIRES FULL ANALYSIS**

- **Current finding:** Insufficient tool_result data in initial sampling
- **Root cause pattern:** Same as sudovoi/tgbot → no /init-project initialization
- **Data anomaly:** Single-day session cluster unusual (suggests migration or bulk import)
- **Recommended action:** Run full JSONL scan on all 22 files to extract tool_result patterns

**Estimated burn (pending deeper analysis):** ~1.8M tokens

