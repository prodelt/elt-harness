const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db.js');

test('Database state store tests', async (t) => {
  await t.test('initDb creates database and tables', () => {
    const database = db.initDb();
    assert.ok(database);
    
    // Check tables exist
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(row => row.name);
    assert.ok(tableNames.includes('sessions'));
    assert.ok(tableNames.includes('events_metrics'));
    assert.ok(tableNames.includes('projects'));
    assert.ok(tableNames.includes('handoffs'));
  });

  await t.test('logEvent inserts events into events_metrics', () => {
    const testEvent = 'test-event-' + Date.now();
    const testProject = 'test-project';
    const duration = 123;
    const outputChars = 456;
    
    db.logEvent(testEvent, testProject, duration, outputChars);
    
    const database = db.initDb();
    const row = database.prepare("SELECT * FROM events_metrics WHERE event = ?").get(testEvent);
    assert.ok(row);
    assert.strictEqual(row.event, testEvent);
    assert.strictEqual(row.project, testProject);
    assert.strictEqual(row.duration_ms, duration);
    assert.strictEqual(row.output_chars, outputChars);
    assert.ok(row.fired_at);
  });

  await t.test('saveSession inserts and updates sessions', () => {
    const sessId = 'sess-' + Date.now();
    const projPath = '/path/to/project';
    
    // Insert
    db.saveSession(sessId, projPath, true);
    let row = db.initDb().prepare("SELECT * FROM sessions WHERE id = ?").get(sessId);
    assert.ok(row);
    assert.strictEqual(row.project_path, projPath);
    assert.strictEqual(row.active, 1);
    
    // Update active status
    db.saveSession(sessId, projPath, false);
    row = db.initDb().prepare("SELECT * FROM sessions WHERE id = ?").get(sessId);
    assert.strictEqual(row.active, 0);
  });

  await t.test('saveProject inserts and updates projects', () => {
    const projPath = '/path/to/project-' + Date.now();
    const projKey = 'test-key';
    
    db.saveProject(projPath, projKey);
    let row = db.initDb().prepare("SELECT * FROM projects WHERE path = ?").get(projPath);
    assert.ok(row);
    assert.strictEqual(row.key, projKey);
  });

  await t.test('saveHandoff inserts and updates handoffs', () => {
    const sessId = 'sess-handoff-' + Date.now();
    const handoffData = { step: 1, message: 'handoff test' };

    db.saveHandoff(sessId, handoffData);
    let row = db.initDb().prepare("SELECT * FROM handoffs WHERE session_id = ?").get(sessId);
    assert.ok(row);
    assert.strictEqual(row.data, JSON.stringify(handoffData));
  });

  await t.test('getHandoff returns parsed handoff data', () => {
    const sessId = 'sess-gethandoff-' + Date.now();
    const handoffData = { task: 'S2.1', phase: 'implement', open_steps: ['a', 'b'] };

    db.saveHandoff(sessId, handoffData);
    const handoff = db.getHandoff(sessId);

    assert.ok(handoff);
    assert.strictEqual(handoff.session_id, sessId);
    assert.deepStrictEqual(handoff.data, handoffData);
    assert.ok(handoff.created_at);
  });

  await t.test('getHandoff returns null for unknown session', () => {
    const handoff = db.getHandoff('sess-does-not-exist-' + Date.now());
    assert.strictEqual(handoff, null);
  });

  await t.test('getMetricsSummary aggregates correctly', () => {
    const testEvent = 'summary-event-' + Date.now();
    db.logEvent(testEvent, 'proj', 50, 100);
    db.logEvent(testEvent, 'proj', 150, 200);
    
    const summary = db.getMetricsSummary();
    const eventSummary = summary.find(row => row.event === testEvent);
    assert.ok(eventSummary);
    assert.strictEqual(Number(eventSummary.count), 2);
    assert.strictEqual(Number(eventSummary.total_duration_ms), 200);
    assert.strictEqual(Number(eventSummary.avg_duration_ms), 100);
    assert.strictEqual(Number(eventSummary.max_duration_ms), 150);
    assert.strictEqual(Number(eventSummary.total_output_chars), 300);
    assert.strictEqual(Number(eventSummary.avg_output_chars), 150);
  });
});
