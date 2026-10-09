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
async function call(method, input) {
  child.stdin.write(JSON.stringify({ method, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false);
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
async function transform(intent) {
  const result = await call('ic/transform', { intents: [intent] });
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  return result.queries[0];
}
try {
  const graph = (node, start, end) => ({ op: 'Graph', limit: 1000, root: 'd',
    nodes: [{ id: 'd', entity: 'device' }, { id: node, entity: 'device_kpi' }],
    edges: [{ relation: 'device_kpi_of_device', from: node, to: 'd' }],
    select: [], group_by_identity: ['d'],
    measures: [{ node, measure: 'cpu_usage' }],
    time_windows: [{ node, dimension: 'device_kpi_ts_raw', start, end }] });
  const intent = { op: 'GraphPair', limit: 1000,
    align_by: [{ left: { node: 'd' }, right: { node: 'd' } }],
    select: [{ side: 'Right', node: 'd', dimension: 'device_name' }],
    left: graph('prev', '2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z'),
    right: graph('curr', '2026-09-21T00:00:00Z', '2026-09-28T00:00:00Z'),
    rank_by: { op: 'Subtract', minuend: 'Right', subtrahend: 'Left', direction: 'Desc', take: 5 } };
  const query = await transform(intent);
  db.exec('CREATE TABLE I_EntNetworkElement(id TEXT, name TEXT); CREATE TABLE NetworkDeviceKPI(resId TEXT, ts TEXT, cpuUsage REAL)');
  const device = db.prepare('INSERT INTO I_EntNetworkElement VALUES (?, ?)');
  const sample = db.prepare('INSERT INTO NetworkDeviceKPI VALUES (?, ?, ?)');
  for (let i = 0; i < 7; i++) {
    device.run(`d${i}`, 'same name');
    sample.run(`d${i}`, '2026-09-15T00:00:00Z', 10);
    sample.run(`d${i}`, '2026-09-22T00:00:00Z', 10 + i);
  }
  const rows = db.prepare(query.sql).all(...query.bindings);
  assert.deepEqual(rows.map(row => row.right_curr_cpu_usage), [16, 15, 14, 13, 12]);
  assert.ok(rows.every(row => row.left_prev_cpu_usage === 10 && Object.keys(row).length === 4));
  assert.deepEqual(rows.map(row => row.comparison_value), [6, 5, 4, 3, 2]);
  for (const rank_by of [
    { op: 'Ratio', numerator: 'Right', denominator: 'Left', direction: 'Desc', take: 5 },
    { op: 'GrowthRate', current: 'Right', baseline: 'Left', direction: 'Desc', take: 5 },
  ]) {
    const query = await transform({ ...intent, rank_by });
    const rows = db.prepare(query.sql).all(...query.bindings);
    assert.deepEqual(rows.map(row => row.right_curr_cpu_usage),
      [16, 15, 14, 13, 12], rank_by.op);
    for (const row of rows) {
      assert.equal(row.comparison_value, rank_by.op === 'Ratio'
        ? row.right_curr_cpu_usage / row.left_prev_cpu_usage
        : (row.right_curr_cpu_usage - row.left_prev_cpu_usage) / row.left_prev_cpu_usage);
    }
  }
  const inverse = await transform({ ...intent,
    select: [{ side: 'Right', node: 'd', dimension: 'device_name' },
      { side: 'Left', node: 'd', dimension: 'device_name' }],
    rank_by: { op: 'Ratio', numerator: 'Left', denominator: 'Right', direction: 'Desc', take: 5 } });
  const inverseRows = db.prepare(inverse.sql).all(...inverse.bindings);
  assert.deepEqual(inverseRows.map(row => row.right_curr_cpu_usage), [10, 11, 12, 13, 14]);
  assert.deepEqual(Object.keys(inverseRows[0]),
    ['right_d_device_name', 'left_d_device_name', 'left_prev_cpu_usage', 'right_curr_cpu_usage', 'comparison_value']);
  const legacy = { ...intent };
  delete legacy.align_by;
  const rejected = await call('ic/transform', { intents: [legacy] });
  assert.equal(rejected.accepted, false);
  assert.ok(JSON.stringify(rejected.diagnostics).includes('GraphPair migration'));
  const contract = JSON.stringify(await call('ic/info', { key: 'Schema/syntax/graph_pair' }));
  assert.ok(contract.includes('align_by') && contract.includes('GrowthRate') && contract.includes('subtrahend'));
  console.log('iCloud snapshot GraphPair passed: CPU Top-5, Ratio/GrowthRate, reversed operands, per-column sides, migration diagnostics and discoverable contract');
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
