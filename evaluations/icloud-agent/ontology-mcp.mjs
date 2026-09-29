import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { transformResults } from './ontology-transform-receipt.mjs';

const runnerPath = process.env.ONTOLOGY_EVAL_RUNNER;
const artifactPath = process.env.ONTOLOGY_EVAL_ARTIFACT;
const outputDir = process.env.ONTOLOGY_EVAL_OUTPUT_DIR;
if (!runnerPath?.startsWith('/') || !artifactPath?.startsWith('/')) {
  throw new Error('ONTOLOGY_EVAL_RUNNER and ONTOLOGY_EVAL_ARTIFACT must be absolute host paths');
}
if (!outputDir?.startsWith('/') || !statSync(outputDir).isDirectory()) {
  throw new Error('ONTOLOGY_EVAL_OUTPUT_DIR must be an existing absolute host directory');
}
const tools = [
  {
    name: 'index',
    description: 'List ontology knowledge topics with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'info',
    description: 'Resolve an exact ontology topic or stable knowledge target.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        target: {
          type: 'object',
          properties: {
            kind: { type: 'string' },
            owner: { type: 'string' },
            id: { type: 'string' },
          },
          required: ['kind', 'owner', 'id'],
          additionalProperties: false,
        },
      },
      oneOf: [{ required: ['topic'] }, { required: ['target'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'transform',
    description: 'Validate and store one to five independent Model-backed Intents; return a grouped receipt or per-Intent diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        intents: {
          type: 'array', minItems: 1, maxItems: 5,
          items: { type: 'object', additionalProperties: true },
        },
      },
      required: ['intents'],
      additionalProperties: false,
    },
  },
];

function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function error(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

const runner = spawn(runnerPath, [
  artifactPath, '--serve', 'stdio+jsonl://', '--request-fuel', '10000',
  '--with-memory-limit', '512',
], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = [];
let runnerError = null;

function failPending(cause) {
  runnerError = cause;
  for (const request of pending.splice(0)) request.reject(cause);
}

createInterface({ input: runner.stdout, crlfDelay: Infinity }).on('line', (line) => {
  const request = pending.shift();
  if (!request) return;
  try {
    request.resolve(JSON.parse(line));
  } catch (cause) {
    request.reject(cause);
  }
});
runner.on('error', failPending);
runner.on('close', (code) => failPending(new Error(`ontology runner exited (${code})`)));
runner.stdin.on('error', failPending);

function callService(name, input) {
  return new Promise((resolve, reject) => {
    if (runnerError) return reject(runnerError);
    pending.push({ resolve, reject });
    runner.stdin.write(`${JSON.stringify({ method: `ic/${name}`, input })}\n`);
  });
}

async function handle(message) {
  if (message.id === undefined) return null;
  const id = message.id;
  switch (message.method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ontology-eval', version: '1.0.0' },
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools });
    case 'tools/call': {
      const name = message.params?.name;
      if (!tools.some((tool) => tool.name === name)) {
        return error(id, -32602, 'unknown ontology tool');
      }
      const input = message.params?.arguments ?? {};
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return error(id, -32602, 'tool input must be an object');
      }
      if (name === 'transform' &&
        (Object.keys(input).some((key) => key !== 'intents') ||
          !Array.isArray(input.intents) || input.intents.length < 1 ||
          input.intents.length > 5 || input.intents.some((intent) =>
            intent === null || typeof intent !== 'object' || Array.isArray(intent)))) {
        return error(id, -32602, 'transform requires 1 to 5 Intents');
      }
      try {
        if (name === 'transform') {
          const result = await callService(name, input);
          return reply(id, transformResults(result, input.intents, outputDir));
        }
        const result = await callService(name, input);
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: result?.error === true,
        });
      } catch (cause) {
        return reply(id, {
          content: [{ type: 'text', text: `ontology service unavailable: ${cause.message}` }],
          isError: true,
        });
      }
    }
    default:
      return error(id, -32601, 'method not found');
  }
}

if (process.argv.includes('--http')) {
  createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024 * 1024) throw new Error('MCP request too large');
      }
      const result = await handle(JSON.parse(body));
      if (result === null) {
        response.writeHead(202).end();
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      }
    } catch (cause) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify(error(null, -32700, cause.message)));
    }
  }).listen(18016, '127.0.0.1');
} else {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const result = await handle(JSON.parse(line));
        if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (cause) {
        process.stderr.write(`invalid MCP message: ${cause.message}\n`);
      }
    }
  } finally {
    runner.stdin.end();
  }
}
