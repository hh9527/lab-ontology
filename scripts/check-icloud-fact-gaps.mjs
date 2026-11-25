// IC 来源补齐的端到端回归：检查、SQL lowering、绑定和 SQLite 执行。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve as pathResolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const [artifact,adapter]=process.argv.slice(2);
assert(artifact&&adapter,'Usage: node scripts/check-icloud-fact-gaps.mjs <model.wasm> <telora-model.ts>');
const url=pathToFileURL(pathResolve(adapter)),req=createRequire(url);
const core=Object.keys(req('../package.json').dependencies).find(n=>n.endsWith('/dari-core'));
const {check,resolve}=await import(pathToFileURL(req.resolve(core)));
const {sqlite}=await import(new URL('../../dari/src/adapters/sqlite.ts',url));
const {openModel}=await import(url),host=await openModel(artifact),db=new DatabaseSync(':memory:');
const base=t=>t.kind==='option'?t.inner:t;
function evaluate(query,more=''){
 const program=check(`data rows=query_remote! {${query}};${more}answer tree! {Answer [Table(data=rows)]};`,host.model);
 const result=resolve(program,sqlite(db),{},{model:{contractId:host.model.contractId,implementationId:host.model.implementationId,
  execute(plan,parameters){const q=host.bind(plan,parameters);return {...q,rows:db.prepare(q.sql).all(...q.bindings)};}}});
 return {program,result,rows:result.values.rows};
}
try{
 db.exec(`CREATE TABLE NetworkDeviceKPI(resId TEXT,tenantId TEXT,ts TEXT,nePingRespTime INTEGER);
 INSERT INTO NetworkDeviceKPI VALUES ('a','t','2026-11-01T00:00:00.000Z',40),('a','t','2026-11-01T01:00:00.000Z',41),('a','t','2026-11-01T02:00:00.000Z',NULL);
 CREATE TABLE NetworkAPKPI(resId TEXT,tenantId TEXT,ts TEXT,hwApMemoryUseRate REAL);
 INSERT INTO NetworkAPKPI VALUES ('ap','t','2026-11-01T00:00:00.000Z',20),('ap','t','2026-11-01T01:00:00.000Z',80),('ap','t','2026-11-01T02:00:00.000Z',NULL);`);
 const ping=evaluate(`let a=from(ic::device_kpi);let r=a |> project({avg:a.device_ping_response_avg,min:a.device_ping_response_min,max:a.device_ping_response_max,n:a.device_ping_response_observation_count});r |> order_by(asc(r.avg)) |> take(1)`);
 assert.deepEqual(ping.rows,[{avg:40.5,min:40,max:41,n:2}]);
 const t=base(ping.program.bindings.get('rows').type.inner.fields.avg);assert.match(t.name,/MeanPingResponseTime/);assert.equal(t.inner.name,'Float');
 const window=evaluate(`let a=from(ic::device_kpi);let r=a |> filter(a.device_kpi_ts_raw >= DateTimeUtc("2026-11-01T01:00:00.000Z") && a.device_kpi_ts_raw < DateTimeUtc("2026-11-01T03:00:00.000Z")) |> project({avg:a.device_ping_response_avg,n:a.device_ping_response_observation_count});r |> order_by(asc(r.avg)) |> take(1)`);
 assert.deepEqual(window.rows,[{avg:41,n:1}]);
 assert.deepEqual(evaluate(`let a=from(ic::source_NetworkAPKPI);let r=a |> project({avg:a.ap_memory_usage_avg,min:a.ap_memory_usage_min,max:a.ap_memory_usage_max,n:a.ap_memory_usage_observation_count});r |> order_by(asc(r.avg)) |> take(1)`).rows,[{avg:50,min:20,max:80,n:2}]);
 db.exec(`CREATE TABLE NetworkCellLinkQualityKPI(resId TEXT,ts TEXT,jitter REAL,delay REAL,packetLoss REAL,lqm REAL);
 INSERT INTO NetworkCellLinkQualityKPI VALUES ('d','2026-11-01T00:00:00.000Z',2,10,1,60),('d','2026-11-01T01:00:00.000Z',4,30,3,80),('d','2026-11-01T02:00:00.000Z',NULL,NULL,NULL,NULL);
 CREATE TABLE NetworkCellLinkTrafficKPI(resId TEXT,ts TEXT,upwardTraffic REAL,downwardTraffic REAL,utilization REAL);
 INSERT INTO NetworkCellLinkTrafficKPI VALUES ('d','2026-11-01T00:00:00.000Z',100,200,20),('d','2026-11-01T01:00:00.000Z',300,600,60);`);
 assert.deepEqual(evaluate(`let a=from(ic::source_NetworkCellLinkQualityKPI);let r=a |> project({j:a.cell_link_jitter,lo:a.cell_link_delay_min,hi:a.cell_link_delay_max,loss:a.cell_link_packet_loss,q:a.cell_link_lqm,n:a.cell_link_jitter_observation_count});r |> order_by(asc(r.j)) |> take(1)`).rows,[{j:3,lo:10,hi:30,loss:2,q:70,n:2}]);
 assert.deepEqual(evaluate(`let a=from(ic::source_NetworkCellLinkTrafficKPI);let r=a |> project({up:a.cell_link_upward_traffic,down:a.cell_link_downward_traffic,u:a.cell_link_utilization});r |> order_by(asc(r.up)) |> take(1)`).rows,[{up:200,down:400,u:40}]);
 db.exec(`CREATE TABLE PhysicalServerProcessor(id TEXT,frequency INTEGER);
 INSERT INTO PhysicalServerProcessor VALUES ('a',2600),('b',2800),('c',-1),('d',NULL);`);
 const processors=evaluate(`let a=from(ic::source_PhysicalServerProcessor);let r=a |> project({id:a.source_PhysicalServerProcessor__id,frequency:a.server_processor_frequency,raw:a.source_PhysicalServerProcessor__frequency_raw});r |> order_by(asc(r.id)) |> take(10)`);
 assert.deepEqual(processors.rows,[{id:'a',frequency:2600,raw:2600},{id:'b',frequency:2800,raw:2800},{id:'c',frequency:null,raw:-1},{id:'d',frequency:null,raw:null}]);
 assert.deepEqual(evaluate(`let a=from(ic::source_PhysicalServerProcessor);let r=a |> filter(unwrap_or!(a.server_processor_frequency >= 2700,False)) |> project({id:a.source_PhysicalServerProcessor__id});r |> order_by(asc(r.id)) |> take(10)`).rows,[{id:'b'}]);
 assert.deepEqual(evaluate(`let a=from(ic::source_PhysicalServerProcessor);let r=a |> filter(is_none(a.server_processor_frequency)) |> project({id:a.source_PhysicalServerProcessor__id});r |> order_by(asc(r.id)) |> take(10)`).rows,[{id:'c'},{id:'d'}]);
 db.exec(`CREATE TABLE SYS_StorageDisk(id TEXT);INSERT INTO SYS_StorageDisk VALUES ('disk-a');
 CREATE TABLE StorageHardDriveKPI(resId TEXT,ts TEXT,utility REAL);INSERT INTO StorageHardDriveKPI VALUES ('disk-a','2026-11-01T00:00:00.000Z',20),('disk-a','2026-11-01T01:00:00.000Z',40);`);
 assert.deepEqual(evaluate(`let r=from(ic::source_SYS_StorageDisk).as!(d) |> connect(ic::relations::source_SYS_StorageDisk_StorageHardDriveKPI).as!(k);let g=r |> group_by_identity(d);let o=g |> project({id:d.storage_disk_id,usage:k.storage_disk_usage});o |> order_by(asc(o.id)) |> take(10)`).rows,[{id:'disk-a',usage:30}]);
 db.exec(`CREATE TABLE EnterpriseOpticalModule(id TEXT,tenantId TEXT);
 INSERT INTO EnterpriseOpticalModule VALUES ('module-a','t'),('module-b',NULL);
 CREATE TABLE X_TENANT_VIEW(TENANT_ID TEXT,TENANT_NAME TEXT);INSERT INTO X_TENANT_VIEW VALUES ('t','Tenant');`);
 assert.deepEqual(evaluate(`let r=from(ic::source_EnterpriseOpticalModule).as!(m) |> connect(ic::relations::source_EnterpriseOpticalModule_X_TENANT_VIEW).as!(t);let o=r |> project({id:m.network_optical_module_id,tenant:t.tenant_name});o |> order_by(asc(o.id)) |> take(10)`).rows,[{id:'module-a',tenant:'Tenant'},{id:'module-b',tenant:null}]);
 console.log('Passed: Ping/AP memory null-aware statistics, fractional business mean, window filtering, seven link statistics, frequency thresholds/sentinel/NULL disk KPI identity join and optional optical-module tenant');
}finally{db.close();await host.close();}
