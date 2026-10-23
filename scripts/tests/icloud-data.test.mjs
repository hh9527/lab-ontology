import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generate, loadModel, validate } from '../generate-icloud-data.mjs';

const directory = mkdtempSync(join(process.env.TMPDIR || join(homedir(), '.cache/tmp'), 'icloud-data-test-'));
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
  assert.deepEqual(first.checks.missingCpuSeries, []);
  assert.deepEqual(first.checks.alarmsWithoutCpuSamples, []);
  assert.equal(first.checks.unsupportedAlarmCpuResources.length, 2);
  db = new DatabaseSync(join(directory, 'first/icloud.sqlite'));
  const catalog = JSON.parse(readFileSync(new URL('../../icloud_model/data/source_catalog.json', import.meta.url)));
  for (const dataset of catalog.datasets) {
    assert.deepEqual(db.prepare(`PRAGMA table_info("${dataset.table}")`).all().map(field => field.name).sort(), dataset.fields.map(field => field.name).sort());
  }
  assert.equal(db.prepare('SELECT count(*) n FROM NetworkDeviceKPI WHERE ts >= ? AND ts < ?').get(first.window.start, first.window.endExclusive).n, 12 * 48);
  assert.equal(db.prepare('SELECT max(ts) t FROM NetworkDeviceKPI').get().t, '2026-10-03T11:00:00Z');
  for (const family of ['HuaweiStorageDevice', 'FCSwitchDevice']) {
    const populations = db.prepare(`SELECT d.id, count(k.ts) n FROM ${family} d LEFT JOIN StorageDeviceKPI k ON k.resId=d.id GROUP BY d.id`).all();
    assert.equal(populations.length, 12);
    assert.ok(populations.every(row => row.n === 48), `${family}: every resource needs a complete series`);
  }
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
  // Domain units and threshold populations follow the reference pack's scenarios.
  const server = db.prepare('SELECT min(peakPower-averagePower) gap, max(systemPower) peak FROM ServerDeviceKPI').get();
  assert.ok(server.gap > 0 && server.peak > 1000);
  assert.ok(db.prepare('SELECT max(avgreadiosize) peak FROM StorageHardDriveKPI').get().peak > 500);
  assert.ok(db.prepare('SELECT max(cpuusage) peak FROM StorageDeviceKPI').get().peak > 90);
  assert.equal(db.prepare('SELECT count(*) n FROM T_CURRENT_ALARM WHERE ARRIVEUTC>=? OR ACKUTC>=? OR CLEARUTC>=?').get(...Array(3).fill(Date.parse(options.anchor))).n, 0);
  const indexes = db.prepare("SELECT name FROM pragma_index_list('StorageDeviceKPI')").all();
  assert.ok(indexes.some(({ name }) => db.prepare(`PRAGMA index_info("${name}")`).all().map(row => row.name).join(',') === 'resId,ts'));
  const gaps = generate({ ...options, storageGapHours: 5, output: join(directory, 'gaps') }, model);
  assert.equal(gaps.generation.seriesGaps.length, 2);
  const gapDb = new DatabaseSync(join(directory, 'gaps/icloud.sqlite'));
  try {
    for (const gap of gaps.generation.seriesGaps) {
      assert.equal(gapDb.prepare('SELECT count(*) n FROM StorageDeviceKPI WHERE resId=? AND ts>=?').get(gap.resId, gap.endExclusive).n, 0);
      assert.equal(gapDb.prepare('SELECT count(*) n FROM StorageDeviceKPI WHERE resId=?').get(gap.resId).n, 43);
    }
    assert.deepEqual(gaps.checks.missingCpuSeries, []);
    assert.deepEqual(gaps.checks.alarmsWithoutCpuSamples, []);
  } finally { gapDb.close(); }
  assert.throws(() => generate({ ...options, storageGapHours: 48, output: join(directory, 'invalid-gap') }, model), /storageGapHours/);
  db.exec("UPDATE NetworkDeviceKPI SET ts='2026-10-01 12:00:00' WHERE rowid=1; UPDATE I_EntNetworkElement SET classification='invalid' WHERE rowid=1");
  const invalid = validate(db, model, first.tables);
  assert.ok(invalid.invalidTimes.length > 0);
  assert.ok(invalid.invalidEnums.length > 0);
  db.exec("UPDATE StorageDeviceKPI SET resId='missing-owner' WHERE resId='FCSwitchDevice-0005'");
  const missing = validate(db, model, first.tables);
  assert.ok(missing.missingCpuSeries.some(row => row.id === 'FCSwitchDevice-0005'));
  assert.ok(missing.alarmsWithoutCpuSamples.some(row => row.MEDN === 'FCSwitchDevice-0005'));
  db.exec('UPDATE ServerDeviceKPI SET peakPower=0 WHERE rowid=1; UPDATE T_CURRENT_ALARM SET ACKED=1, ACKUTC=OCCURUTC-1 WHERE rowid=1');
  const scenarios = validate(db, model, first.tables, { anchor: options.anchor });
  assert.ok(scenarios.invalidMetricScenarios.some(row => row.table === 'ServerDeviceKPI'));
  assert.ok(scenarios.invalidAlarmTimes.length > 0);
  console.log('Passed: deterministic database, 48 tables/822 columns, all carriers/relations, UTC windows, trends, grains, validation and failed publication');
} finally {
  db?.close();
  rmSync(directory, { recursive: true });
}
