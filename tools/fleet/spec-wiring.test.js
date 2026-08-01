// Живой прогон 011/T019 (01.08): fleet звал `elt commit` без --spec, автодетект по tid ушёл
// в specs/003 (T019 есть в ПЯТИ спеках) и уронил стадию commit — 17 минут работы воркера в
// мусор, причина в events.jsonl не записана. Тест держит обе половины починки.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const gate = require('./gate');

test('specArgsFor: путь к tasks.md → флаг --spec с ПАПКОЙ спеки', () => {
  // path.dirname сохраняет разделители входа — fleet отдаёт tasksPath как пришёл из CLI.
  assert.deepEqual(gate.specArgsFor('specs/011-elt-v3-gate/tasks.md'), ['--spec', 'specs/011-elt-v3-gate']);
  assert.deepEqual(gate.specArgsFor(null), [], 'без specFile флага быть не должно (старое поведение)');
});

test('findSpecDir: одинаковый tid в двух спеках — specFile решает, автодетект берёт первую', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-collide-'));
  for (const [dir, mark] of [['003-fleet', 'X'], ['011-gate', ' ']]) {
    fs.mkdirSync(path.join(root, 'specs', dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'specs', dir, 'tasks.md'), `- [${mark}] **T019** слайс\n`);
  }
  assert.equal(path.basename(gate.findSpecDir(root, 'T019')), '003-fleet', 'автодетект берёт первую по обходу — это и был баг');
  assert.equal(
    path.basename(gate.findSpecDir(root, 'T019', path.join(root, 'specs', '011-gate', 'tasks.md'))),
    '011-gate', 'явный specFile обязан побеждать автодетект',
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('fleet: все вызовы gate.gate несут specFile, а gate-reject несёт причину', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fleet.js'), 'utf8');
  const calls = src.match(/gate\.gate\(\{[^}]*\}\)/g) || [];
  assert.ok(calls.length >= 3, `ожидалось ≥3 вызовов gate.gate, найдено ${calls.length}`);
  for (const c of calls) assert.match(c, /specFile:\s*tasksPath/, `вызов без specFile: ${c.slice(0, 80)}`);
  assert.match(src, /event: g\.ok \? 'gate-pass' : 'gate-reject'[^;]*err:/, 'gate-reject снова слепой — нет err');
});
