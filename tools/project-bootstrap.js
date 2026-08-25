#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { initOrSyncProjectDocs, verifyProjectDocs } = require('./project-docs-core');
const { run: runAgentSkillSupplyChain } = require('./agent-skill-supply-chain');
const { readHarnessConfig } = require('./elt-config');

const DEFAULT_MANIFEST = path.resolve(__dirname, '..', 'config', 'agent-skill-sources.json');
// Скилы deprecated-маршрутов: зеркала намеренно не обновляются (см. CLAUDE.md «Deprecated»).
const DEPRECATED_SKILLS = new Set(['pipeline']);

// Каталоги, которых нет в вопросе «насколько велик проект»: они не пишутся человеком и
// не влияют на выбор стратегии разведки.
const FILE_COUNT_SKIP = new Set(['.git', 'node_modules', '.fleet-wt', '.codegraph', 'dist', 'build', 'coverage']);

// Размер проекта — механический сигнал выбора стратегии, поэтому у него не может быть двух
// реализаций с разной семантикой. Считаем средствами Node на ВСЕХ машинах: наличие `rg`, его
// версия и правила hidden/.gitignore больше не меняют ответ. Генерируемые тяжёлые каталоги
// исключены явным одинаковым контрактом. Поймано красным CI на Ubuntu без ripgrep.
function walkFileCount(root, limit = 5000) {
  let count = 0;
  let outputChars = 0;
  const stack = [root];
  while (stack.length && count <= limit) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!FILE_COUNT_SKIP.has(entry.name)) stack.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        count += 1;
        const relative = path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/');
        outputChars += Buffer.byteLength(relative, 'utf8') + 1;
        if (count > limit) break;
      }
    }
  }
  return { count, outputChars };
}

