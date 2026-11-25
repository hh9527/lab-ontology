import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert(artifact && adapter, 'Usage: node scripts/check-icloud-port-identity.mjs <model.wasm> <telora-model.ts>');
const url = pathToFileURL(resolve(adapter));
const requireAdapter = createRequire(url);
const core = Object.keys(requireAdapter('../package.json').dependencies).find(name => name.endsWith('/dari-core'));
assert(core, 'Model adapter must declare its dari-core dependency');
const {check} = await import(pathToFileURL(requireAdapter.resolve(core)));
const {openModel} = await import(url);
const host = await openModel(artifact);
const db = new DatabaseSync(':memory:');
try {
  db.exec(`CREATE TABLE PonDevicePonPortKPI(
    resId TEXT,tenantId TEXT,parentId TEXT,portName TEXT,ts TEXT,ifInBandRate REAL);
    INSERT INTO PonDevicePonPortKPI VALUES
    ('p1','t1','olt1','GPON0/0/1','2026-11-01T00:00:00.000Z',10),
    ('p1','t1','olt1','GPON0/0/1','2026-11-01T01:00:00.000Z',30),
    ('p2','t1','olt2','GPON0/0/1','2026-11-01T00:00:00.000Z',60),
    ('p2','t1','olt2','GPON0/0/1','2026-11-01T01:00:00.000Z',80);`);
  const compile = (fields, grouping = true) => check(`data result = query_remote! {
    let a = from(ic::pon_port_kpi);
    let grouped = a ${grouping ? '|> group_by_identity(a)' : ''};
    let rows = grouped |> project({${fields}});
    rows |> order_by(desc(rows.n)) |> take(10)
  }; answer tree! { Answer ["验收"] };`, host.model);
  const run = program => {
    const query = host.bind(program.bindings.get('result').modelPlan, []);
    return db.prepare(query.sql).all(...query.bindings).map(row => ({...row}));
  };
  // Labels are identical, but the resource identities and their means are distinct.
  assert.deepEqual(run(compile('name:a.pon_port_kpi__port_name,usage:a.pon_port_receive_usage,n:a.pon_port_kpi_sample_count'))
    .sort((a,b) => a.usage-b.usage), [
      {name:'GPON0/0/1',usage:20,n:2}, {name:'GPON0/0/1',usage:70,n:2}
    ]);
  assert.deepEqual(run(compile('n:a.pon_port_kpi_sample_count', false)), [{n:4}],
    'Record count still counts sampling records, not port identities');
  assert.throws(() => compile('ts:a.pon_port_kpi_ts,n:a.pon_port_kpi_sample_count'), /not authorized for grouping/);
  assert.throws(() => compile('raw:a.pon_port_receive_sample,n:a.pon_port_kpi_sample_count'), /not authorized for grouping/);
  assert.throws(() => compile('name:a.pon_port_kpi__port_name,n:a.pon_port_kpi_sample_count', false), /not authorized for grouping/);
  db.exec(`CREATE TABLE EntPonElement(id TEXT,name TEXT,classification TEXT);
    INSERT INTO EntPonElement VALUES ('olt1','OLT A','ne.category.olt'),('olt2','OLT B','ne.category.olt'),('nonolt','ONU','ne.category.pon.onu');
    INSERT INTO PonDevicePonPortKPI VALUES
    ('p3','t1','missing','GPON0/0/1','2026-11-01T00:00:00.000Z',40),
    ('p4','t1','nonolt','GPON0/0/1','2026-11-01T00:00:00.000Z',50);`);
  const linked = check(`data result = query_remote! {
    let linked = from(ic::pon_port_kpi).as!(p)
      |> connect(ic::relations::pon_port_kpi_of_olt).as!(o);
    let grouped = linked |> group_by_identity(p);
    let rows = grouped |> project({id:p.pon_port_kpi__res_id,name:p.pon_port_kpi__port_name,
      olt:o.pon_olt_name,usage:p.pon_port_receive_usage,n:p.pon_port_kpi_sample_count});
    rows |> order_by(desc(rows.usage),asc(rows.id)) |> take(10)
  }; answer tree! { Answer ["验收"] };`, host.model);
  assert.equal(linked.bindings.get('result').type.inner.fields.olt.kind,'option',
    'An identity dependency must not remove optional-relation nullability');
  assert.deepEqual(run(linked), [
    {id:'p2',name:'GPON0/0/1',olt:'OLT B',usage:70,n:2},
    {id:'p4',name:'GPON0/0/1',olt:null,usage:50,n:1},
    {id:'p3',name:'GPON0/0/1',olt:null,usage:40,n:1},
    {id:'p1',name:'GPON0/0/1',olt:'OLT A',usage:20,n:2}
  ], 'Only group the port: preserve distinct identities, sample means/counts, missing owners and OLT role scope');
  console.log('Passed: port-window averages, separate same-name ports, unchanged sample counts, rejection of sampling time/raw values as identity attributes, and optional OLT attributes without extra grouping');
} finally {
  db.close();
  await host.close();
}
