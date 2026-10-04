import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { PGlite } = await import(pathToFileURL(process.argv[3]).href);
const sqlite = new DatabaseSync(':memory:');
const postgres = new PGlite();
const t1 = '2026-10-01T12:00:00Z';
const t2 = '2026-10-02T12:00:00Z';
const fixture = [
  ['a', 'a', t1, 85, 10], ['a', 'a', t2, null, 95],
  ['b', 'a', t1, 10, 90], ['b', 'a', t2, 90, 20],
  ['c', 'a', t1, 20, 30], ['c', 'b', t2, 99, 99], ['c', 'a', t2, 70, null],
  ['d', 'a', null, 100, 100],
  ['e', 'a', t1, 20, 30], ['e', 'a', t2, 25, 40], ['e', 'a', null, 100, 100],
  ['zero', 'a', t1, 0, 20], ['zero', 'a', t2, 40, 30],
  ['negative', 'a', t1, -10, 20], ['negative', 'a', t2, -5, 30],
  ['future', 'a', t1, 5, 10], ['future', 'a', '2026-10-04T00:00:00Z', 500, 60],
];
const plain = rows => rows.map(row => ({ ...row }));
const sorted = rows => plain(rows).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
try {
  if (process.argv[4]) {
    await withKnowledgeRunner(process.argv[4], async (_, request) => {
      for (const item of cases) {
        const result = await request('ic/transform', { intents: [item.intent] });
        assert.equal(result.accepted, true, JSON.stringify(result.diagnostics));
        assert.deepEqual(result.queries[0], item.sqlite, `${item.name}: snapshot matches source`);
      }
      for (const [dataset, id] of [['device_kpi', 'device_cpu_latest'], ['device_kpi', 'device_memory_latest'],
        ['server_kpi', 'server_cpu_latest'], ['server_kpi', 'server_memory_latest']]) {
        const node = (await request('ic/info', { key: `Measure/${dataset}/${id}` })).Document.Found;
        assert.equal(node.detail.aggregate, 'Latest');
        assert.equal(node.detail.sampling.unit, '%');
        assert.ok(node.links.some(link => link.key === 'Schema/syntax/graph/latest'));
        assert.ok(node.links.some(link => link.key === `TimeRole/${dataset}/ts`));
      }
    }, { memory: '2048' });
    console.log('Latest snapshot passed: all exported queries match source; four measures publish units, clock and contract');
  }
  for (const db of [sqlite, postgres]) {
    const timeType = db === sqlite ? 'TEXT' : 'TIMESTAMPTZ';
    await db.exec(`CREATE TABLE "I_EntNetworkElement"(id TEXT, name TEXT);
      CREATE TABLE "PhysicalServer"(id TEXT, name TEXT);
      CREATE TABLE "NetworkDeviceKPI"("resId" TEXT, "tenantId" TEXT, ts ${timeType}, "cpuUsage" DOUBLE PRECISION, "memUsage" DOUBLE PRECISION);
      CREATE TABLE "ServerDeviceKPI"("resId" TEXT, "tenantId" TEXT, ts ${timeType}, "cpuUsage" DOUBLE PRECISION, "memUsage" DOUBLE PRECISION)`);
  }
  for (const owner of [...new Set(fixture.map(row => row[0])), 'empty']) {
    for (const table of ['I_EntNetworkElement', 'PhysicalServer']) {
      const name = table === 'PhysicalServer' ? owner : 'same name';
      sqlite.prepare(`INSERT INTO "${table}" VALUES (?, ?)`).run(owner, name);
      await postgres.query(`INSERT INTO "${table}" VALUES ($1, $2)`, [owner, name]);
    }
  }
  for (const row of fixture) {
    for (const table of ['NetworkDeviceKPI', 'ServerDeviceKPI']) {
      sqlite.prepare(`INSERT INTO "${table}" VALUES (?, ?, ?, ?, ?)`).run(...row);
      await postgres.query(`INSERT INTO "${table}" VALUES ($1, $2, $3, $4, $5)`, row);
    }
  }
  const results = new Map();
  for (const item of cases) {
    const rows = sqlite.prepare(item.sqlite.sql).all(...item.sqlite.bindings);
    for (const timezone of ['UTC', 'Asia/Shanghai']) {
      await postgres.exec(`SET TIME ZONE '${timezone}'`);
      const pg = (await postgres.query(item.postgres.sql, item.postgres.bindings)).rows;
      assert.deepEqual(sorted(pg), sorted(rows), `${item.name}: cross-dialect values`);
      if (['top', 'subtract', 'ratio', 'growth', 'inverse', 'filtered_top'].includes(item.name)) {
        assert.deepEqual(plain(pg), plain(rows), `${item.name}: stable ordering`);
      }
    }
    results.set(item.name, rows);
  }
  const mixed = new Map(results.get('mixed').map(row => [row.d_device_id, row]));
  assert.equal(mixed.size, 7, 'same-name owners keep their identities; NULL-only clock and empty owners have no window samples');
  assert.deepEqual([mixed.get('a').k_device_cpu_latest, mixed.get('a').k_device_memory_latest, mixed.get('a').k_cpu_usage], [null, 95, 85]);
  assert.deepEqual([mixed.get('b').k_device_cpu_latest, mixed.get('b').k_device_memory_latest, mixed.get('b').k_cpu_usage], [90, 20, 50]);
  assert.deepEqual([mixed.get('c').k_device_cpu_latest, mixed.get('c').k_device_memory_latest, mixed.get('c').k_cpu_usage], [70, null, 63]);
  assert.equal(mixed.get('future').k_device_cpu_latest, 5, 'half-open cutoff excludes future row');
  assert.deepEqual(results.get('postfilter').map(row => row.d_device_id), ['b']);
  assert.deepEqual(results.get('prefilter').map(row => row.d_device_id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(results.get('top').map(row => row.d_device_id), ['b', 'c']);
  assert.deepEqual(results.get('filtered_top').map(row => row.d_device_id), ['b']);
  assert.equal(mixed.get('b').k_device_kpi_sample_count, 2);
  const unbounded = new Map(results.get('unbounded').map(row => [row.d_device_id, row]));
  assert.equal(unbounded.get('d').k_device_cpu_latest, null);
  assert.equal(unbounded.get('d').k_device_memory_latest, null);
  assert.equal(unbounded.get('d').k_cpu_usage, 100, 'NULL-clock rows remain in Avg');
  assert.equal(unbounded.get('e').k_device_cpu_latest, 25);
  assert.equal(unbounded.get('e').k_cpu_usage, 145 / 3);
  assert.equal(unbounded.get('e').k_device_kpi_sample_count, 3, 'NULL-clock rows remain in Count');
  assert.equal(unbounded.get('future').k_device_cpu_latest, 500, 'no implicit now cutoff');
  for (const op of ['subtract', 'ratio', 'growth']) {
    const rows = results.get(op);
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const l = row.left_k_device_cpu_latest;
      const r = row.right_k_device_cpu_latest;
      const expected = op === 'subtract' ? r - l : op === 'ratio' ? r / l : (r - l) / l;
      assert.equal(row.comparison_value, expected, `${op}: exact selected-row comparison`);
      assert.notEqual(row.right_d_device_id, 'a', 'Latest NULL is excluded by existing pair rank rules');
      if (op !== 'subtract') assert.notEqual(row.right_d_device_id, 'zero');
      if (op === 'growth') assert.notEqual(row.right_d_device_id, 'negative');
    }
  }
  const server = new Map(results.get('server').map(row => [row.d_server_name, row]));
  const differences = new Map(results.get('subtract').map(row => [row.right_d_device_id, row.comparison_value]));
  for (const row of results.get('inverse')) {
    assert.equal(row.comparison_value, -differences.get(row.right_d_device_id));
  }
  assert.deepEqual([server.get('a').k_server_cpu_latest, server.get('a').k_server_memory_latest, server.get('a').k_server_cpu_usage], [null, 95, 85]);
  console.log(`Latest product execution passed: ${cases.length} queries, SQLite/PostgreSQL, shared-row NULL semantics, ties, Avg, windows, pre/post thresholds, owner Top-N, GraphPair and server measures`);
} finally {
  sqlite.close();
  await postgres.close();
}
