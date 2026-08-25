#!/usr/bin/env node
'use strict';
// bin/doctor.js — 019 T011. Диагностика САМОГО плагина, а не проекта.
//
// Заменяет побайтную сверку `~/.claude/bin` из `tools/doctor-core.js`. Смысл сверки был
// один: убедиться, что развёрнутая копия харнеса не отстала от исходника (дефекты D16, D18 —
// правка есть в `tools/`, нет в копии). У плагина копии нет: установленный каталог И ЕСТЬ
// исходник, поэтому вопрос «отстала ли копия» исчезает, а вместо него остаётся вопрос
// «цело ли замыкание» — на него и отвечает этот файл.
//
// Зелёный в ЧИСТОМ проекте — требование T015: отсутствие `.harness/harness.json` это INFO,
// а не FAIL, иначе плагин нельзя поставить до бутстрапа, а бутстрап нельзя запустить без
// плагина.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');

// Замыкание рантайма плагина: точки входа + модули, которые они требуют. Список ручной и
// короткий намеренно — он должен читаться глазами, как и список владений харнеса (T021).
// 020 T012: точки входа хуков — часть того же замыкания. Хук, который не резолвится, ломает
// не команду, а КАЖДУЮ сессию, и заметить это без загрузки модуля нечем.
const BIN_ENTRIES = ['oracle.js', 'l0.js', 'ledger.js', 'doctor.js', 'session-start.js', 'session-stop.js'];
const SURFACE = [
  'commands/elt-verify.md',
  'commands/elt-defects.md',
  'commands/elt-doctor.md',
  'skills/elt/SKILL.md',
  // 020 T011: скилы поверхности три, а не один. `harness-method` и `project-bootstrap`
  // Claude Code подхватывает из каталога так же, как `elt`, — значит они установлены у
  // каждого, кто поставил плагин, и их пропажа так же ломает поверхность.
  'skills/harness-method/SKILL.md',
  'skills/project-bootstrap/SKILL.md',
  'agents/review-bugs.md',
  'agents/review-claude-md.md',
  'agents/review-code-comments.md',
  'agents/review-history.md',
  'agents/review-prior-comments.md',
  'agents/confidence-scorer.md',
];

// 020 T011. Ниже — три проверки, которые смотрят на ПОВЕДЕНИЕ, а не на наличие файла.
// Причина: «поверхность плагина на месте» это `fs.existsSync` по списку, и она осталась бы
// зелёной, если бы `/elt` вёл в несуществующий файл, если бы фоновой прогон снова начал
// считать любой неучтённый исход зелёным (см. 020 T007) или если бы в `agents/` появился
// файл, о котором манифест не знает. Каждый из трёх классов уже случался.

// События хуков Claude Code. Список закрытый намеренно: опечатка в имени события даёт хук,
// который просто никогда не вызовется, — самый тихий из возможных отказов.
const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification',
  'Stop', 'SubagentStop', 'StopFailure', 'PreCompact', 'SessionStart', 'SessionEnd',
]);

// Каталоги поверхности и то, что в них считается файлом поверхности. Нужны обе стороны
// сверки: объявленного нет на диске И на диске есть необъявленное.
const SURFACE_DIRS = [
  { dir: 'agents', match: (name) => name.endsWith('.md') },
  { dir: 'commands', match: (name) => name.endsWith('.md') },
];

function surfaceOnDisk(root) {
  const found = [];
  for (const { dir, match } of SURFACE_DIRS) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) if (match(name)) found.push(`${dir}/${name}`);
  }
  const skills = path.join(root, 'skills');
  if (fs.existsSync(skills)) {
    for (const name of fs.readdirSync(skills)) {
      if (fs.existsSync(path.join(skills, name, 'SKILL.md'))) found.push(`skills/${name}/SKILL.md`);
    }
  }
  return found.sort();
}

// Ссылки инструкции на файлы репозитория. Глобы и плейсхолдер `NNN-name` — не пути.
// `json` в альтернативе раньше `js`: иначе `cases-ingested.json` обрезается до `.js`.
function referencedFiles(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:tools|bin|agents|commands|skills|specs)\/[A-Za-z0-9._\-/]+\.(?:json|js|md)/g)) {
    if (m[0].includes('*') || m[0].includes('NNN')) continue;
    out.add(m[0]);
  }
  return [...out];
}

