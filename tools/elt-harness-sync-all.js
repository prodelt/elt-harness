#!/usr/bin/env node
'use strict';
// 016 T008 — раскатка схемы v4 по реестру проектов.
//
// Основание (аудит 2026-08-11, раздел 6): v4 доехал до 4 из 14 проектов, `oracleSelect: impact`
// стоит ровно в одном (это тот рычаг, что дал 150 c → 1,6 c на выборке оракула), а три проекта
// носят мёртвое поле `judge.verify`, которое runtime игнорирует. Дрейф не виден никому, потому
// что смотреть его можно было только руками по 14 путям.
//
// Дверь узкая намеренно: правятся ровно четыре поля схемы v4 и удаляется одно мёртвое. Остальной
// конфиг проекта (oracle, smoke, judge, branchPolicy) не трогается — он про проект, не про схему.
const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY = path.join(os.homedir(), '.claude', 'projects-registry.json');
// ponytail: значения по умолчанию сидят здесь, а не в конфиге — их ровно один набор на все
// проекты. Понадобится второй профиль — тогда и выносить.
const V4 = {
  verify: 'background',
  oracleSelect: 'impact',
  background: { layers: ['suite', 'mutate', 'smoke', 'judge'] },
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function projectPaths(registryFile = REGISTRY) {
  const reg = readJson(registryFile);
  const projects = (reg && reg.projects) || {};
  return Object.entries(projects)
    .map(([key, p]) => ({ key, path: typeof p === 'string' ? p : (p && p.path) }))
    .filter((p) => p.path && !p.archived && fs.existsSync(path.join(p.path, '.harness', 'harness.json')));
}

// Что именно разошлось с текущей схемой. Пустой массив = проект в норме.
function drift(cfg) {
  const out = [];
  if (cfg.verify !== V4.verify) out.push({ field: 'verify', from: cfg.verify, to: V4.verify });
  if (cfg.oracleSelect !== V4.oracleSelect) out.push({ field: 'oracleSelect', from: cfg.oracleSelect, to: V4.oracleSelect });
  if (!cfg.background || !Array.isArray(cfg.background.layers) || !cfg.background.layers.length) {
    out.push({ field: 'background.layers', from: cfg.background && cfg.background.layers, to: V4.background.layers });
  }
  // Мёртвое поле: runtime его игнорирует с 011, а конфиг обещает второго судью, которого нет.
  if (cfg.judge && Object.prototype.hasOwnProperty.call(cfg.judge, 'verify')) {
    out.push({ field: 'judge.verify', from: cfg.judge.verify, to: undefined, dead: true });
  }
  return out;
}

function applyDrift(cfg, items) {
  const next = JSON.parse(JSON.stringify(cfg));
  for (const it of items) {
    if (it.field === 'verify') next.verify = V4.verify;
    else if (it.field === 'oracleSelect') next.oracleSelect = V4.oracleSelect;
    else if (it.field === 'background.layers') next.background = { ...(next.background || {}), layers: V4.background.layers };
    else if (it.field === 'judge.verify') delete next.judge.verify;
  }
  return next;
}

function scan(options = {}) {
  return projectPaths(options.registry || REGISTRY).map((p) => {
    const file = path.join(p.path, '.harness', 'harness.json');
    const cfg = readJson(file);
    if (!cfg) return { ...p, file, error: 'harness.json не читается как JSON', items: [] };
    return { ...p, file, cfg, items: drift(cfg) };
  });
}

// Запись атомарна по одному проекту: конфиг харнеса — единственный источник правды гейта,
// и полузаписанный файл заблокировал бы проект целиком.
function applyTo(entry) {
  const next = applyDrift(entry.cfg, entry.items);
  const tmp = `${entry.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, entry.file);
  return next;
}

function format(entries) {
  const lines = [];
  let dirty = 0;
  for (const e of entries) {
    if (e.error) { lines.push(`  ✗ ${e.key}: ${e.error}`); continue; }
    if (!e.items.length) { lines.push(`  = ${e.key}: по схеме`); continue; }
    dirty += 1;
    lines.push(`  ~ ${e.key}  (${e.path})`);
    for (const it of e.items) {
      lines.push(it.dead
        ? `      − ${it.field}: ${JSON.stringify(it.from)} → удалить (runtime игнорирует)`
        : `      + ${it.field}: ${JSON.stringify(it.from)} → ${JSON.stringify(it.to)}`);
    }
  }
  lines.unshift(`elt harness sync-all: ${entries.length} проектов, расходятся со схемой ${dirty}`);
  return lines.join('\n');
}

module.exports = { scan, drift, applyDrift, applyTo, format, projectPaths, V4, REGISTRY };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const entries = scan({ registry: at('--registry') || REGISTRY });
  const only = at('--project');
  const target = only ? entries.filter((e) => e.key === only || e.path === only) : entries;
  if (only && !target.length) { console.error(`elt harness sync-all: проект ${only} не найден среди ${entries.length}`); process.exit(4); }

  console.log(format(target));
  // --dry-run по умолчанию: раскатка по 12 чужим репозиториям без явного согласия — ровно тот
  // класс действий, который должен требовать подтверждения.
  if (!argv.includes('--apply')) {
    console.log('\n(dry-run; применить: --apply --project <key>, или --apply --all для всех)');
    process.exit(0);
  }
  if (!only && !argv.includes('--all')) {
    console.error('elt harness sync-all: --apply без --project требует явного --all');
    process.exit(4);
  }
  let n = 0;
  for (const e of target) {
    if (e.error || !e.items.length) continue;
    applyTo(e);
    n += 1;
    console.log(`  ✓ ${e.key}: применено ${e.items.length} правк(и)`);
  }
  console.log(`elt harness sync-all: обновлено проектов ${n}`);
}
