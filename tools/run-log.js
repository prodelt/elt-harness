'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function gitDir(cwd) {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const dir = (result.stdout || '').trim();
  return dir ? (path.isAbsolute(dir) ? dir : path.join(cwd, dir)) : null;
}

function lineCount(body) {
  return body.split(/\r?\n/).filter(Boolean).length;
}

function runtimeRunLog(cwd) {
  const dir = gitDir(cwd);
  if (!dir) return null;
  const runtime = path.join(dir, 'elt', 'run-log.jsonl');
  const legacy = path.join(cwd, '.harness', 'run-log.jsonl');
  if (!fs.existsSync(legacy)) return runtime;

  const legacyBody = fs.readFileSync(legacy, 'utf8');
  const current = fs.existsSync(runtime) ? fs.readFileSync(runtime, 'utf8') : '';
  if (!current.startsWith(legacyBody)) {
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, legacyBody + (legacyBody && current && !legacyBody.endsWith('\n') ? '\n' : '') + current);
  }

  const migrated = fs.readFileSync(runtime, 'utf8');
  if (lineCount(migrated) < lineCount(legacyBody) || !migrated.startsWith(legacyBody)) {
    throw new Error('run-log migration verification failed');
  }
  fs.rmSync(legacy);
  return runtime;
}

// 016 T009 — молчаливый `return null` здесь стоил AWE4 всей истории слайсов: коммиты
// `chore: elt slice` есть, `.git/elt/` нет вовсе, и харнес про работу не знает. Коммит без
// записи в run-log хуже отсутствующего коммита: гейт, brief и ретро-разметка считают срез
// несуществующим. Поэтому невозможность записать — громкая ошибка, а не тихий null.
function appendRunLog(cwd, entry) {
  const file = runtimeRunLog(cwd);
  if (!file) throw new Error(`run-log: не удалось определить git-dir для ${cwd} — запись слайса невозможна`);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    throw new Error(`run-log: запись в ${file} не удалась (${e.code || e.message}) — слайс остался бы невидимым для харнеса`);
  }
  return file;
}

function lastRun(cwd) {
  const file = runtimeRunLog(cwd);
  if (!file) return null;
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  } catch { return null; }
}

module.exports = { appendRunLog, gitDir, lastRun, runtimeRunLog };
