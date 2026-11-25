import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert(artifact && adapter, 'Usage: node scripts/check-icloud-resource-roles.mjs <model.wasm> <telora-model.ts>');
const url = pathToFileURL(resolve(adapter));
const requireAdapter = createRequire(url);
const {check} = await import(pathToFileURL(requireAdapter.resolve(Object.keys(requireAdapter('../package.json').dependencies).find(name=>name.endsWith('/dari-core')))));
const {openModel} = await import(url);
const host = await openModel(artifact);
const db = new DatabaseSync(':memory:');
try {
  db.exec(`CREATE TABLE PhysicalServer(id TEXT,name TEXT,healthStatus INTEGER,connectStatus INTEGER);
    INSERT INTO PhysicalServer VALUES ('s1','Same',0,1),('s2','Same',0,3),('s3','Other',4,1);
    CREATE TABLE EntNetworkElement(id TEXT,name TEXT,classification TEXT);
    INSERT INTO EntNetworkElement VALUES ('ap1','AP 1','ne.category.fatap'),('ap2','AP 2','AP'),('sw','Switch','ne.category.switch');
    CREATE TABLE NetworkApRadioSsidKPI(resId TEXT,parentId TEXT,connectedTerminals INTEGER);
    INSERT INTO NetworkApRadioSsidKPI VALUES ('ssid1','ap1',10),('ssid2','ap2',20),('ssid3','sw',30);
    CREATE TABLE EntPonElement(id TEXT,name TEXT,classification TEXT,parentOltResId TEXT);
    INSERT INTO EntPonElement VALUES ('olt','OLT','ne.category.olt',''),('onu1','ONU 1','ne.category.pon.onu','olt'),
      ('onu2','ONU 2','ne.category.pon.onu','olt'),('spl','Splitter','ne.category.pon.spl','olt');
    CREATE TABLE PonDeviceOnuKPI(resId TEXT,onuHwOpticsRxPower REAL);
    INSERT INTO PonDeviceOnuKPI VALUES ('onu1',-22),('onu1',-24),('onu2',-18);
    CREATE TABLE PonDevicePonPortKPI(parentId TEXT,ifInBandRate REAL);
    INSERT INTO PonDevicePonPortKPI VALUES ('olt',40),('onu1',60),('spl',80);`);
  function query(plan) {
    const program = check(`data result = query_remote! { ${plan} }; answer tree! { Answer ["验收"] };`, host.model);
    const template = host.bind(program.bindings.get('result').modelPlan, []);
    return db.prepare(template.sql).all(...template.bindings).map(row => ({...row}));
  }
  const counts = query(`let s = from(ic::server_device);
    let rows = s |> project({health:s.server_health,n:s.server_device_count});
    rows |> order_by(desc(rows.n)) |> take(20)`);
  assert.equal(counts.reduce((sum, row) => sum + row.n, 0), 3);
  assert.deepEqual(counts.map(row => row.n), [2, 1]);
  assert.throws(() => query(`let s = from(ic::server_device);
    let rows = s |> project({name:s.server_name,n:s.server_device_count});
    rows |> order_by(desc(rows.n)) |> take(20)`), /not authorized for grouping/);
  const namedServers = query(`let s = from(ic::server_device);
    let grouped = s |> group_by_identity(s);
    let rows = grouped |> project({name:s.server_name,n:s.server_device_count});
    rows |> order_by(asc(rows.name)) |> take(20)`);
  assert.equal(namedServers.length, 3, 'Same names must remain separate entity groups');
  assert(namedServers.every(row => row.n === 1));
  const connections = query(`let s = from(ic::server_device);
    let rows = s |> project({state:s.server_device__connectStatus,n:s.server_device_count});
    rows |> order_by(desc(rows.n)) |> take(20)`);
  assert.deepEqual(connections.map(row => row.n), [2, 1]);
  assert.deepEqual(query(`let s = from(ic::pon_onu_role);
    s |> project({n:s.onu_count}) |> take(1)`), [{n:2}]);
  assert.deepEqual(query(`let s = from(ic::onu_kpi);
    s |> project({n:s.onu_kpi_sample_count}) |> take(1)`), [{n:3}]);
  assert.deepEqual(query(`let joined = from(ic::onu_kpi).as!(a)
    |> connect(ic::relations::onu_kpi_of_onu_role).as!(o)
    |> connect(ic::relations::pon_onu_parent_olt).as!(olt);
    let grouped = joined |> group_by_identity(o);
    let rows = grouped |> project({onu:o.pon_onu_id,olt:olt.pon_olt_name,rx:a.onu_rx_power,samples:a.onu_kpi_sample_count});
    rows |> order_by(asc(rows.rx)) |> take(500)`), [
      {onu:'onu1',olt:'OLT',rx:-23,samples:2}, {onu:'onu2',olt:'OLT',rx:-18,samples:1}
    ], 'ONU-window aggregates retain identity and differ from sample counts');
  const ssids = query(`let joined = from(ic::ap_radio_ssid_kpi).as!(a)
    |> connect(ic::relations::ap_ssid_kpi_of_device).as!(d);
    let grouped = joined |> group_by_identity(d);
    let rows = grouped |> project({device:d.device_name,terminals:a.ap_ssid_connected_terminals_sample_avg});
    rows |> order_by(desc(rows.terminals)) |> take(20)`);
  assert(!ssids.some(row => row.device === 'Switch'), 'SSID relation must not identify a switch as its AP');
  assert.deepEqual(ssids.filter(row => row.device).map(row => row.device).sort(), ['AP 1', 'AP 2']);
  const reverseSsids = query(`let joined = from(ic::device).as!(d)
    |> connect(ic::relations::source_EntNetworkElement_NetworkApRadioSsidKPI).as!(a);
    let grouped = joined |> group_by_identity(d);
    let rows = grouped |> project({device:d.device_name,terminals:a.ap_ssid_connected_terminals_sample_avg});
    rows |> order_by(desc(rows.terminals)) |> take(20)`);
  assert(reverseSsids.every(row => row.device !== 'Switch' || row.terminals === null),
    'Reusing an AP endpoint as the source must retain its classification constraint');
  assert.deepEqual(reverseSsids.filter(row => row.terminals !== null).map(row => row.device).sort(), ['AP 1', 'AP 2']);
  const ports = query(`let joined = from(ic::pon_port_kpi).as!(a)
    |> connect(ic::relations::pon_port_kpi_of_olt).as!(d);
    let grouped = joined |> group_by_identity(d);
    let rows = grouped |> project({olt:d.pon_olt_name,usage:a.pon_port_receive_usage});
    rows |> order_by(desc(rows.usage)) |> take(20)`);
  assert.deepEqual(ports.filter(row => row.olt).map(row => row.olt), ['OLT']);
  assert(!ports.some(row => row.olt === 'ONU 1' || row.olt === 'Splitter'));
  console.log('Passed: DARI remote proofs and SQLite execution for server counts, ONU/sample populations, AP guards and OLT roles');
} finally {
  db.close();
  await host.close();
}
