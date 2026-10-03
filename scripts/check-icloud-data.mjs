import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const directory = process.argv[2] ?? 'bin/icloud-data';
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
const model = JSON.parse(readFileSync(join(directory, 'model.json')));
const db = new DatabaseSync(join(directory, 'icloud.sqlite'), { readOnly: true });
const child = spawn('bin/telora-run', [process.argv[3] ?? 'bin/icloud_model.snapshot.wasm',
  '--serve', 'stdio+jsonl://', '--request-fuel', '100000', '--with-memory-limit', '1024']);
child.stderr.pipe(process.stderr);
const closed = new Promise(resolve => child.once('close', resolve));
const reader = createInterface({ input: child.stdout });
const lines = reader[Symbol.asyncIterator]();
const deadline = setTimeout(() => child.kill(), 60000);
async function query(intent) {
  child.stdin.write(JSON.stringify({ method: 'ic/transform', input: { intents: [intent] } }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false, 'Runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  assert.equal(response.ok.accepted, true, JSON.stringify(response.ok.diagnostics));
  const query = response.ok.queries[0];
  return db.prepare(query.sql).all(...query.bindings);
}
try {
  for (const dataset of model.datasets.filter(dataset => dataset.fields.some(field => field.column === 'ts'))) {
    const dimension = model.dimensions.find(dimension => dimension.dataset === dataset.id && dimension.column === 'ts' && !dimension.computed);
    const rows = await query({ op: 'Graph', root: 'k', nodes: [{ id: 'k', entity: dataset.id }], edges: [],
      select: [{ node: 'k', dimension: dimension.id }],
      time_windows: [{ node: 'k', dimension: dimension.id, start: manifest.window.start, end: manifest.window.endExclusive }] });
    assert.equal(rows.length, manifest.tables[dataset.table], dataset.id);
  }
  for (const role of ['pon_onu_role', 'pon_olt_role']) {
    const dimension = model.dimensions.find(dimension => dimension.dataset === role && dimension.column === 'name');
    const rows = await query({ op: 'Graph', root: 'p', nodes: [{ id: 'p', entity: role }], edges: [], select: [{ node: 'p', dimension: dimension.id }] });
    assert.ok(rows.length > 0);
    const expected = db.prepare('SELECT name FROM I_EntPonElement WHERE classification=?').all(role === 'pon_onu_role' ? 'ne.category.pon.onu' : 'ne.category.olt').map(row => row.name).sort();
    assert.deepEqual(rows.map(row => Object.values(row)[0]).sort(), expected);
  }
  const start = manifest.window.start;
  const end = manifest.window.endExclusive;
  const middle = new Date(Date.parse(start) + Math.floor((Date.parse(end) - Date.parse(start)) / 2000) * 1000).toISOString().replace('.000Z', 'Z');
  const graph = (node, start, end) => ({ op: 'Graph', root: 'd',
    nodes: [{ id: 'd', entity: 'device' }, { id: node, entity: 'device_kpi' }],
    edges: [{ relation: 'device_kpi_of_device', from: node, to: 'd' }],
    select: [], group_by_identity: ['d'], measures: [{ node, measure: 'cpu_usage' }],
    time_windows: [{ node, dimension: 'device_kpi_ts_raw', start, end }] });
  const rows = await query({ op: 'GraphPair', left: graph('prev', start, middle), right: graph('curr', middle, end),
    align_by: [{ left: { node: 'd' }, right: { node: 'd' } }], select: [{ side: 'Right', node: 'd', dimension: 'device_name' }],
    rank_by: { op: 'GrowthRate', current: 'Right', baseline: 'Left', direction: 'Desc', take: 5 } });
  assert.equal(rows.length, 5);
  assert.ok(rows[0].right_curr_cpu_usage > rows[0].left_prev_cpu_usage);
  const rates = rows.map(row => (row.right_curr_cpu_usage - row.left_prev_cpu_usage) / row.left_prev_cpu_usage);
  assert.deepEqual(rates, rates.toSorted((a, b) => b - a));
  console.log('Passed snapshot queries: all 17 KPI windows, ONU/OLT scopes, CPU GrowthRate Top-5');
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
