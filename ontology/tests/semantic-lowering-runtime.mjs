import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// telora -C ontology eval @test/semantic_lowering:runtime_cases > "$TMPDIR/cases.json"
// node ontology/tests/semantic-lowering-runtime.mjs "$TMPDIR/cases.json"
const cases = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE devices(id TEXT, name TEXT, tenant_id TEXT, peer_tenant TEXT, peer_code TEXT);
  CREATE TABLE tenants(id TEXT, name TEXT);
  CREATE TABLE scoped_devices(tenant TEXT, code TEXT, name TEXT);
  CREATE TABLE samples(device_id TEXT, ts TEXT, cpu REAL, threshold REAL);
  INSERT INTO devices VALUES
    ('d1', 'D1', 't1', 't1', 'same'),
    ('d2', 'D2', 't2', 't2', 'same'),
    ('d3', 'D3', NULL, NULL, NULL),
    ('d4', 'D4', 'missing', 'missing', 'same');
  INSERT INTO tenants VALUES ('t1', 'T1'), ('t2', 'T2');
  INSERT INTO scoped_devices VALUES
    ('t1', 'same', 'Peer1'), ('t2', 'same', 'Peer2'), ('t1', 'other', 'Other');
  INSERT INTO samples VALUES
    ('d1', '2026-11-01T00:00:00.000Z', 20, 90),
    ('d2', '2026-11-01T00:00:00.000Z', 40, 90),
    ('d3', '2026-11-01T00:00:00.000Z', NULL, 90);
`);
const run = (index) => db.prepare(cases[index].sql).all(...cases[index].bindings)
  .map((row) => ({ ...row }));
const byDevice = (rows) => rows.sort((a, b) => a.d_device__name.localeCompare(b.d_device__name));
assert.deepEqual(byDevice(run(0)), ['D1', 'D2', 'D3', 'D4'].map((name) => ({ d_device__name: name })));
assert.deepEqual(run(1), [{ s_sample__cpu_mean: 30 }]);
assert.deepEqual(byDevice(run(2)), [
  { d_device__name: 'D1', t_tenant__name: 'T1' },
  { d_device__name: 'D2', t_tenant__name: 'T2' },
  { d_device__name: 'D3', t_tenant__name: null },
  { d_device__name: 'D4', t_tenant__name: null },
]);
assert.deepEqual(byDevice(run(3)), [
  { d_device__name: 'D1', p_scoped_device__name: 'Peer1' },
  { d_device__name: 'D2', p_scoped_device__name: 'Peer2' },
  { d_device__name: 'D3', p_scoped_device__name: null },
  { d_device__name: 'D4', p_scoped_device__name: null },
]);
assert.deepEqual(byDevice(run(4)), [
  { d_device__name: 'D1', t2_tenant__name: 'T1' },
  { d_device__name: 'D2', t2_tenant__name: 'T2' },
  { d_device__name: 'D3', t2_tenant__name: null },
  { d_device__name: 'D4', t2_tenant__name: null },
]);
assert.deepEqual(byDevice(run(5)), ['D1', 'D2'].map((name) => ({ d_device__name: name })));
assert.deepEqual(run(6), [{ d_device__name: 'D1', t_tenant__name: 'T1' }]);
db.exec('DELETE FROM samples');
assert.deepEqual(run(1), [{ s_sample__cpu_mean: null }]);
db.close();
console.log('Passed: projection, mean, optional/composite/chained LEFT JOIN, EXISTS, peer filter, empty aggregate');