function fileCount(root) {
  const counted = walkFileCount(root);
  return { ok: true, ...counted, source: 'fs-walk' };
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

const CODE_MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.cs', '.rb', '.php', '.cpp', '.c', '.kt', '.swift']);
const DOC_EXTENSIONS = new Set(['.md', '.docx', '.pdf', '.pptx', '.xlsx', '.txt']);

function listFiles(root, limit = 500) {
  const completed = spawnSync('rg', ['--files'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (completed.status !== 0) return [];
  return completed.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit);
}

function classifyKind(root) {
  const manifest = CODE_MANIFESTS.find((name) => exists(root, name));
  if (manifest) return { kind: 'code', confidence: 'high', signals: [manifest] };
  const files = listFiles(root);
  const codeFiles = files.filter((file) => CODE_EXTENSIONS.has(path.extname(file)));
  if (codeFiles.length > 0) return { kind: 'code', confidence: 'medium', signals: codeFiles.slice(0, 5) };
  const docFiles = files.filter((file) => DOC_EXTENSIONS.has(path.extname(file)));
  if (docFiles.length > 0) return { kind: 'docs', confidence: 'medium', signals: docFiles.slice(0, 5) };
  return { kind: 'unknown', confidence: 'low', signals: [] };
}

function inspectProject(root, options = {}) {
  const resolved = path.resolve(root || process.cwd());
  const docs = verifyProjectDocs(resolved);
  const harness = readHarnessConfig(resolved);
  const classification = classifyKind(resolved);
  return {
    kind: 'project-bootstrap-inspect',
    root: resolved,
    classification,
    docs: { ok: docs.ok, coreIdentical: Boolean(docs.coreIdentical), missing: docs.missing || [], unknownSections: docs.unknownSections || [] },
    harness: { exists: fs.existsSync(path.join(resolved, '.harness', 'harness.json')), ok: harness.ok, errors: harness.errors || [], config: harness.config || null },
    codegraph: { indexed: exists(resolved, path.join('.codegraph', 'codegraph.db')) },
    gitGate: {
      managedHookInstalled: exists(resolved, path.join('.githooks', 'pre-commit')),
      hooksPath: hooksPathOf(resolved),
      hooksPathManaged: hooksPathOf(resolved) === HOOKS_PATH,
    },
  };
}

function planOracleDecision(inspected) {
  if (inspected.classification.kind !== 'code') {
    return { proposed: null, source: 'none', reason: `kind is ${inspected.classification.kind} — no oracle required or invented` };
  }
  if (inspected.harness.ok && inspected.harness.config && inspected.harness.config.oracle) {
    return { proposed: inspected.harness.config.oracle, source: 'existing', reason: 'valid .harness/harness.json already declares an oracle' };
  }
  return { proposed: null, source: 'none', reason: 'no valid oracle declared — code kind requires an explicit oracle before slices, none will be invented' };
}

function planTargetState(root, options = {}) {
  const inspected = inspectProject(root, options);
  const oracle = planOracleDecision(inspected);
  const codegraphRequested = options.codegraph === true;
  return {
    kind: 'project-bootstrap-plan',
    root: inspected.root,
    classification: inspected.classification,
    decisions: {
      oracle,
      judge: oracle.source === 'existing'
        ? { enabled: true, model: 'sonnet', reason: 'oracle exists for code kind' }
        : { enabled: false, reason: 'no oracle to gate — judge stays disabled' },
      codegraph: {
        enabled: codegraphRequested,
        reason: codegraphRequested ? 'explicit --codegraph flag' : 'not enabled — requires explicit --codegraph flag or interactive confirmation',
      },
      gitGate: {
        managed: inspected.gitGate.managedHookInstalled,
        hookPath: '.githooks/pre-commit',
        reason: inspected.gitGate.managedHookInstalled ? 'already installed' : 'not installed — apply will install the managed pre-commit gate',
      },
    },
    existing: { docs: inspected.docs, harness: inspected.harness, codegraph: inspected.codegraph },
  };
}

const STATE_STUB = '# STATE\n\n> Живий хребет проєкту (`.planning/STATE.md`), створено `project-bootstrap apply`.\n> Заповнити після першого спек-слайсу.\n';

// 019 T015: хук больше не зовёт deploy-копию `$HOME/.claude/bin/elt.js` — её нет. Путь к CLI
// плагина ЗАПЕКАЕТСЯ в момент bootstrap: git-хук исполняется вне Claude Code, поэтому
// `${CLAUDE_PLUGIN_ROOT}` в нём не подставится, а искать установку плагина шеллом по
// `~/.claude/plugins/**` было бы вторым резолвером, который разойдётся с первым. Переменная
// `ELT_CLI` оставлена перекрытием: переехала установка — не переписывать хук, а объявить её.
const ELT_CLI_PATH = path.join(__dirname, 'elt.js');

function gitGateTemplate(eltCli = ELT_CLI_PATH) {
  const posix = String(eltCli).split(path.sep).join('/');
  return [
    '#!/bin/sh',
    '# elt gate — managed pre-commit hook (installed by project-bootstrap apply).',
    '# Enable once per clone:  git config core.hooksPath .githooks',
    'ELT_CLI="${ELT_CLI:-' + posix + '}"',
    'if [ ! -f "$ELT_CLI" ]; then',
    '  echo "elt gate: CLI не найден по $ELT_CLI — переустанови плагин (claude plugin install elt@elt) или задай ELT_CLI" >&2',
    '  exit 1',
    'fi',
    'node "$ELT_CLI" gate',
    '',
  ].join('\n');
}

// ── 020 T009: гейт обязан БЫТЬ ВКЛЮЧЁН, а не просто лежать файлом ──────────────────────
// Разведка живьём: `project-bootstrap apply` писал `.githooks/pre-commit` и на этом
// останавливался, а `git config core.hooksPath .githooks` только УПОМИНАЛСЯ комментарием
// внутри шаблона. В самом репо-разработчике `git config core.hooksPath` не возвращал ничего:
// «managed gate установлен» означало «файл существует», и ни один прямой `git commit` этим
// хуком не проверялся. Это ровно тот fail-open, который снимает T009.
const HOOKS_PATH = '.githooks';
function gitIn(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function hooksPathOf(root) {
  const r = gitIn(root, ['config', '--get', 'core.hooksPath']);
  return r.code === 0 && r.out ? r.out.split(path.sep).join('/') : null;
}
function enableHooksPath(root) {
  return gitIn(root, ['config', 'core.hooksPath', HOOKS_PATH]).code === 0;
}
// Отказной commit-пробой. Проверяется не наличие файла, а ПОВЕДЕНИЕ: в одноразовом
// репозитории тот же самый хук обязан (1) отказать коммиту с кодом без пруфа и (2) пропустить
// документный коммит. Односторонняя проба ничего не доказывает: хук `exit 1` прошёл бы её.
function probeGitGate(root, { eltCli = path.join(__dirname, 'elt.js') } = {}) {
  const hookSrc = path.join(root, HOOKS_PATH, 'pre-commit');
  if (!fs.existsSync(hookSrc)) return { ok: false, reason: 'hook-missing', detail: hookSrc };
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elt-gate-probe-'));
  try {
    for (const args of [['init', '-q'], ['config', 'user.email', 'probe@elt'], ['config', 'user.name', 'probe'],
      ['config', 'core.hooksPath', HOOKS_PATH]]) gitIn(tmp, args);
    fs.mkdirSync(path.join(tmp, HOOKS_PATH), { recursive: true });
    // CRLF в shell-скрипте ломает shebang: `sh` ищет интерпретатор «/bin/sh\r».
    const hookBody = fs.readFileSync(hookSrc, 'utf8').split('\r\n').join('\n');
    fs.writeFileSync(path.join(tmp, HOOKS_PATH, 'pre-commit'), hookBody, { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'seed.txt'), 'seed\n');
    gitIn(tmp, ['add', '-A']);
    gitIn(tmp, ['commit', '-q', '--no-verify', '-m', 'seed']); // база фикстуры — мимо хука намеренно
    const env = { ...process.env, ELT_CLI: String(eltCli).split(path.sep).join('/') };
    const commit = (msg) => {
      const r = spawnSync('git', ['commit', '-q', '-m', msg], { cwd: tmp, encoding: 'utf8', env, windowsHide: true });
      return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    };
    // (1) код без пруфа — обязан быть отвергнут САМИМ гейтом, а не поломкой хука.
    fs.writeFileSync(path.join(tmp, 'probe.js'), 'module.exports = 1;\n');
    gitIn(tmp, ['add', '-A']);
    const refused = commit('probe: код без пруфа');
    if (refused.code === 0) return { ok: false, reason: 'hook-not-blocking', detail: 'коммит с кодом без пруфа прошёл' };
    if (/CLI не найден/.test(refused.out)) return { ok: false, reason: 'hook-broken', detail: refused.out.trim().slice(0, 300) };
    // (2) документный коммит — обязан пройти, иначе «хук» это просто exit 1.
    gitIn(tmp, ['reset', '-q', '--hard', 'HEAD']);
    fs.mkdirSync(path.join(tmp, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.planning', 'probe.md'), 'notes\n');
    gitIn(tmp, ['add', '-A']);
    const passed = commit('docs: только .planning');
    if (passed.code !== 0) return { ok: false, reason: 'hook-blocks-everything', detail: passed.out.trim().slice(0, 300) };
    return { ok: true, reason: 'hook отказал коду без пруфа и пропустил документный коммит' };
  } catch (e) {
    return { ok: false, reason: 'probe-failed', detail: e.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows lock */ }
  }
}

function applyPlan(root, options = {}) {
  const plan = planTargetState(root, options);
  const resolved = plan.root;
  const changes = [];

  if (!(plan.existing.docs.ok && plan.existing.docs.coreIdentical)) {
    const result = initOrSyncProjectDocs({ root: resolved, mode: 'init', home: options.home });
    if (result.success) changes.push({ id: 'project-docs', mode: result.mode });
  }

  const statePath = path.join(resolved, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, STATE_STUB, 'utf8');
    changes.push({ id: 'planning-state', created: true });
  }

  const hookPath = path.join(resolved, '.githooks', 'pre-commit');
  if (plan.classification.kind === 'code' && !plan.decisions.gitGate.managed) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, gitGateTemplate(), { mode: 0o755 });
    changes.push({ id: 'git-gate', created: true });
  }
  // 020 T009: включаем хук ВСЕГДА, когда файл уже есть, — даже если сам файл ставил не мы.
  // Установленный, но невключённый хук — это отсутствующий хук, который выглядит как рабочий.
  // Вне git-репозитория включать нечего — это не отказ, а неприменимость (bootstrap умеет
  // работать и по каталогу без git). Запись в changes только когда состояние РЕАЛЬНО изменилось,
  // иначе повторный apply перестал бы быть идемпотентным.
  const isGitRepo = gitIn(resolved, ['rev-parse', '--is-inside-work-tree']).code === 0;
  if (plan.classification.kind === 'code' && isGitRepo && fs.existsSync(hookPath) && hooksPathOf(resolved) !== HOOKS_PATH) {
    const enabled = enableHooksPath(resolved);
    if (enabled) changes.push({ id: 'git-gate-hooks-path', enabled, value: HOOKS_PATH });
    else changes.push({ id: 'git-gate-hooks-path', enabled: false, error: 'git config core.hooksPath не отработал' });
  }

  // 006 T005: patch missing specApproval/ctx7Gate defaults into an existing
  // valid harness.json — never invents the whole file (oracle stays
  // user-declared, see the `blocked` branch below), and never overrides an
  // explicit user choice (only fills in keys that are absent).
  if (plan.classification.kind === 'code' && plan.existing.harness.exists && plan.existing.harness.ok) {
    const harnessPath = path.join(resolved, '.harness', 'harness.json');
    let current = null;
    try { current = JSON.parse(fs.readFileSync(harnessPath, 'utf8')); } catch { current = null; }
    if (current) {
      const added = [];
      if (!('specApproval' in current)) { current.specApproval = true; added.push('specApproval'); }
      if (!('ctx7Gate' in current)) { current.ctx7Gate = 'warn'; added.push('ctx7Gate'); }
      // ELT v3: один независимый judge + attest + red-proof. Старый verify-on-pass удаляем
      // при явном apply: runtime уже игнорирует его, а конфиг не должен обещать лишний слой.
      if (current.judge && typeof current.judge === 'object' && !Array.isArray(current.judge)) {
        if (!('attest' in current.judge)) { current.judge.attest = true; added.push('judge.attest'); }
        if ('verify' in current.judge) { delete current.judge.verify; added.push('removed judge.verify'); }
      }
      if (!('redProof' in current)) { current.redProof = 'on'; added.push('redProof'); }
      // 014 T016 (AC12): поля экзоскелета v4. Умолчания подобраны так, что ОТСУТСТВИЕ полей =
      // поведение 011 — старый harness.json работает по-старому (verifyMode → 'sync'), а
      // проставленные значения включают спекулятивный контур явно. `smokeParallel:false` —
      // консервативно: параллельный smoke бьётся о порты и внешние сервисы (T010, R2).
      if (!('verify' in current)) { current.verify = 'background'; added.push('verify'); }
      if (!('backgroundTimeoutMin' in current)) { current.backgroundTimeoutMin = 20; added.push('backgroundTimeoutMin'); }
      if (!('smokeParallel' in current)) { current.smokeParallel = false; added.push('smokeParallel'); }
      // 014 T024: смотрим на САМО поле `layers`, а не на наличие объекта `background`. Проект,
      // у которого уже есть `background` с любым другим ключом (например будущий тюнинг
      // таймаутов), оставался бы без списка слоёв — а его отсутствие фон трактует как «включены
      // все» лишь по умолчанию, и явности, ради которой бутстрап и существует, не возникало.
      if (!current.background || typeof current.background !== 'object') current.background = {};
      if (!Array.isArray(current.background.layers)) {
        current.background.layers = ['suite', 'mutate', 'smoke', 'judge'];
        added.push('background.layers');
      }
      if (added.length > 0) {
        fs.writeFileSync(harnessPath, JSON.stringify(current, null, 2) + '\n');
        changes.push({ id: 'harness-approval-fields', added });
      }
    }
  }

  const blocked = [];
  if (plan.classification.kind === 'code' && plan.decisions.oracle.source !== 'existing') {
    blocked.push({ id: 'harness', reason: plan.decisions.oracle.reason });
  }

  return {
    kind: 'project-bootstrap-apply',
    root: resolved,
    plan,
    changes,
    blocked,
    after: planTargetState(resolved, options),
  };
}

function checkDocsContract(inspected) {
  if (inspected.classification.kind === 'unknown') {
    return { ok: true, skipped: true, reason: 'kind is unknown — docs contract not evaluated' };
  }
  // 010 T008 (AC5): красный без объяснения — хуже, чем жёлтый с причиной. `unknownSections`
  // (свои секции в AGENTS.md) больше не рубят контракт, но ВИДНЫ снаружи: раньше они делали
  // verify красным, а причина не доезжала до отчёта вовсе.
  const ok = inspected.docs.ok && inspected.docs.coreIdentical;
  const unknownSections = inspected.docs.unknownSections || [];
  const warnings = unknownSections.length ? [`unknownSections: ${unknownSections.join(', ')}`] : [];
  return {
    ok,
    coreIdentical: inspected.docs.coreIdentical,
    missing: inspected.docs.missing,
    unknownSections,
    ...(warnings.length ? { warnings } : {}),
    reason: ok
      ? `project docs match managed template${unknownSections.length ? ` (warn: ${unknownSections.length} non-core sections)` : ''}`
      : 'project docs missing or drifted from managed template',
  };
}

function checkHarnessContract(inspected) {
  if (inspected.classification.kind === 'unknown') {
    return { ok: true, skipped: true, reason: 'kind is unknown — harness contract not evaluated' };
  }
  if (!inspected.harness.exists) return { ok: false, reason: '.harness/harness.json is missing' };
  if (!inspected.harness.ok) return { ok: false, reason: 'harness.json is invalid', errors: inspected.harness.errors };
  return { ok: true, reason: 'harness.json is schema-valid' };
}

// Первое слово команды = исполняемый файл. Кавычки снимаем, `--flag`-хвост не трогаем:
// нужно ровно то, что shell пойдёт искать в PATH.
function commandBinary(command) {
  const first = command.trim().split(/\s+/)[0] || '';
  return first.replace(/^["']|["']$/g, '');
}

// 010 T007 (AC6): «непустая строка» — не контракт. Строка `just test` в проекте без just
// проходила проверку и падала только в первом слайсе. Без --deep проверяем, что команда
// вообще резолвится; с --deep оракул реально запускается и его код возврата идёт в отчёт.
function checkOracleVerifierContract(inspected, options = {}) {
  if (inspected.classification.kind === 'unknown') {
    return { ok: true, skipped: true, reason: 'kind is unknown — oracle/verifier contract not evaluated' };
  }
  if (!inspected.harness.ok || !inspected.harness.config) {
    return { ok: false, reason: 'no valid harness config to read an oracle/verifier from' };
  }
  const cfg = inspected.harness.config;
  const cfgKind = cfg.kind;
  const label = cfgKind === 'code' ? 'oracle' : 'artifactVerifier';
  const value = cfgKind === 'code' ? cfg.oracle : cfg.artifactVerifier;
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: `harness.json kind=${cfgKind} requires a non-empty ${label}` };
  }
  const runner = options.commandRunner || ((file, args, opts) => spawnSync(file, args, opts));
  const base = { kind: cfgKind, command: value };
  if (options.deep === true) {
    // R5: чужие тесты могут писать в БД/сеть — поэтому только по явному флагу и с таймаутом.
    const shell = cfg.shell === 'powershell' ? 'powershell' : 'bash';
    // PowerShell сам по себе возвращает 0/1 по успеху пайплайна, а не код нативной команды:
    // без `exit $LASTEXITCODE` красный оракул с exit 3 приезжал бы в отчёт как 1, а
    // несуществующая команда — как 0 ($LASTEXITCODE не выставлен → голый `exit`). Оба случая
    // поймал живой прогон (тест без подменённого раннера); мок их скрывал.
    const argv = shell === 'powershell'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `$ErrorActionPreference='Stop'; ${value}; exit $LASTEXITCODE`]
      : ['-c', value];
    const timeout = Number(options.deepTimeoutMs) > 0 ? Number(options.deepTimeoutMs) : 600000;
    const completed = runner(shell, argv, { cwd: inspected.root, encoding: 'utf8', timeout, windowsHide: true });
    const exit = completed.status === null || completed.status === undefined ? null : completed.status;
    const timedOut = completed.error && completed.error.code === 'ETIMEDOUT';
    return {
      ...base, deep: true, exit, timedOut: Boolean(timedOut),
      ok: exit === 0,
      reason: exit === 0 ? `${label} ran green (exit 0)` : `${label} did not pass: exit ${exit === null ? 'null' : exit}${timedOut ? ' (timeout)' : ''}`,
    };
  }
  const binary = commandBinary(value);
  const probe = runner(process.platform === 'win32' ? 'where' : 'which', [binary], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (probe.status !== 0) {
    return { ...base, deep: false, binary, ok: false, reason: `${label} command "${binary}" does not resolve on PATH` };
  }
  return { ...base, deep: false, binary, ok: true, reason: `${label} command resolves ("${binary}")` };
}

function checkApprovalContract(inspected) {
  if (inspected.classification.kind !== 'code') {
    return { ok: true, skipped: true, reason: 'kind is not code — specApproval/ctx7Gate not evaluated' };
  }
  if (!inspected.harness.ok || !inspected.harness.config) {
    return { ok: false, reason: 'no valid harness config to read specApproval/ctx7Gate from' };
  }
  const cfg = inspected.harness.config;
  const specApproval = cfg.specApproval === true;
  const ctx7Gate = typeof cfg.ctx7Gate === 'string' && cfg.ctx7Gate.trim() !== '' ? cfg.ctx7Gate : null;
  return {
    ok: specApproval && ctx7Gate !== null,
    specApproval,
    ctx7Gate,
    reason: specApproval && ctx7Gate !== null
      ? 'specApproval and ctx7Gate configured'
      : 'specApproval/ctx7Gate missing — run project-bootstrap apply to fill in defaults',
  };
}

// 010 T006 (AC4): judge.enabled без физически резолвимого моста = контур объявлен, но не
// установлен — ровно та дыра, из-за которой в 9 живых проектах судья деградировал в
// самозаверение. Порядок резолва тот же, что у `elt judge run` (elt.js resolveJudgeInvoke).
function checkJudgeBridgeContract(inspected, options = {}) {
  const cfg = inspected.harness.ok ? inspected.harness.config : null;
  if (!cfg || !cfg.judge || cfg.judge.enabled !== true) {
    return { ok: true, skipped: true, reason: 'judge is not enabled — bridge not required' };
  }
  // 019 T015: вторая ступень — каталог плагина, а не deploy-копия `~/.claude/bin/judge/`.
  // `pluginTools` перекрывается ради теста: в самом репо мост есть ВСЕГДА, и без перекрытия
  // ветка «моста нет» стала бы недостижимой — то есть зелёный перестал бы что-либо значить.
  const pluginTools = options.pluginTools || __dirname;
  const candidates = [
    path.join(inspected.root, 'tools', 'judge-invoke.js'),
    path.join(pluginTools, 'judge-invoke.js'),
  ];
  const resolved = candidates.find((file) => fs.existsSync(file));
  if (!resolved) {
    return { ok: false, reason: 'judge bridge is not resolvable', looked: candidates.map(normalizePath), repair: 'claude plugin install elt@elt' };
  }
  return { ok: true, reason: 'judge bridge is resolvable', bridge: normalizePath(resolved) };
}

function checkGateContract(inspected) {
  if (inspected.classification.kind !== 'code') {
    return { ok: true, skipped: true, reason: `kind is ${inspected.classification.kind} — git gate not required` };
  }
  if (!inspected.gitGate.managedHookInstalled) {
    return { ok: false, reason: '.githooks/pre-commit is missing — run project-bootstrap apply' };
  }
  // Каталог без git — включать и пробовать нечего: `core.hooksPath` и commit-проба неприменимы.
  // Сам файл хука при этом всё равно обязан лежать (проверено выше) — контракт не ослабляется.
  if (gitIn(inspected.root, ['rev-parse', '--is-inside-work-tree']).code !== 0) {
    return { ok: true, skipped: true, reason: 'хук на месте; не git-репозиторий — включение и проба неприменимы' };
  }
  // 020 T009: наличие файла больше не считается гейтом. Нужны включённый core.hooksPath и
  // доказанное ПОВЕДЕНИЕ хука — иначе verify зелёный на репозитории, где ни один прямой
  // `git commit` не проверяется.
  if (!inspected.gitGate.hooksPathManaged) {
    return { ok: false, reason: `core.hooksPath = ${inspected.gitGate.hooksPath || '(не задан)'} — хук лежит, но не включён: git config core.hooksPath ${HOOKS_PATH}` };
  }
  const probe = probeGitGate(inspected.root);
  if (!probe.ok) return { ok: false, reason: `commit-probe: ${probe.reason} (${probe.detail || ''})` };
  return { ok: true, reason: `managed pre-commit gate включён и проверен пробой: ${probe.reason}` };
}

function findSpecTasks(root) {
  const specsDir = path.join(root, 'specs');
  if (!fs.existsSync(specsDir)) return { files: [], open: 0, done: 0 };
  const re = /^\s*(?:[-*]\s*)?\[( |X|x)\]/;
  const files = [];
  let open = 0;
  let done = 0;
  for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(specsDir, entry.name, 'tasks.md');
    if (!fs.existsSync(file)) continue;
    files.push(file);
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(re);
      if (!m) continue;
      if (m[1] === ' ') open += 1; else done += 1;
    }
  }
  return { files, open, done };
}

