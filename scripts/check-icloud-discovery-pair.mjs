import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const directory = process.argv[2] ?? 'bin/icloud-data';
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
const db = new DatabaseSync(join(directory, 'icloud.sqlite'), { readOnly: true });
const child = spawn('bin/telora-run', [process.argv[3] ?? 'bin/icloud_model.snapshot.wasm',
  '--serve', 'stdio+jsonl://', '--request-fuel', '100000', '--with-memory-limit', '2048']);
child.stderr.pipe(process.stderr);
const closed = new Promise(resolve => child.once('close', resolve));
const reader = createInterface({ input: child.stdout });
const lines = reader[Symbol.asyncIterator]();
const deadline = setTimeout(() => child.kill(), 60000);
async function request(method, input) {
  child.stdin.write(JSON.stringify({ method: `ic/${method}`, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false);
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
async function info(key) {
  const result = await request('info', { key });
  assert.ok(result.Document.Found, key);
  return result.Document.Found;
}
async function transform(intent, accepted = true) {
  const result = await request('transform', { intents: [intent] });
  assert.equal(result.accepted, accepted, JSON.stringify(result.diagnostics));
  if (!accepted) {
    assert.equal(result.queries, null);
    const message = JSON.stringify(result.diagnostics);
    assert.ok(message.includes('disjoint time windows') && message.includes('Align owner entities'));
    return;
  }
  const query = result.queries[0];
  return db.prepare(query.sql).all(...query.bindings);
}
const start = manifest.window.start;
const end = manifest.window.endExclusive;
const middle = new Date((Date.parse(start) + Date.parse(end)) / 2).toISOString().replace('.000Z', 'Z');
const pair = (left, right, node) => ({ op: 'GraphPair', left, right, select: [],
  align_by: [{ left: { node }, right: { node } }],
  rank_by: { op: 'GrowthRate', current: 'Right', baseline: 'Left', direction: 'Desc', take: 3 } });
try {
  // #48: normalized RFC3339 identities reject impossible pairing before returning SQL.
  for (const [entity, measure, dimension] of [
    ['source_StorageDeviceKPI', 'storage_cpu_usage', 'source_StorageDeviceKPI__ts'],
    ['source_PonDeviceKPI', 'pon_cpu_usage', 'source_PonDeviceKPI__ts'],
  ]) {
    const graph = (start, end) => ({ op: 'Graph', root: 'k', nodes: [{ id: 'k', entity }], edges: [], select: [],
      group_by_identity: ['k'], measures: [{ node: 'k', measure }], time_windows: [{ node: 'k', dimension, start, end }] });
    await transform(pair(graph(start, middle), graph(middle, end), 'k'), false);
    await transform(pair(graph(middle, end), graph(start, middle), 'k'), false);
    assert.ok((await transform(pair(graph(start, middle), graph(start, middle), 'k'))).length > 0);
    assert.ok((await transform(pair(graph(start, end), graph(middle, end), 'k'))).length > 0);
  }
  // #47: follow the measure's returned links to discover both owner populations and paths.
  const measure = await info('Measure/source_StorageDeviceKPI/storage_cpu_usage');
  const related = [];
  for (const link of measure.links.filter(link => link.type === 'Related')) related.push(await info(link.key));
  for (const [owner, relation] of [
    ['storage_device', 'source_HuaweiStorageDeviceAssociationStorageDeviceKPI'],
    ['source_FCSwitchDevice', 'source_FCSwitchDevice_StorageDeviceKPI'],
  ]) {
    const dataset = related.find(node => node.type === 'Dataset' && node.detail.id === owner);
    const path = related.find(node => node.type === 'Relation' && node.detail.id === relation);
    assert.ok(dataset && path, owner);
    assert.equal(path.detail.from_dataset, owner);
    assert.equal(path.detail.to_dataset, 'source_StorageDeviceKPI');
    assert.deepEqual(dataset.detail.grain, [owner === 'storage_device' ? 'id' : 'source_id']);
    assert.ok(measure.description.summary.includes(owner) && measure.description.summary.includes(relation));
    const graph = (start, end) => ({ op: 'Graph', root: 'd', nodes: [{ id: 'd', entity: dataset.detail.id }, { id: 'k', entity: path.detail.to_dataset }],
      edges: [{ relation: path.detail.id, from: 'd', to: 'k' }], select: [], group_by_identity: ['d'],
      measures: [{ node: 'k', measure: measure.detail.id }],
      time_windows: [{ node: 'k', dimension: 'source_StorageDeviceKPI__ts', start, end }] });
    assert.equal((await transform(pair(graph(start, middle), graph(middle, end), 'd'))).length, 3);
  }
  // #49: enumerate IDs using only directory reads, then submit a discovered measure ID.
  let directoryCalls = 0;
  async function enumerate(key) {
    directoryCalls++;
    const node = await info(key);
    const entries = [];
    for (const entry of node.detail.entries) {
      if (entry.type === 'Directory') {
        assert.equal('id' in entry, false);
        entries.push(...await enumerate(entry.key));
      } else entries.push(entry);
    }
    return entries;
  }
  const entries = await enumerate('Directory/device_kpi/members');
  assert.equal(entries.length, (await info('Directory/device_kpi/members')).detail.total);
  assert.ok(directoryCalls < entries.length / 2);
  for (const entry of entries.filter(entry => entry.type !== 'Schema')) {
    assert.equal(typeof entry.id, 'string', entry.key);
    if (entry.type !== 'Relation') assert.equal(entry.dataset, 'device_kpi', entry.key);
    else assert.ok(typeof entry.dataset === 'string' && entry.dataset.length > 0);
  }
  const average = entries.find(entry => entry.type === 'Measure' && entry.id === 'cpu_usage');
  assert.ok(average && average.label !== average.id);
  const rows = await transform({ op: 'Graph', root: 'k', nodes: [{ id: 'k', entity: average.dataset }], edges: [], select: [],
    measures: [{ node: 'k', measure: average.id }],
    time_windows: [{ node: 'k', dimension: entries.find(entry => entry.type === 'Dimension' && entry.id === 'device_kpi_ts_raw').id, start, end }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].k_cpu_usage, db.prepare('SELECT avg(cpuUsage) value FROM NetworkDeviceKPI WHERE ts>=? AND ts<?').get(start, end).value);
  console.log(JSON.stringify({ status: 'passed', checks: ['#48 time identity pairing', '#47 owner discovery and period ranking', '#49 directory vocabulary'],
    vocabularyMembers: entries.length, directoryCalls, memberReadsForEnumeration: 0 }));
} finally {
  db.close();
  child.stdin.end();
  child.kill();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  await closed;
  clearTimeout(timeout);
  clearTimeout(deadline);
  reader.close();
}
