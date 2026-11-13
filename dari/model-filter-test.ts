import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 db.exec('CREATE TABLE T_CURRENT_ALARM(CSN INTEGER,OCCURUTC INTEGER,SEVERITY INTEGER); INSERT INTO T_CURRENT_ALARM VALUES(1,1000,1),(2,2000,1),(3,2500,2),(4,4000,2)');
 const source=`
type Params = Schema({start:EpochMillis,end:EpochMillis});
data request: Params = input();
data rows = query_remote! {
 let a = from(ic::current_alarm);
 a |> filter(a.alarm_occur_utc_raw >= request.start)
   |> filter(a.alarm_occur_utc_raw < request.end)
   |> project({severity:a.alarm_severity,total:a.alarm_count}).as!(out)
   |> order_by(asc(out.severity)) |> take(10)
};
answer tree! { Answer [Table(data = rows)]};`;
 const program=check(source,host.model);
 const output=resolve(program,db,{request:{start:1500,end:3000}});
 assert.deepEqual(output.values.rows.map((r:any)=>r.total),[1,1]);
 assert.equal(output.queries,1);
 const narrowed=source.replace('   |> project','   |> filter(a.alarm_severity == ic::AlarmSeverity::Critical)\n   |> project');
 const critical=resolve(check(narrowed,host.model),db,{request:{start:1500,end:3000}});
 assert.deepEqual(critical.values.rows.map((r:any)=>r.total),[1]);
 const compound=source.replace('filter(a.alarm_occur_utc_raw >= request.start)\n   |> filter(a.alarm_occur_utc_raw < request.end)','filter((a.alarm_occur_utc_raw >= request.start && a.alarm_occur_utc_raw < request.end) || a.alarm_severity == ic::AlarmSeverity::Major)');
 assert.deepEqual(resolve(check(compound,host.model),db,{request:{start:1500,end:3000}}).values.rows.map((r:any)=>r.total),[1,2]);
 db.exec("CREATE TABLE I_EnterpriseFrame(name TEXT,manufacturer TEXT); INSERT INTO I_EnterpriseFrame VALUES('null',NULL),('empty',''),('named','Acme')");
 const nullable=(predicate:string)=>'data rows=query_remote! {let f=from(ic::frame);f |> filter('+predicate+') |> project({name:f.frame_name}).as!(out) |> order_by(asc(out.name)) |> take(10)};answer tree! { Answer [Table(data = rows)]};';
 const selected=(predicate:string)=>resolve(check(nullable(predicate),host.model),db).values.rows.map((row:any)=>row.name);
 assert.deepEqual(selected('is_some(f.frame__manufacturer)'),['empty','named']);
 assert.deepEqual(selected('is_none(f.frame__manufacturer)'),['null']);
 assert.deepEqual(selected('is_some(f.frame__manufacturer) && f.frame_name == "named"'),['named']);
 assert.deepEqual(selected('is_none(f.frame__manufacturer) || f.frame_name == "named"'),['named','null']);
 assert.throws(()=>check(nullable('is_some(f.frame_name)'),host.model),/optional dimension/);
 assert.throws(()=>check(nullable('is_some()'),host.model),/one optional dimension/);

 const optionalSource=(predicate:string)=>'type Params=Schema({name:Option(String)});data request:Params=input();data rows=query_remote! {let f=from(ic::frame);f |> filter('+predicate+') |> project({name:f.frame_name}).as!(out) |> order_by(asc(out.name)) |> take(10)};answer tree! {Answer [Table(data=rows,spec={allow_no_data:True})]};';
 const optionalProgram=check(optionalSource('(f.frame_name == request.name).unwrap_or!(False)'),host.model);
 assert.deepEqual(resolve(optionalProgram,db,{request:{name:'named'}}).values.rows,[{name:'named'}]);
 assert.deepEqual(resolve(optionalProgram,db,{request:{name:null}}).values.rows,[]);
 const acceptUnknown=check(optionalSource('(f.frame_name == request.name).unwrap_or!(True)'),host.model);
 assert.equal(resolve(acceptUnknown,db,{request:{name:null}}).values.rows.length,3);
 assert.throws(()=>check(optionalSource('f.frame_name == request.name'),host.model),/nonnullable|unwrap_or/);
 assert.throws(()=>check(optionalSource('(f.frame_name == request.name).unwrap_or!(1)'),host.model),/Bool/);
 assert.throws(()=>check(optionalSource('(f.frame_name == "named").unwrap_or!(False)'),host.model),/already Bool/);
 const nested=check(optionalSource('((f.frame_name == request.name).unwrap_or!(False)) || f.frame_name == "empty"'),host.model);
 assert.deepEqual(resolve(nested,db,{request:{name:null}}).values.rows,[{name:'empty'}]);
 console.log('model optional parameters: Some/None, explicit Bool defaults and boolean composition passed');

 const enumSource='type Params=Schema({severity:Option(ic::AlarmSeverity)});data request:Params=input();data rows=query_remote! {let a=from(ic::current_alarm);a |> filter((a.alarm_severity == request.severity).unwrap_or!(False)) |> project({total:a.alarm_count}).as!(out) |> take(1)};answer tree! {Answer [Table(data=rows)]};';
 let enumWire='';
 const enumProgram=check(enumSource,{...host.model,check_type(intent,encoded){enumWire=encoded.json;return host.model.check_type(intent,encoded);}});
 const wrongBusiness=JSON.parse(enumWire);
 wrongBusiness.steps.find((step:any)=>step.kind==='filter').body.args[0].right.logical='AnotherIdentity';
 assert.throws(()=>host.checkWire(JSON.stringify(wrongBusiness)),/business type does not match/);
 assert.deepEqual(resolve(enumProgram,db,{request:{severity:'Critical'}}).values.rows,[{total:2}]);
 assert.deepEqual(resolve(enumProgram,db,{request:{severity:null}}).values.rows,[{total:0}]);
 const projected='data rows=query_remote! {let f=from(ic::frame);f |> project({name:f.frame_name,manufacturer:not_none(f.frame__manufacturer)}).as!(out) |> order_by(asc(out.name)) |> take(1)};answer tree! { Answer [Table(data = rows)]};';
 const projectedProgram=check(projected,host.model);
 assert.equal(show(projectedProgram.bindings.get('rows')!.type),'Table(Schema({name: String, manufacturer: String}))');
 assert.deepEqual(resolve(projectedProgram,db).values.rows,[{name:'empty',manufacturer:''}]);
 const firstNull=projected.replace('asc(out.name)','desc(out.name)');
 assert.deepEqual(resolve(check(firstNull,host.model),db).values.rows,[{name:'named',manufacturer:'Acme'}]);
 assert.throws(()=>check(projected.replace('not_none(f.frame__manufacturer)','not_none(f.frame_name)'),host.model),/optional direct model member/);
 assert.throws(()=>check(projected.replace('not_none(f.frame__manufacturer)','unwrap_or!(not_none(f.frame__manufacturer),"x")'),host.model),/Computed model expression|outermost/);
 db.exec('CREATE TABLE NetworkDeviceKPI(cpuUsage REAL)');
 const aggregate='data rows=query_remote! {let a=from(ic::device_kpi);a |> project({cpu:not_none(a.cpu_usage)}).as!(out)};answer tree! { Answer [Table(data = rows,spec={allow_no_data:True})]};';
 const aggregateProgram=check(aggregate,host.model);
 assert(!show(aggregateProgram.bindings.get('rows')!.type).includes('Option('));
 assert.deepEqual(resolve(aggregateProgram,db).values.rows,[]);
 db.exec('INSERT INTO NetworkDeviceKPI VALUES(NULL),(12),(24)');
 assert.deepEqual(resolve(aggregateProgram,db).values.rows,[{cpu:18}]);
 console.log('model not_none projection: required output Schema, null exclusion before take, empty strings and aggregate output semantics passed');
 console.log('model null predicates: SQL pushdown, null versus empty string, boolean composition and optional member validation passed');
 console.log('model row predicates: half-open time window, full-input grouping and enum filter passed');
}finally{db.close();await host.close();}
