import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// 执行 @test/typed_relations:runtime_cases 导出的真实新旧查询。
const cases = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE tenants (id TEXT);
CREATE TABLE sites (id TEXT, tenant_id TEXT);
CREATE TABLE devices (id TEXT, site_id TEXT, tenant_id TEXT);
CREATE TABLE connections (a_device_id TEXT, id TEXT, tenant_id TEXT, z_device_id TEXT);
CREATE TABLE routes (a_device_id TEXT, id TEXT, tenant_id TEXT, z_device_id TEXT);`);
const insert = (table, rows) => {
  for (const row of rows) db.prepare(`INSERT INTO ${table} VALUES (${row.map(() => '?').join(',')})`).run(...row);
};
insert('tenants', [['T1'], ['T2'], ['T0']]);
insert('sites', [['S1', 'T1'], ['S1', 'T2'], ['S0', 'T0']]);
insert('devices', [
  ['A', 'S1', 'T1'], ['B', 'S1', 'T1'], ['C', 'S1', 'T1'], ['D', 'S1', 'T1'],
  ['A', 'S1', 'T2'], ['B', 'S1', 'T2'], ['X', 'S1', 'T2'],
]);
insert('connections', [
  ['A', 'C1', 'T1', 'B'], ['A', 'C2', 'T1', 'B'], ['B', 'C3', 'T1', 'C'],
  ['A', 'C1', 'T2', 'B'], ['A', 'broken', 'T1', 'X'], ['A', 'orphan', 'T3', 'B'],
  ['C', 'self', 'T1', 'C'],
]);
insert('routes', [
  ['A', 'R1', 'T1', 'B'], ['B', 'R2', 'T1', 'C'], ['B', 'R1', 'T2', 'A'],
  ['C', 'broken', 'T1', 'X'],
]);
const expected = {
  endpoints: [
    { t_tenant_id: 'T1', a_device_id: 'A', z_device_id: 'B' },
    { t_tenant_id: 'T1', a_device_id: 'A', z_device_id: 'B' },
    { t_tenant_id: 'T1', a_device_id: 'B', z_device_id: 'C' },
    { t_tenant_id: 'T2', a_device_id: 'A', z_device_id: 'B' },
    { t_tenant_id: 'T1', a_device_id: 'C', z_device_id: 'C' },
  ],
  exists: [{ d_count: 4 }],
  undirected: [['A', 'B'], ['B', 'A'], ['B', 'C'], ['C', 'B'], ['C', 'C']]
    .map(([a_device_id, z_device_id]) => ({ a_device_id, z_device_id })),
  directed: [['A', 'B'], ['B', 'C'], ['B', 'A']]
    .map(([a_device_id, z_device_id]) => ({ a_device_id, z_device_id })),
  empty_groups: [['T1', 4], ['T2', 3], ['T0', 0]].map(([t_tenant_id, d_count]) => ({ t_tenant_id, d_count })),
  alternative_counts: [['A', 3], ['A', 1], ['B', 3], ['B', 1], ['C', 2], ['D', 0], ['X', 0]]
    .map(([d_device_id, c_count]) => ({ d_device_id, c_count })),
};
const normalized = (rows) => rows.map((row) => ({ ...row }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
for (const item of cases) {
  assert.ok(item.id in expected, `unexpected case ${item.id}`);
  const oldRows = db.prepare(item.baseline.sql).all(...item.baseline.bindings);
  const typedRows = db.prepare(item.typed.sql).all(...item.typed.bindings);
  assert.deepEqual(normalized(typedRows), normalized(expected[item.id]), `${item.id} semantics`);
  assert.deepEqual(normalized(typedRows), normalized(oldRows), `${item.id} baseline parity`);
}
assert.equal(cases.length, Object.keys(expected).length);
db.exec('DELETE FROM connections; DELETE FROM routes;');
for (const item of cases.filter((c) => ['exists', 'alternative_counts'].includes(c.id))) {
  const rows = db.prepare(item.typed.sql).all(...item.typed.bindings);
  if (item.id === 'exists') assert.deepEqual(normalized(rows), [{ d_count: 0 }]);
  else assert.ok(rows.length === 7 && rows.every((row) => row.c_count === 0));
}
db.close();
console.log('Passed 6 typed/baseline query pairs: composite tenant identity, explicit A/Z, direction, EXISTS grain and empty/alternative counts.');
