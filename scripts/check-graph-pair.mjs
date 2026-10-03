import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Evaluation loads source modules; copy the test model into an isolated crate.
const temporary = mkdtempSync(join(tmpdir(), 'graph-pair-'));
const db = new DatabaseSync(':memory:');
try {
  writeFileSync(join(temporary, 'telora-config.json'), JSON.stringify({ version: 1, members: ['ontology'] }));
  writeFileSync(join(temporary, 'telora-lock.json'), JSON.stringify({ version: 1,
    packages: { ontology: { source: { workspace: 'ontology' }, dependencies: [] } } }));
  const crate = join(temporary, 'ontology');
  cpSync('ontology', crate, { recursive: true });
  copyFileSync('ontology/tests/graph_pair.telora', join(crate, 'src/graph_pair.telora'));
  const queries = JSON.parse(execFileSync('bin/telora', ['-C', crate, 'eval',
    '@src/graph_pair:execution_queries', '--initialization-fuel', '100000',
    '--with-memory-limit', '2048'], { encoding: 'utf8' }));
  db.exec('CREATE TABLE devices(id TEXT, name TEXT); CREATE TABLE samples(id INTEGER, owner TEXT, ts INTEGER, usage REAL, bytes INTEGER, label TEXT)');
  const device = db.prepare('INSERT INTO devices VALUES (?, ?)');
  const sample = db.prepare('INSERT INTO samples VALUES (?, ?, ?, ?, ?, NULL)');
  let id = 0;
  for (const [owner, before, after] of [
    ['a', [0, 20], [30]], ['b', [10], [20, 20, 20]],
    ['c', [30], [40]], ['d', [30], [20]],
    ['left-only', [0], []], ['right-only', [], [1000]],
    ['null-left', [null], [1000]], ['null-right', [0], [null]],
  ]) {
    device.run(owner, 'same name');
    for (const value of before) sample.run(++id, owner, 1, value, value);
    for (const value of after) sample.run(++id, owner, 11, value, value);
  }
  const execute = query => db.prepare(query.sql).all(...query.bindings);
  const values = query => execute(query).map(row => [row.left_prev_usage, row.right_curr_usage]);
  assert.deepEqual(values(queries[0]), [[10, 30], [10, 20]]);
  assert.deepEqual(values(queries[1]), [[30, 20], [10, 20]]);
  assert.deepEqual(values(queries[2]), [[10, 30], [10, 20], [30, 40], [30, 20]]);
  assert.ok(execute(queries[2]).every(row => Object.keys(row).length === 3));
  assert.equal(execute(queries[3]).length, 6);
  assert.deepEqual(Object.values(execute(queries[4])[0]), [6]);
  assert.deepEqual(values(queries[5]), [[30, 40], [30, 20]]);
  assert.deepEqual(values(queries[6]), [[10, 30], [10, 20], [30, 40], [30, 20]]);
  assert.deepEqual(values(queries[7]), values(queries[6]));
  assert.deepEqual(values(queries[8]), [[30, 20], [30, 40], [10, 20], [10, 30]]);
  assert.deepEqual(values(queries[9]), [[30, 20], [10, 20], [30, 40], [10, 30]]);
  const labels = execute(queries[10]);
  assert.equal(labels.length, 4, 'different display values must not remove aligned identities');
  assert.ok(labels.every(row => row.right_d_name === 'current name' && row.left_d_name === 'previous name'));
  assert.deepEqual(Object.keys(labels[0]), ['right_d_name', 'left_d_name', 'left_prev_usage', 'right_curr_usage']);
  assert.deepEqual(execute(queries[11]).map(row => [row.left_prev_bytes, row.right_curr_bytes]),
    [[10, 60], [20, 30], [30, 40], [30, 20]], 'integer division must retain fractional ratios');
  for (const [owner, before, after] of [
    ['zero-baseline', 0, 5], ['negative-baseline', -10, -5],
    ['zero-current', 10, 0], ['negative-current', 10, -20],
  ]) {
    device.run(owner, 'same name');
    sample.run(++id, owner, 1, before, before);
    sample.run(++id, owner, 11, after, after);
  }
  assert.equal(execute(queries[6]).length, 7, 'Ratio excludes only zero or NULL denominators');
  assert.equal(execute(queries[8]).length, 7, 'inverse Ratio guards the selected denominator');
  assert.equal(execute(queries[7]).length, 6, 'GrowthRate requires a positive selected baseline');
  assert.ok(execute(queries[7]).every(row => row.left_prev_usage > 0));
  assert.deepEqual(values(queries[7]).slice(-2), [[10, 0], [10, -20]]);
  db.exec('CREATE TABLE composite_devices(id TEXT, tenant TEXT, name TEXT); CREATE TABLE composite_samples(id INTEGER, owner TEXT, tenant TEXT, ts INTEGER, usage REAL)');
  const compositeDevice = db.prepare('INSERT INTO composite_devices VALUES (?, ?, ?)');
  const compositeSample = db.prepare('INSERT INTO composite_samples VALUES (?, ?, ?, ?, ?)');
  for (const [tenant, before, after] of [
    ['t1', 10, 20], ['t2', 100, 300], ['left-only', 1, null], ['right-only', null, 1000],
  ]) {
    compositeDevice.run('same-id', tenant, 'same-name');
    if (before !== null) compositeSample.run(++id, 'same-id', tenant, 1, before);
    if (after !== null) compositeSample.run(++id, 'same-id', tenant, 2, after);
  }
  assert.deepEqual(execute(queries[12]).map(row => [row.left_s_composite_usage, row.right_s_composite_usage]),
    [[100, 300], [10, 20]], 'all composite identity columns must align without cross-tenant fanout');
  console.log('GraphPair SQLite execution passed: explicit identity/output sides, changed labels, independent populations, thresholds/counts, operand directions, fractional ratios, zero/negative baselines, ties and limits');
} finally {
  db.close();
  rmSync(temporary, { recursive: true, force: true });
}
