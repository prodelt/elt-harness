#!/usr/bin/env node
'use strict';

/**
 * measure-noise.js — замир сигнал/шум блокирующих вердиктів.
 *
 * Читає .git/elt/run-log.jsonl, бере останні N блокирующих вердиктів,
 * для кожного визначає по історії git, чи істинний він чи хибний.
 * Істинний — якщо після нього було виправлено ті ж файли.
 * Хибний — якщо коміт тих самих задач БЕЗ виправки названих файлів.
 * Невизначений (unknown) — якщо неясно або немає достатньо даних.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isIgnoredForReview } = require('./harness-files');

/**
 * Читає JSONL файл, кожна строка — один JSON об'єкт.
 * Бере останні N записів.
 */
function readJsonlLines(filePath, limit = Infinity) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(line => line.trim());

  const result = [];
  for (const line of lines.slice(-limit)) {
    try {
      result.push(JSON.parse(line));
    } catch (e) {
      // Залишаємо битий JSON, не валяємо скрипт
      continue;
    }
  }
  return result;
}

/**
 * Вороху гейту, L0, судді — яке відключення означає блокування?
 * Блокується коли:
 *   - status = judge-block + verdict = block
 *   - status = l0-block + verdict = block
 *   - status = background-verify-red + red = true в будь-якому шарі
 *   - status = red-stop
 *   - status = judge-dead
 */
function isBlockingVerdict(record) {
  const { status, verdict, background } = record;

  if (status === 'judge-block' && verdict === 'block') return true;
  if (status === 'l0-block' && verdict === 'block') return true;
  if (status === 'red-stop') return true;
  if (status === 'judge-dead') return true;

  // background-verify-red — коли red = true в будь-якому шарі
  if (status === 'background-verify-red' && background) {
    if (background.sections && background.sections.some(s => s.red === true)) {
      return true;
    }
  }

  return false;
}

/**
 * Витягує набір файлів з вердикта та його метаданих.
 * Шукає у:
 *   - judges[].reasons (може назвати файли у текстовій формі)
 *   - background.sections[].reason
 *   - l0.triggers[].files
 *
 * Повертає Set унікальних шляхів.
 */
function extractFilesFromVerdict(record) {
  const files = new Set();

  // З L0-тригерів
  if (record.l0 && record.l0.triggers) {
    for (const trigger of record.l0.triggers) {
      if (trigger.files) {
        for (const f of trigger.files) {
          files.add(String(f).replace(/\\/g, '/'));
        }
      }
    }
  }

  // З text-причин судді — наївний парсинг (ищемо звичайні назви файлів)
  if (record.judges) {
    for (const judge of record.judges) {
      if (judge.reasons) {
        for (const reason of judge.reasons) {
          // Шукаємо шаблони на кшталт `file.js` або `path/to/file.md`
          const fileMatches = reason.match(/[\w\-./]+\.[\w]+/g) || [];
          for (const match of fileMatches) {
            if (/^[.\w\-/\\]+\.\w+$/.test(match)) {
              files.add(match.replace(/\\/g, '/'));
            }
          }
        }
      }
    }
  }

  // З причин фону
  if (record.background && record.background.sections) {
    for (const section of record.background.sections) {
      if (section.reason) {
        const fileMatches = section.reason.match(/[\w\-./]+\.[\w]+/g) || [];
        for (const match of fileMatches) {
          if (/^[.\w\-/\\]+\.\w+$/.test(match)) {
            files.add(match.replace(/\\/g, '/'));
          }
        }
      }
    }
  }

  return files;
}

/**
 * Читає diff для заданого коміту (від заголовку першого лайну).
 * Шукає нові файли або змінені файли у diff.
 */
function getFilesInCommitDiff(repo, commitHash) {
  const result = spawnSync('git', ['diff', '--name-only', `${commitHash}^..${commitHash}`], {
    cwd: repo,
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    return new Set();
  }

  return new Set(
    result.stdout
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/\\/g, '/'))
  );
}

/**
 * Визначає, чи істинний вердикт по історії.
 *
 * Істинний = коміт після вердикту торкнув ті ж файли (або якщо нема явних файлів у вердикті).
 * Хибний = коміт той самої задачі без торкання названих файлів.
 * Unknown = інші випадки.
 */
function classifyVerdictTruth(repo, record, allRecords, index) {
  const { ts, task, commit } = record;
  const verdictFiles = extractFilesFromVerdict(record);

  // Коли немає явних файлів у вердикті, неможливо класифікувати
  if (verdictFiles.size === 0) {
    return 'unknown';
  }

  // Шукаємо перший коміт цієї ж задачі після вердикту
  const nextRecord = allRecords.slice(index + 1).find(r => {
    if (!r.commit || !r.task) return false;
    // Той самий батч-коміт чи коміт тієї ж задачі
    const sameTask = task && task.split(',').some(t => (r.task || '').includes(t.trim()));
    return sameTask && r.ts > ts;
  });

  if (!nextRecord || !nextRecord.commit) {
    return 'unknown'; // Немає подальшого коміту, нема доказу
  }

  const nextCommitFiles = getFilesInCommitDiff(repo, nextRecord.commit);

  // Чи були змінені файли, названі у вердикті?
  const hasRelevantChanges = [...verdictFiles].some(f => {
    // Нормалізуємо шляхи
    const normalized = f.replace(/\\/g, '/');
    return nextCommitFiles.has(normalized) ||
           [...nextCommitFiles].some(cf => cf.includes(normalized) || normalized.includes(cf));
  });

  if (hasRelevantChanges) {
    return 'true';
  }

  return 'false';
}

