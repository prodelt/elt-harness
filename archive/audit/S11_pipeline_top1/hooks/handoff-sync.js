#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function runGit(cwd, command) {
  const attempts = process.platform === 'win32'
    ? [command, `cmd /c ${command}`]
    : [command];
  for (const attempt of attempts) {
    try {
      return execSync(attempt, {
        cwd,
        encoding: 'utf8',
        timeout: 4000,
        stdio: 'pipe'
      }).trim();
    } catch (_) {}
  }
  try {
    return '';
  } catch (_) {
    return '';
  }
}

function readGitHeadInfo(cwd) {
  const gitDir = path.join(cwd, '.git');
  try {
    const headRaw = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!headRaw) return { branch: '', head: '' };
    if (headRaw.startsWith('ref: ')) {
      const refPath = headRaw.slice(5).trim();
      const branch = refPath.replace(/^refs\/heads\//, '') || '';
      const hash = safeRead(path.join(gitDir, refPath)).trim();
      return {
        branch,
        head: hash ? `${hash.slice(0, 7)} (subject unavailable)` : ''
      };
    }
    return {
      branch: 'detached',
      head: `${headRaw.slice(0, 7)} (subject unavailable)`
    };
  } catch (_) {
    return { branch: '', head: '' };
  }
}

function parseConfig(cwd) {
  const explicit = process.env.CLAUDE_HANDOFF_CONFIG;
  const configPath = explicit || path.join(cwd, '.claude', 'handoff-automation.json');
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return {
    configPath,
    cwd,
    planFile: path.resolve(cwd, config.planFile || 'audit/S11_pipeline_top1/PLAN.md'),
    memoryFile: path.resolve(cwd, config.memoryFile || 'MEMORY.md'),
    trackedPromptFile: path.resolve(cwd, config.trackedPromptFile || 'audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md'),
    generatedPromptFile: path.resolve(cwd, config.generatedPromptFile || '.planning/AUTO_NEXT_SESSION_PROMPT.md'),
    statusFile: path.resolve(cwd, config.statusFile || '.planning/AUTO_HANDOFF_STATUS.md'),
    readFirst: Array.isArray(config.readFirst) ? config.readFirst.map(item => path.resolve(cwd, item)) : [],
    promptTitle: typeof config.promptTitle === 'string' ? config.promptTitle : 'Auto Next Session Prompt',
    planSectionAnchor: typeof config.planSectionAnchor === 'string' ? config.planSectionAnchor : ''
  };
}

