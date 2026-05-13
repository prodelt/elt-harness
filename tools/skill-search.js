#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const rankerPath = path.join(os.homedir(), '.claude', 'hooks', 'skill-ranker.js');
const digestPath = path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl');
const historyPath = path.join(os.homedir(), '.claude', 'skill-registry', 'history.jsonl');

function usage() {
  return [
    'Usage: node tools/skill-search.js "query" [--top N] [--json]',
    '       tools/skill.cmd "query"',
    '       bash tools/skill.sh "query"',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { query: [], top: 8, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--top') args.top = Number(argv[++i] || 8);
    else args.query.push(arg);
  }
  return { query: args.query.join(' ').trim(), top: args.top, json: args.json };
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.query) {
    process.stderr.write(usage() + '\n');
    process.exit(2);
  }
  if (!fs.existsSync(rankerPath)) {
    process.stderr.write('Missing skill ranker: ' + rankerPath + '\n');
    process.exit(1);
  }
  if (!fs.existsSync(digestPath)) {
    process.stderr.write('Missing skill registry: ' + digestPath + '\n');
    process.exit(1);
  }

  const ranker = require(rankerPath);
  const digests = loadJsonl(digestPath);
  const history = loadJsonl(historyPath);
  const ranked = ranker.rankSkills(digests, args.query, history, {}).slice(0, args.top);

  if (args.json) {
    process.stdout.write(JSON.stringify({ query: args.query, total: digests.length, ranked }, null, 2) + '\n');
    return;
  }

  process.stdout.write(`Query: "${args.query}" (${digests.length} skills, top ${ranked.length})\n\n`);
  ranked.forEach((skill, index) => {
    process.stdout.write(
      `${index + 1}. ${skill.name} score=${skill.score} risk=${skill.risk_level || 'low'} tokens~${skill.token_estimate || '?'}\n`
    );
  });
}

main();
