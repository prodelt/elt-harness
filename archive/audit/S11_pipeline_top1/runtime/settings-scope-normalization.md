# Settings Scope Normalization — 2026-04-24

## Summary

Task 54 normalization closed 3 config-drift items identified in the Task 47 startup payload audit.

## Changes Applied

### 1. `.claude.json` — Duplicate project keys removed

**Tool:** `audit/S11_pipeline_top1/runtime/claude-json-normalizer.js --apply`

| Action | Key |
|--------|-----|
| KEEP (canonical) | `D:/Mammoth ERP system` |
| REMOVED (dup) | `D:/Mammoth erp system` |
| REMOVED (dup) | `D:/mammoth erp system` |

- Project entries before: 88 — after: 86
- Backup: `C:\Users\user\.claude.json.<timestamp>.bak`

Root cause: Claude Code on Windows treats path keys as case-sensitive internally; repeated project opens with different shell cwd casing created duplicate entries over time.

**Prevention:** Run normalizer dry-run periodically: `node claude-json-normalizer.js --json`.

---

### 2. Global `enabledPlugins` — Reduced to minimal core

**File:** `C:\Users\user\.claude\settings.json`

| Plugin | Before | After | Scope |
|--------|--------|-------|-------|
| `code-review` | true | **true** | global — useful in every project |
| `github` | true | **true** | global — repo discovery everywhere |
| `commit-commands` | true | **true** | global — git flow everywhere |
| `skill-creator` | true | **true** | global — skill authoring everywhere |
| `vercel` | true | **false** | → project (Izi-tracker) |
| `frontend-design` | true | **false** | → project (Izi-tracker if needed) |
| `playwright` | true | **false** | → project (Pipeline-setupper, Izi-tracker) |
| `supabase` | true | **false** | → project (Izi-tracker) |
| `typescript-lsp` | true | **false** | → project (Izi-tracker) |
| `firecrawl` | true | **false** | → project (Pipeline-setupper) |
| `chrome-devtools-mcp` | true | **false** | → project (Pipeline-setupper) |

**Impact:** 7 plugins removed from global startup load. Each enabled plugin contributes to `skill_listing` and `deferred_tools_delta` at session start.

---

### 3. Per-project plugin settings updated

**Pipeline-setupper** (`.claude/settings.local.json`):
```json
"enabledPlugins": {
  "firecrawl@claude-plugins-official": true,
  "chrome-devtools-mcp@claude-plugins-official": true,
  "playwright@claude-plugins-official": true
}
```

**Izi-tracker** (`.claude/settings.json`):
```json
"supabase@claude-plugins-official": true,
"playwright@claude-plugins-official": true,
"typescript-lsp@claude-plugins-official": true,
"vercel@claude-plugins-official": true
```

---

### 4. `settings.local.json` allow-rules — No action

148 specific allow-rules in Pipeline-setupper `.claude/settings.local.json`.
Audit found **zero broad wildcards** (no `Bash(*)`, `Read(*)`).
All rules are session-specific commands accumulated over S11 sessions.
Status: acceptable as-is; a periodic cleanup pass can trim truly stale entries.

---

## Scope Policy (forward-looking)

### Global settings (all projects get this)
- `code-review`, `github`, `commit-commands`, `skill-creator`
- Core hooks (hooks are never disabled globally)
- `skillListingMaxDescChars`, `skillListingBudgetFraction` throttles

### Project settings (.claude/settings.json or settings.local.json)
- Language-specific LSPs: `typescript-lsp`, `gopls-lsp`, `pyright-lsp`
- Platform plugins: `vercel`, `supabase`
- UI/browser tools: `playwright`, `chrome-devtools-mcp`, `frontend-design`
- Research/crawl: `firecrawl`

### On-demand (disable everywhere, enable in session manually)
- `browser-harness`, `hermes-agent` (per Task 51/52 policy)
- Experimental / LSP beta plugins

---

## Verification

```bash
# Confirm .claude.json clean
node audit/S11_pipeline_top1/runtime/claude-json-normalizer.js --json
# Expected: duplicateGroups: 0, removableKeys: 0

# Confirm global minimal core (4 true)
node -e "
const s = require('C:/Users/user/.claude/settings.json');
const enabled = Object.entries(s.enabledPlugins).filter(([,v]) => v).map(([k]) => k);
console.log('Globally enabled plugins:', enabled.length, enabled);
"
```

## Normalizer script

Location: `audit/S11_pipeline_top1/runtime/claude-json-normalizer.js`
Tests: `audit/S11_pipeline_top1/runtime/claude-json-normalizer.test.js` (6/6 PASS)

Run periodically to catch new duplicates:
```bash
node audit/S11_pipeline_top1/runtime/claude-json-normalizer.js
# exit 0 = clean, exit 1 = duplicates found (dry-run)
```