/**
 * Основна функція: замір шумів.
 */
function measureNoise(options = {}) {
  const repo = options.repo || '.';
  const last = options.last || 20;

  // Читаємо run-log.jsonl
  const logPath = path.join(repo, '.git/elt/run-log.jsonl');
  const allRecords = readJsonlLines(logPath);

  if (allRecords.length === 0) {
    return {
      error: 'Данних немає',
      blocking: 0,
      signal: 0,
      noise: 0,
      unknown: 0,
      wrongScope: [],
      ratio: null,
      dateRange: null,
    };
  }

  // Фільтруємо блокуючі вердикти
  const blockingRecords = allRecords.filter(isBlockingVerdict);
  const recentBlocking = blockingRecords.slice(-last);

  if (recentBlocking.length === 0) {
    return {
      error: 'Блокуючих вердиктів немає',
      blocking: 0,
      signal: 0,
      noise: 0,
      unknown: 0,
      wrongScope: [],
      ratio: null,
      dateRange: null,
    };
  }

  // Класифікуємо кожен вердикт
  let signal = 0;
  let noise = 0;
  let unknownCount = 0;
  const wrongScope = [];

  for (let i = 0; i < recentBlocking.length; i++) {
    const record = recentBlocking[i];
    const index = allRecords.indexOf(record);

    const verdictFiles = extractFilesFromVerdict(record);

    // Чи є файли, які НЕ мають бути предметом вердикту?
    for (const file of verdictFiles) {
      if (isIgnoredForReview(file)) {
        wrongScope.push({
          file,
          ts: record.ts,
          task: record.task,
          status: record.status,
        });
      }
    }

    const truth = classifyVerdictTruth(repo, record, allRecords, index);
    if (truth === 'true') {
      signal++;
    } else if (truth === 'false') {
      noise++;
    } else if (truth === 'unknown') {
      unknownCount++;
    }
  }

  const dateRange = recentBlocking.length > 0
    ? `${recentBlocking[0].ts} — ${recentBlocking[recentBlocking.length - 1].ts}`
    : null;

  // Отношение читается как «сигнал к шуму» и НЕ округляется до целого: при 5 истинных и
  // 2 ложных прежняя формула печатала «1:0» — то есть шума нет вовсе, чего в данных нет.
  const classified = signal + noise;
  const ratio = classified === 0 ? 'нет классифицированных'
    : noise === 0 ? `${signal}:0 (ложных не найдено)`
    : `${(signal / noise).toFixed(2)}:1`;
  // Критерий фазы 2 — сигнал не меньше шума. Считается ТОЛЬКО по классифицированным:
  // подмешивать unknown в любую сторону значит подгонять число.
  const meetsCriterion = classified > 0 && signal >= noise;
  const unknownShare = recentBlocking.length
    ? Number((unknownCount / recentBlocking.length).toFixed(3))
    : 0;

  return {
    error: null,
    blocking: recentBlocking.length,
    signal,
    noise,
    unknown: unknownCount,
    wrongScope,
    ratio,
    classified,
    meetsCriterion,
    unknownShare,
    dateRange,
  };
}

/**
 * CLI та експорт.
 */
module.exports = {
  measureNoise,
  isBlockingVerdict,
  extractFilesFromVerdict,
  classifyVerdictTruth,
  readJsonlLines,
};

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let repo = '.';
  let last = 20;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) {
      repo = args[++i];
    } else if (args[i] === '--last' && args[i + 1]) {
      last = parseInt(args[++i], 10) || 20;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  const result = measureNoise({ repo, last });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.error) {
      console.log(`❌ ${result.error}`);
      process.exit(1);
    }

    console.log(`\n📊 Замир сигнал/шум блокуючих вердиктів`);
    console.log(`========================================\n`);
    console.log(`Блокуючих вердиктів взято: ${result.blocking}`);
    console.log(`Період: ${result.dateRange}\n`);
    console.log(`Істинних блокувань (сигнал):  ${result.signal}`);
    console.log(`Хибних блокувань (шум):       ${result.noise}`);
    console.log(`Невизначених:                  ${result.unknown}\n`);
    console.log(`Відношення сигнал:шум = ${result.ratio}` +
      ` (критерій фази 2 «≥ 1:1»: ${result.meetsCriterion ? 'виконано' : 'НЕ виконано'};` +
      ` невизначених ${Math.round(result.unknownShare * 100)}%)\n`);

    if (result.wrongScope.length > 0) {
      console.log(`⚠️  Вердикти по файлам, які НЕ мають вноситися:`);
      result.wrongScope.forEach(item => {
        console.log(`   • ${item.file} (${item.status}, задача: ${item.task})`);
      });
    } else {
      console.log(`✅ Жодного вердикту по ігнорованим файлам`);
    }

    console.log();
  }
}
