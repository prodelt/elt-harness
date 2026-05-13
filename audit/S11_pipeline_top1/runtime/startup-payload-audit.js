#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const projectSpecs = [
  {
    id: 'pipeline-setupper',
    label: 'Pipeline-setupper',
    primarySession:
      'C:\\Users\\espad\\.claude\\projects\\C--Claude-playground-Pipiline-setupper\\cf23b3b8-3f2d-4347-ac91-7f2584b3d182.jsonl',
    coldTokenSession: null,
  },
  {
    id: 'izi-tracker',
    label: 'Izi-tracker',
    primarySession:
      'C:\\Users\\espad\\.claude\\projects\\D--Ametrin-projects-Izi-tracker-izi-tracker\\9e15dffd-5840-40af-b52d-4faa77717220.jsonl',
    coldTokenSession:
      'C:\\Users\\espad\\.claude\\projects\\D--Ametrin-projects-Izi-tracker-izi-tracker\\5ffa7388-f2b0-418d-b4ee-ac2767a53261.jsonl',
  },
];

const configPaths = {
  globalSettings: 'C:\\Users\\espad\\.claude\\settings.json',
  claudeJson: 'C:\\Users\\espad\\.claude.json',
  projectLocalSettings: path.join(repoRoot, '.claude', 'settings.local.json'),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL ${filePath}:${index + 1}: ${error.message}`);
      }
    });
}

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function clip(text, maxLength) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`;
}

function describeAttachment(attachment) {
  if (attachment.type === 'hook_success') {
    if ((attachment.content ?? '').includes('<persisted-output>')) {
      return 'SessionStart persisted-output payload';
    }
    if ((attachment.content ?? '').includes('Vercel CLI is not installed')) {
      return 'SessionStart Vercel CLI advisory';
    }
    const stdoutPreview = clip(attachment.stdout, 80);
    return stdoutPreview ? `SessionStart hook_success: ${stdoutPreview}` : 'SessionStart hook_success';
  }

  if (attachment.type === 'file') {
    return attachment.displayPath ?? attachment.filename ?? 'attached file';
  }

  if (attachment.type === 'hook_additional_context') {
    return clip(Array.isArray(attachment.content) ? attachment.content[0] : attachment.content, 80);
  }

  return attachment.type;
}

function getAttachment(events, type) {
  return events.find((event) => event.attachment && event.attachment.type === type)?.attachment ?? null;
}

function getFirstAssistantUsage(events) {
  return events.find((event) => event.type === 'assistant' && event.message?.usage)?.message?.usage ?? null;
}

function getFirstToolSearchTotal(events) {
  return (
    events.find((event) => typeof event.toolUseResult?.total_deferred_tools === 'number')?.toolUseResult
      ?.total_deferred_tools ?? null
  );
}

function getInitialAttachments(events) {
  const attachments = [];
  for (const event of events) {
    if (event.type === 'assistant') {
      break;
    }
    if (event.attachment?.type) {
      attachments.push({
        type: event.attachment.type,
        label: describeAttachment(event.attachment),
        bytes: byteLength(event.attachment),
      });
    }
  }
  return attachments.sort((left, right) => right.bytes - left.bytes);
}

function summarizeSession(spec) {
  const primaryEvents = readJsonl(spec.primarySession);
  const deferred = getAttachment(primaryEvents, 'deferred_tools_delta');
  const mcpInstructions = getAttachment(primaryEvents, 'mcp_instructions_delta');
  const skillListing = getAttachment(primaryEvents, 'skill_listing');
  const usage = getFirstAssistantUsage(primaryEvents);
  const initialAttachments = getInitialAttachments(primaryEvents);
  const coldUsage = spec.coldTokenSession ? getFirstAssistantUsage(readJsonl(spec.coldTokenSession)) : null;
  const metaEvent =
    primaryEvents.find((event) => event.sessionId || event.cwd || event.gitBranch || event.timestamp) ?? {};

  return {
    id: spec.id,
    label: spec.label,
    sessionId: metaEvent.sessionId ?? null,
    timestamp: metaEvent.timestamp ?? null,
    cwd: metaEvent.cwd ?? null,
    gitBranch: metaEvent.gitBranch ?? null,
    primarySession: spec.primarySession,
    coldTokenSession: spec.coldTokenSession,
    startupBreakdown: {
      deferred_tools_delta: {
        count: deferred?.addedNames?.length ?? 0,
        bytes: deferred ? byteLength(deferred) : 0,
      },
      mcp_instructions_delta: {
        count: mcpInstructions?.addedNames?.length ?? 0,
        bytes: mcpInstructions ? byteLength(mcpInstructions) : 0,
      },
      skill_listing: {
        count: skillListing?.skillCount ?? 0,
        bytes: skillListing ? byteLength(skillListing.content ?? '') : 0,
      },
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
      cold_cache_creation_input_tokens: coldUsage?.cache_creation_input_tokens ?? null,
      cold_cache_read_input_tokens: coldUsage?.cache_read_input_tokens ?? null,
    },
    startupAttachments: {
      count: initialAttachments.length,
      totalBytes: initialAttachments.reduce((sum, item) => sum + item.bytes, 0),
      topOffenders: initialAttachments.slice(0, 5),
    },
    totalDeferredToolsFromToolSearch: getFirstToolSearchTotal(primaryEvents),
  };
}

