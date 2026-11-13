import {createFixtureModel} from './fixture-model.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {check as checkProgram,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const source=readFileSync(new URL('./examples/source-select.dari',import.meta.url),'utf8');
const program=check(source);
for(const [from,to,error]of [
 ['$.cpu', '"cpu"', /Use \$\.field/],
 ['$.cpu', '$.missing', /Unknown field missing/],
 ['$.cpu', '$.name', /Chart value must be numeric/],
 ['$.cpu', '$.cpu + 1', /Use \$\.field/],
 ['$.cpu', '$."cpu"', /Expected identifier/],
 ['$.cpu', 'fn(x) { x.cpu }', /Expected/],
] as const)assert.throws(()=>check(source.replace(from,to)),error);
assert.throws(()=>check(source.replace('data top = query! {','data selector = $.cpu;\ndata top = query! {')),/requires an input row context/);
assert.equal(show(program.bindings.get('request')!.type),'Schema({floor: Float})');
for(const [declaration,error]of [
 ['data request = input(Params);',/accepts no arguments/],
 ['data request: Params = input(Params);',/accepts no arguments/],
 ['data request = input();',/explicit Schema type annotation/],
 ['data request: Float = input();',/annotation must be Schema/],
 ['data request: Params = unwrap_or!(input(), {floor: 0.0});',/explicitly typed declaration/],
] as const)assert.throws(()=>check(source.replace('data request: Params = input();',declaration)),error);
assert.equal(show(program.bindings.get('summary')!.type),'Option(Schema({n: Int, average: Option(Float)}))');
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE devices(id TEXT,name TEXT,cpu REAL,tenant TEXT)');
const insert=db.prepare('INSERT INTO devices VALUES(?,?,?,?)');
for(let i=0;i<1000;i++)insert.run('device-'+i,'设备-'+i,i%100,'tenant-'+i%20);
const output=resolve(program,db,{request:{floor:50}});
assert.equal(output.answer,'[report](report.html)\n\n设备数：*5*');
assert.equal(output.queries,2);
assert.match(output.artifacts['report.html'],/设备-99/);
assert.match(output.artifacts['report.html'],/metadata/);
const empty=resolve(program,db,{request:{floor:200}});
assert.equal(empty.answer,'无数据\n\n设备数：*0*');assert.deepEqual(empty.artifacts,{});
assert.throws(()=>resolve(program,db,{request:{floor:'wrong'}}),/Invalid input/);
for(const [from,to,error]of [
 ['a.cpu > request.floor','a.missing > request.floor',/Unknown field/],
 ['take(5)','take(501)',/1..500/],
 ['order_by(desc(projected.cpu))','order_by(desc(projected.missing))',/Unknown field/],
 ['Identity & Metrics','Identity & Schema({id: String})',/Schema conflict/],
 ['{n: count(), average: avg(a.cpu)}','{n: count(), average: a.cpu}',/Ungrouped/],
 ['a.id, name','a.id + a.id, name',/Arithmetic/],
] as const)assert.throws(()=>check(source.replace(from,to)),error);
const joined=`
type Id = struct(String); type OtherId = struct(String);
type A = Schema({id: Id}); type B = Schema({id: Id, score: Float});
data a: Table(A) = source("a"); data b: Table(B) = source("b");
data rows = query! { let l = from(a); let r = from(b);
left_join({l,r}, l.id == r.id) |> project({id:l.id, score:r.score}) |> order_by(asc(out.id)) |> take(10) };
answer tree! { Answer [Table(data = rows)] };`;
const jp=check(joined);assert.equal(show(jp.bindings.get('rows')!.type),'Table(Schema({id: Id, score: Option(Float)}))');
db.exec("CREATE TABLE a(id TEXT); CREATE TABLE b(id TEXT, score REAL); INSERT INTO a VALUES('one'),('two'); INSERT INTO b VALUES('one',7)");
assert.match(resolve(jp,db).answer,/two \| 无数据/);
assert.throws(()=>check(joined.replace('type B = Schema({id: Id','type B = Schema({id: OtherId')),/Cannot compare/);
// Parameter placeholders must follow SQL textual order even across nested queries.
const parameters=source.replace('cpu: a.cpu}', 'cpu: a.cpu + request.floor}');
assert.match(resolve(check(parameters),db,{request:{floor:50}}).artifacts['report.html'],/149/);
// Capture multiple external bindings, including a computed scalar in an aggregate.
const captures=source.replace('data top = query! {','data offset = request.floor + 1;\ndata top = query! {')
 .replace('cpu: a.cpu}', 'cpu: a.cpu + offset}')
 .replace('n: count()', 'n: count() + request.floor');
