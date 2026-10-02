import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const artifact = process.argv[2] ?? 'bin/icloud_model.snapshot.wasm';
const cases = [
  ['device_kpi', 'device', 'device_kpi_of_device', true, 'device_name', 'device_kpi_ts_raw', 'device_online_rate_avg', 'NetworkDeviceKPI'],
  ['source_NetworkDeviceOnlineKPI', 'device', 'source_EntNetworkElement_NetworkDeviceOnlineKPI', false, 'device_name', 'source_NetworkDeviceOnlineKPI__ts', 'network_online_rate_avg', 'NetworkDeviceOnlineKPI'],
  ['source_PonDeviceKPI', 'pon_device', 'source_EntPonElementAssociationPonDeviceKPI', false, 'pon_name', 'source_PonDeviceKPI__ts', 'pon_online_rate_avg', 'PonDeviceKPI'],
  ['source_PonDeviceOnlineKPI', 'pon_device', 'source_EntPonElement_PonDeviceOnlineKPI', false, 'pon_name', 'source_PonDeviceOnlineKPI__ts', 'pon_online_table_rate_avg', 'PonDeviceOnlineKPI'],
];
const child = spawn('bin/telora-run', [artifact, '--serve', 'stdio+jsonl://',
  '--request-fuel', '100000', '--with-memory-limit', '1024']);
child.stderr.pipe(process.stderr);
const reader = createInterface({ input: child.stdout });
const lines = reader[Symbol.asyncIterator]();
const closed = new Promise(resolve => child.once('close', resolve));
const deadline = setTimeout(() => child.kill(), 60000);
const db = new DatabaseSync(':memory:');
async function request(method, input) {
  child.stdin.write(JSON.stringify({ method: `ic/${method}`, input }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false, 'runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
try {
  for (const table of ['I_EntNetworkElement', 'I_EntPonElement']) {
    db.exec(`CREATE TABLE ${table}(id TEXT, name TEXT)`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?)`);
    for (const id of ['a', 'b', 'c', 'd']) insert.run(id, 'same-name');
  }
  for (const spec of cases) {
    const table = spec[7];
    db.exec(`CREATE TABLE ${table}(resId TEXT, ts TEXT, onlineRate REAL, onlineRateEffcnt INTEGER)`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`);
    for (const [id, value, effectiveCount] of [['a', 100, 1000], ['a', 80, 1], ['a', null, 1],
      ['b', 100, 1], ['b', 0, 1], ['c', 95, 1], ['c', 95, 1], ['d', null, 1], ['missing-owner', 100, 1]]) {
      insert.run(id, '2026-09-15 00:00:00', value, effectiveCount);
    }
    insert.run('a', '2026-10-01 00:00:00', 0, 1);
  }
  const intents = cases.map(([entity, owner, relation, reverse, name, time, measure]) => ({
    op: 'Graph', root: 'd', nodes: [{ id: 'd', entity: owner }, { id: 'k', entity }],
    edges: [{ relation, from: reverse ? 'k' : 'd', to: reverse ? 'd' : 'k' }],
    select: [{ node: 'd', dimension: name }], group_by_identity: ['d'],
    measures: [{ node: 'k', measure }],
    time_windows: [{ node: 'k', dimension: time, start: '2026-09-01 00:00:00', end: '2026-10-01 00:00:00' }],
    measure_having: [{ node: 'k', measure, op: 'Ge', value: 90 }],
    top_by_measure: { node: 'k', measure, direction: 'Desc', take: 5 },
  }));
  const result = await request('transform', { intents });
  assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
  assert.equal(result.queries.length, cases.length);
  for (const [index, query] of result.queries.entries()) {
    const rows = db.prepare(query.sql).all(...query.bindings);
    assert.equal(rows.length, 2, `${cases[index][0]} must preserve same-name owner identities`);
    assert.deepEqual(rows.map(row => Object.values(row).find(value => typeof value === 'number')), [95, 90]);
    const key = `Measure/${cases[index][0]}/${cases[index][6]}`;
    const node = (await request('info', { key })).Document.Found;
    assert.equal(node.detail.aggregate, 'Avg');
    assert.ok(node.description.aliases.length > 0);
    assert.ok(node.links.some(link => link.type === 'Related' && link.key.startsWith('Dimension/')));
  }
  console.log(JSON.stringify({ status: 'passed', populations: cases.length,
    verified: ['identity groups', 'mean versus peak', 'NULL handling', 'no effective-count weighting',
      'exclusive end', 'mean threshold and ranking', 'knowledge aliases and raw links'] }));
} finally {
  clearTimeout(deadline);
  db.close();
  reader.close();
  child.kill();
  await closed;
}