function inspectGlobalSettings(filePath) {
  const settings = readJson(filePath);
  const enabledPlugins = settings.enabledPlugins ?? {};
  const hooks = settings.hooks ?? {};
  return {
    filePath,
    enabledPluginKeys: Object.keys(enabledPlugins).length,
    enabledPluginTrueCount: Object.values(enabledPlugins).filter(Boolean).length,
    skillListingMaxDescChars: settings.skillListingMaxDescChars ?? null,
    skillListingBudgetFraction: settings.skillListingBudgetFraction ?? null,
    sessionStartHooks:
      hooks.SessionStart?.reduce((sum, group) => sum + (group.hooks?.length ?? 0), 0) ?? 0,
  };
}

function inspectProjectLocalSettings(filePath) {
  const settings = readJson(filePath);
  const allow = settings.permissions?.allow ?? [];
  const deny = settings.permissions?.deny ?? [];
  return {
    filePath,
    allowRules: allow.length,
    denyRules: deny.length,
  };
}

function inspectDuplicateProjectKeys(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const projectKeys = [];
  let insideProjects = false;
  let depth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!insideProjects) {
      if (/"projects"\s*:\s*\{/.test(line)) {
        insideProjects = true;
        depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      }
      continue;
    }

    if (depth === 1) {
      const match = line.match(/^\s+"([^"]+)"\s*:\s*\{/);
      if (match) {
        projectKeys.push({ key: match[1], line: index + 1 });
      }
    }

    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
    if (depth <= 0) {
      break;
    }
  }

  const groups = new Map();
  for (const entry of projectKeys) {
    const normalized = entry.key.toLowerCase();
    const group = groups.get(normalized) ?? [];
    group.push(entry);
    groups.set(normalized, group);
  }

  const duplicateGroups = Array.from(groups.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedKey, entries]) => ({
      normalizedKey,
      entries,
    }))
    .sort((left, right) => right.entries.length - left.entries.length);

  return {
    filePath,
    totalProjectKeys: projectKeys.length,
    duplicateGroupCount: duplicateGroups.length,
    duplicateGroups,
  };
}

function buildSummary() {
  return {
    generatedAt: new Date().toISOString(),
    projects: projectSpecs.map(summarizeSession),
    config: {
      globalSettings: inspectGlobalSettings(configPaths.globalSettings),
      projectLocalSettings: inspectProjectLocalSettings(configPaths.projectLocalSettings),
      claudeJsonProjects: inspectDuplicateProjectKeys(configPaths.claudeJson),
    },
  };
}

function renderMarkdown(summary) {
  const lines = [];
  lines.push(`# Startup payload audit`);
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Project breakdown');
  lines.push('');

  for (const project of summary.projects) {
    lines.push(`### ${project.label}`);
    lines.push(`- session: \`${project.sessionId}\``);
    lines.push(`- cwd: \`${project.cwd}\``);
    lines.push(`- branch: \`${project.gitBranch}\``);
    lines.push(`- deferred_tools_delta: ${project.startupBreakdown.deferred_tools_delta.count} items / ${project.startupBreakdown.deferred_tools_delta.bytes} bytes`);
    lines.push(`- mcp_instructions_delta: ${project.startupBreakdown.mcp_instructions_delta.count} items / ${project.startupBreakdown.mcp_instructions_delta.bytes} bytes`);
    lines.push(`- skill_listing: ${project.startupBreakdown.skill_listing.count} skills / ${project.startupBreakdown.skill_listing.bytes} bytes`);
    lines.push(`- cache_creation_input_tokens: ${project.startupBreakdown.cache_creation_input_tokens}`);
    lines.push(`- cache_read_input_tokens: ${project.startupBreakdown.cache_read_input_tokens}`);
    if (project.startupBreakdown.cold_cache_creation_input_tokens !== null) {
      lines.push(
        `- cold cache reference: create=${project.startupBreakdown.cold_cache_creation_input_tokens}, read=${project.startupBreakdown.cold_cache_read_input_tokens}`
      );
    }
    if (project.totalDeferredToolsFromToolSearch !== null) {
      lines.push(`- total_deferred_tools from ToolSearch: ${project.totalDeferredToolsFromToolSearch}`);
    }
    lines.push(`- startup attachment bytes total: ${project.startupAttachments.totalBytes}`);
    lines.push('- top offenders:');
    for (const offender of project.startupAttachments.topOffenders) {
      lines.push(`  - ${offender.type}: ${offender.bytes} bytes (${offender.label})`);
    }
    lines.push('');
  }

  const globalSettings = summary.config.globalSettings;
  lines.push('## Config drift');
  lines.push('');
  lines.push(`- global enabled plugin keys: ${globalSettings.enabledPluginKeys}`);
  lines.push(`- globally enabled plugins (truthy): ${globalSettings.enabledPluginTrueCount}`);
  lines.push(`- global skill listing budget fraction: ${globalSettings.skillListingBudgetFraction}`);
  lines.push(`- global skill listing max desc chars: ${globalSettings.skillListingMaxDescChars}`);
  lines.push(`- SessionStart hook count: ${globalSettings.sessionStartHooks}`);
  lines.push(`- project local allow rules: ${summary.config.projectLocalSettings.allowRules}`);
  lines.push(`- project local deny rules: ${summary.config.projectLocalSettings.denyRules}`);
  lines.push(`- duplicate project key groups in .claude.json: ${summary.config.claudeJsonProjects.duplicateGroupCount}`);
  lines.push('');
  lines.push('## Duplicate project key groups');
  lines.push('');
  for (const group of summary.config.claudeJsonProjects.duplicateGroups) {
    lines.push(`- ${group.normalizedKey}`);
    for (const entry of group.entries) {
      lines.push(`  - line ${entry.line}: ${entry.key}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

const summary = buildSummary();
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(renderMarkdown(summary));
}
