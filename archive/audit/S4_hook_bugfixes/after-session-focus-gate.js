#!/usr/bin/env node

/**
 * SessionStart hook: Session Focus Gate
 *
 * Forces the user to define ONE clear goal per session.
 * Saves goal to temp file for Scope Guard to reference.
 *
 * Also piggybacks tool-results/ TTL cleanup (B05): once per session,
 * purge .txt files older than loopGuardian.toolResultsTtlDays in every
 * ~/.claude/projects/PROJ/UUID/tool-results/ directory.
 *
 * Based on /insights findings:
 * - Focused sessions (1 goal) → fully_achieved
 * - Mega-sprints (3+ goals) → partially_achieved + high friction
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const metrics = require('./lib/metrics');
const cfg = require('./lib/config');

metrics.inc('session-focus-gate', 'fired');
const focusDir = path.join(os.tmpdir(), 'claude-session-focus');
const focusFile = path.join(focusDir, 'goal.json');

// Ensure directory exists
if (!fs.existsSync(focusDir)) {
  fs.mkdirSync(focusDir, { recursive: true });
}

// Reset focus for new session
const sessionData = {
  goal: null,
  doneCriteria: null,
  taskCount: 0,
  startedAt: new Date().toISOString(),
  verified: false
};

fs.writeFileSync(focusFile, JSON.stringify(sessionData, null, 2));

// ── B05: TTL cleanup for persisted tool-results/ ────────────────────────────
// Safe-fire-and-forget: never crashes the hook. Runs at most once per session
// (sentinel file w/ mtime check), rate-limited to ~daily work.
(function cleanupToolResults() {
  try {
    const ttlDays = (cfg.loopGuardian && cfg.loopGuardian.toolResultsTtlDays) || 7;
    const maxAgeMs = ttlDays * 24 * 60 * 60 * 1000;

    // Sentinel: run at most once per 24h
    const sentinel = path.join(os.tmpdir(), 'claude-tool-results-cleanup.ts');
    try {
      const st = fs.statSync(sentinel);
      if (Date.now() - st.mtimeMs < 24 * 60 * 60 * 1000) return;
    } catch (_) {}

    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) { fs.writeFileSync(sentinel, '.'); return; }

    let purged = 0;
    const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);

    for (const proj of projects) {
      // Look for tool-results/ either under the project root or under <uuid>/
      const candidates = [path.join(projectsDir, proj, 'tool-results')];
      try {
        const subs = fs.readdirSync(path.join(projectsDir, proj), { withFileTypes: true });
        for (const s of subs) {
          if (s.isDirectory()) {
            candidates.push(path.join(projectsDir, proj, s.name, 'tool-results'));
          }
        }
      } catch (_) {}

      for (const dir of candidates) {
        let files;
        try { files = fs.readdirSync(dir); } catch (_) { continue; }
        for (const f of files) {
          if (!f.endsWith('.txt')) continue;
          const full = path.join(dir, f);
          try {
            const st = fs.statSync(full);
            if (Date.now() - st.mtimeMs > maxAgeMs) {
              fs.unlinkSync(full);
              purged++;
            }
          } catch (_) {}
        }
      }
    }
    fs.writeFileSync(sentinel, String(purged));
    if (purged > 0) metrics.inc('session-focus-gate', 'tool_results_purged');
  } catch (_) { /* never crash */ }
})();

// v4: official API format — hookSpecificOutput.additionalContext
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: 'SESSION FOCUS: Define ONE goal. Format: Focus: [goal] Done when: [criteria]. 1 goal = fully_achieved, 3+ = partially_achieved.'
  }
}));