const captured=resolve(check(captures),db,{request:{floor:50}});
assert.match(captured.answer,/设备数：\*55\*/);
assert.match(captured.artifacts['report.html'],/150/);
assert.throws(()=>check(source.replace('request.floor','missing.floor')),/Unknown binding missing/);
// A local source alias shadows an outer scalar binding.
const shadowed=source.replace('data top = query! {','data a = 123;\ndata top = query! {');
assert.equal(resolve(check(shadowed),db,{request:{floor:50}}).answer,output.answer);
// The projection type determines the element; terminal operations determine the container.
assert.equal(show(program.bindings.get('highest')!.type),'Option(Schema({cpu: Float}))');
assert.equal(show(program.bindings.get('best_device')!.type),'Option(Schema({id: DeviceId, cpu: Float}))');
assert.equal(show(program.bindings.get('average')!.type),'Option(Schema({cpu: Option(Float)}))');
const inspect=source.replace('UseValue(ref = summary_n)','if let Some(value_row) = highest [UseValue(ref = value_row.cpu)] else ["无数据"], if let Some(value_row) = average [UseValue(ref = value_row.cpu)] else ["无数据"]');
const options=resolve(check(inspect),db,{request:{floor:50}});
assert.deepEqual(options.values.highest,{tag:'Some',value:{cpu:99}});
assert.deepEqual(options.values.average,{tag:'Some',value:{cpu:99}});
const missing=resolve(check(inspect),db,{request:{floor:200}});
assert.deepEqual(missing.values.highest,{tag:'None'});
assert.deepEqual(missing.values.average,{tag:'Some',value:{cpu:null}});
assert.equal(resolve(check(inspect.replace('order_by(desc(out.cpu))\n      |> take_opt()','take_opt()')),db,{request:{floor:50}}).values.highest.value.cpu,99); // ordering is inherited from top
assert.throws(()=>check(source.replace('project({cpu: a.cpu})','project(a.cpu)')),/project requires a Schema row/);
assert.throws(()=>check(source.replace('Table(Device)','Table(Float)')),/Table requires Schema/);
assert.throws(()=>check(source.replace('cpu: Float, tenant: String','cpu: Schema({value: Float}), tenant: String')),/Schema fields require logical scalars/);
assert.throws(()=>check(source.replace('cpu: Float, tenant: String','cpu: Option(Option(Float)), tenant: String')),/Option requires/);

// Optional record values preserve their schema and support an explicit fallback.
const recordValue=source.replace('answer', 'data winner = unwrap_or!(best_device, {id: DeviceId("none"), cpu: 0.0});\nanswer')
 .replace('UseValue(ref = summary_n)','UseValue(ref = winner.cpu)');
const winner=resolve(check(recordValue),db,{request:{floor:50}});
assert.equal(winner.values.best_device.tag,'Some');assert.equal(winner.values.winner.cpu,99);
const noWinner=resolve(check(recordValue),db,{request:{floor:200}});
assert.deepEqual(noWinner.values.best_device,{tag:'None'});assert.equal(noWinner.values.winner.cpu,0);

// Every relation carries named Schema rows.
const chained=source.replace('answer',`data cpu_values = query! {
    let a = from(top); a |> project({cpu: a.cpu}) |> order_by(desc(out.cpu)) |> take(3)
};
data scalar_peak = query! {
    let a = from(cpu_values); a |> project(a) |> order_by(desc(out.cpu)) |> take_opt()
};
answer`).replace('UseValue(ref = summary_n)','if let Some(value_row) = scalar_peak [UseValue(ref = value_row.cpu)] else ["无数据"]');
assert.equal(show(check(chained).bindings.get('cpu_values')!.type),'Table(Schema({cpu: Float}))');
assert.deepEqual(resolve(check(chained),db,{request:{floor:50}}).values.scalar_peak,{tag:'Some',value:{cpu:99}});
const wholeRecord=source.replace('project({id: a.id, name: a.name, cpu: a.cpu})','project(a)');
assert.match(show(check(wholeRecord).bindings.get('top')!.type),/tenant: String/);
assert.match(resolve(check(wholeRecord),db,{request:{floor:50}}).answer,/report/);

