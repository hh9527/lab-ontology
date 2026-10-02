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
try {
  const graph = (node, start, end) => ({ op: 'Graph', root: 'd',
    nodes: [{ id: 'd', entity: 'device' }, { id: node, entity: 'device_kpi' }],
    edges: [{ relation: 'device_kpi_of_device', from: node, to: 'd' }],
    select: [{ node: 'd', dimension: 'device_name' }], group_by_identity: ['d'],
    measures: [{ node, measure: 'cpu_usage' }],
    time_windows: [{ node, dimension: 'device_kpi_ts_raw', start, end }] });
  const intent = { op: 'GraphPair',
    left: graph('prev', '2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z'),
    right: graph('curr', '2026-09-21T00:00:00Z', '2026-09-28T00:00:00Z'),
    rank_by: { op: 'Subtract', direction: 'Desc', take: 5 } };
  child.stdin.write(JSON.stringify({ method: 'ic/transform', input: { intents: [intent] } }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false);
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  assert.equal(response.ok.accepted, true, JSON.stringify(response.ok.diagnostics));
  const query = response.ok.queries[0];
  db.exec('CREATE TABLE I_EntNetworkElement(id TEXT, name TEXT); CREATE TABLE NetworkDeviceKPI(resId TEXT, ts TEXT, cpuUsage REAL)');
  const device = db.prepare('INSERT INTO I_EntNetworkElement VALUES (?, ?)');
  const sample = db.prepare('INSERT INTO NetworkDeviceKPI VALUES (?, ?, ?)');
  for (let i = 0; i < 7; i++) {
    device.run(`d${i}`, 'same name');
    sample.run(`d${i}`, '2026-09-15T00:00:00Z', 10);
    sample.run(`d${i}`, '2026-09-22T00:00:00Z', 10 + i);
  }
  const rows = db.prepare(query.sql).all(...query.bindings);
  assert.deepEqual(rows.map(row => row.curr_cpu_usage), [16, 15, 14, 13, 12]);
  assert.ok(rows.every(row => row.prev_cpu_usage === 10 && Object.keys(row).length === 3));
  console.log('iCloud snapshot GraphPair CPU increase Top-5 passed');
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
