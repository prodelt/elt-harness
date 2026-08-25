'use strict';
// 020 T014 — неизменяемая identity спеки/задачи и канонический approval digest
// `elt-approval/v1`.
//
// Сегодня подпись плана — это ДВА хеша (`Spec-Hash`, `Tasks-Hash`) над текстом с
// CRLF-нормализацией и нормализованными галочками. Этого хватило, чтобы закрыть D4/D7/D11,
// но у схемы нет ни версии, ни границ записей: два файла склеиваются в две независимые
// строки, и никто не может доказать, что подпись относится именно к паре
// `spec.md` + `tasks.md` в этом порядке. Плюс живой источник расхождений — Unicode: одна и
// та же кириллица в NFC и NFD даёт разные байты и разный хеш на Windows и Linux.
//
// `elt-approval/v1` закрывает ровно это: одна versioned запись, length-prefixed границы,
// POSIX-пути, порядок `spec.md → tasks.md`, UTF-8/LF/NFC и галочка, нормализованная к `[ ]`.
// Смена схемы делает старую подпись stale — это заявленное поведение, а не регресс.
//
// Файл чистый: fs только на чтение файлов спеки, ни git, ни сети. Старый write-path
// (`elt spec approve`) остаётся авторитетным до T015 — здесь ничего не переписывается.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPROVAL_SCHEMA = 'elt-approval/v1';

// Роли идут в фиксированном порядке. Порядок — часть подписи: перестановка файлов не должна
// давать тот же digest, иначе «подписан план» и «подписана спека» становятся неразличимы.
const ROLES = [
  { role: 'spec', file: 'spec.md' },
  { role: 'tasks', file: 'tasks.md' },
];

const TASK_LINE = /^\s*[-*]\s*\[([ xX])\]\s*\*\*(T\d{3})\*\*\s*(.*)$/;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Repo-relative POSIX path: на Windows `path.relative` даёт `specs\020-...`, и подпись,
// снятая там, не совпала бы с подписью из Linux CI при одинаковом содержимом.
function repoRelativePosix(repoDir, target) {
  return path.relative(repoDir, target).split(path.sep).join('/');
}

// Канонизация текста — ровно четыре операции, каждая закрывает конкретный источник
// расхождения байтов при одинаковом смысле.
function canonicalText(raw) {
  return String(raw)
    .replace(/^﻿/, '')            // BOM: PowerShell 5.1 пишет его в UTF-8 файлы
    .replace(/\r\n/g, '\n')            // CRLF: чекаут worktree против основного дерева (D4)
    .replace(/^(\s*[-*]\s*\[)[xX](\])/gm, '$1 $2') // статус выполнения — не часть намерения (D11)
    .normalize('NFC');                 // одна и та же кириллица в двух формах Unicode
}

// Length-prefixed запись: без явной длины конкатенация двух файлов двусмысленна — перенос
// текста из конца spec.md в начало tasks.md дал бы тот же поток байтов и тот же digest.
function canonicalRecord(role, posixPath, text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`${APPROVAL_SCHEMA}\n${role}\n${posixPath}\n${body.length}\n`, 'utf8');
  return Buffer.concat([header, body, Buffer.from('\n', 'utf8')]);
}

/**
 * approvalDigest({ repoDir, specDir }) → { ok, schema, digest, records } | { ok:false, reason }
 * Digest считается ТОЛЬКО по canonical records; никакие поля состояния (галочки, даты,
 * commit) в него не входят по определению.
 */
function approvalDigest({ repoDir, specDir }) {
  const records = [];
  const parts = [];
  for (const { role, file } of ROLES) {
    const full = path.join(specDir, file);
    if (!fs.existsSync(full)) return { ok: false, reason: `missing-${role}`, detail: `${file} not found` };
    const posix = repoRelativePosix(repoDir, full);
    const text = canonicalText(fs.readFileSync(full, 'utf8'));
    const record = canonicalRecord(role, posix, text);
    parts.push(record);
    records.push({ role, path: posix, bytes: Buffer.byteLength(text, 'utf8'), digest: sha256(record) });
  }
  return { ok: true, schema: APPROVAL_SCHEMA, digest: sha256(Buffer.concat(parts)), records };
}

// Тот же digest, но из уже прочитанных строк: нужен golden-фикстуре теста, которая обязана
// давать одинаковый результат на Windows и Linux без файлов на диске и без .gitattributes.
function approvalDigestFromTexts(entries) {
  const parts = entries.map(({ role, path: posix, text }) => canonicalRecord(role, posix, canonicalText(text)));
  return { ok: true, schema: APPROVAL_SCHEMA, digest: sha256(Buffer.concat(parts)) };
}

/**
 * taskIdentities(tasksText, specPath) → [{ specPath, id, index, title }]
 * Порядок — как в файле (спека: «file-order tasks»), индекс входит в identity: перестановка
 * задач меняет план, и proof старого порядка не должен молча подходить новому.
 * Голый `T013` идентичностью не является: тот же ID живёт в каждой спеке репозитория.
 */
function taskIdentities(tasksText, specPath) {
  const out = [];
  const lines = canonicalText(tasksText).split('\n');
  for (const line of lines) {
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    out.push({ specPath, id: m[2], index: out.length, title: m[3].trim() });
  }
  return out;
}

function sameIdentity(a, b) {
  return Boolean(a) && Boolean(b) && a.specPath === b.specPath && a.id === b.id && a.index === b.index;
}

// Ключ для журнала и отчётов. Индекс намеренно не в ключе: он часть identity, но ключом
// служит пара (спека, id) — иначе одна и та же задача после вставки соседа выглядела бы
// другой задачей и ломала бы сверку миграции.
function identityKey(identity) {
  return `${identity.specPath}#${identity.id}`;
}

module.exports = {
  APPROVAL_SCHEMA,
  approvalDigest,
  approvalDigestFromTexts,
  canonicalText,
  identityKey,
  repoRelativePosix,
  sameIdentity,
  taskIdentities,
};
