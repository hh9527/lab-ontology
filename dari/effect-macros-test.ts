import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {createFixtureModel} from './fixture-model.ts';
const db=new DatabaseSync(':memory:');
let captures=0;
const contextType={kind:'schema',fields:{epochMillis:{kind:'scalar',name:'EpochMillis'}}};
const program=check(`data first=context! { epoch_millis: Context::Now };data second=context! { epoch_millis: Context::Now };answer tree! {Answer [UseValue(ref = first.epoch_millis),UseValue(ref = second.epoch_millis)]};`,undefined,{contextType});
assert.equal(captures,0);
const execution={get context(){captures++;return {epochMillis:captures*1000};}};
assert.equal(resolve(program,db,{},execution).answer,'*1000*\n\n*1000*');
assert.equal(captures,1);
assert.equal(resolve(program,db,{},execution).answer,'*2000*\n\n*2000*');
assert.equal(captures,2);
const {model,stats}=createFixtureModel();
const query=check(`data rows=query_remote! {let a=from(ic::DeviceKpi);let result=project({cpu:a.cpu_usage});result |> order_by(desc(result.cpu)) |> take(1)};answer tree! {Answer [Table(data = rows),Table(data = rows)]};`,model);
assert.equal(stats.checks,1); // No database exists yet: check only obtains the model proof.
db.exec('CREATE TABLE devices(id TEXT,name TEXT,cpu REAL,tenant TEXT);INSERT INTO devices VALUES(\'a\',\'A\',80,\'t\')');
const result=resolve(query,db);
assert.equal(result.queries,1); // Both consumers share the data node's result.
assert.equal(stats.checks,1); // Resolve binds the checked plan, without proving it again.
for(const [source,message]of [
 ['data x=query {};',/Use query! \{/],
 ['data x=query({});',/Use query! \{/],
 ['data x=context();',/Use context!/],
 ['data x=query_remote {};',/Use query_remote! \{/],
 ['data x=query_remote({});',/Use query_remote! \{/],
 ['data x=time_context!(1);',/Use context!/]
] as const)assert.throws(()=>check(source),message);
db.close();
console.log('Effect macros: explicit syntax, check without acquisition, one context snapshot per resolve and shared query data node passed');
