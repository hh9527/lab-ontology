import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openModel} from './model-bridge.ts';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try {
 db.exec('CREATE TABLE T_CURRENT_ALARM(CSN INTEGER,ALARMNAME TEXT)');
 const insert=db.prepare('INSERT INTO T_CURRENT_ALARM VALUES(?,?)');
 for(let i=0;i<1200;i++)insert.run(i,(i%2?'Edge':'Core')+'-'+i);
 const answer='answer tree! {Answer [if let Some(row)=total [UseValue(ref=row.n)] else ["无数据"]]};';
 const aggregate=(filter='')=>'data total=query_remote! {let f=from(ic::current_alarm);let rows=f '+filter+' |> project({n:f.alarm_count});rows |> take_opt()};';
 const all=resolve(check(aggregate()+answer,host.model),db);
 assert.equal(all.answer,'*1200*');assert.equal(all.queries,1);
 for(const [predicate,n]of [['contains(f.alarm_name,"CORE")',600],['not_contains(f.alarm_name,"core")',600],['starts_with(f.alarm_name,"edge")',600],['ends_with(f.alarm_name,"19")',12]]as const){
  assert.equal(resolve(check(aggregate('|> filter('+predicate+')')+answer,host.model),db).answer,'*'+n+'*');
 }
 const unbounded='data population=query_remote! {let f=from(ic::current_alarm);f |> project({name:f.alarm_name})};';
 assert.throws(()=>check(unbounded+answer,host.model),/Remote query data node requires a proven result bound/);
 const bounded='data population=query_remote! {let f=from(ic::current_alarm);let rows=f |> project({name:f.alarm_name});rows |> order_by(asc(rows.name)) |> take(20)};';
 const doubled=bounded+'data doubled=query! {let a=from(population);let b=from(population);a |> union_all(b)};data total=query! {let r=from(doubled);r |> project({n:count()}) |> take_opt()};'+answer;
 assert.equal(resolve(check(doubled,host.model),db).answer,'*40*');
 console.log('Real IC: full-population aggregate/filter, strict remote boundary and bounded remote/local union composition passed');
} finally {db.close();await host.close();}
