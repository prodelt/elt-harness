#!/usr/bin/env node
'use strict';
// host-surface — 020 T011. Всё, что живёт НЕ в этом репозитории: глобальные скилы в домашнем
// каталоге и бинарники судьи на PATH.
//
// До этой задачи такие проверки стояли прямо в оракуле: `tools/skills-frontgate-contract.test.js`
// и `tools/elt-skill-frontgate-contract.test.js` читали `os.homedir()` и падали везде, где
// домашнего каталога разработчика нет — то есть на любом чистом клоне и на обеих машинах CI.
// Замер перед правкой: полный оракул с пустым HOME = 78/80, и оба красных — ровно эти файлы.
//
// Лечится не скипом. Скип по `if (!fs.existsSync(...)) return;` дал бы зелёный оракул,
// который ничего не проверил, — тот же класс, что «оракул зелёный» против «оракул ничего не
// гонял». Здесь проверка вынута в чистый модуль с ЯВНЫМ `home`/`PATH`: механический оракул
// гоняет её на фикстурах (`host-surface.test.js`), а на живой машине её зовёт CLI ниже.
//
//   node tools/host-surface.js [--json] [--expect-absent] [--home DIR] [--root DIR]
//   node tools/host-surface.js --sync-clients [--dry-run]   # 020 T012: паритет Claude/Codex/Gemini
//
// `--expect-absent` — обратное утверждение для CI: прогон обязан быть герметичным, поэтому
// найденный на раннере глобальный скил или установленный судья это ОТКАЗ, а не удача. Без
// него «оракул зелёный на CI» невозможно отличить от «на раннере случайно оказался хост».

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Скилы, которые этот репозиторий НЕ поставляет, но на которые опирается работа человека.
// `elt` в списке нет намеренно: с v5 он поставляется плагином из `skills/elt/SKILL.md`, и его
// контракт держит `elt-skill-frontgate-contract.test.js` против копии в репозитории. Копия в
// `~/.claude/skills/elt` — легаси-развёртка, она заморожена на 4.0.0 и больше не источник.
const HOST_SKILLS = [
  {
    name: 'grill-me',
    // Контракт v2 (spec 006 T007): разведка кода ДО вопросов, ≥2 раунда AskUserQuestion по
    // всем четырём категориям, варианты концепции для UI и фиксированная секция-выход.
    contract: [
      { name: 'frontmatter name: grill-me', re: /^---[\s\S]*?name:\s*grill-me[\s\S]*?---/m },
      { name: 'протокол v2', re: /[Пп]ротокол v2/ },
      { name: 'разведка кода до вопросов', re: /[Рр]азведка кода/ },
      { name: 'AskUserQuestion', re: /AskUserQuestion/ },
      { name: 'минимум 2 раунда', re: /2\s*раунд/ },
      { name: 'категория пользователи/сценарии', re: /пользователи\/сценарии/ },
      { name: 'категория данные/интеграции', re: /данные\/интеграции/ },
      { name: 'категория риски/edge cases', re: /риски\/edge cases/ },
      { name: 'категория не-цели/приоритет MVP', re: /не-цели\/приоритет MVP/ },
      { name: '2–3 варианта концепции для UI', re: /UI-задач[\s\S]{0,200}?2[–\-]3\s*вариант|2[–\-]3\s*вариант[\s\S]{0,200}?UI-задач/ },
      { name: 'секция-выход «Решения (зафиксированы с пользователем …)»', re: /## Решения \(зафиксированы с пользователем/ },
    ],
  },
];

// Три поверхности одного скила. Источник — Claude, остальные обязаны быть побайтовой копией:
// разошедшееся зеркало это молча другой протокол у другого CLI.
const SKILL_ROOTS = [
  { client: 'claude', dir: '.claude' },
  { client: 'codex', dir: '.codex' },
  { client: 'gemini', dir: '.gemini' },
];

// Бинарники, которыми зовётся судья. Ни один не обязан быть на CI — там судьи нет по
// построению, и именно это `--expect-absent` и закрепляет.
const JUDGE_BINARIES = ['claude', 'codex', 'agy'];

// Худший статус побеждает: 'ok' выдаётся только когда все остальные тоже 'ok'.
const SEVERITY = { ok: 0, 'contract-miss': 1, drift: 2, absent: 3 };
function worst(statuses) {
  return statuses.reduce((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc), 'ok');
}

function skillPath(home, client, name) {
  return path.join(home, client, 'skills', name, 'SKILL.md');
}

function checkHostSkills({ home = os.homedir(), skills = HOST_SKILLS, readFile } = {}) {
  const read = readFile || ((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null));
  const results = skills.map((skill) => {
    const surfaces = SKILL_ROOTS.map((root) => {
      const file = skillPath(home, root.dir, skill.name);
      return { client: root.client, path: file, text: read(file) };
    });
    const source = surfaces[0];
    const missing = surfaces.filter((s) => s.text === null).map((s) => s.path);
    if (source.text === null) {
      // Источника нет — зеркала и контракт проверять не на чем. Это ОТСУТСТВИЕ, не «чисто».
      return { name: skill.name, status: 'absent', source: source.path, missing, mirrors: [], contractMissing: [] };
    }
    const mirrors = surfaces.slice(1).map((s) => ({
      client: s.client, path: s.path, present: s.text !== null, identical: s.text === source.text,
    }));
    const contractMissing = skill.contract.filter((c) => !c.re.test(source.text)).map((c) => c.name);
    const status = mirrors.some((m) => !m.present || !m.identical) ? 'drift'
      : contractMissing.length ? 'contract-miss'
        : 'ok';
    return { name: skill.name, status, source: source.path, missing, mirrors, contractMissing };
  });
  return { status: worst(results.map((r) => r.status)), home, skills: results };
}

// Резолв бинарника по PATH без запуска процесса: запуск судьи ради «есть ли он» стоит секунд
// и на Windows поднимает окно. `exists` инъектируется, чтобы тест гонял это на фикстуре, а не
// на настоящем PATH машины.
function checkJudgeBinaries({ pathEnv = process.env.PATH || '', pathExt = process.env.PATHEXT || '', names = JUDGE_BINARIES, exists } = {}) {
  const has = exists || ((p) => fs.existsSync(p));
  const dirs = String(pathEnv).split(path.delimiter).filter(Boolean);
  const exts = ['', ...String(pathExt).split(';').filter(Boolean).map((e) => e.toLowerCase())];
  const found = [];
  for (const name of names) {
    for (const dir of dirs) {
      const hit = exts.map((ext) => path.join(dir, name + ext)).find((p) => has(p));
      if (hit) { found.push({ name, path: hit }); break; }
    }
  }
  return {
    status: found.length ? 'present' : 'absent',
    found,
    missing: names.filter((n) => !found.some((f) => f.name === n)),
  };
}

// Судья, названный конфигом проекта, установлен на ЭТОЙ машине? Утверждение переехало сюда из
// `elt-gate-l0.test.js`, где оно требовало установленного judge-CLI от каждого, кто гонит
// оракул, — и делало полный named oracle на CI недостижимым. Репозиторное свойство («конфиг
// называет провайдера, которого рантайм умеет спавнить») осталось там; машинное — здесь.
function checkConfiguredJudge({ root = process.cwd(), judges, readFile } = {}) {
  const read = readFile || ((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null));
  const raw = read(path.join(root, '.harness', 'harness.json'));
  if (raw === null) return { status: 'no-config', provider: null };
  let provider = null;
  try { provider = (JSON.parse(raw).judge || {}).provider || 'claude'; } catch { return { status: 'bad-config', provider: null }; }
  const installed = judges.found.some((f) => f.name === provider);
  return { status: installed ? 'ok' : 'not-installed', provider };
}

// 020 T012 — паритет клиентов. Один и тот же `/elt` обязан быть одинаковым у Claude, Codex и
// Gemini. Замер 2026-08-24: репозиторный `skills/elt/SKILL.md` = 5.0.0, а все три домашние
// копии = 4.0.0 — то есть два из трёх клиентов месяц читали снятый маршрут (`--skip-attest`,
// `~/.claude/bin/elt.js`), и заметить это было нечем: сверка шла по наличию файла.
//
// Сверяется SHA-256, а не «файл есть»: расхождение в одну строку это уже другой протокол.
// Claude получает скил установкой плагина, Codex и Gemini — копией из этого репозитория;
// источник у всех троих один и тот же файл, поэтому и хеш обязан быть один.
const CLIENT_SKILL = ['skills', 'elt', 'SKILL.md'];

// Снятая развёртка рантайма. Её присутствие само по себе не отказ (чужие файлы не удаляем),
// но НИ ОДИН маршрут не имеет права на неё ссылаться — спека 019 T015 её сняла.
const LEGACY_RUNTIME = ['.claude', 'bin', 'elt.js'];

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function versionOf(text) {
  const m = /^version:\s*(\S+)\s*$/m.exec(text || '');
  return m ? m[1] : null;
}

function checkClientParity({ home = os.homedir(), repoRoot = path.join(__dirname, '..'), readFile } = {}) {
  const read = readFile || ((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null));
  const sourcePath = path.join(repoRoot, ...CLIENT_SKILL);
  const sourceText = read(sourcePath);
  if (sourceText === null) {
    return { status: 'no-source', source: { path: sourcePath, sha256: null, version: null }, clients: [], legacyRuntime: null };
  }
  const source = { path: sourcePath, sha256: sha256(sourceText), version: versionOf(sourceText) };
  const clients = SKILL_ROOTS.map((root) => {
    const file = path.join(home, root.dir, ...CLIENT_SKILL);
    const text = read(file);
    if (text === null) return { client: root.client, path: file, status: 'absent', sha256: null, version: null };
    const hash = sha256(text);
    return {
      client: root.client, path: file, sha256: hash, version: versionOf(text),
      status: hash === source.sha256 ? 'ok' : 'drift',
    };
  });
  const legacyPath = path.join(home, ...LEGACY_RUNTIME);
  const legacyRuntime = { path: legacyPath, present: read(legacyPath) !== null };
  const statuses = clients.map((c) => c.status);
  return {
    status: statuses.every((s) => s === 'ok') ? 'ok' : statuses.includes('drift') ? 'drift' : 'absent',
    source, clients, legacyRuntime,
  };
}

// Починка паритета: РОВНО один файл на клиента переписывается из репозиторного источника.
// Ничего не удаляется — ни чужие скилы рядом, ни снятая развёртка `~/.claude/bin/elt.js`
// (риск спеки: «невідомі hooks не видаляти»), а прежнее содержимое сохраняется рядом как
// `.bak-<timestamp>`: правка домашнего профиля пользователя обязана быть обратимой.
function syncClientSurfaces({ home = os.homedir(), repoRoot = path.join(__dirname, '..'), dryRun = false, now = Date.now } = {}) {
  const parity = checkClientParity({ home, repoRoot });
  if (parity.status === 'no-source') return { status: 'no-source', changes: [] };
  const source = fs.readFileSync(parity.source.path, 'utf8');
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const changes = [];
  for (const client of parity.clients) {
    if (client.status === 'ok') continue;
    const change = { client: client.client, path: client.path, from: client.version, to: parity.source.version, backup: null };
    if (client.status === 'drift') change.backup = `${client.path}.bak-${stamp}`;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(client.path), { recursive: true });
      if (change.backup) fs.copyFileSync(client.path, change.backup);
      fs.writeFileSync(client.path, source);
    }
    changes.push(change);
  }
  return { status: dryRun ? 'dry-run' : 'applied', changes, source: parity.source };
}

