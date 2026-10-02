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
async function info(input) {
  child.stdin.write(JSON.stringify({ method: `${domain}/info`, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false, 'runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  if (++calls % 250 === 0) process.stderr.write(`Discovered ${calls} nodes for ${domain}\n`);
  return response.ok;
}
try {
  // Only the root is seeded; every subsequent request comes from a returned key.
  const nodes = await collectKnowledge(info);
  const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  const found = new Map(nodes.map(node => [node.key, node]));
  assert.deepEqual([...found.keys()].sort(), expected.slice().sort(), 'unreachable or unpublished catalog nodes');
  const root = found.get('index');
  assert.equal(root.detail.entries.length, 5);
  assert.equal(root.links.length, 0);
  let endpoints = 0;
  const counts = {};
  for (const node of nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    for (const key of discoveryKeys(node)) assert.ok(found.has(key), `dangling ${key}`);
    if (!['Index', 'Directory', 'Terminology'].includes(node.type)) continue;
    assert.ok(node.detail.entries.length <= 12, node.key);
    assert.equal(new Set(node.detail.entries.map(entry => entry.term ? `${entry.term}\0${entry.key}` : entry.key)).size,
      node.detail.entries.length, `duplicate entries: ${node.key}`);
    for (const entry of node.detail.entries) {
      const target = found.get(entry.key);
      if ('type' in entry) {
        assert.equal(entry.type, target.type);
        assert.equal(entry.label, target.description.label);
        assert.ok(!node.links.some(link => link.key === entry.key), `repeated enumeration: ${node.key}`);
      }
      if (['Relation', 'BusinessLink'].includes(entry.type)) {
        assert.equal(found.get(entry.from)?.type, 'Dataset');
        assert.equal(found.get(entry.to)?.type, 'Dataset');
        if (entry.type === 'Relation') {
          assert.equal(found.get(entry.from).detail.id, target.detail.from_dataset);
          assert.equal(found.get(entry.to).detail.id, target.detail.to_dataset);
        }
        endpoints++;
      }
    }
  }
  const totals = new Map();
  const counting = new Set();
  function total(node) {
    if (totals.has(node.key)) return totals.get(node.key);
    assert.ok(!counting.has(node.key), `directory cycle: ${node.key}`);
    counting.add(node.key);
    const count = node.type === 'Index' ? node.detail.entries.length
      : node.detail.entries.reduce((sum, entry) => sum +
        (['Directory', 'Terminology'].includes(entry.type) ? total(found.get(entry.key)) : 1), 0);
    assert.equal(node.detail.total, count, `incorrect visible total: ${node.key}`);
    counting.delete(node.key);
    totals.set(node.key, count);
    return count;
  }
  for (const node of nodes) {
    if (['Index', 'Directory', 'Terminology'].includes(node.type)) total(node);
  }
  const sizes = nodes.map(node => ({ key: node.key,
    size: JSON.stringify({ Document: { Found: node } }, null, 2).length,
  })).sort((a, b) => b.size - a.size);
  assert.ok(sizes[0].size <= 16000, `response over budget: ${JSON.stringify(sizes[0])}`);
  assert.ok(renderKnowledge(nodes).startsWith('<!doctype html>'));
  assert.deepEqual(await info({ key: 'unpublished/nonexistent' }), { Document: 'NotFound' });
  if (outputFile) writeFileSync(outputFile, JSON.stringify(nodes));
  console.log(JSON.stringify({ domain, nodes: nodes.length, counts, endpoints,
    root_size: sizes.find(item => item.key === 'index').size, largest: sizes.slice(0, 5),
    reachability: 'passed', html: 'passed', budget: 'passed' }, null, 2));
} finally {
  child.stdin.end();
  child.kill();
  await closed;
}
