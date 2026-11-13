import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';
const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 db.exec("CREATE TABLE T_CURRENT_ALARM(CSN INTEGER,OCCURUTC INTEGER,ALARMNAME TEXT);INSERT INTO T_CURRENT_ALARM VALUES(1,1000,'A'),(2,2000,'A'),(3,3000,'B'),(4,9000,'A'),(5,1500,'C')");
 const query=(body:string)=>check('data bounds:Schema({start:EpochMillis,end:EpochMillis})=input();data rows=query_remote! {'+body+'};answer tree! { Answer [Table(data = rows)]};',host.model);
 const body='let a=from(ic::current_alarm);let windowed=a |> filter(a.alarm_occur_utc_raw >= bounds.start && a.alarm_occur_utc_raw < bounds.end);let totals=project({name:windowed.alarm_name,cnt:windowed.alarm_count});totals |> order_by(desc(totals.cnt),asc(totals.name)) |> take(10)';
 assert.deepEqual(resolve(query(body),db,{bounds:{start:1000,end:4000}}).values.rows,[{name:'A',cnt:2},{name:'B',cnt:1},{name:'C',cnt:1}]);
 const after=body.replace('totals |> order_by','totals |> filter(totals.name != "C") |> order_by');
 const afterProgram=query(after),result=resolve(afterProgram,db,{bounds:{start:1000,end:4000}});
 assert.deepEqual(result.values.rows,[{name:'A',cnt:2},{name:'B',cnt:1}]);assert.equal(result.queries,1);
 db.exec("CREATE TABLE I_EnterpriseFrame(name TEXT,manufacturer TEXT);INSERT INTO I_EnterpriseFrame VALUES('a',NULL),('b',''),('c','Acme')");
 const required=query('let f=from(ic::frame);let output=project({name:f.frame_name,manufacturer:not_none(f.frame__manufacturer)});output |> order_by(asc(output.name)) |> take(1)');
 assert.equal(show(required.bindings.get('rows')!.type),'Table(Schema({name: String, manufacturer: String}))');
 assert.deepEqual(resolve(required,db).values.rows,[{name:'b',manufacturer:''}]);
 const related=query('let f=from(ic::frame);let d=from(ic::device);let linked=f |> connect(ic::relations::frame_belongs_to_device,f,d);let output=linked |> project({frame:f.frame_name,device:d.device_name});output |> order_by(asc(output.frame)) |> take(10)');
 assert.match(show(related.bindings.get('rows')!.type),/device: Option\(String\)/);
 const {dariHost}=await import(new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href);
 const scalar=(name:string)=>({kind:'scalar',name});
 const contextType={kind:'schema',fields:{now:scalar('Rfc3339'),epochMillis:scalar('EpochMillis'),timeZone:{kind:'option',inner:scalar('String')}}};
 for(const file of ['ic-device.dari','ic-enum.dari','ic-relation.dari','ic-alarm-report.dari','ic-period-comparison.dari']){
  const program=check(fs.readFileSync(new URL('./examples/'+file,import.meta.url),'utf8'),host.model,{host:dariHost,contextType});
  assert.equal(program.bindings.get('answer')!.type.kind,'answer');
 }
 console.log('Migrated IC examples: device, enum, Relation, alarm report and Pair comparison checked');
 console.log('Named IC plans: source window before aggregation, post-projection filter, one SQL execution, not_none and optional Relation typing passed');
}finally{db.close();await host.close();}