function checkSpecReadiness(root) {
  const specs = findSpecTasks(root);
  if (specs.files.length === 0) return { ok: true, status: 'idle', reason: 'no specs/*/tasks.md yet — explicit idle, not a failure', files: [] };
  if (specs.open === 0) return { ok: true, status: 'complete', reason: 'all discovered slices are closed', open: 0, done: specs.done, files: specs.files };
  return { ok: true, status: 'active', open: specs.open, done: specs.done, files: specs.files };
}

function checkCleanTree(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: true, skipped: true, reason: 'not a git repository' };
  const completed = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (completed.status !== 0) return { ok: false, reason: 'git status failed', error: completed.stderr || completed.error?.message || '' };
  const dirty = completed.stdout.trim().length > 0;
  return { ok: !dirty, dirty, reason: dirty ? 'working tree has uncommitted changes' : 'working tree is clean' };
}

function verifyProject(root, options = {}) {
  const inspected = inspectProject(root, options);
  const resolved = inspected.root;
  const contracts = {
    docs: checkDocsContract(inspected),
    harnessConfig: checkHarnessContract(inspected),
    oracleVerifier: checkOracleVerifierContract(inspected, options),
    judgeBridge: checkJudgeBridgeContract(inspected, options),
    gate: checkGateContract(inspected),
    skillAvailability: supplyChainStatus(resolved, options),
  };
  const signals = {
    specReadiness: checkSpecReadiness(resolved),
    cleanTree: checkCleanTree(resolved),
    approvalGate: checkApprovalContract(inspected),
  };
  return {
    kind: 'project-bootstrap-verify',
    root: resolved,
    classification: inspected.classification,
    ok: Object.values(contracts).every((c) => c.ok),
    contracts,
    signals,
  };
}

