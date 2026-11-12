import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE a(id INTEGER,g TEXT,n INTEGER); CREATE TABLE b(id INTEGER,g TEXT,n INTEGER)');
const insertA=db.prepare('INSERT INTO a VALUES(?,?,?)'),insertB=db.prepare('INSERT INTO b VALUES(?,?,?)');
for(let i=0;i<1200;i++)insertA.run(i,'g'+i%3,i);
for(let i=600;i<1800;i++)insertB.run(i,'g'+i%3,i);
const prefix='type R=Schema({id:Int,g:String,n:Int});data a:Table(R)=source("a");data b:Table(R)=source("b");';
function run(body:string){return resolve(check(prefix+body,undefined,{allowTestSources:true}),db);}
for(const [op,total]of [['union',1800],['union_all',2400],['intersect',600],['except',600]]as const){
 const result=run(`data combined=query! {let l=from(a);let r=from(b);${op}({l,r})};data total=query! {let x=from(combined);x |> project({n:count()}) |> take_opt()};answer tree! { Answer [Value(data = total,field = project!(n))]};`);
 assert.equal(result.answer,'*'+total+'*');assert.equal(result.queries,1);
}
for(const [op,total]of [['semi_join',600],['anti_join',600]]as const){
 const result=run(`data matched=query! {let l=from(a);let r=from(b);${op}({l,r},l.id == r.id) |> project({id:l.id})};data total=query! {let x=from(matched);x |> project({n:count()}) |> take_opt()};answer tree! { Answer [Value(data = total,field = project!(n))]};`);
 assert.equal(result.answer,'*'+total+'*');
}
const top=run('data rows=query! {let r=from(a);r |> top_per({g:r.g},desc(r.n),1) |> project({g:r.g,n:r.n}) |> order_by(asc(out.g)) |> take(10)};answer tree! { Answer [UseTable(ref = rows)]};');
assert.deepEqual(top.values.rows.map((r:any)=>r.n),[1197,1198,1199]);
const dedup=run('data rows=query! {let r=from(a);r |> project({g:r.g}) |> distinct() |> order_by(asc(out.g)) |> take(10)};answer tree! { Answer [UseTable(ref = rows)]};');
assert.equal(dedup.values.rows.length,3);
assert.throws(()=>check(prefix+'answer tree! { Answer [UseTable(ref = a)]};',undefined,{allowTestSources:true}),/proven bound/);
assert.equal(run('data empty=is_empty(a);answer tree! { Answer [Value(value = empty)]};').answer,'*false*');
db.close();console.log('unmaterialized SQL DAG: union/all/intersect/except, semi/anti joins, distinct, partition Top-N and delivery bounds passed');
