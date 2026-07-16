#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write(`stdout error: ${error.message}\n`);
  process.exit(3);
});

const readJsonl = (filePath) => {
  try {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    process.stderr.write(`failed to read JSONL: ${error.message}\n`);
    process.exit(2);
  }
};

const parseJsonLine = (line) => {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return { ok: false, error };
  }
};

const byteLength = (value) => Buffer.byteLength(String(value || ''), 'utf8');
const jsonBytes = (value) => byteLength(JSON.stringify(value || {}));
const addValue = (obj, key, amount) => ({ ...obj, [key]: (obj[key] || 0) + amount });
const addTopEvent = (items, event) => [...items, event];
const fmt = (n) => `${(n / 1024).toFixed(1)}K`;
const pct = (n, total) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0.0%');

const baseStats = (format) => ({
  format,
  total: 0,
  lineCount: 0,
  invalidLines: 0,
  byRecordType: {},
  byPayloadType: {},
  roles: {},
  userByKind: {},
  toolResults: {},
  assistantText: 0,
  assistantThinking: 0,
  assistantToolUse: {},
  systemReminderBytes: 0,
  topEvents: [],
  fileReadBytes: {},
  tokenUsage: { lastTotal: 0, maxTotal: 0 },
});

const detectFormat = (records) => {
  const first = records.find((record) => record.ok)?.value;
  if (first?.type === 'session_meta' || first?.type === 'response_item') return 'codex';
  if (first?.payload?.type || first?.record_type) return 'codex';
  return 'claude';
};

const collectClaudeToolRefs = (records) => records.reduce((refs, record) => {
  if (!record.ok || record.value.type !== 'assistant') return refs;
  const content = record.value.message?.content;
  if (!Array.isArray(content)) return refs;

  return content.reduce((nextRefs, item) => {
    if (item.type !== 'tool_use') return nextRefs;
    return {
      toolNames: { ...nextRefs.toolNames, [item.id]: item.name || 'unknown' },
      readPaths: item.name === 'Read'
        ? { ...nextRefs.readPaths, [item.id]: item.input?.file_path || 'unknown' }
        : nextRefs.readPaths,
    };
  }, refs);
}, { toolNames: {}, readPaths: {} });

const collectCodexToolRefs = (records) => records.reduce((refs, record) => {
  if (!record.ok) return refs;
  const payload = record.value.payload || {};
  const isCall = payload.type === 'function_call' || payload.type === 'custom_tool_call';
  if (!isCall || !payload.call_id) return refs;

  const name = payload.name || refs.toolNames[payload.call_id] || 'unknown';
  return { toolNames: { ...refs.toolNames, [payload.call_id]: name } };
}, { toolNames: {} });

const classifyClaudeKind = (record) => {
  const content = record.message?.content;
  if (record.type === 'user' && typeof content === 'string' && /<system-reminder>/.test(content)) {
    return 'system-reminder';
  }
  if (record.type === 'user' && Array.isArray(content) && content.some((item) => item.type === 'tool_result')) {
    return 'tool-result';
  }
  return record.type || 'unknown';
};

const updateClaudeUserStats = (stats, record, refs) => {
  const content = record.message?.content;
  if (typeof content === 'string') {
    const reminders = content.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g) || [];
    const reminderBytes = reminders.reduce((sum, item) => sum + byteLength(item), 0);
    const promptBytes = byteLength(content) - reminderBytes;
    return {
      ...stats,
      systemReminderBytes: stats.systemReminderBytes + reminderBytes,
      userByKind: {
        ...addValue(stats.userByKind, 'system-reminder', reminderBytes),
        prompt: (stats.userByKind.prompt || 0) + promptBytes,
      },
    };
  }
  if (!Array.isArray(content)) return stats;
  return content.reduce((nextStats, item) => updateClaudeUserItem(nextStats, item, refs), stats);
};

const updateClaudeUserItem = (stats, item, refs) => {
  if (item.type === 'text') {
    return { ...stats, userByKind: addValue(stats.userByKind, 'text', byteLength(item.text)) };
  }
  if (item.type !== 'tool_result') return stats;

  const body = typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '');
  const outputBytes = byteLength(body);
  const toolName = refs.toolNames[item.tool_use_id] || 'unknown';
  const readPath = refs.readPaths[item.tool_use_id];
  return {
    ...stats,
    userByKind: addValue(stats.userByKind, 'tool-result', outputBytes),
    toolResults: addValue(stats.toolResults, toolName, outputBytes),
    fileReadBytes: readPath ? addValue(stats.fileReadBytes, readPath, outputBytes) : stats.fileReadBytes,
  };
};

