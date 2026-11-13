import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {createFixtureModel} from './fixture-model.ts';

const source=`
type Params = Schema({floor: Float});
data request: Params = input();
data row = query_remote! {
    let a = from(ic::DeviceKpi);
    a |> filter(a.cpu_usage > request.floor)
      |> project({cpu: a.cpu_usage}).as!(out)
      |> order_by(desc(out.cpu)) |> take_opt()
};
answer tree! { Answer [
    if let Some(found) = row [
        p ["CPU：", UseValue(ref = found.cpu)],
        if let Some(cpu) = found.cpu [
            if cpu > 50.0 [p ["偏高"]] else [p ["正常"]]
        ] else [p ["指标为空"]]
    ] else [p ["无数据"]]
] };
`;
const {model,stats}=createFixtureModel(),program=check(source,model);
assert.equal(show(program.bindings.get('row')!.type),'Option(Schema({cpu: Option(Float)}))');
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE devices(id TEXT,name TEXT,cpu REAL,tenant TEXT); INSERT INTO devices VALUES("one","甲",80,"t")'.replaceAll('"',"'"));
assert.equal(resolve(program,db,{request:{floor:0}}).answer,'CPU：*80*\n\n偏高');
assert.equal(stats.checks,1);
assert.equal(resolve(program,db,{request:{floor:100}}).answer,'无数据');
assert.equal(stats.checks,1);
assert.throws(()=>check(source.replace('= found.cpu [','= found.missing ['),model),/Unknown field/);
assert.throws(()=>check(source.replace('else [p ["无数据"]]','else [p [UseValue(ref = found.cpu)]]'),model),/Unknown binding found/);
assert.throws(()=>check(source.replace('= row [','= request ['),model),/requires Option/);
assert.throws(()=>check('type R = Schema({id:Int}); data r: Table(R) = source("rows");'),/test fixture capability/);
assert.throws(()=>check(source.replace('take_opt()','take_opt(1)'),model),/accepts no arguments/);
const shadowed=source.replace('answer','data cpu = 42; data derived = cpu + 1; answer')
 .replace('if cpu > 50.0 [p ["偏高"]]','if cpu > 50.0 [p [UseValue(ref = derived)]]');
assert.equal(resolve(check(shadowed,model),db,{request:{floor:0}}).answer,'CPU：*80*\n\n*43*');
const bounded=source.replace('answer',`data rows = query_remote! {
 let a = from(ic::DeviceKpi); a |> project({cpu:a.cpu_usage}).as!(out) |> order_by(desc(out.cpu)) |> take(5)
};
data copied = query! { let r = from(rows); r |> project({cpu:r.cpu}).as!(out) };
answer`).replace('p ["CPU：", UseValue(ref = found.cpu)]','Table(data = copied)');
assert.match(resolve(check(bounded,model),db,{request:{floor:0}}).answer,/80/);
const contextSource=`data ctx = context! { time_zone: Context::ClientTz }; answer tree! { Answer [p [UseValue(ref = ctx.time_zone)]] };`;
const contextType={kind:'schema',fields:{timeZone:{kind:'scalar',name:'String'}}};
const contextProgram=check(contextSource,undefined,{contextType});
assert.equal(resolve(contextProgram,db,{}, {context:{timeZone:'Asia/Shanghai'}}).answer,'*Asia/Shanghai*');
assert.throws(()=>check(contextSource),/host-provided Schema/);
assert.throws(()=>resolve(contextProgram,db,{}, {context:{timeZone:42}}),/invalid model scalar/);
const oldContract=model.contractId;
model.contractId='changed';
assert.throws(()=>resolve(program,db,{request:{floor:0}}),/Model contract changed/);
model.contractId=oldContract;
const implementation=model.implementationId;
model.implementationId='new-build';
assert.throws(()=>resolve(program,db,{request:{floor:0}}),/Model contract changed/);
model.implementationId=implementation;
const scalarQuery=`data row = query_remote! {
 let a = from(ic::DeviceKpi); a |> project({cpu:a.cpu_usage}).as!(out) |> take_opt()
}; answer tree! { Answer [if let Some(value_row) = row [UseValue(ref = value_row.cpu)] else ["无数据"]] };`;
assert.equal(resolve(check(scalarQuery,model),db).answer,'*80*');
const singleton=scalarQuery.replace('take_opt()','take(1)').replace('if let Some(value_row) = row [UseValue(ref = value_row.cpu)] else ["无数据"]','Table(data = row)');
assert.match(resolve(check(singleton,model),db).answer,/80/);
const dishonest={...model,check_type(intent:import('./src/model.ts').IntentType,encoded:import('./src/model.ts').EncodedIntent){const result=model.check_type(intent,encoded);return {...result,maxRows:500};}};
assert.throws(()=>check(singleton,dishonest),/exceeds the authored take/);
const excessRows={...model,bind(plan:unknown,parameters:unknown[]){const q=model.bind(plan,parameters);return {...q,sql:'SELECT 80.0 AS cpu UNION ALL SELECT 81.0 AS cpu',bindings:[]};}};
assert.throws(()=>resolve(check(singleton,excessRows),db),/exceeds published row bound/);
db.close();
console.log('typed pipeline: passed');
