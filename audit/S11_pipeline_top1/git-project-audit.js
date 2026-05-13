'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ACTIVE_PROJECTS = Object.freeze([
  'C:\\Claude playground\\Pipiline setupper',
  'D:\\Ametrin projects\\Izi-tracker',
  'D:\\Ametrin projects\\Law-assistant',
  'D:\\Ametrin projects\\sudoviy-master-try-3',
  'D:\\Ametrin projects\\tg-bot-reclamaties-master',
]);

function normalizeExistingPath(projectPath) {
  if (!fs.existsSync(projectPath)) {
    return path.resolve(projectPath);
  }
  return fs.realpathSync.native(projectPath);
}

function runGitTopLevel(projectPath) {
  try {
    const output = childProcess.execFileSync(
      'git',
      ['-C', projectPath, 'rev-parse', '--show-toplevel'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      },
    );
    return output.trim();
  } catch (error) {
    return null;
  }
}

function hasOwnGitDir(projectPath) {
  return fs.existsSync(path.join(projectPath, '.git'));
}

function buildAuditResult(inputPath) {
  const resolvedPath = normalizeExistingPath(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      inputPath,
      path: resolvedPath,
      status: 'missing',
      gitTopLevel: null,
      reason: 'project path does not exist',
    };
  }

  const gitTopLevel = runGitTopLevel(resolvedPath);
  const normalizedTopLevel = gitTopLevel ? normalizeExistingPath(gitTopLevel) : null;
  if (hasOwnGitDir(resolvedPath) && normalizedTopLevel === resolvedPath) {
    return {
      inputPath,
      path: resolvedPath,
      status: 'ok',
      gitTopLevel: normalizedTopLevel,
      reason: 'project owns .git',
    };
  }

  return {
    inputPath,
    path: resolvedPath,
    status: 'needs-init',
    gitTopLevel: normalizedTopLevel,
    reason: normalizedTopLevel ? 'inherits git root from parent' : 'no git root found',
  };
}

function auditProjects(projectPaths) {
  return projectPaths.map((projectPath) => buildAuditResult(projectPath));
}

function formatResultLine(result) {
  if (result.status === 'ok') {
    return `OK: ${result.path} -> ${result.gitTopLevel}`;
  }
  if (result.status === 'missing') {
    return `MISSING: ${result.path}`;
  }
  const inherited = result.gitTopLevel ? `inherits ${result.gitTopLevel}` : result.reason;
  return `NEED INIT: ${result.path} (${inherited})`;
}

function formatTextReport(results) {
  const lines = results.map((result) => formatResultLine(result));
  const summary = results.reduce(
    (counts, result) => ({
      ...counts,
      [result.status]: counts[result.status] + 1,
    }),
    { ok: 0, 'needs-init': 0, missing: 0 },
  );

  return [
    ...lines,
    '',
    `Summary: OK=${summary.ok} NEED_INIT=${summary['needs-init']} MISSING=${summary.missing}`,
    'No projects were modified. Run git init manually only after explicit approval.',
  ].join('\n');
}

function parseArgs(args) {
  return args.reduce(
    (state, arg, index) => {
      if (state.skipNext) {
        return { ...state, skipNext: false };
      }
      if (arg === '--json') {
        return { ...state, json: true };
      }
      if (arg === '--active-projects') {
        return { ...state, paths: [...state.paths, ...ACTIVE_PROJECTS] };
      }
      if (arg === '--path') {
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
          throw new Error('--path requires a project path');
        }
        return { ...state, paths: [...state.paths, value], skipNext: true };
      }
      if (arg === '--help' || arg === '-h') {
        return { ...state, help: true };
      }
      throw new Error(`Unknown argument: ${arg}`);
    },
    { json: false, paths: [], help: false, skipNext: false },
  );
}

function usage() {
  return [
    'Usage: node audit/S11_pipeline_top1/git-project-audit.js [options]',
    '',
    'Options:',
    '  --path <path>        Audit one project path. Can be repeated.',
    '  --active-projects   Audit the S11 active project list.',
    '  --json              Print machine-readable JSON.',
    '  -h, --help          Show this help.',
    '',
    'Default: audits the current working directory only.',
  ].join('\n');
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const targetPaths = parsed.paths.length > 0 ? parsed.paths : [process.cwd()];
    const results = auditProjects(targetPaths);
    const output = parsed.json ? JSON.stringify(results, null, 2) : formatTextReport(results);
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`git-project-audit failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ACTIVE_PROJECTS,
  auditProjects,
  formatTextReport,
  parseArgs,
};
