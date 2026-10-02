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
  const sample = db.prepare('INSERT INTO samples VALUES (?, ?, ?, ?, 0, NULL)');
  let id = 0;
  for (const [owner, before, after] of [
    ['a', [0, 20], [30]], ['b', [10], [20, 20, 20]],
    ['c', [30], [40]], ['d', [30], [20]],
    ['left-only', [0], []], ['right-only', [], [1000]],
    ['null-left', [null], [1000]], ['null-right', [0], [null]],
  ]) {
    device.run(owner, 'same name');
    for (const value of before) sample.run(++id, owner, 1, value);
    for (const value of after) sample.run(++id, owner, 11, value);
  }
  const execute = query => db.prepare(query.sql).all(...query.bindings);
  const values = query => execute(query).map(row => [row.prev_usage, row.curr_usage]);
  assert.deepEqual(values(queries[0]), [[10, 30], [10, 20]]);
  assert.deepEqual(values(queries[1]), [[30, 20], [10, 20]]);
  assert.deepEqual(values(queries[2]), [[10, 30], [10, 20], [30, 40], [30, 20]]);
  assert.ok(execute(queries[2]).every(row => Object.keys(row).length === 3));
  assert.equal(execute(queries[3]).length, 6);
  assert.deepEqual(Object.values(execute(queries[4])[0]), [6]);
  assert.deepEqual(values(queries[5]), [[30, 40], [30, 20]]);
  console.log('GraphPair SQLite execution passed: independent averages, identity grouping, intersection, NULL exclusion, Asc/Desc, ties, limits, output shape');
} finally {
  db.close();
  rmSync(temporary, { recursive: true, force: true });
}
