import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const child = spawn('bin/telora-run', [process.argv[2] ?? 'bin/icloud_model.snapshot.wasm',
  '--serve', 'stdio+jsonl://', '--request-fuel', '100000', '--with-memory-limit', '1024']);
child.stderr.pipe(process.stderr);
const closed = new Promise(resolve => child.once('close', resolve));
const reader = createInterface({ input: child.stdout });
const lines = reader[Symbol.asyncIterator]();
const deadline = setTimeout(() => child.kill(), 60000);
const db = new DatabaseSync(':memory:');
async function request(method, input) {
  child.stdin.write(JSON.stringify({ method: `ic/${method}`, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false);
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
const cases = [
  ['storage_device', 'source_StorageDeviceKPI', 'source_HuaweiStorageDeviceAssociationStorageDeviceKPI', 'storage_device_id', 'StorageDeviceKPI', 'cpuusage', 'storage'],
  ['source_FCSwitchDevice', 'source_StorageDeviceKPI', 'source_FCSwitchDevice_StorageDeviceKPI', 'source_FCSwitchDevice__name', 'StorageDeviceKPI', 'cpuusage', 'storage'],
  ['pon_device', 'source_PonDeviceKPI', 'source_EntPonElementAssociationPonDeviceKPI', 'pon_name', 'PonDeviceKPI', 'cpuUsage', 'pon'],
];
try {
  for (const table of ['HuaweiStorageDevice', 'FCSwitchDevice', 'I_EntPonElement']) {
    db.exec(`CREATE TABLE ${table}(id TEXT, name TEXT)`);
    for (const suffix of ['a', 'b', 'empty']) db.prepare(`INSERT INTO ${table} VALUES (?,?)`).run(`${table}-${suffix}`, 'same name');
  }
  for (const [table, column, owners] of [
    ['StorageDeviceKPI', 'cpuusage', ['HuaweiStorageDevice', 'FCSwitchDevice']],
    ['PonDeviceKPI', 'cpuUsage', ['I_EntPonElement']],
  ]) {
    db.exec(`CREATE TABLE ${table}(resId TEXT, ts TEXT, ${column} REAL, ${column}Effcnt INTEGER)`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?)`);
    for (const owner of owners) {
      // More than a client row cap; a skewed effective count must not weight the mean.
      for (let index = 0; index < 300; index++) insert.run(`${owner}-a`, new Date(Date.parse('2026-10-02T12:00:00Z') + index * 1000).toISOString().replace('.000Z', 'Z'), index % 3 * 30 + 10, index === 0 ? 1000 : 1);
      insert.run(`${owner}-a`, '2026-10-02T12:05:00Z', null, 1);
      insert.run(`${owner}-a`, '2026-10-03T00:00:00Z', 999, 1);
      insert.run(`${owner}-b`, '2026-10-02T12:00:00Z', 20, 0);
      insert.run(`${owner}-empty`, '2026-10-02T12:00:00Z', null, 1);
    }
  }
  for (const [owner, entity, relation, dimension, table, column, prefix] of cases) {
    const measures = [`${prefix}_cpu_usage`, `${prefix}_cpu_sample_max`, `${prefix}_cpu_sample_min`];
    const intent = { op: 'Graph', limit: 1000, root: 'd', nodes: [{ id: 'd', entity: owner }, { id: 'k', entity }],
      edges: [{ relation, from: 'd', to: 'k' }], select: [{ node: 'd', dimension }], group_by_identity: ['d'],
      measures: measures.map(measure => ({ node: 'k', measure })),
      time_windows: [{ node: 'k', dimension: `${entity}__ts`, start: '2026-10-02T00:00:00Z', end: '2026-10-03T00:00:00Z' }] };
    const result = await request('transform', { intents: [intent] });
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    const query = result.queries[0];
    const rows = db.prepare(query.sql).all(...query.bindings);
    assert.equal(rows.length, 3, 'same-name owners must keep separate identities');
    assert.deepEqual(rows.map(row => measures.map(measure => row[`k_${measure}`])).sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1)),
      [[null, null, null], [20, 20, 20], [40, 70, 10]]);
    for (const [index, measure] of measures.entries()) {
      const node = (await request('info', { key: `Measure/${entity}/${measure}` })).Document.Found;
      assert.equal(node.detail.aggregate, ['Avg', 'Max', 'Min'][index]);
      assert.ok(node.description.summary.includes('TODO(#47)'));
      assert.ok(JSON.stringify(node).includes('%'));
    }
    const average = (await request('info', { key: `Measure/${entity}/${measures[0]}` })).Document.Found;
    assert.ok(average.links.some(link => link.key === `Dimension/${entity}/${entity}__${column}`));
    assert.ok(average.links.some(link => link.key === `Measure/${entity}/${measures[1]}`));
    assert.ok(average.links.some(link => link.key === `Measure/${entity}/${measures[2]}`));
  }
  console.log('Passed CPU queries: storage/FC/PON Avg/Min/Max, >200 samples, identity grouping, half-open UTC windows, NULL, no effective-count weighting, discoverable unit TODO and links');
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
