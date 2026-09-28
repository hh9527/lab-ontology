import { createInterface } from 'node:readline';
import { createServer } from 'node:http';

const baseUrl = 'http://127.0.0.1:18015';
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
    description: 'Lower a Model-backed Intent to parameterized SQL or structured diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'object', additionalProperties: true },
        ctx: { type: 'object', additionalProperties: true },
      },
      required: ['intent'],
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
      try {
        const response = await fetch(`${baseUrl}/ic/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30000),
        });
        const body = await response.text();
        return reply(id, {
          content: [{ type: 'text', text: body }],
          isError: !response.ok,
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
  for await (const line of lines) {
    try {
      const result = await handle(JSON.parse(line));
      if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (cause) {
      process.stderr.write(`invalid MCP message: ${cause.message}\n`);
    }
  }
}