// Read-only migration planner for the whole registry (spec 005 AC12). Never writes:
// per-project it reaches for the same read-only planTargetState (T008) the canonical
// apply is built on, so a dry-run leaves every project byte-identical. Emits a
// machine-readable plan (domain + actions + risk). Rollout stays per-project: apply is
// only run via `project-bootstrap apply --root <path>` after review — no apply-all here.
function planProjectMigration(entry, options = {}) {
  const root = entry.path;
  if (!root || !fs.existsSync(root)) {
    return { key: entry.key, name: entry.name, path: root || null, domain: 'missing', risk: 'missing', actions: [], reason: 'registry path does not exist' };
  }
  const plan = planTargetState(root, options);
  const kind = plan.classification.kind;
  const actions = [];
  if (!(plan.existing.docs.ok && plan.existing.docs.coreIdentical)) actions.push('sync-docs');
  if (!fs.existsSync(path.join(root, '.planning', 'STATE.md'))) actions.push('create-state');
  if (kind === 'code' && !plan.decisions.gitGate.managed) actions.push('install-gate');
  const needsManualOracle = kind === 'code' && plan.decisions.oracle.source !== 'existing';
  if (needsManualOracle) actions.push('declare-oracle');
  const risk = kind === 'unknown' ? 'review'
    : needsManualOracle ? 'manual'
      : actions.length === 0 ? 'none' : 'safe';
  return { key: entry.key, name: entry.name, path: plan.root, domain: kind, risk, actions };
}

