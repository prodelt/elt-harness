#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readControlPlane(root, now = new Date()) {
  const file = path.join(root, '.planning', 'agent-control-plane.json');
  const parsed = readJson(file);
  if (!parsed.ok) return { ok: false, file, missing: !fs.existsSync(file), error: parsed.error };

  const bypass = parsed.value && parsed.value.supplyChainBypass;
  const hasBypass = !!(
    bypass &&
    typeof bypass.reason === 'string' &&
    bypass.reason.trim() &&
    typeof bypass.approvedBy === 'string' &&
    bypass.approvedBy.trim() &&
    typeof bypass.expiresAt === 'string'
  );
  const expiresAt = hasBypass ? new Date(bypass.expiresAt) : null;
  const bypassActive = hasBypass && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();

  return {
    ok: true,
    file,
    value: parsed.value,
    bypass: bypassActive
      ? {
          active: true,
          reason: bypass.reason,
          approvedBy: bypass.approvedBy,
          expiresAt: bypass.expiresAt,
        }
      : null,
  };
}

function targetClientsFromAudit(audit) {
  const clients = audit && audit.clients && typeof audit.clients === 'object' ? Object.keys(audit.clients) : [];
  return clients.length > 0 ? clients : ['claude', 'codex', 'gemini'];
}

function summarizeSupplyChainAudit(audit, { root = process.cwd(), now = new Date() } = {}) {
  const validationOk = !!(audit && audit.validation && audit.validation.ok);
  const targetClients = targetClientsFromAudit(audit);
  const approved = (audit && Array.isArray(audit.skills) ? audit.skills : [])
    .filter((skill) => skill.status === 'approved');

  const missingSource = approved.filter((skill) => !skill.sourceExists);
  const missingInstalls = approved.flatMap((skill) => targetClients
    .filter((client) => !(skill.clients && skill.clients[client] && skill.clients[client].installed))
    .map((client) => ({ skill: skill.name, client })));
  const driftedInstalls = approved.flatMap((skill) => targetClients
    .filter((client) => {
      const clientState = skill.clients && skill.clients[client];
      return clientState && clientState.installed && !clientState.matchesSource;
    })
    .map((client) => ({ skill: skill.name, client })));
  const missingClientRoots = targetClients
    .filter((client) => !(audit && audit.clients && audit.clients[client] && audit.clients[client].exists));

  const normalizedRoot = normalizePath(root);
  const projects = audit && Array.isArray(audit.projects) ? audit.projects : [];
  const currentProject = projects.find((project) => project.path && normalizePath(project.path) === normalizedRoot) || null;
  const currentControlPlaneMissing = currentProject ? currentProject.exists && !currentProject.controlPlane : false;
  const controlPlane = readControlPlane(root, now);
  const bypass = controlPlane.bypass;

  const driftCounts = {
    missingSource: missingSource.length,
    missingInstalls: missingInstalls.length,
    driftedInstalls: driftedInstalls.length,
    missingClientRoots: missingClientRoots.length,
    currentControlPlaneMissing: currentControlPlaneMissing ? 1 : 0,
  };
  const driftCount = Object.values(driftCounts).reduce((sum, count) => sum + count, 0);

  return {
    ok: validationOk && (driftCount === 0 || !!bypass),
    validationOk,
    bypass,
    targetClients,
    approvedCount: approved.length,
    driftCount,
    driftCounts,
    missingSource: missingSource.map((skill) => skill.name),
    missingInstalls,
    driftedInstalls,
    missingClientRoots,
    currentProject,
    controlPlane: {
      ok: controlPlane.ok,
      file: controlPlane.file,
      missing: controlPlane.missing === true || currentControlPlaneMissing,
      error: controlPlane.error || '',
    },
    summary: validationOk
      ? `approved=${approved.length} drift=${driftCount} bypass=${bypass ? 'active' : 'none'}`
      : 'manifest validation failed',
  };
}

function assertSupplyChainClean(summary) {
  if (summary && summary.ok) return { ok: true, reason: '' };
  if (summary && summary.bypass) return { ok: true, reason: '' };
  const reason = summary
    ? `Supply-chain drift blocks success: ${summary.summary}.`
    : 'Supply-chain preflight result is missing.';
  return { ok: false, reason };
}

module.exports = {
  assertSupplyChainClean,
  readControlPlane,
  summarizeSupplyChainAudit,
};
