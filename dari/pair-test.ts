import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openModel} from './model-bridge.ts';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 db.exec(`CREATE TABLE I_EntNetworkElement(id TEXT);CREATE TABLE NetworkDeviceKPI(resId TEXT,tenantId TEXT,ts TEXT,cpuUsage REAL);
 INSERT INTO I_EntNetworkElement VALUES('one'),('two'),('zero');
 INSERT INTO NetworkDeviceKPI VALUES('one','t','2026-11-01T00:00:00Z',10),('two','t','2026-11-01T00:00:00Z',50),('zero','t','2026-11-01T00:00:00Z',0),('one','t','2026-11-02T00:00:00Z',30),('two','t','2026-11-02T00:00:00Z',60),('zero','t','2026-11-02T00:00:00Z',10)`);
 const source=`type Params = Schema({start:Rfc3339,split:Rfc3339,end:Rfc3339});data request:Params = input();
 data rows = query_remote! {
 let l = from(ic::device);let r = from(ic::device);let kl = from(ic::device_kpi);let kr = from(ic::device_kpi);
 l |> pair(r) |> connect(ic::relations::device_kpi_of_device,kl,l) |> connect(ic::relations::device_kpi_of_device,kr,r)
 |> group_by_identity(l) |> group_by_identity(r)
 |> filter(kl.device_kpi_ts_raw >= request.start) |> filter(kl.device_kpi_ts_raw < request.split)
 |> filter(kr.device_kpi_ts_raw >= request.split) |> filter(kr.device_kpi_ts_raw < request.end)
 |> project({device:l.device_id,before:kl.cpu_usage,after:kr.cpu_usage}).as!(out)
 |> order_by(desc(growth_rate(out.after,out.before))) |> take(10)
 };answer tree! { Answer [Table(data = rows)]};`;
 const inputs={request:{start:'2026-11-01T00:00:00Z',split:'2026-11-02T00:00:00Z',end:'2026-11-03T00:00:00Z'}};
 const result=resolve(check(source,host.model),db,inputs);
 assert.deepEqual(result.values.rows.map((r:any)=>r.device),['one','two']);
 assert.deepEqual(result.values.rows.map((r:any)=>[r.before,r.after]),[[10,30],[50,60]]);
 assert.equal(result.queries,1);
 for(const op of ['difference','ratio']){
  const rows=resolve(check(source.replace('growth_rate',op),host.model),db,inputs).values.rows;
  assert.equal(rows[0].device,'one');
 }
 const filtered=source.replace(' |> project({device:', ' |> filter(kl.cpu_usage > ic::Percent(20.0)) |> filter(kr.cpu_usage < ic::Percent(70.0))\n |> project({device:');
 assert.deepEqual(resolve(check(filtered,host.model),db,inputs).values.rows.map((r:any)=>r.device),['two']);
 console.log('model pair: full-input period aggregation, identity alignment, growth/difference/ratio ranking and zero-baseline handling passed');
}finally{db.close();await host.close();}
