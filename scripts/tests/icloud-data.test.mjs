import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generate, loadModel, validate } from '../generate-icloud-data.mjs';

const directory = mkdtempSync(join(tmpdir(), 'icloud-data-test-'));
const model = loadModel();
const options = { seed: 20260926, resources: 12, days: 2, intervalMinutes: 60, anchor: '2026-10-03T12:00:00Z' };
let db;
try {
  const first = generate({ ...options, output: join(directory, 'first') }, model);
  const second = generate({ ...options, output: join(directory, 'second') }, model);
  assert.deepEqual(first, second, 'Fixed inputs must reproduce the manifest and database hash');
  assert.deepEqual(readFileSync(join(directory, 'first/icloud.sqlite')), readFileSync(join(directory, 'second/icloud.sqlite')));
  assert.equal(Object.keys(first.tables).length, 48);
  assert.equal(first.columns, 822);
  assert.equal(first.checks.relations.length, model.relations.length);
  assert.ok(first.checks.relations.every(relation => relation.pairs > 0 && !relation.upperBoundExceeded));
  assert.deepEqual(first.checks.emptyCarriers, []);
  assert.deepEqual(first.checks.invalidEnums, []);
  db = new DatabaseSync(join(directory, 'first/icloud.sqlite'));
  const catalog = JSON.parse(readFileSync(new URL('../../icloud_model/data/source_catalog.json', import.meta.url)));
  for (const dataset of catalog.datasets) {
    assert.deepEqual(db.prepare(`PRAGMA table_info("${dataset.table}")`).all().map(field => field.name).sort(), dataset.fields.map(field => field.name).sort());
  }
  assert.equal(db.prepare('SELECT count(*) n FROM NetworkDeviceKPI WHERE ts >= ? AND ts < ?').get(first.window.start, first.window.endExclusive).n, 12 * 48);
  assert.equal(db.prepare('SELECT max(ts) t FROM NetworkDeviceKPI').get().t, '2026-10-03T11:00:00Z');
  assert.ok(db.prepare('SELECT avg(cpuUsage) value FROM NetworkDeviceKPI WHERE resId=? AND ts<?').get('I_EntNetworkElement-0001', '2026-10-02T12:00:00Z').value
    < db.prepare('SELECT avg(cpuUsage) value FROM NetworkDeviceKPI WHERE resId=? AND ts>=?').get('I_EntNetworkElement-0001', '2026-10-02T12:00:00Z').value);
  assert.throws(() => db.exec('INSERT INTO NetworkDeviceKPI SELECT * FROM NetworkDeviceKPI LIMIT 1'), /UNIQUE/);
  assert.throws(() => generate({ ...options, output: join(directory, 'first') }, model), /already exists/);
  assert.throws(() => generate({ ...options, anchor: '2026-02-30T12:00:00Z', output: join(directory, 'bad') }, model), /valid UTC/);
  assert.equal(existsSync(join(directory, 'bad')), false);
  const broken = structuredClone(model);
  broken.datasets.find(dataset => dataset.table === 'NetworkDeviceKPI').dataset.grain = ['ts'];
  assert.throws(() => generate({ ...options, output: join(directory, 'failed') }, broken), /UNIQUE/);
  assert.equal(existsSync(join(directory, 'failed')), false, 'Failed build must not publish output');
  db.exec("UPDATE NetworkDeviceKPI SET ts='2026-10-01 12:00:00' WHERE rowid=1; UPDATE I_EntNetworkElement SET classification='invalid' WHERE rowid=1");
  const invalid = validate(db, model, first.tables);
  assert.ok(invalid.invalidTimes.length > 0);
  assert.ok(invalid.invalidEnums.length > 0);
  console.log('Passed: deterministic database, 48 tables/822 columns, all carriers/relations, UTC windows, trends, grains, validation and failed publication');
} finally {
  db?.close();
  rmSync(directory, { recursive: true });
}