function check(name, fn) {
  try {
    const res = fn();
    if (res === true || res === undefined) return { name, status: 'PASS', detail: '' };
    if (res && res.status) return { name, ...res };
    return { name, status: 'PASS', detail: String(res) };
  } catch (error) {
    return { name, status: 'FAIL', detail: error.message };
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));
}

function runDoctor({ root = PLUGIN_ROOT, cwd = process.cwd() } = {}) {
  const checks = [];

  checks.push(check('node >= 18', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`node ${process.versions.node} — плагину нужен 18+`);
    return `node ${process.versions.node}`;
  }));

  checks.push(check('git на PATH', () => {
    const v = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
    return v;
  }));

  let manifest = null;
  checks.push(check('plugin.json', () => {
    manifest = readJson('.claude-plugin/plugin.json');
    if (manifest.name !== 'elt') throw new Error(`name = "${manifest.name}", ожидается "elt"`);
    if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version))) throw new Error(`version = "${manifest.version}" не semver`);
    return `elt ${manifest.version}`;
  }));

  // Дрейф между двумя манифестами — отдельный класс: `claude plugin tag` валит релиз, если
  // версии разошлись, но заметить это ДО релиза больше нечем.
  checks.push(check('marketplace.json согласован с plugin.json', () => {
    const market = readJson('.claude-plugin/marketplace.json');
    const entry = (market.plugins || []).find((p) => p.name === 'elt');
    if (!entry) throw new Error('в marketplace.json нет плагина elt');
    if (manifest && entry.version !== manifest.version) {
      throw new Error(`версии разошлись: plugin.json ${manifest.version}, marketplace.json ${entry.version}`);
    }
    return `marketplace elt ${entry.version}`;
  }));

  checks.push(check('точки входа bin/', () => {
    const missing = BIN_ENTRIES.filter((f) => !fs.existsSync(path.join(root, 'bin', f)));
    if (missing.length) throw new Error(`нет файлов: ${missing.join(', ')}`);
    return `${BIN_ENTRIES.length} шт.`;
  }));

  // Замыкание: каждая точка входа обязана РЕЗОЛВИТЬСЯ целиком. `require` вместо `node --check`
  // намеренно: синтаксис ловит и --check, а вот оборванный `require('./missing')` — только
  // фактическая загрузка. Ровно так ломались deploy-копии (D16).
  checks.push(check('замыкание bin/ резолвится', () => {
    for (const f of BIN_ENTRIES) {
      const full = path.join(root, 'bin', f);
      delete require.cache[require.resolve(full)];
      require(full);
    }
    return `${BIN_ENTRIES.length} модулей загружены`;
  }));

  checks.push(check('поверхность плагина на месте', () => {
    const missing = SURFACE.filter((f) => !fs.existsSync(path.join(root, f)));
    if (missing.length) throw new Error(`нет файлов: ${missing.join(', ')}`);
    return `${SURFACE.length} файлов`;
  }));

  // Обратная сторона той же сверки: файл, лежащий в `agents/` или `commands/`, но не
  // объявленный в SURFACE, — это поверхность, которую никто не диагностирует. Так и появлялись
  // «есть в каталоге, нет в манифесте» расхождения.
  checks.push(check('поверхность объявлена целиком (обе стороны)', () => {
    const disk = surfaceOnDisk(root);
    const declared = new Set(SURFACE);
    const undeclared = disk.filter((f) => !declared.has(f));
    if (undeclared.length) throw new Error(`на диске есть, в манифесте нет: ${undeclared.join(', ')}`);
    return `${disk.length} файлов сверено в обе стороны`;
  }));

  // Замыкание `/elt`: инструкция ссылается на файлы, и markdown никто не компилирует —
  // оборванная ссылка это тупик посреди маршрута, который иначе видно только человеку.
  checks.push(check('/elt: замыкание инструкции', () => {
    const skill = path.join(root, 'skills', 'elt', 'SKILL.md');
    if (!fs.existsSync(skill)) throw new Error('нет skills/elt/SKILL.md — входа /elt не существует');
    const text = fs.readFileSync(skill, 'utf8');
    const refs = referencedFiles(text);
    if (refs.length < 5) throw new Error(`инструкция ссылается всего на ${refs.length} файлов — разбор сломался`);
    const missing = refs.filter((rel) => !fs.existsSync(path.join(root, rel)));
    if (missing.length) throw new Error(`инструкция ведёт в несуществующие файлы: ${missing.join(', ')}`);
    const version = /^version:\s*(\S+)\s*$/m.exec(text);
    if (!version) throw new Error('в frontmatter скила нет version');
    if (manifest && version[1] !== manifest.version) {
      throw new Error(`версии разошлись: plugin.json ${manifest.version}, skills/elt/SKILL.md ${version[1]}`);
    }
    return `${refs.length} ссылок целы, version ${version[1]}`;
  }));

  // Схема терминальных состояний фона. 020 T007 перевернул умолчание: раньше всё, что не
  // помечено красным, автоматически становилось pass. Проверка гоняет сам классификатор на
  // синтетических слоях, а не смотрит на наличие файла: приоритет red > dead > inconclusive
  // это и есть то, что ломается молча.
  checks.push(check('фон: схема терминальных состояний', () => {
    const bg = require(path.join(root, 'tools', 'elt-verify-bg.js'));
    const { BG_TERMINAL, classifyRun } = bg;
    const expected = ['pass', 'red', 'dead', 'inconclusive', 'error'];
    const actual = Object.keys(BG_TERMINAL).sort();
    if (actual.join(',') !== [...expected].sort().join(',')) {
      throw new Error(`исходы разошлись со схемой: ${actual.join(', ')}`);
    }
    for (const [k, v] of Object.entries(BG_TERMINAL)) {
      if (!String(v).startsWith('background-verify-')) throw new Error(`статус ${k} = "${v}" без префикса background-verify- — детектор bg-silent его не найдёт`);
    }
    const cases = [
      [[{}], 'pass'],
      [[{ red: true }, { nonConclusive: true }, { inconclusive: true }], 'red'],
      [[{ nonConclusive: true }, { inconclusive: true }], 'dead'],
      [[{ inconclusive: true }, {}], 'inconclusive'],
    ];
    for (const [sections, want] of cases) {
      const got = classifyRun(sections);
      if (got !== want) throw new Error(`classifyRun(${JSON.stringify(sections)}) = ${got}, ожидается ${want}`);
    }
    return `${expected.length} исходов, приоритет red > dead > inconclusive держится`;
  }));

  // Хуки плагина. 020 T012 сделал проверку предметной: мало «файл разбирается» — хук обязан
  // указывать на СУЩЕСТВУЮЩИЙ файл этого же плагина и не нести абсолютных путей. Оба класса
  // ловились только глазами: markdown и JSON никто не компилирует, а сломанный хук виден лишь
  // на чужой машине и лишь в момент старта сессии.
  checks.push(check('plugin hooks', () => {
    const file = path.join(root, 'hooks', 'hooks.json');
    if (!fs.existsSync(file)) return { status: 'INFO', detail: 'hooks/hooks.json нет — плагин без хуков' };
    const raw = fs.readFileSync(file, 'utf8');
    const absolute = raw.match(/[A-Za-z]:\\\\|"\/(?:home|Users)\//g);
    if (absolute) throw new Error(`в хуках абсолютные пути (${absolute.join(', ')}) — на чужой машине они не разрешатся`);
    if (/\.claude[/\\]bin/.test(raw)) throw new Error('хук ссылается на снятую развёртку ~/.claude/bin (019 T015)');

    const parsed = JSON.parse(raw);
    const events = Object.entries(parsed.hooks || {});
    if (!events.length) throw new Error('в hooks.json нет ни одного события');
    const unknown = events.map(([e]) => e).filter((e) => !HOOK_EVENTS.has(e));
    if (unknown.length) throw new Error(`неизвестные события: ${unknown.join(', ')}`);

    let commands = 0;
    for (const [event, groups] of events) {
      for (const group of groups) {
        for (const hook of group.hooks || []) {
          commands++;
          if (hook.type !== 'command') throw new Error(`${event}: тип хука "${hook.type}" не поддерживается`);
          const target = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(hook.command || '');
          if (!target) throw new Error(`${event}: команда не идёт от \${CLAUDE_PLUGIN_ROOT} — ${hook.command}`);
          if (!fs.existsSync(path.join(root, target[1]))) {
            throw new Error(`${event}: хук ведёт в несуществующий файл ${target[1]}`);
          }
        }
      }
    }
    return `${events.length} событий, ${commands} команд, все цели на месте`;
  }));

  // 020 T022: граф и packs показываются как ready/degraded/unavailable, а не как «файл есть».
  // Разница принципиальная: наличие `graphs/elt-v5.json` ничего не доказывает — граф,
  // который не компилируется, делает нерабочей ВСЮ дверь `elt run`, и узнать об этом на
  // старте сессии лучше, чем на первом переходе.
  checks.push(check('graph: канонический граф компилируется', () => {
    let compiler;
    try { compiler = require(path.join(root, 'tools', 'graph-compiler.js')); }
    catch (e) { return { status: 'FAIL', detail: `graph-compiler недоступен: ${e.message}` }; }
    const r = compiler.compile(compiler.loadCanonicalGraph());
    if (!r.ok) return { status: 'FAIL', detail: `unavailable — ${(r.errors || []).join('; ').slice(0, 200)}` };
    const nodes = Object.keys(r.graph.nodes).length;
    return `ready — graph ${r.graph.graphVersion}, ${nodes} узлов, ${r.graph.edges.length} рёбер`;
  }));

  checks.push(check('graph: журнал прогона', () => {
    let journal;
    try { journal = require(path.join(root, 'tools', 'graph-journal.js')); }
    catch (e) { return { status: 'FAIL', detail: `graph-journal недоступен: ${e.message}` }; }
    const file = journal.defaultJournalPath(cwd);
    if (!fs.existsSync(file)) return { status: 'INFO', detail: 'журнала ещё нет — прогон не начинался' };
    const read = journal.readEvents(file);
    // Порча в середине — это правленый журнал, и он важнее любой другой строки отчёта:
    // на нём стоит весь resume.
    if (read.corrupt.length) return { status: 'FAIL', detail: `unavailable — порча в строке ${read.corrupt[0].line}` };
    if (read.truncatedTail) return { status: 'WARN', detail: `degraded — оборванный хвост после падения; ${read.events.length} событий` };
    return `ready — ${read.events.length} событий`;
  }));

  checks.push(check('packs: реестр компонентов', () => {
    const manifestFile = path.join(cwd, '.elt', 'components.json');
    const lockFile = path.join(cwd, '.elt', 'components.lock.json');
    if (!fs.existsSync(manifestFile)) return { status: 'INFO', detail: 'реестра нет — packs не подключены' };
    let catalog;
    try { catalog = require(path.join(root, 'tools', 'component-catalog.js')); }
    catch (e) { return { status: 'FAIL', detail: `component-catalog недоступен: ${e.message}` }; }
    const loaded = catalog.loadCatalog(manifestFile);
    // Коллизия имён — это `unavailable`, а не «каталог с замечаниями»: при неоднозначном
    // реестре какой узел выполнится, решает порядок чтения файла.
    if (!loaded.ok) return { status: 'FAIL', detail: `unavailable — ${loaded.reason}${loaded.detail ? `: ${loaded.detail}` : ''}` };
    const packs = Object.keys(loaded.packs).length;
    const nodes = Object.keys(loaded.nodeById).length;
    if (!fs.existsSync(lockFile)) return { status: 'WARN', detail: `degraded — ${packs} packs без lock: старый proof не станет stale` };
    return `ready — ${packs} packs, ${nodes} узлов, lock на месте`;
  }));

  // Проект — не плагин: его отсутствие это состояние, а не поломка.
  checks.push(check('проект: .harness/harness.json', () => {
    const file = path.join(cwd, '.harness', 'harness.json');
    if (!fs.existsSync(file)) {
      return { status: 'INFO', detail: 'конфига нет — чистый проект; создаётся командой /elt' };
    }
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg.oracle) return { status: 'WARN', detail: 'в конфиге нет поля oracle — механический оракул не назван' };
    return `oracle: ${cfg.oracle}`;
  }));

  const summary = {
    pass: checks.filter((c) => c.status === 'PASS').length,
    warn: checks.filter((c) => c.status === 'WARN').length,
    info: checks.filter((c) => c.status === 'INFO').length,
    fail: checks.filter((c) => c.status === 'FAIL').length,
  };
  return { plugin: 'elt', version: manifest ? manifest.version : null, checks, summary };
}

function formatText(report) {
  const lines = [`elt-doctor — плагин elt ${report.version || '?'}`];
  for (const c of report.checks) {
    lines.push(`  [${c.status.padEnd(4)}] ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  const s = report.summary;
  lines.push(`  PASS=${s.pass} WARN=${s.warn} INFO=${s.info} FAIL=${s.fail}`);
  return lines.join('\n') + '\n';
}

function main(argv = process.argv.slice(2), out = process.stdout) {
  const report = runDoctor();
  out.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatText(report));
  return report.summary.fail ? 2 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { runDoctor, formatText, main, BIN_ENTRIES, SURFACE, HOOK_EVENTS, PLUGIN_ROOT };