function migrationPlan(home, options = {}) {
  const resolvedHome = path.resolve(home || require('node:os').homedir());
  const registryFile = path.join(resolvedHome, '.claude', 'projects-registry.json');
  const registry = readJson(registryFile);
  const projects = registry.ok && registry.value && registry.value.projects ? Object.values(registry.value.projects) : [];
  const rows = projects.map((entry) => planProjectMigration(entry, options));
  const totals = rows.reduce((acc, row) => {
    acc.byDomain[row.domain] = (acc.byDomain[row.domain] || 0) + 1;
    acc.byRisk[row.risk] = (acc.byRisk[row.risk] || 0) + 1;
    return acc;
  }, { byDomain: {}, byRisk: {} });
  return {
    kind: 'project-bootstrap-migration-plan',
    dryRun: true,
    registry: registryFile,
    scanned: rows.length,
    totals,
    projects: rows,
    note: 'read-only — no project modified; apply per project with `project-bootstrap apply --root <path>` after review (no apply-all)',
  };
}

function detectStack(root) {
  const packageJson = path.join(root, 'package.json');
  if (!fs.existsSync(packageJson)) return { name: 'unknown', confidence: 'low' };
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next || exists(root, path.join('src', 'app'))) return { name: 'Next.js App Router', confidence: 'high' };
    if (deps.vite || exists(root, 'vite.config.ts') || exists(root, 'vite.config.js')) return { name: 'Vite React', confidence: 'high' };
    if (deps.electron || pkg.main) return { name: 'Electron', confidence: 'medium' };
    return { name: 'Node.js', confidence: 'medium' };
  } catch (error) {
    return { name: 'unknown', confidence: 'low', error: error.message };
  }
}

