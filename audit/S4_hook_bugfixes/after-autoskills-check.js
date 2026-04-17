#!/usr/bin/env node

/**
 * SessionStart hook: Tech Stack Skills Check
 *
 * Scans project for package.json/go.mod/pyproject.toml,
 * detects frameworks, and recommends missing skills via additionalContext.
 * Advisory only — does not block.
 */

const fs = require('fs');
const path = require('path');
const metrics = require('./lib/metrics');
const { normCwd } = require('./lib/pathnorm');

metrics.inc('autoskills-check', 'fired');
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const cwd = normCwd((input && input.cwd) || process.cwd());

// Map: dependency name → skill recommendation
const SKILL_MAP = {
  // Frontend
  'react': 'React patterns & best practices',
  'next': 'Next.js App Router patterns',
  'vue': 'Vue.js patterns',
  'svelte': 'Svelte patterns',
  'astro': 'Astro patterns',
  // Backend
  'express': 'Express.js patterns',
  'hono': 'Hono framework patterns',
  'fastify': 'Fastify patterns',
  // Database
  'prisma': 'Prisma ORM patterns',
  'drizzle-orm': 'Drizzle ORM patterns',
  '@supabase/supabase-js': 'Supabase patterns',
  // Styling
  'tailwindcss': 'Tailwind CSS v4 patterns',
  // Testing
  'playwright': 'Playwright testing patterns',
  'vitest': 'Vitest testing patterns',
  // Animation
  'gsap': 'GSAP animation patterns',
  'three': 'Three.js / R3F patterns',
  'framer-motion': 'Framer Motion patterns',
};

try {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) process.exit(0);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps || Object.keys(deps).length === 0) process.exit(0);

  const detected = [];
  for (const [dep, hint] of Object.entries(SKILL_MAP)) {
    if (deps[dep]) {
      detected.push(hint);
    }
  }

  if (detected.length === 0) process.exit(0);

  // Check if Context7 should be reminded for detected stack
  const msg = [
    'TECH STACK DETECTED: ' + detected.join(', ') + '.',
    'Use Context7 (mcp__context7__resolve-library-id → query-docs) for current API docs before coding.',
    'Use SkillsMP (mcp__skillsmp__skillsmp_search) to find relevant skills for your stack.'
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: msg
    }
  }));
} catch {
  process.exit(0);
}
