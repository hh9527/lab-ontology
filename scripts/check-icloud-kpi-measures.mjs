import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cases } from './tests/fixtures/icloud-kpi-measures.mjs';

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
  assert.equal(line.done, false, 'runner exited before answering');
  const response = JSON.parse(line.value);
  assert.equal(response.error, false, JSON.stringify(response.diagnostics));
  return response.ok;
}
async function info(key) {
  const node = (await request('info', { key })).Document.Found;
  assert.ok(node, `missing ${key}`);
  return node;
}
try {
  const catalog = JSON.parse(readFileSync('icloud_model/data/source_catalog.json', 'utf8'));
  for (const [table, column, unitName, unitType] of [
    ['StorageDeviceKPI', 'cpuusage', 'percent', 'ratio'],
    ['StorageDeviceKPI', 'memoryusage', 'percent', 'ratio'],
    ['StorageHardDriveKPI', 'utility', 'percent', 'ratio'],
    ['StorageHardDriveKPI', 'avgreadiosize', 'kilobyte', 'data_size'],
    ['StorageHardDriveKPI', 'avgwriteiosize', 'kilobyte', 'data_size'],
  ]) {
    const field = catalog.datasets.find(dataset => dataset.table === table).fields.find(field => field.name === column);
    assert.equal(field.columnType, 'measure');
    assert.equal(field.unitName, unitName);
    assert.equal(field.unitType, unitType);
  }
  for (const [entity, table, time, fields] of cases) {
    db.exec(`CREATE TABLE ${table}(resId TEXT, tenantId TEXT, ts TEXT, ${fields.map(([column]) => `${column} REAL`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES (${Array(fields.length + 3).fill('?').join(', ')})`);
    for (const [timestamp, value] of [
      ['2026-10-02T00:00:00Z', 10], ['2026-10-02T12:00:00Z', 30],
      ['2026-10-02T13:00:00Z', null], ['2026-10-03T00:00:00Z', 999],
    ]) insert.run('resource', 'tenant', timestamp, ...fields.map(() => value));
    const statistics = entity === 'interface_kpi' ? [['', 'Avg', 20]]
      : [['', 'Avg', 20], ['_max', 'Max', 30], ['_min', 'Min', 10]];
    const measures = fields.flatMap(([, base]) => statistics.map(([suffix]) => base + suffix));
    const intent = {
      op: 'Graph', limit: 1000, root: 'k', nodes: [{ id: 'k', entity }], edges: [], select: [],
      measures: measures.map(measure => ({ node: 'k', measure })),
      time_windows: [{ node: 'k', dimension: time, start: '2026-10-02T00:00:00Z', end: '2026-10-03T00:00:00Z' }],
    };
    const result = await request('transform', { intents: [intent] });
    assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
    assert.equal(result.queries.length, 1);
    const query = result.queries[0];
    const rows = db.prepare(query.sql).all(...query.bindings);
    assert.equal(rows.length, 1);
    for (const [, base, unit] of fields) {
      for (const [suffix, aggregate, expected] of statistics) {
        const measure = base + suffix;
        assert.equal(rows[0][`k_${measure}`], expected, `${entity}/${measure}: half-open window and NULL`);
        const node = await info(`Measure/${entity}/${measure}`);
        assert.equal(node.detail.aggregate, aggregate);
        assert.ok(node.description.aliases.length > 0);
        assert.ok(node.description.summary.includes('Samples are not summed across time'));
        if (unit) assert.ok(JSON.stringify(node).includes(unit), `${measure}: unit`);
      }
    }
    for (const [unit, buckets, values] of [
      ['hour', ['2026-10-02T00:00:00Z', '2026-10-02T12:00:00Z', '2026-10-02T13:00:00Z'], [10, 30, null]],
      ['day', ['2026-10-02T00:00:00Z'], [20]],
      ['month', ['2026-10-01T00:00:00Z'], [20]],
    ]) {
      const prefix = entity === 'onu_kpi' ? 'onu' : entity;
      const dimension = `${prefix}_utc_${unit}`;
      const measure = fields[0][1];
      const grouped = await request('transform', { intents: [{ ...intent,
        select: [{ node: 'k', dimension }], measures: [{ node: 'k', measure }],
      }] });
      assert.equal(grouped.accepted, true, JSON.stringify(grouped.diagnostics));
      const plan = grouped.queries[0];
      const result = db.prepare(plan.sql).all(...plan.bindings).sort((a, b) => a[`k_${dimension}`].localeCompare(b[`k_${dimension}`]));
      assert.deepEqual(result.map(row => row[`k_${dimension}`]), buckets);
      assert.deepEqual(result.map(row => row[`k_${measure}`]), values);
      const node = await info(`Dimension/${entity}/${dimension}`);
      assert.equal(node.detail.ty, 'DatetimeUtc');
      assert.ok(node.links.some(link => link.key === 'Schema/syntax/operations/utc_time_bucket'));
    }
    // Empty-valued populations must not turn into zero or an absent row.
    db.exec(`UPDATE ${table} SET ${fields.map(([column]) => `${column}=NULL`).join(', ')}`);
    const empty = db.prepare(query.sql).all(...query.bindings);
    assert.equal(empty.length, 1);
    for (const measure of measures) assert.equal(empty[0][`k_${measure}`], null);
    if (entity.startsWith('source_') && entity !== 'source_StorageDeviceKPI') {
      const dataset = await info(`Dataset/${entity}`);
      assert.ok(dataset.description.summary.includes('provisional'));
    }
  }

  db.exec('CREATE TABLE T_CURRENT_ALARM(CSN INTEGER, CLEARED INTEGER)');
  db.exec('INSERT INTO T_CURRENT_ALARM VALUES (1,0),(2,1),(3,NULL),(4,0)');
  const alarms = await request('transform', { intents: [{ op: 'Graph', limit: 1000, root: 'a',
    nodes: [{ id: 'a', entity: 'current_alarm' }], edges: [], select: [],
    measures: [{ node: 'a', measure: 'alarm_count' }, { node: 'a', measure: 'alarm_open_count' }],
  }] });
  assert.equal(alarms.accepted, true, JSON.stringify(alarms.diagnostics));
  const alarmQuery = alarms.queries[0];
  const alarmRow = db.prepare(alarmQuery.sql).get(...alarmQuery.bindings);
  assert.equal(alarmRow.a_alarm_count, 4);
  assert.equal(alarmRow.a_alarm_open_count, 2);
  const cleared = await info('Dimension/current_alarm/alarm_cleared');
  assert.ok(cleared.description.summary.includes('do not impose'));
  for (const aggregate of ['avg', 'min', 'max']) {
    const node = await info(`Measure/device_kpi/device_online_rate_${aggregate}`);
    assert.ok(node.description.summary.toLowerCase().includes('distinct population from networkdeviceonlinekpi'));
  }
  db.exec('CREATE TABLE HuaweiStorageDevice(id TEXT, name TEXT)');
  db.exec("INSERT INTO HuaweiStorageDevice VALUES ('s1','Storage-DC1-A'),('s2','Other')");
  const named = await request('transform', { intents: [{ op: 'Graph', limit: 1000, root: 's',
    nodes: [{ id: 's', entity: 'storage_device' }], edges: [],
    select: [{ node: 's', dimension: 'storage_device__name' }],
    filters: [{ node: 's', dimension: 'storage_device__name', op: 'Contains', value: 'storage' }],
  }] });
  assert.equal(named.accepted, true, JSON.stringify(named.diagnostics));
  const namedQuery = named.queries[0];
  const namedRows = db.prepare(namedQuery.sql).all(...namedQuery.bindings);
  assert.equal(namedRows.length, 1);
  assert.equal(namedRows[0].s_storage_device__name, 'Storage-DC1-A');
  assert((await info('Field/storage_device/name')).detail.roles.includes('Appellation'));
  assert((await info('Dataset/storage_device')).detail.references.some(ref => ref.id === 'id'));

  for (const [ty, member, wire] of [
    ['PonClass', 'olt', 'ne.category.olt'],
    ['PhysicalLinkType', 'lldp', 1], ['PhysicalLinkType', 'csp', 7],
    ['PhysicalLinkType', 'server_internal', 8], ['PhysicalLinkType', 'fiber_search', 9],
  ]) {
    const value = await info(`Value/${ty}/${member}`);
    assert.ok(JSON.stringify(value.detail).includes(JSON.stringify(wire)), `${ty}/${member}: original wire`);
  }
  console.log(`Passed: ${cases.length} KPI datasets, sample aggregates, hour/day/month trends, half-open windows, NULL populations, storage name search, alarm counts, online-rate populations and stable value keys`);
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