function recommendedProbes(strategy, stack) {
  if (stack.name === 'Next.js App Router') {
    return [
      'rg --files src/app src/lib | Select-Object -First 80',
      'rg "use server|redirect|createClient|supabase|auth" src/lib src/app/api -n -m 3 | Select-Object -First 80',
      'rg "page.tsx|layout.tsx|route.ts" src/app -n -m 2 | Select-Object -First 60',
    ];
  }
  if (stack.name === 'Vite React') {
    return [
      'rg --files src | Select-Object -First 80',
      'rg "useState|useEffect|useMemo|createRoot|Router|routes" src -n -m 3 | Select-Object -First 80',
      'rg "export default|function |const .* =" src -n -m 2 | Select-Object -First 60',
    ];
  }
  if (strategy === 'bounded-grep-first') {
    return [
      'rg --files | Select-Object -First 80',
      'rg "<task-keyword>" . -n -m 3 | Select-Object -First 60',
    ];
  }
  return [
    'rg --files | Select-Object -First 120',
    'rg "<task-keyword>" src -n -m 3 | Select-Object -First 80',
  ];
}

function controlPlaneStatus(root) {
  const file = path.join(root, '.planning', 'agent-control-plane.json');
  if (!fs.existsSync(file)) return { ok: false, exists: false, file };
  const parsed = readJson(file);
  if (!parsed.ok) return { ok: false, exists: true, file, error: parsed.error };
  const value = parsed.value || {};
  const required = ['version', 'managedBy', 'manifestVersion', 'manifest', 'requiredClients'];
  const missing = required.filter((key) => value[key] === undefined);
  return {
    ok: missing.length === 0 && Array.isArray(value.requiredClients),
    exists: true,
    file,
    missing,
    manifestVersion: value.manifestVersion,
    requiredClients: Array.isArray(value.requiredClients) ? value.requiredClients : [],
  };
}

