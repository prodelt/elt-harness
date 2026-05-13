#!/usr/bin/env node
'use strict';
/**
 * W10-02: RAG manifest validator
 * Validates .rag/manifest.json format, required fields, and exclude-rules.
 * Usage: node validate-rag-manifest.js <manifest-path> [--json]
 * Exit: 0 = valid, 1 = invalid
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_TOP = ['project', 'path', 'version', 'include', 'exclude',
  'rebuild_triggers', 'index_dir', 'last_built', 'provider', 'query_modes'];

const REQUIRED_EXCLUDES = ['.env*', 'secrets*', 'node_modules/**', '*.lock', '*.log'];
const VALID_PROVIDERS = ['lightrag', 'chromadb', 'weaviate', 'qdrant'];
const VALID_LABELS = ['project-docs', 'memory', 'architecture', 'audit-notes', 'graph-summary', 'source'];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function validateManifest(manifest) {
  const errors = [];
  const warnings = [];

  // 1. Required top-level fields
  for (const field of REQUIRED_TOP) {
    if (!(field in manifest)) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // 2. version: semver
  if (manifest.version && !SEMVER_RE.test(manifest.version)) {
    errors.push(`"version" must be semver (got: "${manifest.version}")`);
  }

  // 3. provider
  if (manifest.provider && !VALID_PROVIDERS.includes(manifest.provider)) {
    warnings.push(`"provider" "${manifest.provider}" not in known list: ${VALID_PROVIDERS.join(', ')}`);
  }

  // 4. include[] validation
  if (Array.isArray(manifest.include)) {
    manifest.include.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`include[${i}] must be an object`);
        return;
      }
      if (typeof entry.glob !== 'string' || !entry.glob.trim()) {
        errors.push(`include[${i}] missing required "glob" string`);
      }
      if (typeof entry.label !== 'string' || !entry.label.trim()) {
        errors.push(`include[${i}] missing required "label" string`);
      } else if (!VALID_LABELS.includes(entry.label)) {
        warnings.push(`include[${i}].label "${entry.label}" not in known labels: ${VALID_LABELS.join(', ')}`);
      }
    });
    if (manifest.include.length === 0) {
      errors.push('"include" array must not be empty');
    }
  } else if ('include' in manifest) {
    errors.push('"include" must be an array');
  }

  // 5. exclude[] — mandatory security patterns
  if (Array.isArray(manifest.exclude)) {
    for (const required of REQUIRED_EXCLUDES) {
      const pattern = required.replace(/\*/g, '');
      const covered = manifest.exclude.some(e => String(e).includes(pattern.replace(/\/$/, '')));
      if (!covered) {
        errors.push(`"exclude" is missing required security pattern covering "${required}"`);
      }
    }
    // Warn if secrets might leak
    const hasEnvExclude = manifest.exclude.some(e => String(e).includes('.env'));
    const hasSecretsExclude = manifest.exclude.some(e => String(e).includes('secret'));
    if (!hasEnvExclude) errors.push('"exclude" must contain a pattern covering ".env*" files');
    if (!hasSecretsExclude) errors.push('"exclude" must contain a pattern covering "secrets*" files');
  } else if ('exclude' in manifest) {
    errors.push('"exclude" must be an array');
  }

  // 6. index_dir must end with /
  if (manifest.index_dir && !String(manifest.index_dir).endsWith('/')) {
    warnings.push('"index_dir" should end with "/" (got: "' + manifest.index_dir + '")');
  }

  // 7. query_modes — must be object with fallback
  if (manifest.query_modes !== null && manifest.query_modes !== undefined) {
    if (typeof manifest.query_modes !== 'object') {
      errors.push('"query_modes" must be an object or null');
    } else if (!manifest.query_modes.fallback) {
      warnings.push('"query_modes" should define a "fallback" mode');
    }
  }

  // 8. rebuild_triggers must be non-empty array
  if (Array.isArray(manifest.rebuild_triggers)) {
    if (manifest.rebuild_triggers.length === 0) {
      warnings.push('"rebuild_triggers" is empty — when will the index rebuild?');
    }
  } else if ('rebuild_triggers' in manifest) {
    errors.push('"rebuild_triggers" must be an array');
  }

  return { errors, warnings };
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const filePath = args.find(a => !a.startsWith('--'));

  if (!filePath) {
    const msg = 'Usage: node validate-rag-manifest.js <manifest-path> [--json]';
    if (jsonMode) process.stdout.write(JSON.stringify({ success: false, errors: [msg], warnings: [] }));
    else console.error(msg);
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    const msg = `File not found: ${resolved}`;
    if (jsonMode) process.stdout.write(JSON.stringify({ success: false, errors: [msg], warnings: [] }));
    else console.error(msg);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (e) {
    const msg = `JSON parse error: ${e.message}`;
    if (jsonMode) process.stdout.write(JSON.stringify({ success: false, errors: [msg], warnings: [] }));
    else console.error(msg);
    process.exit(1);
  }

  const { errors, warnings } = validateManifest(manifest);
  const success = errors.length === 0;

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ success, file: resolved, errors, warnings }));
  } else {
    if (success) {
      process.stdout.write(`✅ VALID: ${resolved}\n`);
      process.stdout.write(`   project: ${manifest.project || '?'} | provider: ${manifest.provider || '?'} | includes: ${Array.isArray(manifest.include) ? manifest.include.length : '?'}\n`);
    } else {
      process.stderr.write(`❌ INVALID: ${resolved}\n`);
      errors.forEach(e => process.stderr.write(`  ERROR: ${e}\n`));
    }
    warnings.forEach(w => process.stderr.write(`  WARN: ${w}\n`));
  }

  process.exit(success ? 0 : 1);
}

main();
