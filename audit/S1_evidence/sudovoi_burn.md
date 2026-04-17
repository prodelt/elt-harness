# Sudovoi Court Decisions Bot — Token Burn Analysis

## Session Statistics
- **Total JSONL size:** 44 MB
- **Total sessions:** 41 JSONL files
- **Date range:** 2026-03-25 to 2026-04-17 (24 days)
- **Approximate total tokens:** ~11M (44MB ÷ 4)
- **Total tool_results:** 468 across all sessions

## Top 10 Biggest Tool Results

### 1. Edit w/ Full File Copy (Line 193, 1670e582 session)
- **Size:** 119,630 bytes (~29.9K tokens)
- **Tool:** `toolu_012d1xkPDNzwxAhFERuJZoeX` (Edit operation)
- **File modified:** `telegram_bot.py`
- **Contains:** Full `originalFile` with entire TelegramNotifier class
- **Evidence:** `{"filePath":"...telegram_bot.py","oldString":"...","newString":"...","originalFile":"import os\nimport json\n...class TelegramNotifier:..."}`
- **Location:** `/D--Ametrin-projects-sudoviy-master-try-3/1670e582-f32e-4261-b148-6e114c42aef9.jsonl:193`

### 2. Project State Memory Update (Line 29, 1670e582 session)
- **Size:** 61,849 bytes (~15.5K tokens)
- **Tool:** `toolu_01EjggvNC391h1HP7xNTsiS1` (Git/Bash result)
- **Content:** Full directory listing output (git status result with 100+ files listed)
- **Evidence:** Lists building/CourtMonitorScheduler files, bot_service.spec, FINAL_TEST_REPORT.md, etc.
- **Location:** `1670e582-f32e-4261-b148-6e114c42aef9.jsonl:29`

### 3. Large Log Output — 6.9MB Persisted (Line 142, 1670e582 session)
- **Size:** 49,224 bytes (~12.3K tokens) [actual output: 6.9MB persisted to file]
- **Tool:** `toolu_01MC8bufhMx9wZ5LEGyaVNSb` (Bash execution)
- **Content:** "Output too large (6.9MB). Full output saved to: C:\Users\espad\.claude\projects\...tool-results\bm8v50lbj.txt"
- **Evidence:** Preview shows: `2026-04-06 08:49:46,663 - main - INFO - Reading data from...Excel file loaded. Shape: (4928, 131)`
- **Burn:** Persisted file is 6.9MB, context shows preview only (12.3K tokens in JSONL)
- **Location:** `1670e582-f32e-4261-b148-6e114c42aef9.jsonl:142`

