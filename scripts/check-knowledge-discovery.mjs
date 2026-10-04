import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { collectKnowledge, discoveryKeys } from '../ontology/tools/knowledge-export.mjs';
import { renderKnowledge } from '../ontology/tools/knowledge-html.mjs';

const [artifact, domain, expectedFile, outputFile] = process.argv.slice(2);
if (!artifact || !domain || !expectedFile) {
  throw new Error('Usage: node scripts/check-knowledge-discovery.mjs <snapshot> <domain> <expected-keys.json> [nodes.json]');
}
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
const child = spawn(runner, [artifact, '--serve', 'stdio+jsonl://',
  '--request-fuel', '100000', '--with-memory-limit', '2048']);
const closed = new Promise(resolve => child.once('close', resolve));
child.stderr.pipe(process.stderr);
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let calls = 0;
async function request(method, input) {
  child.stdin.write(JSON.stringify({ method, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false, 'runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  if (++calls % 250 === 0) process.stderr.write(`Discovered ${calls} nodes for ${domain}\n`);
  return response.ok;
}
const info = input => request(`${domain}/info`, input);
try {
  const roots = await request(`${domain}/discovery`, {});
  const nodes = await collectKnowledge(info, roots);
  const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  const found = new Map(nodes.map(node => [node.key, node]));
  assert.deepEqual([...found.keys()].sort(), expected.slice().sort(), 'unreachable or unpublished catalog nodes');
  const root = found.get('index');
  assert(root.detail.schemas.length > 0);
  assert.equal(root.detail.key_patterns.length, 10);
  assert.equal(new Set(root.detail.schemas).size, root.detail.schemas.length);
  assert(root.detail.schemas.every(key => found.get(key)?.type === 'Schema'));
  assert.deepEqual(root.detail.schemas.slice().sort(), nodes.filter(node => node.type === 'Schema').map(node => node.key).sort());
  assert.equal(root.links.length, 0);
  let endpoints = 0;
  const counts = {};
  for (const node of nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    for (const key of discoveryKeys(node)) assert.ok(found.has(key), `dangling ${key}`);
    assert(!['Directory', 'Terminology'].includes(node.type));
    if (node.type === 'Relation') {
      assert.equal(found.get(`Dataset/${encodeURIComponent(node.detail.from_dataset)}`)?.type, 'Dataset');
      assert.equal(found.get(`Dataset/${encodeURIComponent(node.detail.to_dataset)}`)?.type, 'Dataset');
      endpoints++;
    }
  }
  const sizes = nodes.map(node => ({ key: node.key,
    size: JSON.stringify({ Document: { Found: node } }, null, 2).length,
  })).sort((a, b) => b.size - a.size);
  const concrete = new Set(nodes.filter(node => node.type !== 'Index').map(node => node.key));
  assert.ok(sizes.filter(item => concrete.has(item.key)).every(item => item.size <= 16000), 'concrete response over budget');
  assert.ok(renderKnowledge(nodes).startsWith('<!doctype html>'));
  assert.deepEqual(await info({ key: 'unpublished/nonexistent' }), { Document: 'NotFound' });
  for (const key of ['terminology', 'Directory/datasets', 'Directory/relations']) {
    assert.deepEqual(await info({ key }), { Document: 'NotFound' });
  }
  if (outputFile) writeFileSync(outputFile, JSON.stringify(nodes));
  console.log(JSON.stringify({ domain, nodes: nodes.length, counts, endpoints,
    root_size: sizes.find(item => item.key === 'index').size, largest: sizes.slice(0, 5),
    reachability: 'passed', html: 'passed', budget: 'passed' }, null, 2));
} finally {
  child.stdin.end();
  child.kill();
  await closed;
}
