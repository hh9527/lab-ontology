import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openModel} from './model-bridge.ts';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try {
 db.exec('CREATE TABLE I_EnterpriseFrame(name TEXT)');
 const insert=db.prepare('INSERT INTO I_EnterpriseFrame VALUES(?)');
 for(let i=0;i<1200;i++)insert.run((i%2?'Edge':'Core')+'-'+i);
 const prefix='data population=query_remote! {let f=from(ic::frame);f |> project({name:f.frame_name})};';
 const answer='answer tree! { Answer [Value(data = total,field = project!(n))]};';
 const aggregate='data total=query! {let r=from(population);r |> project({n:count()}) |> take_opt()};';
 const all=resolve(check(prefix+aggregate+answer,host.model),db);
 assert.equal(all.answer,'*1200*');assert.equal(all.queries,1);
 for(const [predicate,n] of [['contains(f.frame_name,"CORE")',600],['not_contains(f.frame_name,"core")',600],['starts_with(f.frame_name,"edge")',600],['ends_with(f.frame_name,"19")',12]] as const){
  const text=prefix.replace('f |> project','f |> filter('+predicate+') |> project');
  const output=resolve(check(text+aggregate+answer,host.model),db);
  assert.equal(output.answer,'*'+n+'*');assert.equal(output.queries,1);
 }
 const doubled=prefix+'data doubled=query! {let a=from(population);let b=from(population);union_all({a,b})};'+aggregate.replace('from(population)','from(doubled)')+answer;
 assert.equal(resolve(check(doubled,host.model),db).answer,'*2400*');
 assert.throws(()=>check(prefix+'answer tree! { Answer [UseTable(ref = population)]};',host.model),/proven bound/);
 assert.throws(()=>check(prefix.replace('project({name:f.frame_name})','project({name:f.frame_name}) |> order_by(asc(out.name))')+aggregate+answer,host.model),/terminal take/);
 console.log('real IC: unbounded query composition, 1200-row aggregation, 2400-row union, model text filters and presentation bound passed');
} finally {db.close();await host.close();}