function summarizeSupplyChain(root, audit) {
  if (!audit || audit.kind !== 'agent-skill-supply-chain') {
    return { ok: false, error: 'supply-chain audit unavailable' };
  }
  const targetClients = audit.validation && audit.validation.ok
    ? Object.keys(audit.clients || {})
    : [];
  const missingClientRoots = targetClients.filter((client) => !(audit.clients[client] && audit.clients[client].exists));
  const missingInstalls = (audit.skills || []).flatMap((skill) => targetClients
    .filter((client) => skill.clients && skill.clients[client] && !skill.clients[client].installed)
    .map((client) => `${client}/${skill.name}`));
  // 010 T008 (AC5): deprecated route не обновляется намеренно (CLAUDE.md: Pipeline v3 снят,
  // exports живут ради doctor), поэтому его копии расходятся с источником вечно — держать на
  // этом красный verify = топить в шуме настоящие красные. Исключение узкое, ровно как в AC5:
  // ТОЛЬКО дрейф. Отсутствие установки остаётся видимым (судья раунда 2 по делу указал, что
  // исключение из missingInstalls — ослабление сверх заявленного в задаче).
  const live = (audit.skills || []).filter((skill) => !DEPRECATED_SKILLS.has(skill.name));
  const driftedInstalls = live.flatMap((skill) => targetClients
    .filter((client) => skill.clients && skill.clients[client] && skill.clients[client].installed && !skill.clients[client].matchesSource)
    .map((client) => `${client}/${skill.name}`));
  const targetProject = (audit.projects || []).find((project) => normalizePath(project.path || '') === normalizePath(root));
  const missingControlPlane = targetProject && targetProject.exists && !targetProject.controlPlane;
  const ok = Boolean(audit.validation && audit.validation.ok)
    && missingClientRoots.length === 0
    && missingInstalls.length === 0
    && driftedInstalls.length === 0
    && missingControlPlane !== true;
  return {
    ok,
    validation: audit.validation || { ok: false, errors: ['missing validation result'] },
    skills: (audit.skills || []).length,
    projects: (audit.projects || []).length,
    target_project: targetProject ? {
      key: targetProject.key,
      exists: targetProject.exists,
      controlPlane: targetProject.controlPlane,
    } : null,
    missing_client_roots: missingClientRoots,
    missing_installs: missingInstalls,
    drifted_installs: driftedInstalls,
  };
}