function checkHostSurface(options = {}) {
  const skills = checkHostSkills(options);
  const judges = checkJudgeBinaries(options);
  const configuredJudge = checkConfiguredJudge({ ...options, judges });
  const clientParity = checkClientParity(options);
  return { skills, judges, configuredJudge, clientParity };
}

// Герметичность прогона: НИ одного глобального скила и НИ одного судьи. Утверждение обратное
// обычному, поэтому и статус считается отдельно — «скил найден» здесь провал.
function hermeticViolations(report) {
  const out = [];
  for (const s of report.skills.skills) {
    if (s.status !== 'absent') out.push(`глобальный скил ${s.name} присутствует: ${s.source}`);
  }
  for (const j of report.judges.found) out.push(`судья ${j.name} установлен: ${j.path}`);
  return out;
}

function formatText(report) {
  const lines = ['host-surface — поверхность вне репозитория'];
  lines.push(`  home: ${report.skills.home}`);
  for (const s of report.skills.skills) {
    lines.push(`  [${s.status.padEnd(13)}] скил ${s.name} — ${s.source}`);
    for (const m of s.mirrors.filter((m) => !m.present || !m.identical)) {
      lines.push(`      зеркало ${m.client}: ${m.present ? 'разошлось' : 'нет файла'} — ${m.path}`);
    }
    for (const c of s.contractMissing) lines.push(`      контракт не выполнен: ${c}`);
  }
  lines.push(`  [${report.judges.status.padEnd(13)}] судьи — найдены: ${report.judges.found.map((f) => f.name).join(', ') || 'ни одного'}`);
  const cj = report.configuredJudge;
  lines.push(`  [${cj.status.padEnd(13)}] судья из .harness/harness.json — ${cj.provider || 'конфига нет'}`);
  const cp = report.clientParity;
  lines.push(`  [${cp.status.padEnd(13)}] паритет клиентов — источник ${cp.source.version || '?'} ${String(cp.source.sha256).slice(0, 12)}`);
  for (const c of cp.clients) {
    lines.push(`      ${c.client}: ${c.status}${c.version ? ` (${c.version} ${String(c.sha256).slice(0, 12)})` : ''} — ${c.path}`);
  }
  if (cp.legacyRuntime && cp.legacyRuntime.present) {
    lines.push(`      снятая развёртка на месте (не удаляется, но маршрутом быть не может): ${cp.legacyRuntime.path}`);
  }
  return lines.join('\n') + '\n';
}