// Model symbols and typed member references reach check_type without string selectors.
const modelSource=readFileSync(new URL('./examples/device.dari',import.meta.url),'utf8');
const {model,stats}=createFixtureModel();
const mp=check(modelSource,model);assert.equal(stats.checks,1);assert.equal(stats.bindings,0);
assert.equal(show(mp.bindings.get('readings')!.type),'Table(Schema({device: ic::DeviceId, cpu: Option(Float)}))');
assert.equal(resolve(mp,db,{request:{floor:50}}).answer,'最高 CPU：*99*');assert.equal(stats.bindings,1);
assert.equal(resolve(mp,db,{request:{floor:100}}).answer,'最高 CPU：*无数据*');
assert.equal(stats.checks,1); // resolve binds the checked plan; it never replans.
assert.throws(()=>resolve(mp,db,{request:{floor:200}}),/within 0..100/);
assert.throws(()=>check(modelSource),/requires a model/);
assert.throws(()=>check(modelSource.replace('ic::DeviceKpi','"device_kpi"'),model),/static Dataset symbol/);
assert.throws(()=>check(modelSource.replace('ic::DeviceKpi','ic::Missing'),model),/Unknown model Dataset/);
assert.throws(()=>check(modelSource.replace('a.cpu_usage >','a.missing >'),model),/Unknown model member/);
assert.throws(()=>check(modelSource.replace('a.cpu_usage >','a.cpu_usage +'),model),/Unsupported model operator/);
assert.throws(()=>check(modelSource.replace('a.cpu_usage > request.floor','a.device_id == a.tenant_id'),model),/incompatible business types/);
// String literals remain ordinary data values, not model identifiers.
const byName=modelSource.replace('a.cpu_usage > request.floor','a.name == "设备-99"');
assert.equal(resolve(check(byName,model),db).answer,'最高 CPU：*99*');
assert.throws(()=>check(modelSource.replace('a.cpu_usage > request.floor','a.name > "设备-99"'),model),/does not allow ordered comparison/);
const renamed=modelSource.replaceAll(/\ba\b/g,'renamed');
assert.equal(resolve(check(renamed,model),db,{request:{floor:50}}).answer,'最高 CPU：*99*');
const projectedOrder=modelSource.replace('desc(a.cpu_usage)','desc(projected.cpu)');
assert.equal(resolve(check(projectedOrder,model),db,{request:{floor:50}}).answer,'最高 CPU：*99*');
const omitMeasure=modelSource.replace('project({device: a.device_id, cpu: a.cpu_usage})','project({device: a.device_id})')
 .replace('a |> project({cpu: a.cpu})','a |> project({cpu: a.device})')
 .replace('order_by(desc(projected.cpu))','order_by(asc(projected.cpu))');
assert.equal(show(check(omitMeasure,model).bindings.get('readings')!.type),'Table(Schema({device: ic::DeviceId}))');
const annotated=modelSource.replace('data readings =','type Expected = Schema({device: ic::DeviceId, cpu: Option(Float)});\ndata readings: Table(Expected) =');
assert.equal(resolve(check(annotated,model),db,{request:{floor:50}}).answer,'最高 CPU：*99*');
const byId=modelSource.replace('a.cpu_usage > request.floor','a.device_id == ic::DeviceId("device-99")');
assert.equal(resolve(check(byId,model),db).answer,'最高 CPU：*99*');
// The measure is aggregated before its predicate, not filtered as raw rows.
const samples=new DatabaseSync(':memory:');
samples.exec("CREATE TABLE devices(id TEXT,name TEXT,cpu REAL,tenant TEXT); INSERT INTO devices VALUES('one','甲',10,'t'),('one','甲',90,'t'),('two','乙',60,'t'),('two','乙',80,'t')");
assert.equal(resolve(check(modelSource,model),samples,{request:{floor:60}}).answer,'最高 CPU：*70*');
const renamedFields=modelSource.replace('device: a.device_id, cpu: a.cpu_usage','resource: a.device_id, usage: a.cpu_usage').replace('project({cpu: a.cpu})','project({cpu: a.usage})');
assert.equal(resolve(check(renamedFields,model),samples,{request:{floor:60}}).answer,'最高 CPU：*70*');
// Published AVG remains nullable for grouped and ungrouped results.
const globalMetric=modelSource.replace('a |> filter(a.cpu_usage > request.floor)\n      |> project({device: a.device_id, cpu: a.cpu_usage})','a |> project({cpu: a.cpu_usage})');
assert.equal(show(check(globalMetric,model).bindings.get('readings')!.type),'Table(Schema({cpu: Option(Float)}))');
samples.exec('DELETE FROM devices');
const noSamples=resolve(check(globalMetric,model),samples);
assert.deepEqual(noSamples.values.highest,{tag:'Some',value:{cpu:null}});
samples.close();
const broken={...model,bind(plan:unknown,values:unknown[]){const q=model.bind(plan,values);q.columns[1].type='String';return q;}};
assert.throws(()=>resolve(check(modelSource,broken),db,{request:{floor:50}}),/contradicts published/);

const start=performance.now();for(let i=0;i<1000;i++)check(source);const checkMs=(performance.now()-start)/1000;
const checked=check(source),at=performance.now();for(let i=0;i<200;i++)resolve(checked,db,{request:{floor:50}});const resolveMs=(performance.now()-at)/200;
console.log(JSON.stringify({status:'passed',fixtureRows:1000,checkMs,resolveMs,queries:output.queries},null,2));

db.close();

function check(source: string, model?: import("./src/model.ts").ModelPort){return checkProgram(source,model,{allowTestSources:true});}
