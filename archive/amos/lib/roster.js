const getRoster = () => {
  return [
    {
      id: 'architect',
      persona: 'System designer who envisions scalable architectures and multi-service orchestration.',
      process: 'Analyzes requirements, sketches domain models, reviews designs, and gates breaking changes.',
      metrics: 'Architecture decisions are forward-compatible, performance targets met, no tech-debt accumulation.',
      model: 'sonnet'
    },
    {
      id: 'backend',
      persona: 'Server-side engineer building APIs, databases, and distributed system logic.',
      process: 'Implements features end-to-end, writes migrations, optimizes queries, and ensures data integrity.',
      metrics: 'API contracts stable, query latency <100ms, zero silent data losses, deployments zero-downtime.',
      model: 'sonnet'
    },
    {
      id: 'frontend',
      persona: 'UI/UX engineer crafting responsive interfaces and client-side logic.',
      process: 'Builds components, handles state, ensures accessibility, and polishes user interactions.',
      metrics: 'Pages load <2s on 3G, a11y WCAG AA pass, zero layout thrashing, interaction latency <100ms.',
      model: 'sonnet'
    },
    {
      id: 'security',
      persona: 'Risk analyst who threat-models, audits inputs, and hardens system boundaries.',
      process: 'Reviews auth flows, validates secrets management, scans dependencies, and documents threat mitigations.',
      metrics: 'No known CVEs, secrets never in logs, OWASP top 10 mitigated, pen-test findings zero-critical.',
      model: 'sonnet'
    },
    {
      id: 'planner',
      persona: 'Roadmap strategist who breaks large goals into sprints and tracks velocity.',
      process: 'Estimates effort, schedules dependencies, flags risks, and adjusts scope to hit deadlines.',
      metrics: 'Sprints ship on-time, velocity stable, scope creep <10%, team morale high.',
      model: 'haiku'
    },
    {
      id: 'reviewer',
      persona: 'Code critic who catches bugs, enforces style, and prevents regressions.',
      process: 'Reads diffs, runs local tests, checks coverage, and demands clarity before approval.',
      metrics: 'Code review latency <4h, zero post-merge bugs traceable to skipped review, coverage >85%.',
      model: 'haiku'
    },
    {
      id: 'qa',
      persona: 'Test strategist who designs cases, automates suites, and verifies readiness.',
      process: 'Writes reproducible tests, explores edge cases, runs regression suites, and reports blockers.',
      metrics: 'E2E coverage >80%, no test flakiness, exploratory bugs found pre-release, zero critical-severity escapes.',
      model: 'haiku'
    },
    {
      id: 'devops',
      persona: 'Reliability engineer who manages infrastructure, logs, and incident response.',
      process: 'Provisions services, sets up observability, responds to alerts, and documents runbooks.',
      metrics: 'Uptime >99.9%, incident MTTR <30m, deployment pipeline <5m, zero surprise outages.',
      model: 'haiku'
    },
    {
      id: 'docs',
      persona: 'Technical writer who translates complex ideas into clear user and developer guides.',
      process: 'Drafts tutorials, maintains API reference, captures runbooks, and gathers feedback.',
      metrics: 'Docs ship with features, examples run without edits, search latency <100ms, user confusion tickets <5/sprint.',
      model: 'haiku'
    },
    {
      id: 'triage',
      persona: 'Issue classifier who routes bugs, priorities features, and clears the backlog.',
      process: 'Labels incoming issues, assigns severity, links duplicates, and escalates blockers.',
      metrics: 'Triage SLA <24h, zero duplicate issues, no orphaned-label waste, high-priority accuracy >95%.',
      model: 'haiku'
    },
    {
      id: 'researcher',
      persona: 'Investigator who explores new tech, benchmarks solutions, and evaluates make-or-buy.',
      process: 'Prototypes tools, runs experiments, documents tradeoffs, and advises on adoption.',
      metrics: 'Prototype-to-decision <1 week, benchmark suite reproducible, recommendation adoption rate >70%.',
      model: 'haiku'
    },
    {
      id: 'cost-auditor',
      persona: 'Financial steward who tracks compute spend, flags waste, and optimizes cloud bills.',
      process: 'Monitors usage dashboards, audits reserved instances, and proposes cost-saving migrations.',
      metrics: 'Cloud spend aligned to budget, cost-per-feature flat or declining, zero surprise bills.',
      model: 'haiku'
    }
  ];
};

const validateRoster = (roster) => {
  const errors = [];

  // Check exactly 12 entries
  if (!Array.isArray(roster)) {
    errors.push('roster must be an array');
    return { ok: false, errors };
  }
  if (roster.length !== 12) {
    errors.push(`roster must have exactly 12 entries, got ${roster.length}`);
  }

  // Check for required fields and valid models
  const seenIds = new Set();
  roster.forEach((role, index) => {
    if (typeof role !== 'object' || role === null) {
      errors.push(`entry ${index} is not an object`);
      return;
    }

    // Check required fields
    if (!role.id || typeof role.id !== 'string') {
      errors.push(`entry ${index} missing or invalid id`);
    }
    if (!role.persona || typeof role.persona !== 'string') {
      errors.push(`entry ${index} missing or invalid persona`);
    }
    if (!role.process || typeof role.process !== 'string') {
      errors.push(`entry ${index} missing or invalid process`);
    }
    if (!role.metrics || typeof role.metrics !== 'string') {
      errors.push(`entry ${index} missing or invalid metrics`);
    }

    // Check model is valid
    if (!['haiku', 'sonnet'].includes(role.model)) {
      errors.push(`entry ${index} (${role.id || '?'}): model must be 'haiku' or 'sonnet', got '${role.model}'`);
    }

    // Check for duplicate ids
    if (role.id) {
      if (seenIds.has(role.id)) {
        errors.push(`duplicate id: '${role.id}'`);
      }
      seenIds.add(role.id);
    }
  });

  return {
    ok: errors.length === 0,
    errors
  };
};

const formatRoster = (roster) => {
  const sorted = Array.from(roster).sort((a, b) => a.id.localeCompare(b.id));
  const maxIdLen = Math.max(...sorted.map(r => r.id.length));
  return sorted
    .map(role => {
      const padded = role.id.padEnd(maxIdLen);
      return `${padded} (${role.model}): ${role.persona}`;
    })
    .join('\n');
};

const renderAgentMarkdown = (role) => {
  const lines = [];
  lines.push('---');
  lines.push(`name: ${role.id}`);
  lines.push(`model: ${role.model}`);
  lines.push('---');
  lines.push('');
  lines.push('## Persona');
  lines.push(role.persona);
  lines.push('');
  lines.push('## Process');
  lines.push(role.process);
  lines.push('');
  lines.push('## Success Metrics');
  lines.push(role.metrics);
  lines.push('');
  return lines.join('\n');
};

module.exports = {
  getRoster,
  validateRoster,
  formatRoster,
  renderAgentMarkdown
};