function supplyChainStatus(root, options = {}) {
  if (options.supplyChain === false) return { ok: true, skipped: true, reason: 'disabled by caller' };
  try {
    const home = path.resolve(options.home || require('node:os').homedir());
    const manifest = path.resolve(options.manifest || DEFAULT_MANIFEST);
    const registry = path.join(home, '.claude', 'projects-registry.json');
    const runner = options.supplyChainRunner || runAgentSkillSupplyChain;
    const audit = options.supplyChainAudit || runner({
      command: 'audit',
      manifest,
      registry,
      home,
      target: 'all',
      apply: false,
      json: true,
      repoRoot: path.resolve(__dirname, '..'),
    });
    return summarizeSupplyChain(root, audit);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function scanProject(root, options = {}) {
  const resolved = path.resolve(root || process.cwd());
  const docs = verifyProjectDocs(resolved);
  const files = fileCount(resolved);
  const controlPlane = controlPlaneStatus(resolved);
  const supplyChain = supplyChainStatus(resolved, options);
  const harness = readHarnessConfig(resolved);
  const stack = detectStack(resolved);
  const strategy = files.ok && files.count <= 80 ? 'bounded-grep-first' : 'project-docs-codemap-first';
  const actions = [
    docs.ok && docs.coreIdentical ? null : { id: 'project-docs', safe: true, command: 'node tools/project-docs.js init --root <project>' },
    controlPlane.ok ? null : { id: 'agent-control-plane', safe: false, command: 'agent-skills.cmd rollout-projects --apply' },
    supplyChain.ok ? null : { id: 'agent-skill-supply-chain', safe: false, command: 'agent-skills.cmd audit; agent-skills.cmd install-skills --target all --apply' },
  ].filter(Boolean);
  return {
    kind: 'project-bootstrap',
    root: resolved,
    strategy,
    stack,
    recommended_probes: recommendedProbes(strategy, stack),
    file_count: files,
    checks: {
      ai_docs: { ok: docs.ok && docs.coreIdentical, missing: docs.missing || [] },
      harness: { ok: harness.ok, errors: harness.errors || [], config: harness.config },
      agent_control_plane: controlPlane,
      agent_skill_supply_chain: supplyChain,
    },
    actions,
  };
}

function applySafeActions(root, options = {}) {
  const before = scanProject(root, options);
  const docsResult = before.checks.ai_docs.ok ? null : initOrSyncProjectDocs({ root, mode: 'init', home: options.home });
  return {
    before,
    applied: [
      docsResult ? { id: 'project-docs', success: docsResult.success, mode: docsResult.mode } : null,
    ].filter(Boolean),
    after: scanProject(root, options),
  };
}

function parseArgs(argv) {
  const command = ['inspect', 'plan', 'apply', 'verify', 'migration-plan'].includes(argv[2]) ? argv[2] : null;
  const defaults = { command, root: process.cwd(), apply: false, json: false, home: undefined, supplyChain: true, codegraph: false, deep: false };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--apply') return parseNext(index + 1, { ...state, apply: true });
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--codegraph') return parseNext(index + 1, { ...state, codegraph: true });
    if (arg === '--deep') return parseNext(index + 1, { ...state, deep: true });
    if (arg === '--no-supply-chain') return parseNext(index + 1, { ...state, supplyChain: false });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--home') return parseNext(index + 2, { ...state, home: argv[index + 1] || state.home });
    return parseNext(index + 1, state);
  };
  return parseNext(command ? 3 : 2, defaults);
}

function run(options) {
  if (options.command === 'inspect') return inspectProject(options.root, options);
  if (options.command === 'plan') return planTargetState(options.root, options);
  if (options.command === 'apply') return applyPlan(options.root, options);
  if (options.command === 'verify') return verifyProject(options.root, options);
  if (options.command === 'migration-plan') return migrationPlan(options.home, options);
  return options.apply ? applySafeActions(options.root, options) : scanProject(options.root, options);
}

const TEXT_SUMMARY = {
  inspect: (report) => `project-bootstrap-inspect: ${report.classification.kind}`,
  plan: (report) => `project-bootstrap-plan: ${report.classification.kind}`,
  apply: (report) => `project-bootstrap-apply: ${report.changes.length} changes, ${report.blocked.length} blocked`,
  verify: (report) => `project-bootstrap-verify: ${report.ok ? 'PASS' : 'FAIL'} (${report.classification.kind})`,
  'migration-plan': (report) => `project-bootstrap-migration-plan: ${report.scanned} projects — ${Object.entries(report.totals.byRisk).map(([r, n]) => `${r}=${n}`).join(' ')}`,
};

function main() {
  const options = parseArgs(process.argv);
  const report = run(options);
  const legacySummary = () => `${report.kind || 'project-bootstrap'}: ${report.after ? report.after.strategy : report.strategy}\n`;
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${options.command ? TEXT_SUMMARY[options.command](report) : legacySummary().trimEnd()}\n`);
  if (options.command === 'inspect') { if (!report.harness.ok) process.exitCode = 1; return; }
  if (options.command === 'plan') return;
  if (options.command === 'migration-plan') return;
  if (options.command === 'apply') { if (report.blocked.length > 0) process.exitCode = 1; return; }
  if (options.command === 'verify') { if (!report.ok) process.exitCode = 1; return; }
  const checks = report.after ? report.after.checks : report.checks;
  if (!checks.harness.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  applyPlan,
  probeGitGate,
  hooksPathOf,
  HOOKS_PATH,
  applySafeActions,
  checkGateContract,
  checkJudgeBridgeContract,
  checkOracleVerifierContract,
  classifyKind,
  controlPlaneStatus,
  detectStack,
  fileCount,
  inspectProject,
  migrationPlan,
  planProjectMigration,
  planTargetState,
  recommendedProbes,
  run,
  scanProject,
  summarizeSupplyChain,
  supplyChainStatus,
  verifyProject,
};
