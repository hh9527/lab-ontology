import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// 输入来自 typed_groups 的 runtime_cases 或 graph_runtime_cases，执行实际生成的 SQL。
const cases = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const graph = process.argv[3] === '--graph';
assert.equal(cases.length, graph ? 5 : 4);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE samples_ms (
  tenant TEXT, device TEXT, seq INTEGER, name TEXT, category TEXT,
  ${graph ? "RX_BYTES REAL, TX_BYTES REAL, DURATION_MS REAL" : "rx REAL, tx REAL, elapsed_ms REAL"}
);
CREATE TABLE owners (tenant TEXT, device TEXT, name TEXT);
CREATE TABLE samples_s (
  ${graph ? "TENANT_ID TEXT, DEVICE_ID TEXT" : "tenant_key TEXT, device_key TEXT"}, sequence INTEGER, title TEXT, kind TEXT,
  ${graph ? "INPUT_BYTES REAL, OUTPUT_BYTES REAL, DURATION_S REAL" : "bytes_in REAL, bytes_out REAL, duration_seconds REAL"}
);`);
const rows = [
  ['T1', 'D1', 1, 'alpha', 'router', 100, 10, 1000],
  ['T1', 'D1', 2, 'alpha', 'router', 900, 90, 9000],
  ['T1', 'D1', 3, 'alpha', 'router', 100, 10, 10000],
  ['T2', 'D1', 1, 'alpha', 'router', 3, 6, 2000],
  ['T1', 'D2', 1, 'invalid', 'switch', 100, 1, 0],
  ['T1', 'D2', 2, 'invalid', 'switch', 200, 2, -1000],
  ['T1', 'D2', 3, 'invalid', 'switch', 300, 3, null],
  ['T1', 'D3', 1, 'null amount', 'switch', null, 0, 1000],
  ['T3', null, 1, 'missing role', 'router', 10, 1, 1000],
  ['T4', null, 1, 'missing role', 'router', 20, 2, 1000],
  ['T1', 'D4', 1, null, 'switch', 0, 0, 1000],
];
const insertMs = db.prepare('INSERT INTO samples_ms VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insertS = db.prepare('INSERT INTO samples_s VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
for (const row of rows) {
  insertMs.run(...row);
  insertS.run(...row.slice(0, 7), row[7] === null ? null : row[7] / 1000);
}
const owners = new Map(rows.filter((row) => row[1] !== null).map((row) => [JSON.stringify(row.slice(0, 2)), row]));
for (const row of owners.values()) db.prepare('INSERT INTO owners VALUES (?, ?, ?)').run(row[0], row[1], row[3] ?? 'zero');
const sum = (values) => values.length ? values.reduce((a, b) => a + b, 0) : null;
const metrics = (group) => {
  const result = {};
  for (const [prefix, index] of [['rx', 5], ['tx', 6]]) {
    const amounts = group.map((row) => row[index]).filter((value) => value !== null);
    const rates = group.filter((row) => row[index] !== null && row[7] !== null && row[7] > 0)
      .map((row) => row[index] / (row[7] / 1000));
    result[`${prefix}_total`] = sum(amounts);
    result[`${prefix}_peak`] = rates.length ? Math.max(...rates) : null;
    result[`${prefix}_mean`] = rates.length ? sum(rates) / rates.length : null;
  }
  return result;
};
const groups = new Map();
for (const row of rows) {
  const identity = row[0] !== null && row[1] !== null ? row.slice(0, 2) : [null, null];
  const key = JSON.stringify([...identity, row[3], row[4]]);
  const group = groups.get(key) ?? [];
  group.push(row);
  groups.set(key, group);
}
const groupedExpected = [...groups].map(([key, group]) => {
  const [tenant_id, device_id, label, category] = JSON.parse(key);
  return { tenant_id, device_id, label, category, ...metrics(group) };
});
const sorted = (values) => values.map((value) => ({ ...value }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const run = (query) => db.prepare(query.sql).all(...query.bindings).map((row) =>
  graph ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^r_/, ''), value])) : row);
for (const item of cases) {
  const expected = item.id.endsWith('_grouped') ? groupedExpected : item.id.endsWith('_exists')
    ? [{ owner_label: 'alpha' }] : [metrics(rows)];
  assert.deepEqual(sorted(run(item.sqlite)), sorted(expected), item.id);
  assert.deepEqual(item.postgres.bindings, item.sqlite.bindings, `${item.id} dialect bindings`);
  assert.ok(!item.sqlite.sql.includes(' JOIN '), `${item.id} must stay within one Dataset`);
}
const query = cases.find((item) => item.id === 'ms_grouped').sqlite;
const results = run(query);
assert.equal(results.find((r) => r.tenant_id === 'T1' && r.device_id === 'D1').rx_mean, 70);
assert.equal(results.find((r) => r.tenant_id === 'T2' && r.device_id === 'D1').rx_mean, 1.5);
const missing = results.filter((r) => r.device_id === null);
assert.equal(missing.length, 1);
assert.equal(missing[0].tenant_id, null);
assert.equal(missing[0].rx_total, 30);

db.exec('DELETE FROM samples_ms; DELETE FROM samples_s;');
for (const item of cases) {
  const actual = run(item.sqlite);
  if (item.id.endsWith('_grouped') || item.id.endsWith('_exists')) assert.deepEqual(actual, [], item.id);
  else assert.deepEqual(actual.map((row) => ({ ...row })), [metrics([])], item.id);
}

// 无 affinity 列保留整数存储，验证 typed rate 的 lowering 主动使用浮点除法。
db.exec(`DROP TABLE samples_s; CREATE TABLE samples_s (
  ${graph ? "TENANT_ID, DEVICE_ID" : "tenant_key, device_key"}, sequence, title, kind,
  ${graph ? "INPUT_BYTES, OUTPUT_BYTES, DURATION_S" : "bytes_in, bytes_out, duration_seconds"}
); INSERT INTO samples_s VALUES ('T1', 'D1', 1, 'integer', 'router', 3, 5, 2);`);
const integer = run(cases.find((item) => item.id === 's_all').sqlite)[0];
assert.equal(integer.rx_mean, 1.5);
assert.equal(integer.tx_mean, 2.5);
db.close();
console.log(`Passed ${cases.length} ${graph ? 'Graph' : 'standalone'} queries over reused Groups, nominal identity, NULL/invalid/empty inputs and integer-storage rate boundaries.`);
