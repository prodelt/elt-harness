'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { transformPayloadForCaching } = require('./proxy_core');

test('injects cache_control into the longest system text block', () => {
  const original = {
    model: 'claude-sonnet-4-6',
    system: 'This is the stable reusable system prompt block.',
    messages: [{ role: 'user', content: 'short' }],
  };
  const snapshot = structuredClone(original);

  const result = transformPayloadForCaching(original);

  assert.equal(result.injected, true);
  assert.equal(result.reason, 'cache_control_injected');
  assert.equal(original.system, snapshot.system);
  assert.deepEqual(original.messages, snapshot.messages);
  assert.ok(Array.isArray(result.payload.system));
  assert.equal(result.payload.system[0].cache_control.type, 'ephemeral');
});

test('injects cache_control into the longest message text block', () => {
  const original = {
    messages: [
      { role: 'user', content: 'tiny' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'This block is significantly longer than tiny.' }],
      },
    ],
  };

  const result = transformPayloadForCaching(original);

  assert.equal(result.injected, true);
  assert.equal(result.target.location.scope, 'messages');
  assert.equal(
    result.payload.messages[1].content[0].cache_control.type,
    'ephemeral',
  );
});

test('skips injection when four explicit breakpoints already exist', () => {
  const cachedBlock = (text) => ({
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  });
  const original = {
    system: [cachedBlock('one'), cachedBlock('two')],
    messages: [
      { role: 'user', content: [cachedBlock('three')] },
      {
        role: 'assistant',
        content: [cachedBlock('four'), { type: 'text', text: 'this uncached block is the longest' }],
      },
    ],
  };

  const result = transformPayloadForCaching(original);

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'breakpoint_limit_reached');
  assert.equal(result.payload, original);
});

test('skips injection when top-level automatic caching already consumes a slot budget', () => {
  const cachedBlock = (text) => ({
    type: 'text',
    text,
    cache_control: { type: 'ephemeral' },
  });
  const original = {
    cache_control: { type: 'ephemeral' },
    system: [cachedBlock('one'), cachedBlock('two')],
    messages: [
      {
        role: 'user',
        content: [cachedBlock('three'), { type: 'text', text: 'this uncached block is the longest' }],
      },
    ],
  };

  const result = transformPayloadForCaching(original);

  assert.equal(result.injected, false);
  assert.equal(result.reason, 'breakpoint_limit_reached');
});
