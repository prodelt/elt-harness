const fs = require('fs');

// Hard cap on transcript bytes parsed in the Stop hook — keeps us far below the
// 4s hook budget even for marathon sessions. Larger files are tail-read and
// the resulting ledger row is flagged partial.
const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

// Infer which client produced the hook input from its transcript path.
function inferClient(input) {
  const tp = String((input && (input.transcript_path || input.transcriptPath)) || '');
  if (/[\\/]\.claude[\\/]/i.test(tp)) return 'claude';
  if (/[\\/]\.codex[\\/]/i.test(tp)) return 'codex';
  if (/[\\/]\.gemini[\\/]/i.test(tp)) return 'gemini';
  return 'unknown';
}

// Sum per-turn API usage across a JSONL transcript. Returns null when the file
// is unreadable; otherwise a totals object (zeros allowed — caller decides).
function extractUsageFromTranscript(transcriptPath, opts) {
  const maxBytes = (opts && opts.maxBytes) || MAX_TRANSCRIPT_BYTES;
  let raw;
  let partial = 0;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > maxBytes) {
      partial = 1;
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
        raw = buf.toString('utf8');
        // Drop the (likely truncated) first line of the tail window
        raw = raw.slice(raw.indexOf('\n') + 1);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    }
  } catch (e) {
    return null;
  }

  const totals = {
    model: '',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    turns: 0,
    partial
  };

  for (const line of raw.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue;
    if (line.indexOf('"usage"') === -1) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      continue;
    }
    const msg = obj && obj.message;
    const usage = msg && msg.usage;
    if (!usage || typeof usage !== 'object') continue;
    totals.input_tokens += usage.input_tokens || 0;
    totals.output_tokens += usage.output_tokens || 0;
    totals.cache_read_tokens += usage.cache_read_input_tokens || 0;
    totals.cache_creation_tokens += usage.cache_creation_input_tokens || 0;
    totals.turns += 1;
    if (typeof msg.model === 'string' && msg.model) totals.model = msg.model;
  }

  return totals;
}

// Pull shell command strings (Bash/PowerShell tool_use inputs) out of a JSONL
// transcript. Powers S7 instinct extraction. Returns [] when unreadable —
// bounded by the same byte cap as usage parsing to stay under the hook budget.
function extractCommandsFromTranscript(transcriptPath, opts) {
  const maxBytes = (opts && opts.maxBytes) || MAX_TRANSCRIPT_BYTES;
  let raw;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size > maxBytes) {
      const fd = fs.openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(maxBytes);
        fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
        raw = buf.toString('utf8');
        raw = raw.slice(raw.indexOf('\n') + 1);
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(transcriptPath, 'utf8');
    }
  } catch (e) {
    return [];
  }

  const commands = [];
  for (const line of raw.split('\n')) {
    if (!line || line.charCodeAt(0) !== 123 /* '{' */) continue;
    if (line.indexOf('tool_use') === -1) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      continue;
    }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item && item.type === 'tool_use' && (item.name === 'Bash' || item.name === 'PowerShell')) {
        const cmd = item.input && typeof item.input.command === 'string' ? item.input.command.trim() : '';
        if (cmd) commands.push(cmd);
      }
    }
  }
  return commands;
}

module.exports = { inferClient, extractUsageFromTranscript, extractCommandsFromTranscript, MAX_TRANSCRIPT_BYTES };