const updateClaudeAssistantStats = (stats, record) => {
  const content = record.message?.content;
  if (!Array.isArray(content)) return stats;
  return content.reduce((nextStats, item) => {
    if (item.type === 'text') return { ...nextStats, assistantText: nextStats.assistantText + byteLength(item.text) };
    if (item.type === 'thinking') return { ...nextStats, assistantThinking: nextStats.assistantThinking + byteLength(item.thinking) };
    if (item.type !== 'tool_use') return nextStats;
    return {
      ...nextStats,
      assistantToolUse: addValue(nextStats.assistantToolUse, item.name || 'unknown', jsonBytes(item.input)),
    };
  }, stats);
};

const updateClaudeStats = (stats, record, size, refs) => {
  const type = record.type || 'unknown';
  const withBase = {
    ...stats,
    total: stats.total + size,
    lineCount: stats.lineCount + 1,
    byRecordType: addValue(stats.byRecordType, type, size),
    topEvents: addTopEvent(stats.topEvents, { size, type, kind: classifyClaudeKind(record), label: type }),
  };
  if (type === 'user') return updateClaudeUserStats(withBase, record, refs);
  if (type === 'assistant') return updateClaudeAssistantStats(withBase, record);
  return withBase;
};

const getCodexTextBytes = (content) => {
  if (typeof content === 'string') return byteLength(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, item) => sum + byteLength(item.text || item.input_text || item.output_text), 0);
};

const getCodexOutputBytes = (payload) => {
  if (typeof payload.output === 'string') return byteLength(payload.output);
  if (typeof payload.stdout === 'string' || typeof payload.stderr === 'string') {
    return byteLength(payload.stdout) + byteLength(payload.stderr);
  }
  return 0;
};

const classifyCodexKind = (payload) => {
  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') return 'tool-result';
  if (payload.type === 'exec_command_end' || payload.type === 'patch_apply_end') return 'tool-result';
  if (payload.type === 'function_call' || payload.type === 'custom_tool_call') return 'tool-call';
  if (payload.type === 'message') return `message:${payload.role || 'unknown'}`;
  return payload.type || 'unknown';
};

const updateCodexMessageStats = (stats, payload) => {
  const role = payload.role || 'unknown';
  const textBytes = getCodexTextBytes(payload.content);
  return {
    ...stats,
    roles: addValue(stats.roles, role, textBytes),
    userByKind: addValue(stats.userByKind, `message:${role}`, textBytes),
  };
};

const updateCodexToolStats = (stats, payload, refs) => {
  const isCall = payload.type === 'function_call' || payload.type === 'custom_tool_call';
  const isOutput = ['function_call_output', 'custom_tool_call_output', 'exec_command_end', 'patch_apply_end'].includes(payload.type);
  if (isCall) {
    return { ...stats, assistantToolUse: addValue(stats.assistantToolUse, payload.name || 'unknown', jsonBytes(payload.arguments || payload.input)) };
  }
  if (!isOutput) return stats;

  const toolName = refs.toolNames[payload.call_id] || payload.name || 'unknown';
  const outputBytes = getCodexOutputBytes(payload);
  return {
    ...stats,
    userByKind: addValue(stats.userByKind, 'tool-result', outputBytes),
    toolResults: addValue(stats.toolResults, toolName, outputBytes),
  };
};

const updateCodexTokenStats = (stats, payload) => {
  if (payload.type !== 'token_count') return stats;
  const total = payload.info?.total_token_usage?.total_tokens || 0;
  return {
    ...stats,
    tokenUsage: {
      lastTotal: total || stats.tokenUsage.lastTotal,
      maxTotal: Math.max(stats.tokenUsage.maxTotal, total),
    },
  };
};

