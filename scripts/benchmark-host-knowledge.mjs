import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createKnowledgeHost } from '../ontology/tools/knowledge-host.mjs';
import { collectKnowledge } from '../ontology/tools/knowledge-export.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const { values } = parseArgs({ options: {
  artifact: { type: 'string' }, runner: { type: 'string' }, baseline: { type: 'string' },
  output: { type: 'string' }, domain: { type: 'string', default: 'ic' },
  legacy: { type: 'boolean', default: false },
} });
assert(values.artifact, '--artifact is required');
const artifactHash = createHash('sha256').update(readFileSync(values.artifact)).digest('hex');
const baseline = values.baseline ? JSON.parse(readFileSync(values.baseline, 'utf8')) : null;
const started = performance.now();
const report = await withKnowledgeRunner(values.artifact, async (_info, request) => {
  const query = { intents: [{ op: 'Graph', root: 'x',
    nodes: [{ id: 'x', entity: 'device' }], edges: [], select: [{ node: 'x', dimension: 'device_name' }],
    filters: [{ node: 'x', dimension: 'device_name', op: 'Contains', value: 'test' }] }] };
  const firstTransform = await request(`${values.domain}/transform`, query);
  assert.equal(firstTransform.accepted, true);
  const firstTransformMs = performance.now() - started;
  const timings = [];
  let guestKnowledgeCalls = 0;
  const knowledgeRequest = async (method, input) => { guestKnowledgeCalls++; return request(method, input); };
  let exportBytes;
  const host = createKnowledgeHost({ artifactHash, domain: values.domain,
    request: async (method, input) => {
      const before = performance.now();
      let data;
      if (values.legacy) {
        const discovery = await knowledgeRequest(method, input);
        const nodes = await collectKnowledge(input => knowledgeRequest(`${values.domain}/info`, input), discovery.roots);
        data = { format: 'ontology-knowledge-export-v1', discovery, complete: true, nodes };
      } else { data = await knowledgeRequest(method, input); }
      timings.push({ method, ms: performance.now() - before });
      if (method.endsWith('/discovery')) exportBytes = Buffer.byteLength(JSON.stringify(data));
      return data;
    },
  });
  const before = performance.now(); const cpu = process.cpuUsage();
  const index = await host.load();
  const loadMs = performance.now() - before; const loadCpu = process.cpuUsage(cpu);
  assert.deepEqual(await host.discovery(), index.discovery);
  assert.deepEqual(await host.info({ key: 'missing-export-node' }), { Document: 'NotFound' });
  const responses = {};
  for (const node of index.nodes) {
    assert.deepEqual(await host.info({ key: node.key }), { Document: { Found: node } });
    const json = JSON.stringify(node);
    responses[node.key] = { sha256: createHash('sha256').update(json).digest('hex'), bytes: Buffer.byteLength(json) };
  }
  if (baseline) assert.deepEqual(responses, baseline.responses, 'Export differs from the complete info graph');
  const cached = performance.now(); await host.load(); const cacheMs = performance.now() - cached;
  assert.equal(timings.length, 1, 'Host must reuse its cached discovery');
  const transform = await request(`${values.domain}/transform`, query);
  assert.deepEqual(transform, firstTransform);
  assert.equal(transform.accepted, true, 'Lowering must work after export and snapshot reset');
  return { artifact_sha256: artifactHash, first_transform_ms: firstTransformMs,
    knowledge_transport: values.legacy ? 'discovery-info' : 'knowledge-root', guest_knowledge_calls: guestKnowledgeCalls,
    host_first_load_ms: loadMs, host_load_cpu_ms: { user: loadCpu.user / 1000, system: loadCpu.system / 1000 },
    timings, cache_load_ms: cacheMs, export_bytes: exportBytes, nodes: index.nodes.length,
    all_nodes_equal: baseline ? true : null, discovery: index.discovery, transform, responses };
}, { runner: values.runner, requestFuel: '1000000', memory: '2048' });
if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
const { responses, discovery, transform, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
