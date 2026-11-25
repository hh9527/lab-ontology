import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert(artifact && adapter, 'Usage: node scripts/check-icloud-grain-quantities.mjs <model.wasm> <telora-model.ts>');
const url = pathToFileURL(resolve(adapter));
const requireAdapter = createRequire(url);
const {check} = await import(pathToFileURL(requireAdapter.resolve('@local/dari-core')));
const {openModel} = await import(url);
const host = await openModel(artifact);
const db = new DatabaseSync(':memory:');
const program = (plan, extra = '') => check(`data result = query_remote! {${plan}}; ${extra}
  answer tree! { Answer ["验收"] };`, host.model);
const base = type => type.kind === 'option' ? type.inner : type;
try {
  for (const [table, count] of [
    ['NetworkCellLinkQualityKPI', 'cell_link_quality_sample_count'],
    ['NetworkCellLinkTrafficKPI', 'cell_link_traffic_sample_count'],
    ['PonDeviceEthernetPortKPI', 'pon_ethernet_sample_count'],
  ]) {
    db.exec(`CREATE TABLE ${table}(resId TEXT,ts TEXT);
      INSERT INTO ${table} VALUES ('same-resource','2026-11-01T00:00:00.000Z'),('same-resource','2026-11-01T01:00:00.000Z');`);
    const p = program(`let a = from(ic::source_${table});
      let grouped = a |> group_by_identity(a);
      let rows = grouped |> project({n:a.${count}});
      rows |> order_by(asc(rows.n)) |> take(10)`);
    const query = host.bind(p.bindings.get('result').modelPlan, []);
    assert.deepEqual(db.prepare(query.sql).all(...query.bindings).map(row => ({...row})), [{n:2}],
      `${table}: one observed entity groups its two sampling records`);
  }
  const power = `let a = from(ic::onu_kpi); a |> project({power:a.onu_rx_power}) |> take(1)`;
  const powerType = base(program(power).bindings.get('result').type.inner.fields.power);
  assert.match(powerType.name, /ontology.*quantity.*Dbm/);
  assert(!powerType.codec.operations.includes('Add'));
  assert(!powerType.codec.operations.includes('Ratio'));
  assert.throws(() => program(power, `data bad = query! {let a = from(result); a |> project({power:a.power + a.power})};`), /does not allow Add/);

  const rate = program(`let a = from(ic::source_NetworkApRadioKPI); a |> project({rate:a.ap_radio_uplink_rate}) |> take(1)`);
  const rateType = base(rate.bindings.get('result').type.inner.fields.rate);
  assert.match(rateType.name, /KilobitsPerSecond/);
  assert(!rateType.name.includes('Integer'), 'An integer rate average must use a floating rate type');
  assert.equal(rateType.codec.parse(1.5), 1.5);
  const bytes = program(`let a = from(ic::ap_radio_ssid_kpi); a |> project({bytes:a.ap_ssid_receive_bytes}) |> take(1)`);
  assert.match(base(bytes.bindings.get('result').type.inner.fields.bytes).name, /ontology.*quantity.*Bytes/);

  const utilization = program(`let a = from(ic::pon_port_kpi); a |> project({usage:a.pon_port_receive_usage}) |> take(1)`);
  const usageType = base(utilization.bindings.get('result').type.inner.fields.usage);
  assert.match(usageType.name, /PortUtilization/);
  assert.equal(usageType.presentation, undefined, 'Source utilization does not imply Percent or Ratio display scaling');
  const opaqueRate = host.model.datasets['ic::interface_kpi'].members.interface_rx_rate;
  assert(opaqueRate, 'Interface octet-rate member is still available');
  assert(!base(opaqueRate.type).codec.operations.includes('Multiply'));
  console.log('Passed: entity grouping over complete sample grains, ontology quantity types, integer-average units, arithmetic rejection and unchanged source utilization scale');
} finally {
  db.close();
  await host.close();
}
