'use strict';
// claims.js — кто какой слайс взял (T006). Файл-claim на слайс в .harness/fleet/claims/
// <Tid>.json = {tid, pid, worker, ts}. Живой pid держит слайс; мёртвый (упавший воркер) =
// stale → перехватывается. Основа resume: после падения fleet добирает по stale-claims.
const fs = require('node:fs');
const path = require('node:path');

function claimsDir(cwd) {
  const d = path.join(cwd, '.harness', 'fleet', 'claims');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function claimPath(cwd, tid) { return path.join(claimsDir(cwd), tid + '.json'); }

function readClaim(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Жив ли процесс. kill(pid,0) не шлёт сигнал, только проверяет существование.
// EPERM = существует, но чужой (жив). ESRCH = нет процесса (мёртв).
function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// Взять слайс. Успех, если свободен ИЛИ держащий pid мёртв (stale) ИЛИ это мы сами.
// Занят живым чужим воркером → {ok:false, heldBy}. ponytail: TOCTOU-окно есть, но fleet
// одномашинный с код-оркестратором — гонка практически исключена; distributed = вне scope.
function claim(tid, { cwd = process.cwd(), pid = process.pid, worker = null, meta = {} } = {}) {
  const p = claimPath(cwd, tid);
  const rec = { tid, pid, worker, ts: new Date().toISOString(), ...meta };
  try {
    const fd = fs.openSync(p, 'wx'); // эксклюзивно: падает EEXIST, если claim уже есть
    fs.writeSync(fd, JSON.stringify(rec));
    fs.closeSync(fd);
    return { ok: true, claim: rec };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const existing = readClaim(p);
    if (existing && existing.pid !== pid && isAlive(existing.pid)) {
      return { ok: false, heldBy: existing };
    }
    fs.writeFileSync(p, JSON.stringify(rec)); // stale/битый/наш → перехват
    return { ok: true, claim: rec, stolen: existing || null };
  }
}

function release(tid, { cwd = process.cwd() } = {}) {
  fs.rmSync(claimPath(cwd, tid), { force: true });
}

// Все claim'ы с пометкой stale (держащий pid мёртв).
function list({ cwd = process.cwd() } = {}) {
  const dir = claimsDir(cwd);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readClaim(path.join(dir, f)))
    .filter(Boolean)
    .map((rec) => ({ ...rec, stale: !isAlive(rec.pid) }));
}

function stale({ cwd = process.cwd() } = {}) {
  return list({ cwd }).filter((c) => c.stale);
}

// Убрать stale-claim'ы (брошенные упавшими воркерами). Возвращает снятые tid.
function sweep({ cwd = process.cwd() } = {}) {
  const dead = stale({ cwd });
  for (const c of dead) release(c.tid, { cwd });
  return dead.map((c) => c.tid);
}

module.exports = { claim, release, list, stale, sweep, isAlive, claimPath };
