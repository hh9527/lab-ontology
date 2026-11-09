// #72: execute model-generated SQL, including safe and unsafe graph aggregates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {withKnowledgeRunner} from '../ontology/tools/knowledge-runner.mjs';
import {readBuildInformation} from '../../dsh-oks/packages/dsh-oks/src/service-metadata.ts';
import {derivePublishedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';

const [artifact, directory, baseline] = process.argv.slice(2);
assert(artifact && directory, 'Usage: node scripts/check-ic-quality.mjs MODEL DATA_DIRECTORY [BASELINE_MODEL]');
const db = new DatabaseSync(join(directory, 'icloud.sqlite'), {readOnly:true});
const publication = readBuildInformation(readFileSync(artifact))['ontology.knowledge'];
const {graph, vocabulary} = new Function('data', publication.program)(publication.data);
const index = derivePublishedKnowledge(graph, undefined, vocabulary);
const type = name => graph.facts.find(f=>f.value.name?.endsWith('::'+name));
for (const [name, symbol, scale] of [['Percent','%',0.01],['Fraction','1',1],['Megabytes','MB',1e6],['Watts','W',1]]) {
  const quantity = graph.facts.find(f=>f.value.name==='ontology/quantity::'+name);
  assert.equal(quantity?.value.unit?.symbol, symbol, name);
  assert.equal(quantity?.value.unit?.scale, scale, name);
  assert(Object.values(index.knowledge.types).some(t=>t.unit?.symbol===symbol&&t.unit?.scale===scale));
}
for (const name of ['DeviceClass','ServerClass','CurrentAlarmCLEARCATEGORY']) {
  const parent = type(name);assert(parent, name);
  assert.equal(parent.value.half_open, name==='DeviceClass', `${name}: declared domain openness`);
  const values = Object.values(parent.value.values);
  assert(values.length > 0);
  for (const value of values) assert(value.names.some(n=>/[\u4e00-\u9fff]/u.test(n)),name);
}
assert(vocabulary.some(v=>v.aliases.includes('交换机')));
const datasets = new Map(publication.data.instructions.filter(([op])=>op==='dataset').map(([,d])=>[d.id,d]));
const dimensions = publication.data.instructions.find(([op])=>op==='capabilities')[1].dimensions;
const catalog = JSON.parse(readFileSync(new URL('../icloud_model/data/source_catalog.json', import.meta.url)));
let enumFields = 0;
for (const dataset of catalog.datasets) for (const field of dataset.fields) {
  const values = field.properties?.['dte.enum.values'];
  if (!values) continue;
  const domains = dimensions.filter(d=>datasets.get(d.dataset)?.source===dataset.table
    && datasets.get(d.dataset).fields.some(f=>f.name===d.field&&f.column===field.name));
  const wires = new Set(domains.flatMap(d=>d.canonical_values.flatMap(v=>v.wires.map(w=>String(Object.values(w)[0])))));
  for (const entry of JSON.parse(values)) assert(wires.has(String(entry.value)),`${dataset.table}.${field.name}: source enum ${entry.value}`);
  enumFields++;
}

const onu = {op:'Graph',root:'k',nodes:[{id:'k',entity:'onu_kpi'},{id:'u',entity:'pon_onu_role'},{id:'o',entity:'pon_olt_role'}],
  edges:[{relation:'onu_kpi_of_onu_role',from:'k',to:'u'},{relation:'pon_onu_parent_olt',from:'u',to:'o'}],
  select:[{node:'o',dimension:'pon_olt_id'}],group_by_identity:['o'],measures:[{node:'k',measure:'onu_cpu'}],limit:500};
try {
  if (baseline) await withKnowledgeRunner(baseline, async (_,request)=>{
    const before = await request('ic/transform',{intents:[onu]});
    assert.equal(before.accepted,false);assert.match(JSON.stringify(before.diagnostics),/multiplied|grain-safe/);
  });
  await withKnowledgeRunner(artifact, async (_,request)=>{
    const run = async (intent, accepted=true, executor=db) => {
      const result = await request('ic/transform',{intents:[intent]});
      assert.equal(result.accepted,accepted,JSON.stringify(result.diagnostics));
      if(!accepted){assert.equal(result.queries,null);return result;}
      const q=result.queries[0];
      return executor.prepare(q.sql).all(...q.bindings).map(r=>({...r}));
    };
    const expected = db.prepare(`SELECT p.parentOltResId id,avg(k.cpuUsage) cpu FROM PonDeviceOnuKPI k
      JOIN I_EntPonElement p ON k.resId=p.id WHERE p.classification='ne.category.pon.onu' GROUP BY p.parentOltResId ORDER BY id`).all();
    const actual = (await run(onu)).sort((a,b)=>a.o_pon_olt_id.localeCompare(b.o_pon_olt_id));
    assert.equal(actual.length,expected.length);
    for(let i=0;i<actual.length;i++){
      assert.equal(actual[i].o_pon_olt_id,expected[i].id);assert(Math.abs(actual[i].k_onu_cpu-expected[i].cpu)<1e-9);
    }
    // Taking the reverse one-to-many edge duplicates each ONU sample across siblings.
    const unsafe = {...onu,nodes:[...onu.nodes,{id:'sibling',entity:'pon_onu_role'}],
      edges:[...onu.edges,{relation:'pon_onu_parent_olt',from:'sibling',to:'o'}]};
    const rejected=await run(unsafe,false);
    assert.match(JSON.stringify(rejected.diagnostics),/multiplied|grain-safe/);
    const portCount=db.prepare('SELECT count(*) n FROM I_EnterpriseNetworkLTP').get().n;
    const portQuery = {op:'Graph',root:'k',nodes:[{id:'k',entity:'interface_kpi'},{id:'p',entity:'port'},{id:'d',entity:'device'}],
      edges:[{relation:'interface_kpi_of_port',from:'k',to:'p'},{relation:'port_belongs_to_device',from:'p',to:'d'}],
      select:[{node:'k',dimension:'interface_kpi_res_id'},{node:'p',dimension:'port_name'},{node:'d',dimension:'device_id'}],
      measures:[{node:'k',measure:'interface_tx'}],limit:500};
    const ports = await run(portQuery);
    assert.equal(ports.length,Math.min(portCount,500));
    assert.equal(new Set(ports.map(p=>p.k_interface_kpi_res_id)).size,ports.length);
    assert(ports.every(p=>p.p_port_name.startsWith('GigabitEthernet')));
    const topPorts = await run({...portQuery,top_by_measure:{node:'k',measure:'interface_tx',direction:'Desc',take:10}});
    const expectedTop = db.prepare('SELECT resId id,avg(ifOutPktSpeed) speed FROM NetworkDeviceInterfaceKPI GROUP BY resId ORDER BY speed DESC LIMIT 10').all();
    assert.deepEqual(topPorts.map(p=>p.k_interface_kpi_res_id),expectedTop.map(p=>p.id));
    const power = await run({op:'Graph',root:'k',nodes:[{id:'k',entity:'server_kpi'}],edges:[],select:[],
      measures:['server_system_power','server_average_power','server_peak_power'].map(measure=>({node:'k',measure}))});
    const watts = db.prepare('SELECT avg(systemPower) system,avg(averagePower) average,avg(peakPower) peak FROM ServerDeviceKPI').get();
    for(const [key,col] of [['system','server_system_power'],['average','server_average_power'],['peak','server_peak_power']])
      assert(Math.abs(power[0]['k_'+col]-watts[key])<1e-9);
    const tenantCpu = await run({op:'Graph',root:'k',nodes:[{id:'k',entity:'server_kpi'},{id:'s',entity:'server_device'},{id:'t',entity:'tenant'}],
      edges:[{relation:'server_kpi_of_server',from:'k',to:'s'},{relation:'server_belongs_to_tenant',from:'s',to:'t'}],
      select:[{node:'t',dimension:'tenant_id'}],measures:[{node:'k',measure:'server_cpu_usage'}]});
    const expectedTenants = db.prepare('SELECT d.tenantId id,avg(k.cpuUsage) cpu FROM ServerDeviceKPI k JOIN PhysicalServer d ON k.resId=d.id GROUP BY d.tenantId').all();
    assert.equal(tenantCpu.length,expectedTenants.length);
    for(const expected of expectedTenants) assert(Math.abs(tenantCpu.find(r=>r.t_tenant_id===expected.id).k_server_cpu_usage-expected.cpu)<1e-9);
    // A half-open enum preserves raw unknown values and their explicit kind.
    const unknownDb = new DatabaseSync(':memory:');
    try {
      unknownDb.exec('CREATE TABLE I_EntNetworkElement(id TEXT, classification TEXT)');
      const insert=unknownDb.prepare('INSERT INTO I_EntNetworkElement VALUES (?,?)');
      for (const row of db.prepare('SELECT id,classification FROM I_EntNetworkElement').all()) insert.run(row.id,row.classification);
      unknownDb.exec("UPDATE I_EntNetworkElement SET classification='unlisted-source-code' WHERE rowid=1");
      const groups = await run({op:'Graph',root:'d',nodes:[{id:'d',entity:'device'}],edges:[],
        select:[{node:'d',dimension:'device_class'}],measures:[{node:'d',measure:'device_count'}]},true,unknownDb);
      assert.equal(groups.reduce((sum,r)=>sum+r.d_device_count,0),db.prepare('SELECT count(*) n FROM I_EntNetworkElement').get().n);
      assert(groups.some(r=>r.d_device_class==='unlisted-source-code'&&r.d_device_class__kind==='Unknown'));
    }finally{unknownDb.close();}
    console.log(JSON.stringify({enumFields,onuGroups:actual.length,ports:ports.length,totalPorts:portCount,topPorts:topPorts.length,tenantGroups:tenantCpu.length,powerMeasures:3,unsafeFanoutRejected:true,unknownEnumTotalsPreserved:true,unitMetadata:true,chineseEnumNames:true}));
  });
}finally{db.close();}
