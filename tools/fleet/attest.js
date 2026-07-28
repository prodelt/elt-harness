'use strict';
// attest.js — механический контроль галлюцинаций воркера (009 T009, 0 LLM-вызовов).
// Воркер обязан закончить ответ JSON-заявкой {"filesChanged":[…],"testsAdded":[…]}.
// Заявку сверяем с РЕАЛЬНЫМ диффом worktree ДО судьи: расхождение — не «плохой код»,
// а несоответствие отчёта работе, и тратить на него LLM-вызов судьи незачем.
//   нет JSON вовсе                        → no-attestation
//   заявка непустая, дифф пуст            → phantom-work
//   заявленный файл не менялся            → hallucinated-file
//   изменённый файл не заявлен            → undeclared-file
const { execFileSync } = require('node:child_process');

// Рантайм-артефакты самого харнесса — не работа воркера и не могут быть в его заявке:
// оракул пишет .harness/oracle-tail.log (T005) прямо в worktree, fleet — свои логи и
// .fleet-wt/. Без этого фильтра undeclared-file ловил бы каждый живой слайс.
const RUNTIME = [/^\.harness\//, /^\.fleet-wt\//];
const isRuntime = (p) => RUNTIME.some((re) => re.test(p));

function norm(p) {
  return String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

// Контракт — «ЗАКОНЧИТЬ ответ заявкой», поэтому ищем её только в хвосте вывода: заявка
// из середины транскрипта (эхо промпта у codex, рассуждения вслух) не считается. Хвост,
// а не строго последняя строка — живые CLI дописывают после ответа служебные строки
// (стоимость, токены, «Done in 3m»), и требовать буквально последний символ значило бы
// резать честных воркеров.
const TAIL_LINES = 15;
function tailOf(text) {
  const lines = String(text).split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join('\n');
}

// Баланс скобок, а не построчный JSON.parse: живой агент печатает заявку pretty-printed
// на несколько строк. Последнее вхождение — на случай двух заявок в хвосте.
// ponytail: скобки внутри строковых значений сломали бы баланс — в путях их не бывает;
// понадобится — брать полноценный сканер строк.
function extractJson(text) {
  const at = text.lastIndexOf('"filesChanged"');
  if (at < 0) return null;
  const start = text.lastIndexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseAttestation(text) {
  if (!text) return null;
  const raw = extractJson(tailOf(text));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    // Оба поля обязательны: половина контракта — не заявка. Пустой testsAdded легален
    // (слайс без новых тестов), отсутствующий — нет.
    if (!Array.isArray(o.filesChanged) || !Array.isArray(o.testsAdded)) return null;
    return {
      filesChanged: o.filesChanged.map(norm).filter(Boolean),
      testsAdded: o.testsAdded.map(norm).filter(Boolean),
    };
  } catch { return null; }
}

// Реальный дифф слайса — ровно то, что увидит судья: правки от базы (merge-base с
// интеграционной), а не только незакоммиченные. Воркеры вроде agy коммитят сами (T028,
// gate.normalizeWorktree это потом разкоммичивает) — по одному `git status` их работа
// выглядела бы пустой и честная заявка ловила бы phantom-work.
// -uall обязателен: иначе неотслеживаемые файлы схлопываются в строку каталога и любой
// новый файл читался бы как undeclared-file.
function changedFiles(cwd, integration = null) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  const files = new Set();
  // -z обязателен: без него git экранирует не-ASCII пути ("tools/\320\272.js") и честная
  // заявка на файл с кириллицей читалась бы как hallucinated-file. NUL-формат отдаёт путь
  // как есть. В status -z переименование = ДВЕ записи подряд: сначала новый путь, следом
  // старый — второй пропускаем.
  const recs = git(['status', '--porcelain', '-uall', '-z']).split('\0').filter(Boolean);
  for (let i = 0; i < recs.length; i++) {
    const xy = recs[i].slice(0, 2);
    files.add(norm(recs[i].slice(3)));
    if (xy[0] === 'R' || xy[0] === 'C') i++; // следующая запись — исходный путь
  }
  if (integration) {
    try {
      const base = git(['merge-base', 'HEAD', integration]).trim();
      if (base) for (const p of git(['diff', '--name-only', '-z', base]).split('\0')) { if (p) files.add(norm(p)); }
    } catch { /* нет такой ветки/базы — остаёмся на status */ }
  }
  return [...files].filter((p) => p && !isRuntime(p));
}

function attest({ stdout, cwd = process.cwd(), integration = null, changed = null }) {
  const actual = changed ? changed.map(norm) : changedFiles(cwd, integration);
  const claim = parseAttestation(stdout);
  const fail = (code, detail = []) => ({ ok: false, code, detail, claim, actual });

  if (!claim) return fail('no-attestation');
  if (!actual.length && claim.filesChanged.length) return fail('phantom-work', claim.filesChanged);
  // Заявленные тесты — тоже заявка о файлах: несуществующий тест-файл это та же галлюцинация.
  const claimed = [...new Set([...claim.filesChanged, ...claim.testsAdded])];
  const hallucinated = claimed.filter((f) => !actual.includes(f));
  if (hallucinated.length) return fail('hallucinated-file', hallucinated);
  const undeclared = actual.filter((f) => !claim.filesChanged.includes(f));
  if (undeclared.length) return fail('undeclared-file', undeclared);
  return { ok: true, code: null, detail: [], claim, actual };
}

module.exports = { attest, parseAttestation, changedFiles };
