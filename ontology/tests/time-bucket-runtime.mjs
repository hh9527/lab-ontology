import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// Input: telora -C ontology eval @test/time_bucket:runtime_cases.
// Optional second argument: installed @electric-sql/pglite module file.
const { cases, grouped } = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
const instants = [
  '0001-01-01T00:00:00Z', '0099-12-31T23:59:59Z', '1900-02-28T23:59:59Z',
  '1969-12-01T00:00:00Z', '1969-12-31T23:59:59Z', '1970-01-01T00:00:00Z',
  '2000-02-29T23:59:59Z', '2024-02-29T23:59:59Z', '2024-03-01T00:00:00Z',
  '2024-12-31T23:59:59Z', '2025-01-01T00:00:00Z', '9999-12-31T23:59:59Z',
];
const rows = instants.map((ts, index) => [index, ts, Date.parse(ts), ts.slice(0, 10), index + 1]);
rows.push([rows.length, '1969-12-31T23:59:59Z', -1, '1969-12-31', 10]);
rows.push([rows.length, null, null, null, 10]);
rows.push([rows.length, null, -62135596800001, null, 10]);
rows.push([rows.length, null, 253402300800000, null, 10]);
for (const [ts, value] of [['2024-02-29T12:00:00Z', 30], ['2024-03-02T00:00:00Z', 999]]) {
  rows.push([rows.length, ts, Date.parse(ts), ts.slice(0, 10), value]);
}
const expected = (row, encoding, unit) => {
  const input = row[encoding === 'datetime' ? 1 : encoding === 'epoch' ? 2 : 3];
  if (input === null) return null;
  const milliseconds = encoding === 'epoch' ? input : Date.parse(encoding === 'date' ? input + 'T00:00:00Z' : input);
  if (milliseconds < -62135596800000 || milliseconds >= 253402300800000) return null;
  const date = new Date(milliseconds);
  if (unit === 'month') date.setUTCDate(1);
  date.setUTCMinutes(0, 0, 0);
  if (unit !== 'hour') date.setUTCHours(0);
  if (encoding === 'epoch') return date.getTime();
  const iso = date.toISOString().replace('.000Z', 'Z');
  return encoding === 'date' ? iso.slice(0, 10) : iso;
};
const normalized = (result, encoding) => result.map(row => {
  const value = Object.values(row)[0];
  return value === null ? null : encoding === 'epoch' ? Number(value)
    : value instanceof Date ? value.toISOString().replace('.000Z', 'Z') : value;
}).sort((a, b) => a === null ? b === null ? 0 : -1 : b === null ? 1 : a < b ? -1 : a > b ? 1 : 0);
const db = new DatabaseSync(':memory:');
let pg;
try {
  db.exec('CREATE TABLE samples(id INTEGER, ts TEXT, epoch INTEGER, day TEXT, value REAL)');
  const insert = db.prepare('INSERT INTO samples VALUES (?,?,?,?,?)');
  for (const row of rows) insert.run(...row);
  if (process.argv[3]) {
    const { PGlite } = await import(pathToFileURL(process.argv[3]).href);
    pg = new PGlite();
    await pg.exec('CREATE TABLE samples(id integer, ts timestamptz, epoch bigint, day date, value double precision)');
    for (const row of rows) await pg.query('INSERT INTO samples VALUES ($1,$2,$3,$4,$5)', row);
  }
  for (const spec of cases) {
    const wanted = normalized(rows.map(row => ({ value: expected(row, spec.encoding, spec.unit) })), spec.encoding);
    assert.deepEqual(normalized(db.prepare(spec.sqlite.sql).all(...spec.sqlite.bindings), spec.encoding), wanted,
      `SQLite ${spec.encoding}/${spec.unit}`);
    if (pg) for (const timezone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
      await pg.exec(`SET TIME ZONE '${timezone}'`);
      const column = `s_sample_${spec.encoding}_${spec.unit}`;
      const value = `t."${column}"`;
      const type = (await pg.query(`SELECT pg_typeof(${value})::text AS type FROM (${spec.postgres.sql}) AS t LIMIT 1`, spec.postgres.bindings)).rows[0].type;
      assert.equal(type, { datetime: 'timestamp with time zone', date: 'date', epoch: 'bigint' }[spec.encoding]);
      // Serialize native PG results explicitly; JS date parsers mishandle years 0001..0099.
      const projection = spec.encoding === 'datetime'
        ? `to_char(${value} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
        : spec.encoding === 'date' ? `to_char(${value}, 'YYYY-MM-DD')` : value;
      const actual = await pg.query(`SELECT ${projection} AS value FROM (${spec.postgres.sql}) AS t`, spec.postgres.bindings);
      assert.deepEqual(normalized(actual.rows, spec.encoding), wanted,
        `PostgreSQL ${timezone} ${spec.encoding}/${spec.unit}`);
    }
  }
  const wantedGroups = [['2024-02-29T00:00:00Z', 19], ['2024-03-01T00:00:00Z', 9]];
  const groupedRows = result => result.map(row => [row.s_sample_datetime_day instanceof Date
    ? row.s_sample_datetime_day.toISOString().replace('.000Z', 'Z') : row.s_sample_datetime_day, row.s_sample_mean])
    .sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(groupedRows(db.prepare(grouped.sqlite.sql).all(...grouped.sqlite.bindings)), wantedGroups);
  if (pg) for (const timezone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
    await pg.exec(`SET TIME ZONE '${timezone}'`);
    const sql = `SELECT to_char(t.s_sample_datetime_day AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS s_sample_datetime_day,
      t.s_sample_mean FROM (${grouped.postgres.sql}) AS t`;
    assert.deepEqual(groupedRows((await pg.query(sql, grouped.postgres.bindings)).rows), wantedGroups);
  }
  console.log(`Passed ${cases.length} UTC bucket variants: SQLite${pg ? ' + PostgreSQL in 3 session timezones' : ''}, NULL, negative milliseconds, leap days, month/year boundaries and calendar range`);
} finally {
  db.close();
  if (pg) await pg.close();
}
