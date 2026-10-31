import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const artifact = process.argv[2] ?? 'bin/icloud_model.snapshot.wasm';
const ns = process.argv[3] === 'ns';
const cases = ns ? [['kpi-server-device', 'sede_sample_time', 'kpi_server_device']] : [
  ['interface_kpi', 'interface_kpi_ts_raw', 'NetworkDeviceInterfaceKPI'],
  ['onu_kpi', 'onu_kpi_ts', 'PonDeviceOnuKPI'],
  ['pon_port_kpi', 'pon_port_kpi_ts', 'PonDevicePonPortKPI'],
  ['ap_radio_ssid_kpi', 'ap_ssid_sample_time', 'NetworkApRadioSsidKPI'],
  ['device_kpi', 'device_kpi_ts_raw', 'NetworkDeviceKPI'],
  ['server_kpi', 'server_kpi_ts_raw', 'ServerDeviceKPI'],
  ...['NetworkAPKPI', 'NetworkApRadioKPI', 'NetworkCellLinkQualityKPI',
    'NetworkCellLinkTrafficKPI', 'NetworkDeviceBoardKPI', 'NetworkDeviceOnlineKPI',
    'PonDeviceEthernetPortKPI', 'PonDeviceKPI', 'PonDeviceOnlineKPI',
    'StorageDeviceKPI', 'StorageHardDriveKPI'].map(table =>
    [`source_${table}`, `source_${table}__ts`, table]),
];
const child = spawn(process.env.TELORA_RUN ?? 'bin/telora-run', [artifact, '--serve', 'stdio+jsonl://',
  '--request-fuel', '100000', '--with-memory-limit', '1024']);
child.stderr.pipe(process.stderr);
const closed = new Promise(resolve => child.once('close', resolve));
const reader = createInterface({ input: child.stdout });
const lines = reader[Symbol.asyncIterator]();
const deadline = setTimeout(() => child.kill(), 60000);
const db = new DatabaseSync(':memory:');
async function transform(intent) {
  child.stdin.write(JSON.stringify({ method: ns ? 'ns/transform' : 'ic/transform', input: { intents: [intent] } }) + '\n');
  const line = await lines.next();
  assert.equal(line.done, false, 'runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
try {
  for (const [entity, dimension, table] of cases) {
    db.exec(`CREATE TABLE "${table}"(ts TEXT)`);
    const values = ['2026-09-29T23:59:59.000Z', '2026-09-30T00:00:00.000Z',
      '2026-09-30T23:59:59.000Z', '2026-10-01T00:00:00.000Z', '2026-10-01T12:00:00.000Z'];
    const insert = db.prepare(`INSERT INTO "${table}" VALUES (?)`);
    for (const value of values) insert.run(value);
    const intent = { op: 'Graph', root: 'k', nodes: [{ id: 'k', entity }], edges: [],
      select: [{ node: 'k', dimension }],
      time_windows: [{ node: 'k', dimension, start: '2026-09-30T00:00:00Z', end: '2026-10-01T00:00:00Z' }] };
    const result = await transform(intent);
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    const query = result.queries[0];
    assert.deepEqual(query.bindings, [intent.time_windows[0].start, intent.time_windows[0].end].map(x => new Date(x).toISOString()));
    const rows = db.prepare(query.sql).all(...query.bindings);
    assert.deepEqual(rows.map(row => Object.values(row)[0]).sort(), values.slice(1, 3).map(x => new Date(x).toISOString()), entity);
    db.exec(`DELETE FROM "${table}"`);
    const mixed = ['2026-09-30T00:00:00Z', '2026-09-30T00:00:00.000Z',
      '2026-09-30T00:00:00.001Z', '2026-09-30T00:00:00.1Z',
      '2026-09-30T00:00:00.100Z', '2026-09-30T00:00:00.999Z',
      '2026-09-30T00:00:01Z'];
    for (const value of mixed) insert.run(new Date(value).toISOString());
    const precise = await transform({...intent,
      time_windows:[{node:'k',dimension,start:'2026-09-30T00:00:00Z',end:'2026-09-30T00:00:00.999Z'}],
      order_by:[{node:'k',dimension,direction:'Asc'}]});
    assert.equal(precise.accepted,true,JSON.stringify(precise.diagnostics));
    const p = precise.queries[0];
    assert.deepEqual(db.prepare(p.sql).all(...p.bindings).map(row=>Object.values(row)[0]),
      mixed.slice(0,5).map(x=>new Date(x).toISOString()), entity+' mixed-precision inputs with canonical storage and ordering');
    for (const bad of ['2026-09-30T00:00:00.1234Z','2026-09-30T00:00:00.001+00:00']) {
      const rejected = await transform({...intent,time_windows:[{node:'k',dimension,start:bad,end:'2026-10-01T00:00:00Z'}]});
      assert.equal(rejected.accepted,false,entity+' invalid precision/offset');
    }
    const legacy = await transform({ ...intent, time_windows: [{ ...intent.time_windows[0], start: '2026-09-30 00:00:00' }] });
    assert.equal(legacy.accepted, false, `${entity} must reject the former space-separated format`);
    assert.equal(legacy.queries, null);
  }
  console.log(JSON.stringify({ status: 'passed', datasets: cases.length,
    checks: ['inclusive start', 'exclusive end', 'cross-day SQLite ordering', 'legacy input rejection', 'mixed precision input normalization', 'same-second half-open windows', 'chronological ordering', 'overprecision rejection'] }));
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
