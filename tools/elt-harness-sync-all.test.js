'use strict';
// 016 T008 — дифф схемы v4 и его применение. Фикстурный реестр, не живой: тест не должен
// зависеть от того, что сейчас стоит у 12 реальных проектов.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { scan, drift, applyTo, format, V4 } = require('./elt-harness-sync-all');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

function fixture(configs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-syncall-'));
  roots.push(root);
  const projects = {};
  for (const [key, cfg] of Object.entries(configs)) {
    const p = path.join(root, key);
    fs.mkdirSync(path.join(p, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(p, '.harness', 'harness.json'), JSON.stringify(cfg, null, 2));
    projects[key] = { path: p };
  }
  const reg = path.join(root, 'registry.json');
  fs.writeFileSync(reg, JSON.stringify({ projects }));
  return reg;
}

test('drift: проект по схеме даёт пустой список', () => {
  assert.deepEqual(drift({ verify: 'background', oracleSelect: 'impact', background: { layers: V4.background.layers } }), []);
});

test('drift: старый конфиг даёт три добавления и удаление мёртвого judge.verify', () => {
  const items = drift({ judge: { enabled: true, verify: { provider: 'codex' } } });
  const fields = items.map((i) => i.field).sort();
  assert.deepEqual(fields, ['background.layers', 'judge.verify', 'oracleSelect', 'verify']);
  assert.equal(items.find((i) => i.field === 'judge.verify').dead, true);
});

test('apply: поля v4 появляются, мёртвое исчезает, чужие поля не тронуты', () => {
  const reg = fixture({ old: { kind: 'code', oracle: 'npm test', judge: { enabled: true, model: 'sonnet', verify: {} } } });
  const [entry] = scan({ registry: reg });
  applyTo(entry);
  const after_ = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
  assert.equal(after_.verify, 'background');
  assert.equal(after_.oracleSelect, 'impact');
  assert.deepEqual(after_.background.layers, V4.background.layers);
  assert.equal('verify' in after_.judge, false);
  assert.equal(after_.oracle, 'npm test');           // конфиг проекта не переписан
  assert.equal(after_.judge.model, 'sonnet');
  assert.deepEqual(drift(after_), []);               // повторный прогон идемпотентен
});

test('format: считает расходящиеся проекты', () => {
  const reg = fixture({
    a: { oracle: 'x' },
    b: { oracle: 'y', verify: 'background', oracleSelect: 'impact', background: { layers: V4.background.layers } },
  });
  const out = format(scan({ registry: reg }));
  assert.match(out, /2 проектов, расходятся со схемой 1/);
});
