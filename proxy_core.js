'use strict';

const http = require('node:http');
const { Readable } = require('node:stream');

const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? '8080', 10);
const UPSTREAM_MESSAGES_URL =
  process.env.ANTHROPIC_MESSAGES_URL ?? 'https://api.anthropic.com/v1/messages';

function log(level, message, details = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...details,
  });
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${entry}\n`);
}

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw createHttpError(400, 'Invalid JSON body', { cause: error.message });
  }
}

function validateMessagesPayload(payload) {
  const isObject = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
  if (!isObject) {
    throw createHttpError(400, 'Request body must be a JSON object');
  }
  if (!Array.isArray(payload.messages)) {
    throw createHttpError(400, 'Request body must include a messages array');
  }
  payload.messages.forEach((message, index) => {
    const isMessageObject =
      message !== null && typeof message === 'object' && !Array.isArray(message);
    const hasValidContent =
      typeof message?.content === 'string' || Array.isArray(message?.content);
    if (!isMessageObject || typeof message.role !== 'string' || !hasValidContent) {
      throw createHttpError(400, 'Each message must include role and content', {
        messageIndex: index,
      });
    }
  });
}

function normalizeBlocks(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content;
  }
  return [];
}

function isTextBlock(block) {
  return (
    block !== null &&
    typeof block === 'object' &&
    block.type === 'text' &&
    typeof block.text === 'string' &&
    block.text.trim().length > 0
  );
}

function buildSystemCandidates(system) {
  const blocks = normalizeBlocks(system);
  return blocks
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => isTextBlock(block))
    .map(({ block, blockIndex }) => ({
      block,
      length: block.text.length,
      location: {
        scope: 'system',
        blockIndex,
      },
    }));
}

function buildMessageCandidates(messages) {
  return messages.flatMap((message, messageIndex) =>
    normalizeBlocks(message.content)
      .map((block, blockIndex) => ({ block, blockIndex }))
      .filter(({ block }) => isTextBlock(block))
      .map(({ block, blockIndex }) => ({
        block,
        length: block.text.length,
        location: {
          scope: 'messages',
          messageIndex,
          blockIndex,
        },
      })),
  );
}

function collectTextCandidates(payload) {
  return [...buildSystemCandidates(payload.system), ...buildMessageCandidates(payload.messages)];
}

function countUsedBreakpointSlots(payload) {
  const topLevelSlots = payload.cache_control ? 1 : 0;
  const blockLevelSlots = [...normalizeBlocks(payload.system), ...payload.messages.flatMap((message) =>
    normalizeBlocks(message.content),
  )].filter((block) => block?.cache_control).length;

  return topLevelSlots + blockLevelSlots;
}

function selectLongestCandidate(candidates) {
  return candidates.reduce((currentLongest, candidate) => {
    if (!currentLongest || candidate.length > currentLongest.length) {
      return candidate;
    }
    return currentLongest;
  }, null);
}

function updateSystemBlock(payload, blockIndex, nextBlock) {
  const nextSystem = normalizeBlocks(payload.system).map((block, currentIndex) =>
    currentIndex === blockIndex ? nextBlock : block,
  );
  return {
    ...payload,
    system: nextSystem,
  };
}

function updateMessageBlock(payload, messageIndex, blockIndex, nextBlock) {
  const nextMessages = payload.messages.map((message, currentMessageIndex) => {
    if (currentMessageIndex !== messageIndex) {
      return message;
    }
    const nextContent = normalizeBlocks(message.content).map((block, currentBlockIndex) =>
      currentBlockIndex === blockIndex ? nextBlock : block,
    );
    return {
      ...message,
      content: nextContent,
    };
  });

  return {
    ...payload,
    messages: nextMessages,
  };
}

function applyBreakpoint(payload, candidate) {
  const nextBlock = {
    ...candidate.block,
    cache_control: { type: 'ephemeral' },
  };

  if (candidate.location.scope === 'system') {
    return updateSystemBlock(payload, candidate.location.blockIndex, nextBlock);
  }

  return updateMessageBlock(
    payload,
    candidate.location.messageIndex,
    candidate.location.blockIndex,
    nextBlock,
  );
}

function transformPayloadForCaching(payload) {
  validateMessagesPayload(payload);

  const candidates = collectTextCandidates(payload);
  const target = selectLongestCandidate(candidates);

  if (!target) {
    return { payload, injected: false, reason: 'no_text_block_found' };
  }

  if (target.block.cache_control) {
    return { payload, injected: false, reason: 'target_already_cached', target };
  }

  if (countUsedBreakpointSlots(payload) >= 4) {
    return { payload, injected: false, reason: 'breakpoint_limit_reached', target };
  }

  return {
    payload: applyBreakpoint(payload, target),
    injected: true,
    reason: 'cache_control_injected',
    target,
  };
}

function buildUpstreamHeaders(headers) {
  const ignoredHeaders = new Set(['connection', 'content-length', 'host']);
  const nextHeaders = {
    'content-type': 'application/json',
  };

  Object.entries(headers).forEach(([name, value]) => {
    if (ignoredHeaders.has(name.toLowerCase()) || value === undefined) {
      return;
    }
    nextHeaders[name] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return nextHeaders;
}

async function sendToAnthropic(req, payload) {
  const response = await fetch(UPSTREAM_MESSAGES_URL, {
    method: 'POST',
    headers: buildUpstreamHeaders(req.headers),
    body: JSON.stringify(payload),
  });
  return response;
}

function writeUpstreamHeaders(res, headers) {
  const ignoredHeaders = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'transfer-encoding',
  ]);

  headers.forEach((value, name) => {
    if (!ignoredHeaders.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  });
}

async function relayUpstreamResponse(res, upstreamResponse) {
  res.statusCode = upstreamResponse.status;
  writeUpstreamHeaders(res, upstreamResponse.headers);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  const upstreamStream = Readable.fromWeb(upstreamResponse.body);
  await new Promise((resolve, reject) => {
    upstreamStream.once('error', reject);
    res.once('finish', resolve);
    res.once('close', resolve);
    upstreamStream.pipe(res);
  });
}

function sendError(res, error) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
  const details = error.details && Object.keys(error.details).length > 0 ? error.details : undefined;
  const body = JSON.stringify({
    error: error.message || 'Unexpected proxy error',
    code: statusCode,
    details,
  });

  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(body);
}

async function handleMessagesRequest(req, res) {
  const rawBody = await readRequestBody(req);
  const payload = parseJsonBody(rawBody);
  const result = transformPayloadForCaching(payload);

  log('info', 'Processed payload', {
    injected: result.injected,
    reason: result.reason,
    targetScope: result.target?.location.scope,
    targetLength: result.target?.length,
  });

  try {
    const upstreamResponse = await sendToAnthropic(req, result.payload);
    await relayUpstreamResponse(res, upstreamResponse);
  } catch (error) {
    throw createHttpError(502, 'Failed to reach Anthropic upstream', {
      cause: error.message,
    });
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
        throw createHttpError(404, 'Route not found');
      }

      await handleMessagesRequest(req, res);
    } catch (error) {
      sendError(res, error);
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(DEFAULT_PORT, () => {
    log('info', 'Zero-Token Proxy listening', {
      port: DEFAULT_PORT,
      upstream: UPSTREAM_MESSAGES_URL,
    });
  });
}

module.exports = {
  buildUpstreamHeaders,
  collectTextCandidates,
  createServer,
  transformPayloadForCaching,
};
