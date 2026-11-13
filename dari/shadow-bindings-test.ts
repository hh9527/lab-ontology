import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {createFixtureModel} from './fixture-model.ts';
const db=new DatabaseSync(':memory:');
const prefix='data input=table([{n:1},{n:2},{n:3}]);';
function local(body:string){return resolve(check(prefix+`data result=query! {${body}};answer tree! {Answer [Table(data =result)]};`),db).values.result;}
try{
 assert.deepEqual(local(`let r=from(input);let r=r |> filter(r.n>1);let old=r;let r=r |> project({text:"new"}).as!(out);r |> order_by(asc(r.text)) |> take(2)`),[{text:'new'},{text:'new'}]);
 assert.deepEqual(local(`let r=from(input);let old=r;let r=r |> filter(r.n>1);old |> project({n:old.n}).as!(sorted) |> order_by(asc(sorted.n)) |> take(3)`),[{n:1},{n:2},{n:3}]);
 assert.deepEqual(local(`from(input).as!(r) |> filter(r.n>1).as!(r) |> project({n:r.n+10}).as!(r) |> order_by(desc(r.n)) |> take(2)`),[{n:13},{n:12}]);
 assert.deepEqual(local(`let r=from(input).as!(r);let saved=r;let r=r |> project({text:"new"}).as!(r);saved |> project({n:saved.n}).as!(sorted) |> order_by(asc(sorted.n)) |> take(3)`),[{n:1},{n:2},{n:3}]);
 assert.deepEqual(local(`let r=from(input);r.as!(r) |> project({n:r.n}).as!(r) |> order_by(asc(r.n)) |> take(1)`),[{n:1}]);
 const global=`data n=2;data r=table([{n:1},{n:2},{n:3}]);data result=query! {let r=from(r);let n=n+1;r |> filter(r.n<n) |> project({n:r.n}).as!(r) |> order_by(asc(r.n)) |> take(3)};answer tree! {Answer [Table(data =result)]};`;
 assert.deepEqual(resolve(check(global),db).values.result,[{n:1},{n:2}]);
 assert.throws(()=>local(`let r=r |> project({n:r.n}).as!(out);r`),/Unknown relation binding/);
 const {model}=createFixtureModel();
 db.exec("CREATE TABLE devices(id TEXT,name TEXT,tenant TEXT,cpu REAL);INSERT INTO devices VALUES('a','Alpha','t',10),('b','Beta','t',20)");
 const remote=(body:string)=>check(`data result=query_remote! {${body}};answer tree! {Answer [Table(data =result)]};`,model);
 const plain=remote(`let r=from(ic::DeviceKpi);let r=r |> filter(r.name!="Alpha");let r=r |> project({name:r.name,cpu:r.cpu_usage}).as!(out);r |> order_by(desc(r.cpu)) |> take(2)`);
 const sugar=remote(`from(ic::DeviceKpi).as!(r) |> filter(r.name!="Alpha").as!(r) |> project({name:r.name,cpu:r.cpu_usage}).as!(r) |> order_by(desc(r.cpu)) |> take(2)`);
 assert.equal(show(plain.bindings.get('result')!.type),show(sugar.bindings.get('result')!.type));
 assert.deepEqual(resolve(plain,db).values.result,resolve(sugar,db).values.result);
 assert.deepEqual(resolve(plain,db).values.result,[{name:'Beta',cpu:20}]);
 console.log('Lexical shadow: local/remote let and as!, type changes, branch snapshots, global captures and equivalent plans passed');
}finally{db.close();}