function findNextTask(planText, anchor) {
  let lines = planText.split(/\r?\n/);
  if (anchor) {
    const anchorIndex = lines.findIndex(line => line.includes(anchor));
    if (anchorIndex >= 0) lines = lines.slice(anchorIndex + 1);
  }
  for (const line of lines) {
    const match = line.match(/^### \[ \] (ЗАДАЧА \d+ .*?)$/);
    if (match) {
      const label = match[1].trim();
      const numberMatch = label.match(/ЗАДАЧА\s+(\d+)/);
      return {
        label,
        number: numberMatch ? numberMatch[1] : ''
      };
    }
  }
  return { label: 'unknown', number: '' };
}

function hasTaskReference(text, taskNumber) {
  if (!text || !taskNumber) return false;
  const patterns = [
    new RegExp(`ЗАДАЧА\\s+${taskNumber}\\b`, 'i'),
    new RegExp(`Task\\s+${taskNumber}\\b`, 'i')
  ];
  return patterns.some(pattern => pattern.test(text));
}

function summarizeTrackedStatus(statusText) {
  const trimmed = statusText.trim();
  if (!trimmed) return { clean: true, summary: 'clean' };
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  return {
    clean: false,
    summary: `${lines.length} tracked change(s)`,
    lines: lines.slice(0, 20)
  };
}

function toRepoPath(cwd, absolutePath) {
  return path.relative(cwd, absolutePath).replace(/\\/g, '/');
}

function buildPrompt(config, context) {
  const readFirst = config.readFirst
    .map(item => `- \`${toRepoPath(config.cwd, item)}\``)
    .join('\n');
  const commands = [
    'git branch --show-current',
    'git log --oneline -4',
    'git status --short --untracked-files=no',
    `rg -n "ЗАДАЧА ${context.nextTask.number}|Default next action|Current next action|Hook Friction" "${toRepoPath(config.cwd, config.planFile)}" "${toRepoPath(config.cwd, config.memoryFile)}" "${toRepoPath(config.cwd, config.trackedPromptFile)}"`
  ].join('\n');

  const warnings = context.warnings.length
    ? context.warnings.map(item => `- ${item}`).join('\n')
    : '- none';

  return [
    `# ${config.promptTitle}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Focus: закрыть ${context.nextTask.label}`,
    'Done when: next unchecked task from PLAN is fully closed with proof and commit',
    '',
    '## Context',
    `- Branch: \`${context.branch || 'unknown'}\``,
    `- Last commit: \`${context.head || 'unknown'}\``,
    `- Tracked worktree: ${context.status.summary}`,
    '',
    '## Read First',
    readFirst || '- none',
    '',
    '## First Commands',
    '```bash',
    commands,
    '```',
    '',
    '## Sync Checks',
    `- Memory references next task: ${context.memorySync ? 'yes' : 'no'}`,
    `- Tracked prompt references next task: ${context.promptSync ? 'yes' : 'no'}`,
    '',
    '## Warnings',
    warnings,
    ''
  ].join('\n');
}

function buildStatus(config, context) {
  const statusLines = context.status.lines && context.status.lines.length
    ? context.status.lines.join('\n')
    : 'clean';

  return [
    '# Auto Handoff Status',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Checks',
    `- Next task from PLAN: ${context.nextTask.label}`,
    `- Memory references next task: ${context.memorySync ? 'yes' : 'no'}`,
    `- Tracked prompt references next task: ${context.promptSync ? 'yes' : 'no'}`,
    `- Branch: ${context.branch || 'unknown'}`,
    `- Last commit: ${context.head || 'unknown'}`,
    `- Tracked worktree: ${context.status.summary}`,
    '',
    '## Tracked Changes',
    '```text',
    statusLines,
    '```',
    '',
    '## Warnings',
    ...(context.warnings.length ? context.warnings.map(item => `- ${item}`) : ['- none']),
    '',
    '## Outputs',
    `- Generated prompt: ${toRepoPath(config.cwd, config.generatedPromptFile)}`,
    `- Status file: ${toRepoPath(config.cwd, config.statusFile)}`,
    ''
  ].join('\n');
}

function runHandoffSync(cwdArg, configPathArg) {
  const cwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
  if (configPathArg) process.env.CLAUDE_HANDOFF_CONFIG = configPathArg;
  const config = parseConfig(cwd);
  if (!config) return null;
  const planText = safeRead(config.planFile);
  const memoryText = safeRead(config.memoryFile);
  const trackedPromptText = safeRead(config.trackedPromptFile);
  const nextTask = findNextTask(planText, config.planSectionAnchor);

  const headInfo = readGitHeadInfo(cwd);
  const branch = runGit(cwd, 'git branch --show-current') || headInfo.branch;
  const head = runGit(cwd, 'git log --oneline -1') || headInfo.head;
  const trackedStatus = summarizeTrackedStatus(runGit(cwd, 'git status --short --untracked-files=no'));
  const memorySync = hasTaskReference(memoryText, nextTask.number);
  const promptSync = hasTaskReference(trackedPromptText, nextTask.number);

  const warnings = [];
  if (!memorySync) warnings.push(`MEMORY.md does not mention next task ${nextTask.number || 'unknown'}`);
  if (!promptSync) warnings.push(`tracked NEXT_SESSION_PROMPT does not mention next task ${nextTask.number || 'unknown'}`);
  if (!trackedStatus.clean) warnings.push(`tracked worktree is not clean: ${trackedStatus.summary}`);
  if (!branch) warnings.push('git branch is unavailable');
  if (!head) warnings.push('git HEAD summary is unavailable');

  const context = {
    nextTask,
    branch,
    head,
    status: trackedStatus,
    memorySync,
    promptSync,
    warnings
  };

  safeWrite(config.generatedPromptFile, buildPrompt(config, context));
  safeWrite(config.statusFile, buildStatus(config, context));
  return {
    success: true,
    nextTask: nextTask.label,
    promptFile: config.generatedPromptFile,
    statusFile: config.statusFile,
    warnings
  };
}

function main() {
  const result = runHandoffSync(process.argv[2], process.env.CLAUDE_HANDOFF_CONFIG);
  if (!result) process.exit(0);
  process.stdout.write(JSON.stringify(result));
}

module.exports = {
  runHandoffSync,
  findNextTask,
  hasTaskReference
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error && error.stack || error));
    process.exit(1);
  }
}
