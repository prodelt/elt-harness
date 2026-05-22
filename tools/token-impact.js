#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function parseJsonLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function classifyToolName(record) {
  const payload = record.payload || {};
  if (payload.name) return payload.name;
  const content = record.message && record.message.content;
  if (Array.isArray(content)) {
    const tool = content.find((item) => item.type === 'tool_use');
    if (tool) return tool.name || 'unknown';
  }
  return '';
}

function toolResultBytes(record) {
  const payload = record.payload || {};
  if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') return byteLength(payload.output);
  const content = record.message && record.message.content;
  if (!Array.isArray(content)) return 0;
  return content
    .filter((item) => item.type === 'tool_result')
    .reduce((sum, item) => sum + byteLength(typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '')), 0);
}

function tokenUsage(record) {
  const usage = record.usage || (record.message && record.message.usage) || (record.payload && record.payload.usage) || {};
  return {
    input: usage.input_tokens || usage.prompt_tokens || 0,
    output: usage.output_tokens || usage.completion_tokens || 0,
    total: usage.total_tokens || 0,
  };
}

function analyzeJsonl(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.reduce((stats, line) => {
    const parsed = parseJsonLine(line);
    if (!parsed.ok) return { ...stats, invalid_lines: stats.invalid_lines + 1 };
    const record = parsed.value;
    const toolName = classifyToolName(record);
    const resultBytes = toolResultBytes(record);
    const usage = tokenUsage(record);
    const isFileRead = /^(Read|functions\.shell_command|shell_command)$/i.test(toolName)
      || /Get-Content|type\s+|cat\s+|rg\s+--files/i.test(JSON.stringify(record));
    return {
      ...stats,
      lines: stats.lines + 1,
      bytes: stats.bytes + byteLength(line),
      tool_output_chars: stats.tool_output_chars + resultBytes,
      file_read_events: stats.file_read_events + (isFileRead ? 1 : 0),
      full_file_read_risk_events: stats.full_file_read_risk_events + (isFileRead && /Get-Content(?![\s\S]*-TotalCount)|cat\s+[^|]+$/i.test(JSON.stringify(record)) ? 1 : 0),
      token_usage: {
        input: stats.token_usage.input + usage.input,
        output: stats.token_usage.output + usage.output,
        total: stats.token_usage.total + usage.total,
      },
    };
  }, {
    file,
    lines: 0,
    invalid_lines: 0,
    bytes: 0,
    tool_output_chars: 0,
    file_read_events: 0,
    full_file_read_risk_events: 0,
    token_usage: { input: 0, output: 0, total: 0 },
  });
}

function measureCommand(command, args, cwd) {
  const completed = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const output = `${completed.stdout || ''}${completed.stderr || ''}`;
  return {
    command: [command, ...args].join(' '),
    status: completed.status,
    output_chars: byteLength(output),
    output_lines: output.split(/\r?\n/).filter(Boolean).length,
  };
}

function compareReports(before, after) {
  const delta = (key) => (after[key] || 0) - (before[key] || 0);
  return {
    kind: 'token-impact-comparison',
    before,
    after,
    delta: {
      bytes: delta('bytes'),
      tool_output_chars: delta('tool_output_chars'),
      file_read_events: delta('file_read_events'),
      full_file_read_risk_events: delta('full_file_read_risk_events'),
      token_total: (after.token_usage.total || 0) - (before.token_usage.total || 0),
    },
    verdict: before.token_usage.total && after.token_usage.total
      ? 'token telemetry available'
      : 'token telemetry missing; use proxy metrics only',
  };
}

function parseArgs(argv) {
  const defaults = { command: 'analyze', json: false, root: process.cwd() };
  const command = ['analyze', 'compare', 'measure-command'].includes(argv[2]) ? argv[2] : defaults.command;
  const start = command === defaults.command ? 2 : 3;
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ...state, command };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--file') return parseNext(index + 2, { ...state, file: argv[index + 1] || state.file });
    if (arg === '--before') return parseNext(index + 2, { ...state, before: argv[index + 1] || state.before });
    if (arg === '--after') return parseNext(index + 2, { ...state, after: argv[index + 1] || state.after });
    if (arg === '--cmd') return parseNext(index + 2, { ...state, cmd: argv[index + 1] || state.cmd });
    return parseNext(index + 1, state);
  };
  return parseNext(start, defaults);
}

function run(options) {
  if (options.command === 'compare') return compareReports(analyzeJsonl(options.before), analyzeJsonl(options.after));
  if (options.command === 'measure-command') {
    const parts = String(options.cmd || '').split(/\s+/).filter(Boolean);
    return measureCommand(parts[0], parts.slice(1), options.root);
  }
  return analyzeJsonl(options.file);
}

function main() {
  const options = parseArgs(process.argv);
  if ((options.command === 'analyze' && !options.file) || (options.command === 'compare' && (!options.before || !options.after)) || (options.command === 'measure-command' && !options.cmd)) {
    process.stderr.write('usage: token-impact analyze --file session.jsonl | compare --before a.jsonl --after b.jsonl | measure-command --cmd "node tool.js"\n');
    process.exit(2);
  }
  const report = run(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.kind || 'token-impact'}\n`);
}

if (require.main === module) main();

module.exports = {
  analyzeJsonl,
  compareReports,
  measureCommand,
};
