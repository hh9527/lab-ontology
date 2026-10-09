import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-result-limit.mjs <pglite-module-path>');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const temporary = mkdtempSync(join(tmpdir(), 'result-limit-'));
const sqlite = new DatabaseSync(':memory:');
const postgres = new PGlite();
const plain = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(
  ([key, value]) => [key === 'count(1)' ? 'count' : key, key.endsWith('_mean') && value !== null ? Number(value) : value])));
const normalized = rows => plain(rows).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
try {
  writeFileSync(join(temporary, 'telora-config.json'), JSON.stringify({ version: 1, members: ['ontology'] }));
  writeFileSync(join(temporary, 'telora-lock.json'), JSON.stringify({ version: 1,
    packages: { ontology: { source: { workspace: 'ontology' }, dependencies: [] } } }));
  const crate = join(temporary, 'ontology');
  cpSync('ontology', crate, { recursive: true });
  copyFileSync('ontology/tests/result_limit.telora', join(crate, 'src/result_limit.telora'));
  const cases = JSON.parse(execFileSync('bin/telora', ['-C', crate, 'eval',
    '@src/result_limit:execution_queries', '--initialization-fuel', '100000',
    '--with-memory-limit', '2048'], { encoding: 'utf8' }), (key, value, context) =>
      typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value) ? BigInt(context.source) : value);
  const schema = 'CREATE TABLE owners(id INTEGER, label TEXT); CREATE TABLE samples(id INTEGER, owner INTEGER, ts BIGINT, value INTEGER)';
  sqlite.exec(schema);
  await postgres.exec(schema);
  for (let id = 1; id <= 130; id++) {
    const owner = [id, `label-${id % 3}`];
    sqlite.prepare('INSERT INTO owners VALUES (?, ?)').run(...owner);
    await postgres.query('INSERT INTO owners VALUES ($1, $2)', owner);
    for (const [sampleId, value] of [[2 * id - 1, 0], [2 * id, 100 + id]]) {
      const sample = [sampleId, id, sampleId, value];
      sqlite.prepare('INSERT INTO samples VALUES (?, ?, ?, ?)').run(...sample);
      await postgres.query('INSERT INTO samples VALUES ($1, $2, $3, $4)', sample);
    }
  }
  const full = new Map();
  for (const item of cases.filter(item => item.limit === 1001)) {
    full.set(item.name, plain(sqlite.prepare(item.sqlite.sql).all(...item.sqlite.bindings)));
  }
  const ordered = new Set(['plain', 'top', 'aggregate_top', 'partitioned', 'ranked_pair']);
  for (const item of cases) {
    const sq = plain(sqlite.prepare(item.sqlite.sql).all(...item.sqlite.bindings));
    const pg = plain((await postgres.query(item.postgres.sql, item.postgres.bindings)).rows);
    assert.deepEqual(item.sqlite.bindings, item.postgres.bindings);
    assert.equal(item.sqlite.bindings.at(-1), item.limit);
    assert.match(item.sqlite.sql, /LIMIT (?:CASE WHEN )?\?\d/);
    assert.match(item.postgres.sql, /LIMIT (?:CASE WHEN CAST\()?\$\d/);
    assert.equal(sq.length, Math.min(full.get(item.name).length, Number(item.limit)), item.name);
    assert.equal(pg.length, sq.length, item.name);
    if (ordered.has(item.name)) {
      assert.deepEqual(sq, full.get(item.name).slice(0, Number(item.limit)), `${item.name}: preserve ordered prefix`);
      assert.deepEqual(pg, sq, `${item.name}: dialect parity`);
    } else if (sq.length === full.get(item.name).length) {
      assert.deepEqual(normalized(pg), normalized(sq), `${item.name}: dialect parity`);
    }
    if (item.name === 'aggregate' || item.name === 'aggregate_top' || item.name === 'latest') {
      for (const row of [...sq, ...pg]) assert.equal(row.s_mean, (100 + row.o_id) / 2, 'aggregate population was truncated');
    }
    if (item.name === 'latest') {
      for (const row of [...sq, ...pg]) assert.equal(row.s_latest, 100 + row.o_id, 'Latest selection was truncated');
    }
    if (item.name === 'pair' || item.name === 'ranked_pair') {
      for (const row of [...sq, ...pg]) {
        assert.equal(row.left_s_mean, (100 + row.left_o_id) / 2);
        assert.equal(row.right_s_mean, 100 + row.left_o_id);
      }
    }
    if (item.name.endsWith('_count')) {
      assert.equal(Number(Object.values(sq[0])[0]), 130);
      assert.equal(Number(Object.values(pg[0])[0]), 130);
    }
    if (item.name === 'partitioned') {
      for (const row of sq) assert.ok(row.s_value === 0 || row.s_value === 100 + row.o_id);
    }
  }
  assert.equal(full.get('distinct').length, 3, 'deduplicate before limit');
  assert.equal(full.get('union').length, 130, 'union before limit');
  assert.equal(full.get('partitioned').length, 260, 'per-owner Top-N before limit');
  assert.equal(cases.find(item => item.name === 'plain' && item.limit === 101).limit, 101);
  console.log(`Final output limit: ${cases.length} SQLite/PostgreSQL execution cases passed (1/2/3/100/101/1001/INT64_MAX; detail, aggregate/Latest, DISTINCT, Top-N, partitioned Top-N, pair/rank/count, union, empty and exact-cap results).`);
} finally {
  sqlite.close();
  await postgres.close();
  rmSync(temporary, { recursive: true, force: true });
}
