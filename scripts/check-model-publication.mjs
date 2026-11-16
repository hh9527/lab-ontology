// 同一制品的知识、类型化转换与脱离模型后的参数绑定验收。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert.ok(artifact && adapter, 'Usage: node scripts/check-model-publication.mjs <ic-model.wasm> <telora-model.ts>');
const adapterUrl = pathToFileURL(resolve(adapter));
const requireAdapter = createRequire(adapterUrl);
const { encodeIntent, verifyReceipt, proofTarget } = await import(pathToFileURL(requireAdapter.resolve('@hh9527/dari-core')));
const { openModel } = await import(adapterUrl);
const module = new WebAssembly.Module(readFileSync(artifact));
const sections = WebAssembly.Module.customSections(module, 'telora.build.information');
assert.equal(sections.length, 1);
const knowledge = JSON.parse(new TextDecoder().decode(sections[0])).entries['ontology.knowledge'];
assert.ok(knowledge, 'single artifact must publish knowledge');
const { graph } = new Function('data', knowledge.program)(knowledge.data);
const datasets = new Set(graph.facts.filter(f => f.key.startsWith('datasets/')).map(f => f.key.slice(9)));
const host = await openModel(artifact);
const database = new DatabaseSync(':memory:');
let closed = false;
try {
  assert.equal(host.contract.datasets.length, 50);
  assert.deepEqual(new Set(host.contract.datasets.map(d => d.id)), datasets);
  assert.equal(host.contract.relations.length, 123);
  assert.ok(host.contract.codec_module.includes('createCodecs'));
  assert.ok(host.model.types['ic::AlarmSeverity']);
  assert.ok(host.model.types['ic::DeviceClass']);
  let plans = 0;
  function transform(dataset, member, predicate) {
    const reference = { kind: 'member', node: 0, member };
    const intent = { kind: 'query', root: 0, nodes: [{ kind: 'node', index: 0, id: 'a', dataset }], steps: [
      ...(predicate ? [{ id: 'filter', kind: 'filter', predicate: predicate(reference) }] : []),
      { id: 'project', kind: 'project', value: { kind: 'record', fields: { value: reference } } },
      { id: 'order', kind: 'order_by', terms: [{ direction: 'Asc', value: { kind: 'output', name: 'value' } }] },
      { id: 'take', kind: 'take', count: 10 }
    ] };
    const encoded = encodeIntent(intent);
    const result = host.model.check_type(intent, encoded);
    verifyReceipt(result.receipt, proofTarget(intent, host.model.contractId, encoded));
    assert.ok(result.maxRows <= 10);
    assert.deepEqual(Object.keys(result.element.fields), ['value']);
    assert.ok(result.plan.checked.sql);
    plans++;
    return result.plan;
  }
  for (const dataset of Object.values(host.model.datasets)) {
    const member = Object.values(dataset.members).find(m => m.kind === 'dimension');
    assert.ok(member, dataset.id);
    transform(dataset, member);
  }
  const device = host.model.datasets['ic::device'];
  const id = device.members.device_id;
  assert.ok(id);
  const type = id.type.kind === 'option' ? id.type.inner : id.type;
  const plan = transform(device, id, left => ({ kind: 'binary', op: '==', left, right: { kind: 'parameter', index: 0, type } }));
  const constants = transform(device, id, left => ({ kind: 'binary', op: '==', left, right: { kind: 'literal', value: 'd1', type } }));
  const requests = host.stats.requests;
  await host.close(); closed = true;
  // 模型通道关闭后，同一计划仍可绑定不同值并执行。
  database.exec('CREATE TABLE I_EntNetworkElement (id TEXT); INSERT INTO I_EntNetworkElement VALUES (\'d1\'), (\'d2\')');
  const run = (plan, parameters) => {
    const query = host.bind(plan, parameters);
    return database.prepare(query.sql).all(...query.bindings).map(row => ({ ...row }));
  };
  assert.deepEqual(run(plan, ['d1']), [{ value: 'd1' }]);
  assert.deepEqual(run(plan, ['d2']), [{ value: 'd2' }]);
  assert.deepEqual(run(plan, ['absent']), []);
  assert.deepEqual(run(constants, []), [{ value: 'd1' }]);
  assert.equal(host.stats.requests, requests, 'execution must not call the model');
  console.log(`Passed: one artifact, 50 knowledge datasets, 123 relations, codecs, ${plans} typed plans, receipts and execution after closing model`);
} finally {
  database.close();
  if (!closed) await host.close();
}