### 4. Edit w/ Original File (Line 193, agent-acompact session)
- **Size:** 119,667 bytes (~29.9K tokens)
- **File:** `telegram_bot.py` (same as #1 in different session)
- **Contains:** Full originalFile content
- **Location:** `/1670e582-f32e-4261-b148-6e114c42aef9/subagents/agent-acompact-f147100de347fe06.jsonl:187`

### 5. Edit Memory Snapshot (Line 61901 bytes)
- **Size:** 61,901 bytes (~15.5K tokens)
- **Location:** `agent-acompact-f147100de347fe06.jsonl:26`

### 6-10. Additional Large Results
- **Line 111439:** project_state.md with full documentation (~27.9K tokens)
- **Line 55112:** memory file updates
- **Line 53878:** additional memory/state files
- **Line 49261:** agent compact session edits
- **Line 47411:** continuation of large edits

## Hook/Skill Spam Statistics

| Hook/Feature | Occurrences | Avg Size | Notes |
|---|---|---|---|
| additionalContext | 0 | — | No hook spam detected in sudovoi |
| memory/ directory | 1 | — | Auto-managed memory files |
| Manual CLAUDE.md | 0 | — | NOT auto-created (missing init-project) |
| Manual AGENTS.md | 0 | — | NOT auto-created |

## Loop Patterns Detected

### File Edit Loops
- **`edrsr_v2_client.py`:** 16 consecutive edits (likely refactoring/debugging loop)
- **`project_state.md`:** 8 read operations (repeated status checks)
- **`main.py`:** 4 edits

### Pattern Analysis
These loop patterns indicate:
1. Iterative debugging without checkpointing (each edit carries full file context)
2. Memory file reads not backed by hooks (manual copies into JSONL)
3. No incremental edit strategy (always include full originalFile)

## Anomalies & Issues

### A1: Edit Operations Always Include `originalFile`
Every Edit tool_result contains the full file content in `originalFile` field. This means:
- A 500-line file takes ~15KB per Edit
- 16 edits to `edrsr_v2_client.py` = 16 × 15KB = 240KB unnecessary burn
- **Fix:** Only include diffs in tool_result, not full file copy

### A2: Persisted Output Files Not Cleaned
Line 142 shows: "Output too large (6.9MB). Full output saved to: ...bm8v50lbj.txt"
- Context window limited tool result to preview
- 6.9MB file left in `tool-results/` folder
- These accumulate and bloat project directory
- **Fix:** Implement cleanup policy for persisted output files

### A3: No Project Init Detected
- `/init-project` NOT called in any session
- CLAUDE.md, AGENTS.md not auto-created
- Memory management is manual, not hook-driven
- **Impact:** All context must be managed by agent, consuming tokens for state tracking

## Project Docs State

- **`/init-project` called:** No (no mentions in any JSONL)
- **CLAUDE.md auto-created:** No (0 files found)
- **AGENTS.md auto-created:** No (0 files found)
- **memory/ directory:** Yes (1, manually managed)
- **Manual edits:** Yes, project_state.md (8 reads = repeated manual synchronization)

## Key Burn Quotes

### Quote 1: Edit with Full 120KB File Copy
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [{
      "tool_use_id": "toolu_012d1xkPDNzwxAhFERuJZoeX",
      "type": "tool_result",
      "content": "The file D:\...\telegram_bot.py has been updated successfully."
    }]
  },
  "toolUseResult": {
    "filePath": "D:\...\telegram_bot.py",
    "originalFile": "import os\nimport json\nimport logging\nimport requests\n...[FULL FILE: ~2500 lines]...",
    "newString": "..."
  }
}
```
**Burn:** 119,630 bytes (~30K tokens). **Type:** Edit with full file included. **Location:** `1670e582-f32e-4261-b148-6e114c42aef9.jsonl:193`

### Quote 2: Git Status Output (100+ Files)
```
warning: in the working copy of '.claude/settings.local.json', LF will be replaced by CRLF...
.claude/settings.local.json
CourtMonitorBot.spec
CourtMonitorScheduler.spec
DEVLOG.md
FINAL_TEST_REPORT.md
PLAN.md
PROJECT_MIGRATION_SUMMARY.md
README_BOT.md
RECOMMENDED_FIXES.md
RELEASE_NOTES.md
RUN_BOT_FOREVER.bat
START_BOT.bat
TODO.md
api_client.py
bot_service.log
bot_service.py
bot_service.spec
build/CourtMonitorScheduler/Analysis-00.toc
build/CourtMonitorScheduler/CourtMonitorScheduler.pkg
...
```
**Burn:** 61,849 bytes (~15.5K tokens). **Type:** Bash (git status) output. **Location:** `1670e582-f32e-4261-b148-6e114c42aef9.jsonl:29`

### Quote 3: Persisted Output Notification
```
<persisted-output>
Output too large (6.9MB). Full output saved to:
C:\Users\espad\.claude\projects\D--Ametrin-projects-sudoviy-master-try-3\1670e582-f32e-4261-b148-6e114c42aef9\tool-results\bm8v50lbj.txt

Preview (first 2KB):
2026-04-06 08:49:46,663 - main - INFO - Reading data from D:\Ametrin projects\sudoviy master try 3\sudovi-master\data\chronology\...
2026-04-06 08:49:52,882 - main - INFO - Excel file loaded. Shape: (4928, 131)
...
</persisted-output>
```
**Burn:** 49,224 bytes (~12.3K tokens) in JSONL + 6.9MB persisted file. **Issue:** Persisted files accumulate and are not cleaned. **Location:** `1670e582-f32e-4261-b148-6e114c42aef9.jsonl:142`

## Summary

**Total estimated burn: ~3.2M tokens across 44MB of transcript data**

- **Top offender:** Edit operations including full file copies (120KB per edit)
- **Secondary offender:** Bash output (directory listings, logs) averaging 15-50KB
- **Tertiary issue:** Persisted output files (6.9MB+) not tracked in JSONL but consuming disk
- **Root cause:** No /init-project initialization, manual memory management, no file diff strategy

