import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

if (!process.argv[2]) throw new Error('Usage: node scripts/check-transform-columns.mjs <pglite-module-path>');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const temporary = mkdtempSync(join(tmpdir(), 'transform-columns-'));
const sqlite = new DatabaseSync(':memory:');
const postgres = new PGlite();
const valueMatches = (type, value) => {
  if (value === null) return true;
  switch (type) {
    case 'String': return typeof value === 'string';
    case 'Bool': return typeof value === 'boolean' || value === 0 || value === 1;
    // Some drivers encode BIGINT as a string; the declaration describes the
    // logical value and does not dictate a driver's lossless integer transport.
    case 'Int': case 'EpochMillis': return Number.isInteger(Number(value));
    case 'Float': return Number.isFinite(Number(value));
    case 'LocalDateTime': return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value);
    case 'DatetimeUtc': return value instanceof Date ? Number.isFinite(value.getTime()) : typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
    default: return false;
  }
};
try {
  writeFileSync(join(temporary, 'telora-config.json'), JSON.stringify({ version: 1, members: ['ontology'] }));
  writeFileSync(join(temporary, 'telora-lock.json'), JSON.stringify({ version: 1,
    packages: { ontology: { source: { workspace: 'ontology' }, dependencies: [] } } }));
  const crate = join(temporary, 'ontology');
  cpSync('ontology', crate, { recursive: true });
  const cases = [];
  for (const [module, binding] of [['result_columns', 'execution_queries'], ['result_limit', 'column_execution_queries']]) {
    copyFileSync(`ontology/tests/${module}.telora`, join(crate, `src/${module}.telora`));
    cases.push(...JSON.parse(execFileSync('bin/telora', ['-C', crate, 'eval',
      `@src/${module}:${binding}`, '--initialization-fuel', '100000', '--with-memory-limit', '2048'], { encoding: 'utf8' })));
  }
  const ddl = 'CREATE TABLE readings(id BIGINT, value BIGINT, ts TEXT, epoch BIGINT, ratio DOUBLE PRECISION, active BOOLEAN, label TEXT, local_epoch BIGINT, local_text TEXT); '
    + 'CREATE TABLE owners(id INTEGER, label TEXT); CREATE TABLE samples(id INTEGER, owner INTEGER, ts BIGINT, value INTEGER)';
  sqlite.exec(ddl);
  await postgres.exec(ddl.replace('ts TEXT', 'ts TIMESTAMPTZ'));
  for (const phase of ['empty', 'all-null-values', 'populated']) {
    if (phase === 'all-null-values') {
      sqlite.prepare('INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, null, '2026-10-20T00:00:00Z', 1792454400000, 1.5, 1, 'first', 1792454400000, '2026-10-20T08:00:00');
      await postgres.query('INSERT INTO readings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [1, null, '2026-10-20T00:00:00Z', 1792454400000, 1.5, true, 'first', 1792454400000, '2026-10-20T08:00:00']);
    }
    if (phase === 'populated') {
      sqlite.prepare('INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(2, 7, '2026-10-21T00:00:00Z', 1792540800000, 2.5, 0, 'second', 1792540800000, '2026-10-21T08:00:00');
      await postgres.query('INSERT INTO readings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [2, 7, '2026-10-21T00:00:00Z', 1792540800000, 2.5, false, 'second', 1792540800000, '2026-10-21T08:00:00']);
      sqlite.prepare('INSERT INTO owners VALUES (?, ?)').run(4, 'empty-owner');
      await postgres.query('INSERT INTO owners VALUES ($1,$2)', [4, 'empty-owner']);
      for (let id = 1; id <= 3; id++) {
        sqlite.prepare('INSERT INTO owners VALUES (?, ?)').run(id, `owner-${id}`);
        await postgres.query('INSERT INTO owners VALUES ($1,$2)', [id, `owner-${id}`]);
        for (const [sampleId, value] of [[id * 2 - 1, 0], [id * 2, id + 100]]) {
          sqlite.prepare('INSERT INTO samples VALUES (?, ?, ?, ?)').run(sampleId, id, sampleId, value);
          await postgres.query('INSERT INTO samples VALUES ($1,$2,$3,$4)', [sampleId, id, sampleId, value]);
        }
      }
    }
    for (const fixture of cases) {
      assert.deepEqual(fixture.sqlite.columns, fixture.postgres.columns, fixture.name);
      const statement = sqlite.prepare(fixture.sqlite.sql);
      const sq = statement.all(...fixture.sqlite.bindings);
      const pg = await postgres.query(fixture.postgres.sql, fixture.postgres.bindings);
      const names = fixture.sqlite.columns.map(column => column.name);
      assert.deepEqual(statement.columns().map(column => column.name), names, `${phase}/${fixture.name}: SQLite column names`);
      assert.deepEqual(pg.fields.map(field => field.name), names, `${phase}/${fixture.name}: PostgreSQL column names`);
      assert.equal(sq.length, pg.rows.length, `${phase}/${fixture.name}: result cardinality`);
      for (const row of [...sq, ...pg.rows]) {
        for (const column of fixture.sqlite.columns) {
          if (!column.nullable) assert.notEqual(row[column.name], null, `${phase}/${fixture.name}/${column.name}: nonnullable`);
          assert.ok(valueMatches(column.type, row[column.name]), `${phase}/${fixture.name}/${column.name}: ${column.type} vs ${row[column.name]}`);
        }
      }
      if (fixture.name.startsWith('end_only_')) {
        assert.equal(sq.length, phase === 'empty' ? 0 : 1, `${phase}/${fixture.name}: exclusive cutoff`);
        if (sq.length) assert.equal(Number(sq[0].r_epoch), 1792454400000);
      }
      if (fixture.name === 'aggregates') {
        assert.equal(Number(sq[0].r_total), phase === 'empty' ? 0 : phase === 'all-null-values' ? 1 : 2);
        assert.equal(sq[0].r_sum, phase === 'populated' ? 7 : null);
        assert.equal(sq[0].r_mean, phase === 'populated' ? 7 : null);
      }
    }
  }
  console.log(`transform columns: ${cases.length} shapes × 3 data populations × SQLite/PostgreSQL passed`);
} finally {
  sqlite.close();
  await postgres.close();
  rmSync(temporary, { recursive: true, force: true });
}
