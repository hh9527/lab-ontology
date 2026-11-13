import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,type Type} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {createFixtureModel} from './fixture-model.ts';
const {model}=createFixtureModel();
function enumeration(name:string,order:string[]):Type{
 const variants=['Zed','Alpha'];
 const parse=(value:unknown)=>{const tag=typeof value==='string'?value:(value as {tag?:string})?.tag;if(!variants.includes(tag!))throw Error('Invalid enum');return {tag};};
 return {kind:'nominal',name,inner:{kind:'scalar',name:'String'},codec:{variants,order,parse,encode:v=>parse(v).tag,decode:parse}};
}
model.types!['ic::Unordered']=enumeration('ic::Unordered',[]);
model.types!['ic::Ordered']=enumeration('ic::Ordered',['Zed','Alpha']);
const program=(kind:string,term:string)=>`type Row = Schema({raw:String,kind:ic::${kind}});
data src:Table(Row)=source("devices");
data rows=query! {let a=from(src);a |> project({raw:a.raw,kind:a.kind}) |> order_by(asc(out.${term})) |> take(10)};
answer tree! {Answer [Table(data = rows)]};`;
assert.throws(()=>check(program('Unordered','kind'),model,{allowTestSources:true}),/has no declared business ordering/);
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE devices(raw TEXT,kind TEXT);INSERT INTO devices VALUES ('b','Zed'),('a','Alpha')");
const ordered=resolve(check(program('Ordered','kind'),model,{allowTestSources:true}),db).values.rows;
assert.deepEqual(ordered.map((r:any)=>r.kind.tag),['Zed','Alpha']);
const raw=resolve(check(program('Unordered','raw'),model,{allowTestSources:true}),db).values.rows;
assert.deepEqual(raw.map((r:any)=>r.raw),['a','b']);
db.close();console.log('Local semantic ordering: unordered enum rejected, explicit business order applied, raw String ordering independent');
