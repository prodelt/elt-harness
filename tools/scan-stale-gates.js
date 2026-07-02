#!/usr/bin/env node
// scan-stale-gates.js — find "mines": a stale, non-closed pipeline-state.json
// that would falsely arm the judge-closeout gate on the next "done" (the bug
// that spammed the non-code Itstep_AI project on 2026-06-25).
//
//   node tools/scan-stale-gates.js [--root "<proj>"] [--fix]
//
// Mirrors the gate's own suppression rule (judge-closeout-gate.js isStale):
// gated complexity + non-closed phase + ts older than 24h, in a repo where the
// gate is actually wired. Default = report only. --fix closes them
// (phase -> "closed"). No --root => scan every project on the machine.
// ponytail: plain fs scan over ~/.claude/projects, no projectKey hashing — the
// stored `cwd` field is the source of truth.

const fs = require('fs');
const path = require('path');
const os = require('os');

const GATED = new Set(['MEDIUM', 'BUG', 'ARCH', 'COMPLEX']);
const CLOSED = new Set(['closed', 'shipped']);
const STALE_MS = 24 * 60 * 60 * 1000;
const BASE = path.join(os.homedir(), '.claude', 'projects');

// A mine = a state that would arm the gate but points at abandoned work.
function isMine(st) {
  if (!st || !st.cwd) return false;
  if (!GATED.has(st.complexity)) return false;
  if (CLOSED.has(st.phase)) return false;
  const ageMs = Date.now() - Date.parse(st.ts);
  return Number.isFinite(ageMs) && ageMs > STALE_MS;
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

function selfCheck() {
  const assert = require('assert');
  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(isMine({ cwd: 'x', complexity: 'MEDIUM', phase: 'implementing', ts: old }), true, 'stale non-closed gated = mine');
  assert.strictEqual(isMine({ cwd: 'x', complexity: 'MEDIUM', phase: 'implementing', ts: fresh }), false, 'fresh task is not a mine');
  assert.strictEqual(isMine({ cwd: 'x', complexity: 'MEDIUM', phase: 'closed', ts: old }), false, 'closed is not a mine');
  assert.strictEqual(isMine({ cwd: 'x', complexity: 'TRIVIAL', phase: 'implementing', ts: old }), false, 'non-gated complexity is not a mine');
  assert.strictEqual(isMine({ complexity: 'MEDIUM', phase: 'implementing', ts: old }), false, 'no cwd is not a mine');
  console.log('scan-stale-gates self-check: ok');
}

function main() {
  const fix = process.argv.includes('--fix');
  const rootArg = arg('--root');
  const wantRoot = rootArg ? norm(rootArg) : null;

  let keys;
  try { keys = fs.readdirSync(BASE); } catch { console.error('no ~/.claude/projects'); process.exit(0); }

  const mines = [];
  for (const k of keys) {
    const f = path.join(BASE, k, 'pipeline-state.json');
    let st;
    try { st = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { continue; }
    if (!st.cwd) continue;
    if (wantRoot && norm(st.cwd) !== wantRoot) continue;
    // only a real mine if the gate is actually installed in that repo
    let gateInstalled;
    try { gateInstalled = fs.existsSync(path.join(st.cwd, '.claude', 'hooks', 'judge-closeout-gate.js')); } catch { gateInstalled = false; }
    if (!gateInstalled) continue;
    if (!isMine(st)) continue;
    mines.push({ f, cwd: st.cwd, st, ageD: Math.round((Date.now() - Date.parse(st.ts)) / 86400000) });
  }

  if (!mines.length) {
    console.log(rootArg ? `no stale gate mines in ${rootArg}` : 'no stale gate mines found');
    return;
  }

  console.log(`${mines.length} stale gate mine(s)${fix ? ' — closing' : ''}:`);
  for (const m of mines) {
    console.log(`  ${m.st.complexity}/${m.st.phase}  ${m.ageD}d old  ${m.cwd}`);
    if (fix) {
      m.st.phase = 'closed';
      m.st.staleClosedBy = 'scan-stale-gates';
      try { fs.writeFileSync(m.f, JSON.stringify(m.st, null, 2) + '\n'); }
      catch (e) { console.error(`   ! could not fix ${m.f}: ${e.message}`); }
    }
  }
  if (!fix) console.log('run with --fix to close them (phase -> closed); the gate also auto-skips them now.');
}

if (process.argv.includes('--self-check')) selfCheck();
else main();
