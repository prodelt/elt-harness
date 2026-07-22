'use strict';
// exec.js — асинхронный аналог spawnSync для долгих дочерних процессов оркестратора.
//
// Зачем (живой прогон 007, 2026-07-22): gate.js и merge.js гоняли оракул через spawnSync
// (~96с). spawnSync блокирует ВЕСЬ event loop node: пока крутится оракул одного слайса —
//  - setTimeout(timeoutMs) воркеров не срабатывает (воркер не убивается в свой лимит);
//  - setInterval поллинга .harness/STOP не тикает (STOP игнорится до конца оракула);
//  - child.on('close') остальных воркеров копится необработанным (слайсы «висят»
//    в implementing, хотя дети давно мертвы);
//  - гейты внутри Promise.all де-факто идут ПОСЛЕДОВАТЕЛЬНО — параллельность fleet
//    съедается на самом дорогом шаге.
// Наблюдение, которое это доказало: логи всех трёх воркеров дописались в одну секунду —
// ровно когда завершился spawnSync-оракул соседнего слайса.
const { spawn } = require('node:child_process');

// Возвращает ту же форму, что spawnSync({encoding:'utf8'}): {status, stdout, stderr}.
// status=null — процесс не стартовал/убит сигналом (как у spawnSync).
function run(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return resolve({ status: null, stdout: '', stderr: String(e.message || e) });
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (e) => resolve({ status: null, stdout, stderr: stderr + String(e.message || e) }));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

module.exports = { run };