const updateCodexStats = (stats, record, size, refs) => {
  const payload = record.payload || {};
  const recordType = record.record_type || record.type || 'unknown';
  const payloadType = payload.type || 'none';
  const base = {
    ...stats,
    total: stats.total + size,
    lineCount: stats.lineCount + 1,
    byRecordType: addValue(stats.byRecordType, recordType, size),
    byPayloadType: addValue(stats.byPayloadType, `${recordType}/${payloadType}`, size),
    topEvents: addTopEvent(stats.topEvents, { size, type: recordType, kind: classifyCodexKind(payload), label: payloadType }),
  };
  const withMessage = payload.type === 'message' ? updateCodexMessageStats(base, payload) : base;
  const withTools = updateCodexToolStats(withMessage, payload, refs);
  const withTokens = updateCodexTokenStats(withTools, payload);

  if (payload.type === 'user_message') {
    return { ...withTokens, userByKind: addValue(withTokens.userByKind, 'event:user-message', byteLength(payload.message)) };
  }
  if (payload.type === 'agent_message') {
    return { ...withTokens, assistantText: withTokens.assistantText + byteLength(payload.message) };
  }
  return withTokens;
};

const analyzeRecords = (records, format, refs) => records.reduce((stats, record) => {
  if (!record.ok) return { ...stats, invalidLines: stats.invalidLines + 1 };
  const size = byteLength(record.line);
  return format === 'codex'
    ? updateCodexStats(stats, record.value, size, refs)
    : updateClaudeStats(stats, record.value, size, refs);
}, baseStats(format));

const renderEntries = (title, entries, total, includePct = true) => {
  const lines = [`${title}:`];
  const sorted = Object.entries(entries).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return [...lines, '  (none)'];
  return [
    ...lines,
    ...sorted.map(([key, value]) => {
      const percent = includePct ? `  ${pct(value, total)}` : '';
      return `  ${key.padEnd(32)} ${fmt(value).padStart(8)}${percent}`;
    }),
  ];
};

const renderTopEvents = (stats) => [
  'Top 10 largest single events:',
  ...stats.topEvents
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((event) => `  ${fmt(event.size).padStart(8)}  type=${event.type} kind=${event.kind} label=${event.label}`),
];

const topEntriesObject = (entries, limit) => Object.fromEntries(
  Object.entries(entries).sort((a, b) => b[1] - a[1]).slice(0, limit),
);

const renderStats = (stats, filePath) => [
  '=== SESSION BREAKDOWN ===',
  `File: ${filePath}`,
  `Format: ${stats.format}`,
  `Lines: ${stats.lineCount}${stats.invalidLines ? ` (${stats.invalidLines} invalid skipped)` : ''}`,
  `Total: ${fmt(stats.total)}`,
  '',
  ...renderEntries('By record type', stats.byRecordType, stats.total),
  '',
  ...renderEntries('By payload type', stats.byPayloadType, stats.total),
  '',
  ...renderEntries('Messages / user-visible content by kind', stats.userByKind, stats.total),
  '',
  ...renderEntries('Tool outputs by tool', stats.toolResults, stats.total),
  '',
  ...renderEntries('Assistant tool-call inputs by tool', stats.assistantToolUse, stats.total, false),
  '',
  ...renderEntries('Message role text bytes', stats.roles, stats.total),
  '',
  `Assistant text: ${fmt(stats.assistantText)} | thinking: ${fmt(stats.assistantThinking)}`,
  `System reminders: ${fmt(stats.systemReminderBytes)}`,
  `Token usage: last=${stats.tokenUsage.lastTotal} max=${stats.tokenUsage.maxTotal}`,
  '',
  ...renderEntries('Top 5 Read() destinations', topEntriesObject(stats.fileReadBytes, 5), stats.total),
  '',
  ...renderTopEvents(stats),
].join('\n');

const analyzeFile = (filePath) => {
  const lines = readJsonl(filePath);
  const records = lines.map((line) => ({ ...parseJsonLine(line), line }));
  const format = detectFormat(records);
  const refs = format === 'codex' ? collectCodexToolRefs(records) : collectClaudeToolRefs(records);
  const stats = analyzeRecords(records, format, refs);
  return renderStats(stats, filePath);
};

const main = () => {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('usage: analyze-session.js <path.jsonl>\n');
    process.exit(1);
  }
  process.stdout.write(`${analyzeFile(inputPath)}\n`);
};

if (require.main === module) main();

module.exports = { analyzeFile };
