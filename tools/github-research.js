#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

function usage() {
  return [
    'Usage: node tools/github-research.js "query" [--limit N] [--json]',
    'Example: node tools/github-research.js "claude code hooks" --limit 5',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { query: [], limit: 5, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--limit') args.limit = Number(argv[++i] || 5);
    else args.query.push(arg);
  }
  return { query: args.query.join(' ').trim(), limit: args.limit, json: args.json };
}

function runGhSearch(query, limit) {
  const result = spawnSync('gh', [
    'search', 'repos', query,
    '--limit', String(limit),
    '--json', 'fullName,description,stargazersCount,updatedAt,url',
  ], { encoding: 'utf8', timeout: 30000 });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'gh search failed').trim());
  }
  return JSON.parse(result.stdout || '[]');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.query) {
    process.stderr.write(usage() + '\n');
    process.exit(2);
  }

  let repos;
  try {
    repos = runGhSearch(args.query, args.limit);
  } catch (error) {
    process.stderr.write('GitHub research failed: ' + error.message + '\n');
    process.exit(1);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ query: args.query, repos }, null, 2) + '\n');
    return;
  }

  process.stdout.write(`GitHub research: "${args.query}" (${repos.length} repos)\n\n`);
  repos.forEach((repo, index) => {
    process.stdout.write(
      `${index + 1}. ${repo.fullName} stars=${repo.stargazersCount} updated=${repo.updatedAt}\n` +
      `   ${repo.description || ''}\n` +
      `   ${repo.url}\n`
    );
  });
}

main();
