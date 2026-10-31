import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generate, loadModel, validate } from '../generate-ns-data.mjs';

const directory = mkdtempSync(join(process.env.TMPDIR || join(homedir(), '.cache/tmp'), 'ns-data-test-'));
const options = { seed: 20261027, resources: 12, days: 2, intervalMinutes: 180, anchor: '2026-10-27T00:00:00Z' };
const model = loadModel();
let db;
try {
  const first = generate({ ...options, output: join(directory, 'first') }, model);
  const second = generate({ ...options, output: join(directory, 'second') }, model);
  assert.deepEqual(first, second, 'Same model, seed and anchor must reproduce all metadata');
  assert.deepEqual(readFileSync(join(directory, 'first/ns.sqlite')), readFileSync(join(directory, 'second/ns.sqlite')));
  assert.equal(Object.keys(first.tables).length, 151);
  assert.equal(first.columns, 2118);
  assert.equal(first.checks.relations.length, 302);
  assert(first.checks.relations.every(r => r.pairs > 0));
  assert.equal(first.checks.cardinalityExceptions.filter(r=>r.explainedBySampling).length, 16);
  assert(first.checks.cardinalityExceptions.every(r => r.explainedBySampling || r.explainedByEventHistory));
  assert(first.checks.domains.some(d => d.absent.length), 'Small profiles report missing domain members');
  db = new DatabaseSync(join(directory, 'first/ns.sqlite'));
  for (const d of model.datasets) {
    assert.deepEqual(db.prepare(`PRAGMA table_info("${d.table}")`).all().map(f => f.name), d.fields.map(f => f.column));
    if (d.kind === 'Metric') assert.equal(first.tables[d.table].rows, options.resources * first.samplesPerSeries);
  }
  const {networkDeviceCategory}=await import('../icloud-category-profiles.mjs');
  const classes=model.domains.NeClassificationValueType.members;
  for (const member of classes) for (const wire of member.wires) assert.equal(networkDeviceCategory(wire,classes).id,member.id);
  for (const device of db.prepare('SELECT name,manufacturer,productName,typeId,classification FROM EntNetworkElement').all()) {
    const cls=networkDeviceCategory(device.classification,classes);
    assert.ok(device.name.startsWith(cls.label+'-'));
    assert.equal(device.typeId,cls.id);
    assert.ok(device.productName.startsWith(device.manufacturer+'-'+cls.label+'-'));
  }
  assert.equal(db.prepare(`SELECT count(*) n FROM AlarmRecord a JOIN EntNetworkElement d ON a.meDn=d.id
    WHERE a.meName!=d.name OR a.manufacturer!=d.manufacturer`).get().n,0);
  const populations = db.prepare('SELECT obj_id, count(*) n FROM kpi_network_device_info GROUP BY obj_id').all();
  assert.equal(populations.length, 12);
  assert(populations.every(r => r.n === 16));
  const values = populations.map(({ obj_id }) => {
    const rows = db.prepare('SELECT cpuUsage value FROM kpi_network_device_info WHERE obj_id=? ORDER BY timestamp').all(obj_id);
    return rows.at(-1).value - rows[0].value;
  });
  assert(values.some(v => v > 10) && values.some(v => v < -10), 'KPI supports rising and falling trends');
  const percent = db.prepare('SELECT min(cpuUsage) lo,max(cpuUsage) hi FROM kpi_network_device_info').get();
  assert(percent.lo < 30 && percent.hi > 80 && percent.hi <= 100);
  assert.throws(() => db.exec('INSERT INTO kpi_network_device_info SELECT * FROM kpi_network_device_info LIMIT 1'), /UNIQUE/);
  assert(db.prepare('SELECT count(*) n FROM Subnet WHERE refParentSubnet=id').get().n === 0, 'Subnet roots/parents do not self-reference');
  // A polymorphic alarm has one resource owner, rather than one identical ID in every resource family.
  const alarm = model.datasets.find(d => d.id === 'alarm-record');
  const meDn = alarm.fields.find(f => f.name === 'me_dn').column;
  const owners = model.relations.filter(r => r.to === 'alarm-record' && r.pairs.length === 1 && r.pairs[0].to === 'me_dn');
  for (const row of db.prepare(`SELECT "${meDn}" value FROM "${alarm.table}"`).all()) {
    let matches = 0;
    for (const r of owners) {
      const d = model.datasets.find(d => d.id === r.from), col = d.fields.find(f => f.name === r.pairs[0].from).column;
      matches += db.prepare(`SELECT count(*) n FROM "${d.table}" WHERE "${col}"=?`).get(row.value).n;
    }
    assert.equal(matches, 1, `Ambiguous alarm owner ${row.value}`);
  }
  assert.equal(db.prepare("SELECT count(DISTINCT date(occurUtc/1000,'unixepoch')) n FROM AlarmRecord").get().n,options.days);
  assert.equal(db.prepare("SELECT count(*) n FROM AlarmRecord WHERE severity='_default'").get().n,0);
  assert.equal(first.tables.AlarmRecord.rows,options.resources*options.days*2);
  for (const [table,column,max] of [['EntNetworkElement','manufacturer',4],['PhysicalServer','manufacturer',3],['PhysicalServer','biosVersion',3]]) {
    assert.ok(db.prepare(`SELECT count(DISTINCT "${column}") n FROM "${table}"`).get().n<=max);
  }
  function corrupt(sql, expected) {
    db.exec('SAVEPOINT corrupt');
    try { db.exec(sql); assert.throws(() => validate(db, model, first), expected); }
    finally { db.exec('ROLLBACK TO corrupt; RELEASE corrupt'); }
  }
  const state = model.datasets.find(d => d.id === 'network-element').fields.find(f => f.domain);
  corrupt(`UPDATE EntNetworkElement SET "${state.column}"='__not_a_declared_wire__'`, /invalidDomains/);
  corrupt("UPDATE kpi_network_device_info SET timestamp='2026-10-26T25:00:00Z' WHERE rowid=1", /invalidTimes/);
  corrupt('UPDATE kpi_network_device_info SET cpuUsage=1000 WHERE rowid=1', /invalidScenarios/);
  corrupt('DELETE FROM kpi_network_device_info WHERE rowid=1', /invalidRows|invalidSeries/);
  const bridge = model.datasets.find(d => d.id === 'network-element-2-kpi');
  const bridgeId = bridge.fields.find(f => f.name === 'obj_sys_id').column;
  corrupt(`UPDATE EntNetworkElement2kpi SET "${bridgeId}"='__unmatched__'||"${bridgeId}"`, /relations/);
  assert.throws(() => generate({ ...options, output: join(directory, 'first') }, model), /already exists/);
  for (const bad of [{ anchor: '2026-02-30T00:00:00Z' }, { resources: 1 }, { days: 0 }, { seed: 2 ** 32 }, { days: 100000 }]) {
    assert.throws(() => generate({ ...options, ...bad, output: join(directory, 'invalid') }, model));
    assert.equal(existsSync(join(directory, 'invalid')), false);
  }
  const broken = structuredClone(model);
  broken.datasets.find(d => d.kind === 'Metric').grain = ['ts'];
  assert.throws(() => generate({ ...options, output: join(directory, 'failed') }, broken), /UNIQUE/);
  assert.equal(existsSync(join(directory, 'failed')), false);
  assert.equal(readdirSync(directory).some(name => name.startsWith('.ns-data-')), false, 'Failed publication cleans temporary output');
  const changed = generate({ ...options, seed: options.seed + 1, output: join(directory, 'changed') }, model);
  assert.notEqual(first.databaseSha256, changed.databaseSha256, 'Seed changes metric values');
  const expanded = generate({ ...options, resources: 48, days: 1, intervalMinutes: 360, output: join(directory, 'expanded') }, model);
  assert(expanded.checks.domains.every(d => d.absent.every(id=>d.domain==='ArSeverityValueType'&&id==='unknown')), 'Expanded profile covers domains except the intentionally omitted unknown severity');
  console.log('NS data: deterministic SQLite, all schema/relations, independent identities, guarded/composite joins, KPI trends, corruption detection and atomic publication passed');
} finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
