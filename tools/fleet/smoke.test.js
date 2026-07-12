'use strict';
// Smoke-тест fleet-модуля: подтверждает, что node --test tools/fleet/ находит и гоняет
// тесты этой директории. Реальные модули (providers/worktree/plan/claims/gate/merge/
// router/fleet) добавляют свои *.test.js рядом по мере слайсов 002-elt-fleet.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('fleet smoke: тест-раннер подключён к tools/fleet/', () => {
  assert.ok(fs.existsSync(path.join(__dirname, 'smoke.test.js')));
});
