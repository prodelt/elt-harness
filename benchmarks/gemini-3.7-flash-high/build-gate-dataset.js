#!/usr/bin/env node
'use strict';
// Deterministic dataset builder (spec 021 T002). Two kinds:
//   polyglot-writer  — selects N tasks from a local Aider-AI/polyglot-benchmark clone
//                       for the writer plain-vs-elt experiment.
//   swebench-gate     — selects a repo-balanced sample of N instances from a local
//                       SWE-bench-style instances.jsonl for the bare-vs-judgeDiff gate
//                       experiment, and synthesizes one deterministic "broken" patch
//                       per instance (adversarial negative — see stripLastHunk below).
// "Deterministic" here means: same inputs (repo/instances path, count, seed) always
// produce byte-identical dataset.json — regenerating it is a way to VERIFY a locked
// preregistration seed, not a source of fresh randomness. See runner.test.js for the
// discriminating regressions.

const fs = require('fs');
const path = require('path');
const { sha256, seededShuffle } = require('./runner.js');

function toSnake(id) {
  return id.replace(/-/g, '_');
}

// Selects `count` tasks under <repoDir>/<lang>/exercises/practice/*, each with a stub
// file (<snake>.<ext>) and a test file (<snake>_test.<ext>) present — anything missing
// either is skipped, not silently zero-filled, so a partial clone fails loudly instead
// of shrinking the dataset without saying so.
function selectPolyglotTasks({ repoDir, lang = 'python', ext = 'py', count, seed }) {
  const practiceDir = path.join(repoDir, lang, 'exercises', 'practice');
  const candidates = fs
    .readdirSync(practiceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const eligible = [];
  for (const id of candidates) {
    const snake = toSnake(id);
    const file = `${snake}.${ext}`;
    const testFile = `${snake}_test.${ext}`;
    const dir = path.join(practiceDir, id);
    const filePath = path.join(dir, file);
    const testPath = path.join(dir, testFile);
    if (!fs.existsSync(filePath) || !fs.existsSync(testPath)) continue;
    const stub = fs.readFileSync(filePath, 'utf8');
    const test = fs.readFileSync(testPath, 'utf8');
    eligible.push({ id, file, testFile, stub, test, stubSha256: sha256(stub), testSha256: sha256(test) });
  }
  const picked = seededShuffle(eligible, seed).slice(0, count);
  if (picked.length < count) {
    throw new Error(`только ${picked.length}/${count} задач найдено в ${practiceDir} (${lang}/${ext})`);
  }
  return picked.sort((a, b) => a.id.localeCompare(b.id));
}

// Drops the LAST hunk of the LAST per-file section of a unified diff — a mechanical,
// deterministic stand-in for "an agent that stopped one hunk early". If the patch has
// only one hunk total, the whole file section is dropped instead (still a plausible-
// looking but incomplete patch, never a silent no-op).
function stripLastHunk(unifiedDiff) {
  const fileBoundary = /^diff --git /m;
  const sections = unifiedDiff.split(fileBoundary).filter(Boolean);
  if (sections.length === 0) return unifiedDiff;
  const prefix = unifiedDiff.startsWith('diff --git') ? 'diff --git ' : '';
  const last = prefix + sections[sections.length - 1];
  const hunkBoundary = /^@@/m;
  const hunkParts = last.split(hunkBoundary);
  let rebuiltLast;
  if (hunkParts.length <= 2) {
    rebuiltLast = null; // only one hunk (or none) in this file section -> drop the whole section
  } else {
    rebuiltLast = hunkParts.slice(0, -1).join('@@');
  }
  const rebuiltSections = sections.slice(0, -1).map((s) => prefix + s);
  if (rebuiltLast !== null) rebuiltSections.push(rebuiltLast);
  return rebuiltSections.join('');
}

function selectSweBenchInstances({ instances, count, seed }) {
  const byRepo = new Map();
  for (const inst of instances) {
    if (!inst.instance_id || !inst.repo || !inst.patch) continue;
    if (!byRepo.has(inst.repo)) byRepo.set(inst.repo, []);
    byRepo.get(inst.repo).push(inst);
  }
  // Balance across repos: seed-shuffle each repo's bucket, then round-robin draw so no
  // single repo can dominate the sample just because it has more upstream instances.
  const repoOrder = seededShuffle([...byRepo.keys()], seed);
  const buckets = repoOrder.map((repo) => seededShuffle(byRepo.get(repo), `${seed}:${repo}`));
  const picked = [];
  let round = 0;
  while (picked.length < count) {
    let addedThisRound = false;
    for (const bucket of buckets) {
      if (round < bucket.length) {
        picked.push(bucket[round]);
        addedThisRound = true;
        if (picked.length === count) break;
      }
    }
    round += 1;
    if (!addedThisRound) break; // exhausted every bucket
  }
  if (picked.length < count) {
    throw new Error(`только ${picked.length}/${count} инстансов набрано из ${byRepo.size} репо`);
  }
  return picked
    .map((inst) => {
      const goldPatch = inst.patch;
      const brokenPatch = stripLastHunk(goldPatch);
      return {
        id: inst.instance_id,
        repo: inst.repo,
        baseCommit: inst.base_commit,
        goldPatch,
        brokenPatch,
        goldPatchSha256: sha256(goldPatch),
        brokenPatchSha256: sha256(brokenPatch),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseArgs(argv) {
  const out = { count: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kind') out.kind = argv[++i];
    else if (a === '--repo') out.repo = argv[++i];
    else if (a === '--lang') out.lang = argv[++i];
    else if (a === '--ext') out.ext = argv[++i];
    else if (a === '--instances') out.instances = argv[++i];
    else if (a === '--count') out.count = Number(argv[++i]);
    else if (a === '--seed') out.seed = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else return { error: `unknown flag: ${a}` };
  }
  if (!out.kind || !out.seed || !out.out) return { error: '--kind, --seed и --out обязательны' };
  if (out.kind === 'polyglot-writer' && !out.repo) return { error: '--repo обязателен для polyglot-writer' };
  if (out.kind === 'swebench-gate' && !out.instances) return { error: '--instances обязателен для swebench-gate' };
  return out;
}

function build(args) {
  let items;
  if (args.kind === 'polyglot-writer') {
    items = selectPolyglotTasks({ repoDir: args.repo, lang: args.lang, ext: args.ext, count: args.count, seed: args.seed });
  } else if (args.kind === 'swebench-gate') {
    const instances = fs
      .readFileSync(args.instances, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    items = selectSweBenchInstances({ instances, count: args.count, seed: args.seed });
  } else {
    throw new Error(`unknown kind: ${args.kind}`);
  }
  const dataset = { schema: 'elt-benchmark-dataset/v1', kind: args.kind, seed: args.seed, count: items.length, items };
  dataset.datasetSha256 = sha256(JSON.stringify(items));
  return dataset;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`build-gate-dataset: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  const dataset = build(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(dataset, null, 2), 'utf8');
  console.log(`build-gate-dataset: ${dataset.items.length} items (${args.kind}) -> ${args.out} (sha256 ${dataset.datasetSha256.slice(0, 12)}...)`);
}

module.exports = { toSnake, selectPolyglotTasks, stripLastHunk, selectSweBenchInstances, parseArgs, build };

if (require.main === module) main(process.argv.slice(2));
