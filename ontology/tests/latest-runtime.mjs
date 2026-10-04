import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const queries = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { PGlite } = await import(pathToFileURL(process.argv[3]).href);
const sqlite = new DatabaseSync(':memory:');
const postgres = new PGlite();
try {
  const schema = 'CREATE TABLE samples(id BIGINT, owner TEXT, tenant TEXT, ts BIGINT, value BIGINT, memory BIGINT)';
  sqlite.exec(schema);
  await postgres.exec(schema);
  const fixture = [
    [1, 'a', 't', -1, 85, 10], [2, 'a', 't', 1, null, 95],
    [3, 'b', 't', -1, 10, 90], [4, 'b', 't', 1, 90, 20],
    [5, 'c', 't', 1, 70, null], [6, 'c', 't', 1, 99, 99],
    [7, 'd', 't', null, 100, 100],
    [8, 'e', 't', -1, 20, 30], [9, 'e', 't', null, 100, 100],
  ];
  for (const row of fixture) {
    sqlite.prepare('INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?)').run(...row);
    await postgres.query('INSERT INTO samples VALUES ($1, $2, $3, $4, $5, $6)', row);
  }
  const sq = sqlite.prepare(queries.mixed.sqlite.sql).all(...queries.mixed.sqlite.bindings);
  const pg = (await postgres.query(queries.mixed.postgres.sql, queries.mixed.postgres.bindings)).rows;
  const values = rows => rows.map(row => [row.s_owner, row.s_latest, row.s_memory_latest,
    Number(row.s_mean), row.s_latest_minus_mean === null ? null : Number(row.s_latest_minus_mean),
    Number(row.s_sample_count), Number(row.s_positive_count)]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(values(pg), values(sq));
  assert.deepEqual(values(sq), [
    ['a', null, 95, 85, null, 2, 1], ['b', 90, 20, 50, 40, 2, 2],
    ['c', 70, null, 84.5, -14.5, 2, 2], ['d', null, null, 100, null, 1, 1],
    ['e', 20, 30, 60, -40, 2, 2],
  ]);
  const large = 9007199254740993n;
  sqlite.prepare('INSERT INTO samples VALUES (?, ?, ?, ?, ?, ?)').run(10, 'large', 't', 1, large, 0);
  await postgres.query('INSERT INTO samples VALUES ($1, $2, $3, $4, $5, $6)', [10, 'large', 't', 1, large, 0]);
  const statement = sqlite.prepare(queries.integer.sqlite.sql);
  statement.setReadBigInts(true);
  const largeSq = statement.all(...queries.integer.sqlite.bindings).find(row => row.s_owner === 'large');
  const largePg = (await postgres.query(queries.integer.postgres.sql, queries.integer.postgres.bindings)).rows.find(row => row.s_owner === 'large');
  assert.equal(largeSq.s_latest, large);
  assert.equal(largePg.s_latest, large);
  const type = await postgres.query(`SELECT pg_typeof(s_latest)::text AS type FROM (${queries.integer.postgres.sql}) AS result LIMIT 1`, queries.integer.postgres.bindings);
  assert.equal(type.rows[0].type, 'bigint');
  console.log('Latest core execution passed: EpochMillis, negative times, NULL clocks/values, grain ties, unchanged Avg/Count, computed measures and exact BIGINT beyond Number precision');
} finally {
  sqlite.close();
  await postgres.close();
}
