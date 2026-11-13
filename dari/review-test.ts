import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {createFixtureModel} from './fixture-model.ts';
const {model}=createFixtureModel();
const source=readFileSync(new URL('./examples/device.dari',import.meta.url),'utf8');
for(const change of [
 (fields:any)=>({renamed:fields.device,cpu:fields.cpu}),
 (fields:any)=>({...fields,cpu:{kind:'scalar',name:'String'}}),
 (fields:any)=>({...fields,cpu:{kind:'option',inner:fields.cpu}}),
 (fields:any)=>({cpu:fields.cpu,device:fields.device}),
])assert.throws(()=>check(source,{...model,check_type(intent,encoded){const result=model.check_type(intent,encoded);return {...result,element:{kind:'schema',fields:change(result.element.fields)}};}}),/result Schema does not match/);
let supplied=false;
check(source,{...model,check_type(intent,encoded){assert(encoded);supplied=true;return model.check_type(intent,encoded);}});
assert(supplied);
const db=new DatabaseSync(':memory:');
try{
 db.exec("CREATE TABLE a(id INTEGER, tenant TEXT); INSERT INTO a VALUES(1,NULL),(2,'x'); CREATE TABLE b(id INTEGER, tenant TEXT); INSERT INTO b VALUES(10,NULL),(20,'x')");
 const source=`type Row = Schema({id:Int,tenant:Option(String)});
 data aa: Table(Row) = source("a"); data bb: Table(Row) = source("b");
 data rows = query! {let l = from(aa);let r = from(bb);
 join({l,r}, unwrap_or!(l.tenant, "") == unwrap_or!(r.tenant, ""))
 |> project({id:l.id,peer:r.id}) |> order_by(asc(out.id)) |> take(10)};
 answer tree! { Answer [Table(data = rows)]};`;
 assert.deepEqual(resolve(check(source,undefined,{allowTestSources:true}),db).values.rows,[{id:1,peer:10},{id:2,peer:20}]);
 assert.throws(()=>check(source.replace('|> project({id:l.id,peer:r.id}) |> order_by(asc(out.id))','|> order_by(asc(l.id))'),undefined,{allowTestSources:true}),/join requires project/);
}finally{db.close();}
console.log('review contracts and joins: passed');