function main(argv = process.argv.slice(2), out = process.stdout) {
  const homeIdx = argv.indexOf('--home');
  const rootIdx = argv.indexOf('--root');
  const report = checkHostSurface({
    ...(homeIdx >= 0 ? { home: argv[homeIdx + 1] } : {}),
    ...(rootIdx >= 0 ? { root: argv[rootIdx + 1] } : {}),
  });
  const expectAbsent = argv.includes('--expect-absent');
  const violations = expectAbsent ? hermeticViolations(report) : [];

  // Починка паритета — отдельная явная команда, а не побочный эффект диагностики: она пишет в
  // домашний профиль пользователя, и делать это «заодно» с отчётом нельзя.
  if (argv.includes('--sync-clients')) {
    const opts = {
      ...(homeIdx >= 0 ? { home: argv[homeIdx + 1] } : {}),
      dryRun: argv.includes('--dry-run'),
    };
    const res = syncClientSurfaces(opts);
    if (argv.includes('--json')) { out.write(JSON.stringify(res, null, 2) + '\n'); return 0; }
    out.write(`host-surface: паритет клиентов — ${res.status}, изменений ${res.changes.length}\n`);
    for (const c of res.changes) {
      out.write(`  ${c.client}: ${c.from || 'нет файла'} → ${c.to}${c.backup ? ` (копия: ${path.basename(c.backup)})` : ''}\n`);
    }
    return 0;
  }

  if (argv.includes('--json')) {
    out.write(JSON.stringify({ ...report, expectAbsent, violations }, null, 2) + '\n');
  } else {
    out.write(formatText(report));
    if (expectAbsent) {
      out.write(violations.length
        ? `  ОТКАЗ герметичности:\n${violations.map((v) => '      ' + v).join('\n')}\n`
        : '  герметично: ни глобальных скилов, ни судьи\n');
    }
  }
  if (expectAbsent) return violations.length ? 1 : 0;
  return report.skills.status === 'ok' ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  HOST_SKILLS, SKILL_ROOTS, JUDGE_BINARIES,
  CLIENT_SKILL, LEGACY_RUNTIME,
  checkHostSkills, checkJudgeBinaries, checkConfiguredJudge, checkClientParity, syncClientSurfaces,
  checkHostSurface, hermeticViolations, formatText, main,
};
