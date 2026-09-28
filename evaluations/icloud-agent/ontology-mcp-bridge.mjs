import { createReadStream, createWriteStream, lstatSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const requestPath = process.env.ONTOLOGY_MCP_REQUEST_FIFO;
const responsePath = process.env.ONTOLOGY_MCP_RESPONSE_FIFO;
if (!requestPath?.startsWith('/') || !responsePath?.startsWith('/') ||
  !lstatSync(requestPath).isFIFO() || !lstatSync(responsePath).isFIFO()) {
  throw new Error('host-owned MCP request and response FIFOs are required');
}

const request = createWriteStream(requestPath);
const response = createReadStream(responsePath);
try {
  await Promise.all([
    pipeline(process.stdin, request),
    pipeline(response, process.stdout),
  ]);
} catch (cause) {
  request.destroy();
  response.destroy();
  process.stderr.write(`MCP bridge closed: ${cause.message}\n`);
  process.exitCode = 1;
}
