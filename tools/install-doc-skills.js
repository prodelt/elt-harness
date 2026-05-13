#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function text(lines) {
  return `${lines.join('\n')}\n`;
}

const INIT_PROJECT_SKILL = text([
  '---',
  'name: init-project',
  'description: Initialize or upgrade project AI docs with section-aware merge, protected local blocks, RAG/planning bootstrap, and registry registration.',
  'version: 2.0.0',
  'requires: []',
  'changelog:',
  '  - 2.0.0 (2026-05-08): delegate to project-docs v2 engine; add protected blocks, .rag/manifest.json, .planning, registry registration, and 6-section verification',
  '  - 1.1.0 (2026-04-23): add real-root detection, create/upgrade/noop modes, pipeline upgrade block, and settings warnings',
  '---',
  '# /init-project - Project AI Setup Initializer v2',
  '',
  'Use this skill when a project needs `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md` created, upgraded, or verified without erasing local rules.',
  '',
  '## Workflow',
  '',
  '1. Detect the real project root from filesystem markers before writing.',
  '2. Use Context7 before changing code that depends on external libraries.',
  '3. Run:',
  '   ```bash',
  '   node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" init --root .',
  '   ```',
  '4. Inspect the diff summary. `create` means no AI docs existed; `upgrade` means at least one doc existed but needed merge; `noop` means the core docs were already synchronized.',
  '5. Verify:',
  '   ```bash',
  '   node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" verify --root .',
  '   ```',
  '',
  '## Guarantees',
  '',
  '- Parses markdown sections instead of rewriting whole files blindly.',
  '- Preserves preambles, tool-specific sections, and `<!-- project-docs:protected:start NAME -->` blocks.',
  '- Ensures all 3 docs contain the 6 core sections: Overview, Stack, Commands, Architecture, Gotchas, Current State.',
  '- Creates `.rag/manifest.json` and `.planning/` when absent.',
  '- Registers the project in `~/.claude/projects-registry.json`.',
  '- Reports a diff summary and never claims success without verification evidence.',
  '',
  '## Rules',
  '',
  'Never overwrite project-specific rules to match a generic template. If the project root is ambiguous, stop and ask for confirmation before writing.',
]);

const SYNC_DOCS_SKILL = text([
  '---',
  'name: sync-docs',
  'description: Keeps CLAUDE.md, AGENTS.md, and .gemini/GEMINI.md synchronized by merging core sections while preserving project-specific notes.',
  'version: 2.0.0',
  'requires: []',
  'changelog:',
  '  - 2.0.0 (2026-05-08): delegate to project-docs v2 section-aware merge and protected-block preservation',
  '  - 1.0.0 (2026-04-22): initialize semver metadata',
  '---',
  '# /sync-docs - Section-Aware AI Docs Sync v2',
  '',
  'Use this skill after project docs change, after `/init-project`, or before shipping architecture/tooling updates.',
  '',
  '## Workflow',
  '',
  '1. Confirm the current folder is the intended project root.',
  '2. Run:',
  '   ```bash',
  '   node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" sync --root .',
  '   ```',
  '3. Review the diff summary for all 3 docs.',
  '4. Verify:',
  '   ```bash',
  '   node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" verify --root .',
  '   ```',
  '',
  '## Merge Contract',
  '',
  '- Core sections are synchronized across `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md`.',
  '- Preambles, tool-specific sections, and protected blocks are preserved.',
  '- Missing `.rag/manifest.json`, `.planning/`, and registry entries are initialized.',
  '- Local commands, gotchas, and project notes must not be flattened into generic boilerplate.',
  '',
  '## Protected Blocks',
  '',
  'Wrap local content that must survive every sync:',
  '',
  '```markdown',
  '<!-- project-docs:protected:start local-rules -->',
  'Project-specific rules here.',
  '<!-- project-docs:protected:end local-rules -->',
  '```',
]);

function writeSkill(home, tool, name, body) {
  const file = path.join(home, tool, 'skills', name, 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function main() {
  try {
    const home = os.homedir();
    const written = [
      writeSkill(home, '.claude', 'init-project', INIT_PROJECT_SKILL),
      writeSkill(home, '.codex', 'init-project', INIT_PROJECT_SKILL),
      writeSkill(home, '.claude', 'sync-docs', SYNC_DOCS_SKILL),
      writeSkill(home, '.codex', 'sync-docs', SYNC_DOCS_SKILL),
    ];
    process.stdout.write(`doc skills installed:\n${written.join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`install-doc-skills failed: ${error.message}\n`);
    process.exit(1);
  }
}

main();
