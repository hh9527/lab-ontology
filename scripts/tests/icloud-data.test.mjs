import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generate, loadModel, validate } from '../generate-icloud-data.mjs';

const directory = mkdtempSync(join(process.env.TMPDIR || join(homedir(), '.cache/tmp'), 'icloud-data-test-'));
const model = loadModel();
function assertRelationCoverage(manifest) {
  assert.ok(manifest.checks.relations.every(relation => relation.pairs > 0));
  for (const relation of manifest.checks.relations.filter(relation=>relation.upperBoundExceeded)) {
    const spec = model.relations.find(r=>r.id===relation.id);
    assert.equal(spec.to_table,'X_TENANT_VIEW');
    assert.ok(spec.from_table.startsWith('PhysicalServer'));
    assert.equal(spec.cardinality.from,'Optional');
    assert.equal(relation.maxToPerFrom,1,'Each server/component still belongs to exactly one tenant');
  }
}
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
  assertRelationCoverage(first);
  assert.deepEqual(first.checks.emptyCarriers, []);
  assert.deepEqual(first.checks.invalidEnums, []);
  assert.deepEqual(first.checks.missingCpuSeries, []);
  assert.deepEqual(first.checks.alarmsWithoutCpuSamples, []);
  assert.ok(first.checks.unsupportedAlarmCpuResources.length > 2);
  assert.deepEqual(first.checks.missingAlarmDays, []);
  assert.equal(first.generation.alarmDays.length, 3, 'Both partial UTC boundary days need alarms');
  assert.ok(first.generation.alarmDays.every(day => day.alarms >= 6));
  assert.ok(first.tables.T_CURRENT_ALARM > options.resources * options.days);
  db = new DatabaseSync(join(directory, 'first/icloud.sqlite'));
  assert.equal(db.prepare("SELECT count(DISTINCT SEVERITY) n FROM T_CURRENT_ALARM").get().n, 4);
  assert.ok(db.prepare("SELECT count(*) n FROM T_CURRENT_ALARM WHERE ALARMNAME='CPU 利用率过高'").get().n > 0);
  const classes = model.dimensions.find(d=>d.dataset==='device'&&d.column==='classification').values;
  const {networkDeviceCategory} = await import('../icloud-category-profiles.mjs');
  for (const member of classes) for (const wire of member.wires) assert.equal(networkDeviceCategory(Object.values(wire)[0],classes).id,member.id);
  const devices = db.prepare('SELECT id,name,alias,manufacturer,productName,typeId,classification FROM I_EntNetworkElement').all();
  for (const device of devices) {
    const cls=networkDeviceCategory(device.classification,classes);
    assert.ok(device.name.startsWith(cls.label+'-'));
    assert.equal(device.alias,device.name);
    assert.equal(device.typeId,cls.id);
    assert.ok(device.productName.startsWith(device.manufacturer+'-'+cls.label+'-'));
  }
  for (const table of ['NetworkDeviceKPI','NetworkDeviceOnlineKPI']) assert.equal(db.prepare(`SELECT count(*) n FROM "${table}" k JOIN I_EntNetworkElement d ON k.resId=d.id WHERE k.deviceName!=d.name OR k.classification!=d.classification`).get().n,0);
  assert.equal(db.prepare(`SELECT count(*) n FROM T_CURRENT_ALARM a JOIN I_EntNetworkElement d ON a.MEDN=d.id
    WHERE a.MENAME!=d.name OR a.MECATEGORY!=d.classification OR a.PRODUCTNAME!=d.productName OR a.MANUFACTURER!=d.manufacturer`).get().n,0);
  const traffic = db.prepare(`SELECT avg(CASE WHEN substr(ts,12,2)='06' THEN ifHCInOctetsSpeed END) busy,
    avg(CASE WHEN substr(ts,12,2)='18' THEN ifHCInOctetsSpeed END) quiet FROM NetworkDeviceInterfaceKPI`).get();
  assert.ok(traffic.busy > traffic.quiet * 1.5, 'Business-hour traffic should exceed night traffic');
  assert.equal(db.prepare('SELECT count(*) n FROM NetworkDeviceKPI WHERE portUsedCount>portCount').get().n, 0);
  const catalog = JSON.parse(readFileSync(new URL('../../icloud_model/data/source_catalog.json', import.meta.url)));
  for (const dataset of catalog.datasets) {
    assert.deepEqual(db.prepare(`PRAGMA table_info("${dataset.table}")`).all().map(field => field.name).sort(), dataset.fields.map(field => field.name).sort());
  }
  assert.equal(db.prepare('SELECT count(*) n FROM NetworkDeviceKPI WHERE ts >= ? AND ts < ?').get(first.window.start, first.window.endExclusive).n, 12 * 48);
  assert.equal(db.prepare('SELECT max(ts) t FROM NetworkDeviceKPI').get().t, '2026-10-03T11:00:00.000Z');
  for (const family of ['HuaweiStorageDevice', 'FCSwitchDevice']) {
    const populations = db.prepare(`SELECT d.id, count(k.ts) n FROM ${family} d LEFT JOIN StorageDeviceKPI k ON k.resId=d.id GROUP BY d.id`).all();
    assert.equal(populations.length, 12);
    assert.ok(populations.every(row => row.n === 48), `${family}: every resource needs a complete series`);
  }
  assert.ok(db.prepare('SELECT avg(cpuUsage) value FROM NetworkDeviceKPI WHERE resId=? AND ts<?').get('I_EntNetworkElement-0001', '2026-10-02T12:00:00.000Z').value
    < db.prepare('SELECT avg(cpuUsage) value FROM NetworkDeviceKPI WHERE resId=? AND ts>=?').get('I_EntNetworkElement-0001', '2026-10-02T12:00:00.000Z').value);
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
  assert.throws(() => generate({ ...options, alarmsPerResourcePerDay: 0, output: join(directory, 'invalid-alarm-rate') }, model), /alarmsPerResourcePerDay/);
  // A larger inventory must reuse categories, not invent one category per device.
  const categorized = generate({ ...options, resources: 36, days: 30, intervalMinutes: 1440, anchor: '2026-10-03T00:00:00Z', output: join(directory, 'categories') }, model);
  const categoryDb = new DatabaseSync(join(directory, 'categories/icloud.sqlite'));
  try {
    for (const [table, column, maximum] of [
      ['I_EntNetworkElement','manufacturer',4],
      ['I_EntNetworkElement','version',3], ['I_EntNetworkElement','language',2],
      ['I_EntNetworkElement','timeZone',1], ['I_EntNetworkElement','location',4],
      ['PhysicalServer','manufacturer',3], ['PhysicalServer','assetManager',3],
      ['PhysicalServer','biosVersion',3], ['EntTerminalElement','vendor',4],
      ['EntTerminalElement','model',12], ['EntTerminalElement','osName',4],
      ['EntTerminalElement','vlanId',4], ['X_TENANT_VIEW','INDUSTRY',5],
    ]) {
      const stats = categoryDb.prepare(`SELECT count(DISTINCT "${column}") n FROM "${table}"`).get();
      assert.ok(stats.n <= maximum, `${table}.${column}: bounded category population`);
      assert.equal(categoryDb.prepare(`SELECT count(*) n FROM "${table}" WHERE "${column}" GLOB ?`).get(`${column}-[0-9]*`).n,0);
    }
    const tenantRows = categoryDb.prepare('SELECT TENANT_ID FROM X_TENANT_VIEW ORDER BY TENANT_ID').all();
    assert.equal(tenantRows.length,10);
    const totals = categorized.generation.tenantDistribution.tiers.map(tier => {
      const ids = tenantRows.slice(tier.tenantStart,tier.tenantStart+tier.tenants).map(row=>row.TENANT_ID);
      return categoryDb.prepare(`SELECT count(*) n FROM I_EntNetworkElement WHERE tenantId IN (${ids.map(()=>'?').join(',')})`).get(...ids).n;
    });
    assert.deepEqual(totals,[22,11,3]);
    for (const [table,tenantCol,siteCol] of [
      ['I_EntNetworkElement','tenantId','projectId'], ['PhysicalServer','tenantId','projectId'],
      ['I_EntPonElement','tenantId','projectId'], ['EntTerminalElement','tenantId','siteId'],
    ]) {
      assert.equal(categoryDb.prepare(`SELECT count(*) n FROM "${table}" d LEFT JOIN X_TENANT_VIEW t ON t.TENANT_ID=d."${tenantCol}" WHERE t.TENANT_ID IS NULL`).get().n,0);
      assert.equal(categoryDb.prepare(`SELECT count(*) n FROM "${table}" d JOIN X_SITE_VIEW s ON s.SITE_ID=d."${siteCol}" WHERE d."${tenantCol}"!=s.TENANT_ID`).get().n,0);
    }
    for (const [child,parent,key] of [['PhysicalServerFan','PhysicalServer','parentResId'],['I_EnterpriseNetworkLTP','I_EntNetworkElement','refParentNE']]) {
      assert.equal(categoryDb.prepare(`SELECT count(*) n FROM "${child}" c JOIN "${parent}" p ON c."${key}"=p.id WHERE c.tenantId!=p.tenantId`).get().n,0);
    }
    assert.equal(categoryDb.prepare(`SELECT count(*) n FROM T_CURRENT_ALARM a JOIN PhysicalServer d ON a.MEDN=d.id WHERE a.TENANTID!=d.tenantId`).get().n,0);
    assert.equal(categoryDb.prepare(`SELECT count(*) n FROM ServerDeviceKPI k JOIN PhysicalServer d ON k.resId=d.id WHERE k.tenantId!=d.tenantId`).get().n,0);
    const severityCounts = categoryDb.prepare('SELECT SEVERITY level,count(*) n FROM T_CURRENT_ALARM GROUP BY SEVERITY ORDER BY SEVERITY').all();
    const totalAlarms = severityCounts.reduce((sum,row)=>sum+row.n,0);
    assert.equal(severityCounts.length,4);
    for (const {level,n} of severityCounts) assert.ok(Math.abs(n/totalAlarms-[0.10,0.18,0.32,0.40][level-1])<0.03,
      `Severity ${level} follows the configured population weight`);
    assert.equal(categoryDb.prepare('SELECT count(DISTINCT id) n FROM I_EntNetworkElement').get().n,36);
    assert.equal(categoryDb.prepare('SELECT count(DISTINCT sn) n FROM I_EntNetworkElement').get().n,36);
    assert.equal(categoryDb.prepare("SELECT count(*) n FROM PhysicalServer WHERE productName NOT LIKE manufacturer || '-%'").get().n,0);
    assert.equal(categoryDb.prepare(`SELECT count(*) n FROM T_CURRENT_ALARM a JOIN PhysicalServer d ON a.MEDN=d.id
      WHERE a.MANUFACTURER!=d.manufacturer OR a.PRODUCTNAME!=d.productName`).get().n,0);
    const vendorCounts = categoryDb.prepare('SELECT count(*) n FROM I_EntNetworkElement GROUP BY manufacturer').all().map(x=>x.n);
    assert.ok(Math.max(...vendorCounts) > Math.min(...vendorCounts)*2, 'Vendors have a common population and a long tail');
    assert.ok(categoryDb.prepare("SELECT count(*) n FROM I_EntNetworkElement WHERE commuState='0'").get().n >= 25, 'Most devices are online');
    assert.ok(categoryDb.prepare('SELECT count(DISTINCT version) n FROM I_EntNetworkElement GROUP BY manufacturer HAVING n>1').all().length>0,
      'Manufacturers do not determine firmware version one-to-one');
    assertRelationCoverage(categorized);
  } finally { categoryDb.close(); }
  const { categoryValue } = await import('../icloud-category-profiles.mjs');
  const vendors = seed => Array.from({length:36},(_,i)=>categoryValue('I_EntNetworkElement','manufacturer',i,seed));
  assert.deepEqual(vendors(100),vendors(100));
  assert.notDeepEqual(vendors(100),vendors(101),'Changing seed changes category assignments');
  const deletedDay = first.generation.alarmDays[0].day;
  db.exec('SAVEPOINT alarm_coverage');
  db.prepare("DELETE FROM T_CURRENT_ALARM WHERE date(OCCURUTC/1000,'unixepoch')=?").run(deletedDay);
  const dayCounts = {...first.tables, T_CURRENT_ALARM: db.prepare('SELECT count(*) n FROM T_CURRENT_ALARM').get().n};
  const missingDay = validate(db, model, dayCounts, { anchor: options.anchor, start: first.window.start });
  assert.deepEqual(missingDay.missingAlarmDays, [deletedDay]);
  db.exec('ROLLBACK TO alarm_coverage; RELEASE alarm_coverage');
  db.exec("UPDATE NetworkDeviceKPI SET ts='2026-10-01 12:00:00' WHERE rowid=1; UPDATE I_EntNetworkElement SET classification='invalid' WHERE rowid=1");
  const invalid = validate(db, model, first.tables);
  assert.ok(invalid.invalidTimes.length > 0);
  assert.ok(invalid.invalidEnums.length > 0);
  const fcAlarm = db.prepare('SELECT a.MEDN id FROM T_CURRENT_ALARM a JOIN FCSwitchDevice d ON a.MEDN=d.id LIMIT 1').get();
  db.prepare("UPDATE StorageDeviceKPI SET resId='missing-owner' WHERE resId=?").run(fcAlarm.id);
  const missing = validate(db, model, first.tables);
  assert.ok(missing.missingCpuSeries.some(row => row.id === fcAlarm.id));
  assert.ok(missing.alarmsWithoutCpuSamples.some(row => row.MEDN === fcAlarm.id));
  db.exec('UPDATE ServerDeviceKPI SET peakPower=0 WHERE rowid=1; UPDATE T_CURRENT_ALARM SET ACKED=1, ACKUTC=OCCURUTC-1 WHERE rowid=1');
  const scenarios = validate(db, model, first.tables, { anchor: options.anchor });
  assert.ok(scenarios.invalidMetricScenarios.some(row => row.table === 'ServerDeviceKPI'));
  assert.ok(scenarios.invalidAlarmTimes.length > 0);
  console.log('Passed: deterministic database, 48 tables/822 columns, all carriers/relations, UTC windows, trends, grains, validation and failed publication');
} finally {
  db?.close();
  rmSync(directory, { recursive: true });
}
