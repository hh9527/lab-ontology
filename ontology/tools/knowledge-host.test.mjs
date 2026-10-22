import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeIndex, createKnowledgeHost } from './knowledge-host.mjs';

const discovery = { addressing: 'node-member-uri-v1', knowledge_contract: 'ontology-knowledge-v3',
  intent_contract: 'ontology-intent-v1', revision: 'test', roots: ['Dataset/a%2Fb'], key_patterns: [], vocabulary: [] };
const node = (key, links = []) => ({ key, type: 'Dataset', address: { node: 'datasets/a%2Fb', member: null },
  description: { label: key }, detail: {}, links });
const publication = () => ({ format: 'ontology-knowledge-export-v1', discovery: structuredClone(discovery),
  complete: true, nodes: [node('index'), node('Dataset/a%2Fb', [{ key: 'index', type: 'Member', role: 'index' }])] });
const scoped = (request, extra = {}) => createKnowledgeHost({ request, artifactHash: 'a'.repeat(64), domain: 'ic',
  cache: new Map(), pending: new Map(), ...extra });

test('host indexes opaque keys and serves discovery, Found and NotFound', async () => {
  const calls = [];
  const host = scoped(async method => { calls.push(method); return publication(); });
  assert.deepEqual(await host.discovery(), discovery);
  assert.deepEqual(await host.info({ key: 'Dataset/a%2Fb' }), { Document: { Found: publication().nodes[1] } });
  assert.deepEqual(await host.info({ key: 'missing' }), { Document: 'NotFound' });
  assert.equal((await host.load()).outgoing.get('Dataset/a%2Fb')[0].key, 'index');
  assert.deepEqual(calls, ['ic/discovery']);
});

test('rejects duplicate keys, dangling references, missing roots and mismatched contracts', () => {
  const duplicate = publication(); duplicate.nodes.push(duplicate.nodes[0]);
  assert.throws(() => buildKnowledgeIndex(duplicate, discovery), /Duplicate/);
  const dangling = publication(); dangling.nodes[1].links[0].key = 'missing';
  assert.throws(() => buildKnowledgeIndex(dangling, discovery), /Dangling/);
  const missing = publication(); missing.nodes.pop();
  assert.throws(() => buildKnowledgeIndex(missing, discovery), /Missing/);
  const mismatch = publication(); mismatch.discovery.revision = 'other';
  assert.throws(() => buildKnowledgeIndex(mismatch, discovery), /differ/);
  assert.throws(() => buildKnowledgeIndex(publication(), { ...discovery, knowledge_contract: 'other' }), /Unsupported/);
});

test('concurrent hosts share one flight and reuse successful data by hash and domain', async () => {
  const cache = new Map(); const pending = new Map(); let calls = 0;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const request = async method => { calls++; await gate; return publication(); };
  const first = scoped(request, { cache, pending }); const second = scoped(request, { cache, pending });
  const loads = [first.load(), second.load(), first.info({ key: 'index' })];
  release(); const results = await Promise.all(loads);
  assert.equal(results[0], results[1]); assert.equal(calls, 1); assert.equal(pending.size, 0);
  assert.equal(await second.load(), results[0]); assert.equal(calls, 1);
  await scoped(request, { cache, pending, artifactHash: 'b'.repeat(64) }).load();
  await scoped(request, { cache, pending, domain: 'other' }).load();
  assert.equal(calls, 3);
});

test('transport or validation failures publish no partial cache and can retry', async () => {
  for (const failure of ['transport', 'validation']) {
    const cache = new Map(); const pending = new Map(); let broken = true;
    const host = scoped(async method => {
      if (broken && failure === 'transport') throw new Error('transport failure');
      const data = publication(); if (broken) data.nodes = []; return data;
    }, { cache, pending });
    await assert.rejects(host.load()); assert.equal(cache.size, 0); assert.equal(pending.size, 0);
    broken = false; assert.equal((await host.load()).nodes.length, 2);
  }
});


test('partial root follows links, resolves roots and terminates cycles without duplicate requests', async () => {
  const data = publication(); data.complete = false;
  data.nodes[0].links = [{ key: data.nodes[1].key, type: 'Member', role: 'datasets' }];
  const calls = [];
  const host = scoped(async (method, input) => {
    calls.push([method, input]);
    if (method.endsWith('/discovery')) return { ...data, nodes: [data.nodes[0]] };
    return { Document: { Found: data.nodes.find(node => node.key === input.key) } };
  });
  assert.equal((await host.load()).nodes.length, 2);
  assert.deepEqual(calls, [['ic/discovery', {}], ['ic/info', { key: 'Dataset/a%2Fb' }]]);
});

test('partial discovery fails atomically when a referenced node cannot be resolved', async () => {
  const data = publication(); data.complete = false; data.nodes = [data.nodes[0]];
  const host = scoped(async method => method.endsWith('/discovery') ? data : { Document: 'NotFound' });
  await assert.rejects(host.load(), /did not resolve/);
});
