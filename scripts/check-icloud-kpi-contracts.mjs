import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {resolve as pathResolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const [artifact, adapter] = process.argv.slice(2);
assert(artifact && adapter, 'Usage: node scripts/check-icloud-kpi-contracts.mjs <model.wasm> <telora-model.ts>');
const url=pathToFileURL(pathResolve(adapter)), req=createRequire(url);
const core=Object.keys(req('../package.json').dependencies).find(name=>name.endsWith('/dari-core'));
const {check,resolve}=await import(pathToFileURL(req.resolve(core)));
const {sqlite}=await import(new URL('../../dari/src/adapters/sqlite.ts',url));
const {openModel}=await import(url);
const host=await openModel(artifact),db=new DatabaseSync(':memory:');
const base=t=>t.kind==='option'?t.inner:t;
try {
  const module=new WebAssembly.Module(readFileSync(artifact));
  const metadata=JSON.parse(new TextDecoder().decode(WebAssembly.Module.customSections(module,'telora.build.information')[0]));
  const publication=metadata.entries['ontology.knowledge'];
  const {graph}=new Function('data',publication.program)(publication.data);
  const facts=new Map(graph.facts.map(f=>[f.key,f.value]));
  const cpu=facts.get('datasets/device_kpi').measures.cpu_usage;
  assert.equal(cpu.statistics.population,'NonNullReportedValues');
  assert.equal(cpu.statistics.weighting,'EqualPerReportedValue');
  assert.equal(cpu.statistics.valid_count,'datasets/device_kpi#fields/source_cpuUsageEffcnt');
  assert.equal(cpu.observation_count,'datasets/device_kpi#measures/cpu_usage_observation_count');
  const portMeasures=facts.get('datasets/device_kpi').measures;
  for(const removed of ['port_count','used_port_count','running_port_count'])assert(!portMeasures[removed],removed+' must not sum repeated stock samples');
  for(const id of ['port_count_sample_avg','used_port_sample_avg','running_port_sample_avg'])assert.equal(portMeasures[id].aggregate,'Avg');
  let identities=0;
  for(const dataset of host.contract.datasets){
    const fact=facts.get('datasets/'+encodeURIComponent(dataset.id));
    if(fact.kind==='Metric'){
      assert(fact.grain.some(name=>/ts$/.test(name)),dataset.id+' must retain sampling time');
      if(dataset.id==='source_StorageDeviceKPI')assert.equal(fact.group_identity,null,'A polymorphic resource has no fabricated single-entity binding');
      else {assert(fact.group_identity?.fields.length,dataset.id+' requires an observed entity identity');identities++;}
    }
  }
  assert.equal(identities,16);
  const lookup=key=>key.split('#').reduce((value,part,index)=>index===0?facts.get(part):part.split('/').reduce((v,k)=>v?.[decodeURIComponent(k)],value),undefined);
  let means=0,validCounts=0;
  for(const [key,fact] of facts){
    if(!key.startsWith('datasets/'))continue;
    for(const field of Object.values(fact.fields??{})){if(field.valid_count){assert(lookup(field.valid_count));validCounts++;}}
    for(const measure of Object.values(fact.measures??{})){
      if(measure.aggregate!=='Avg')continue;
      means++;
      assert.equal(measure.statistics.weighting,'EqualPerReportedValue');
      const count=lookup(measure.observation_count);
      assert.equal(count?.aggregate,'Count');
      assert.equal(count.anchor_field,measure.anchor_field,'Mean denominator must count the same source field');
      if(measure.statistics.valid_count)assert(lookup(measure.statistics.valid_count),'Effective counter knowledge reference must resolve');
    }
    if(fact.kind!=='Metric'||!fact.group_identity)continue;
    const dataset=host.contract.datasets.find(d=>key==='datasets/'+encodeURIComponent(d.id));
    const counter=dataset.members.find(m=>m.kind==='measure'&&m.symbol.endsWith('sample_count'));
    assert(counter,'Sample counter must be published for '+dataset.id);
    check(`data result=query_remote! {let a=from(${dataset.symbol});let grouped=a |> group_by_identity(a);
      let rows=grouped |> project({n:a.${counter.symbol}});rows |> order_by(desc(rows.n)) |> take(20)};
      answer tree! {Answer []};`,host.model);
  }
  assert.equal(means,77);
  assert.equal(validCounts,84);

  for(const dataset of Object.values(host.model.datasets))for(const member of Object.values(dataset.members)){
    const t=base(member.type);
    if(t.kind==='nominal'&&t.inner?.name==='Int'&&t.codec?.operations?.includes('Mean')){
      assert(t.meanResult,member.symbol+' must publish a fractional mean type');
      assert.equal(base(t.meanResult).inner?.name??base(t.meanResult).name,'Float');
    }
  }
  db.exec(`CREATE TABLE NetworkDeviceKPI(resId TEXT,tenantId TEXT,ts TEXT,cpuUsage REAL,cpuUsageEffcnt INTEGER);
    INSERT INTO NetworkDeviceKPI VALUES
    ('a','t','2026-11-01T00:00:00.000Z',10,10),
    ('a','t','2026-11-01T01:00:00.000Z',NULL,0),
    ('b','t','2026-11-01T00:00:00.000Z',100,1),
    ('b','t','2026-11-01T01:00:00.000Z',100,1),
    ('b','t','2026-11-01T02:00:00.000Z',100,1);`);
  db.exec(`ALTER TABLE NetworkDeviceKPI ADD COLUMN portCount INTEGER;
    ALTER TABLE NetworkDeviceKPI ADD COLUMN portUsedCount INTEGER;
    ALTER TABLE NetworkDeviceKPI ADD COLUMN operStatusCount INTEGER;
    UPDATE NetworkDeviceKPI SET portCount=48,portUsedCount=24,operStatusCount=20;`);
  const stocks=check(`data ports=query_remote! {let a=from(ic::device_kpi);
    a |> project({total:a.port_count_sample_avg,used:a.used_port_sample_avg,running:a.running_port_sample_avg,peak:a.port_count_peak}) |> take_opt()};
    answer tree! {Answer [if let Some(p)=ports [UseValue(ref=p.total)] else []]};`,host.model);
  const stocksResult=resolve(stocks,sqlite(db),{},{model:{contractId:host.model.contractId,implementationId:host.model.implementationId,
    execute(plan,parameters){const query=host.bind(plan,parameters);return {...query,rows:db.prepare(query.sql).all(...query.bindings)};}}});
  assert.deepEqual(stocksResult.values.ports,{tag:'Some',value:{total:48,used:24,running:20,peak:48}},'Repeated samples must not inflate port stocks');
  const program=check(`
    data devices=query_remote! {
      let k=from(ic::device_kpi);
      let grouped=k |> group_by_identity(k);
      let rows=grouped |> project({id:k.device_kpi_res_id,cpu:k.cpu_usage,
        observations:k.cpu_usage_observation_count,samples:k.device_kpi_sample_count});
      rows |> order_by(asc(rows.id)) |> take(110)
    };
    data pooled=query_remote! {let k=from(ic::device_kpi); k |> project({cpu:k.cpu_usage}) |> take_opt()};
    data equal_devices=query! {let r=from(devices);r |> project({cpu:avg(r.cpu)}) |> take_opt()};
    answer tree! {Answer [Table(data=devices),if let Some(p)=pooled [UseValue(ref=p.cpu)] else [],if let Some(e)=equal_devices [UseValue(ref=e.cpu)] else []]};`,host.model);
  const result=resolve(program,sqlite(db),{},{model:{contractId:host.model.contractId,implementationId:host.model.implementationId,
    execute(plan,parameters){const query=host.bind(plan,parameters);return {...query,rows:db.prepare(query.sql).all(...query.bindings)};}}});
  assert.deepEqual(result.values.devices,[{id:'a',cpu:10,observations:1,samples:2},{id:'b',cpu:100,observations:3,samples:3}]);
  assert.deepEqual(result.values.pooled,{tag:"Some",value:{cpu:77.5}});
  assert.deepEqual(result.values.equal_devices,{tag:"Some",value:{cpu:55}});
  const deviceMean=base(program.bindings.get('devices').type.inner.fields.cpu);
  assert.match(deviceMean.name,/CpuUtilization/);
  const meanType=base(program.bindings.get('equal_devices').type.inner.fields.cpu);
  assert.equal(meanType.name,deviceMean.name,'Two-stage aggregation preserves the business type');
  assert.throws(()=>check(`data devices=query_remote! {let k=from(ic::device_kpi);k |> project({cpu:k.cpu_usage,mem:k.memory_usage}) |> take(1)};
    data invalid=query! {let r=from(devices);r |> project({value:r.cpu+r.mem})};answer tree! {Answer []};`,host.model),/type|same|Add/i);
  db.exec(`CREATE TABLE NetworkDeviceInterfaceKPI(resId TEXT,tenantId TEXT,ts TEXT,ifInErrors INTEGER);
    INSERT INTO NetworkDeviceInterfaceKPI VALUES ('p','t','2026-11-01T00:00:00.000Z',1),('p','t','2026-11-01T01:00:00.000Z',2);`);
  const errors=check(`data raw=query_remote! {let p=from(ic::interface_kpi);let r=p |> project({n:p.interface_kpi__ifInErrors});r |> order_by(asc(r.n)) |> take(10)};
    data local_mean=query! {let r=from(raw);r |> project({n:avg(r.n)}) |> take_opt()};
    data remote_mean=query_remote! {let p=from(ic::interface_kpi);p |> project({n:p.interface_in_errors}) |> take_opt()};
    answer tree! {Answer [if let Some(x)=local_mean [UseValue(ref=x.n)] else [],if let Some(y)=remote_mean [UseValue(ref=y.n)] else []]};`,host.model);
  const errorMeans=resolve(errors,sqlite(db),{},{model:{contractId:host.model.contractId,implementationId:host.model.implementationId,
    execute(plan,parameters){const query=host.bind(plan,parameters);return {...query,rows:db.prepare(query.sql).all(...query.bindings)};}}});
  assert.deepEqual(errorMeans.values.local_mean,{tag:'Some',value:{n:1.5}});
  assert.deepEqual(errorMeans.values.remote_mean,errorMeans.values.local_mean);
  assert.equal(base(errors.bindings.get('local_mean').type.inner.fields.n).name,base(errors.bindings.get('remote_mean').type.inner.fields.n).name);
  const errorType=base(host.model.datasets['ic::interface_kpi'].members.interface_in_errors.type);
  assert.match(errorType.name,/MeanReceivedErrorPackets/);
  assert.match(facts.get('datasets/interface_kpi').measures.interface_in_errors.type,/MeanReceivedErrorPackets/);
  assert(!errorType.codec.operations.includes('Sum'));
  assert(!errorType.codec.operations.includes('Subtract'));
  console.log('Passed: 16 observed identities, polymorphic exception, mean knowledge references, null-aware observation counts, 77.5 sample mean vs 55 entity mean, nominal preservation and rejected cross-metric arithmetic');
} finally {db.close();await host.close();}
