import assert from 'node:assert/strict';
import {check,type Type} from './src/compiler.ts';
import {createFixtureModel} from './fixture-model.ts';
const {model}=createFixtureModel();
const kind:Type={kind:'nominal',name:'test::Kind',inner:{kind:'scalar',name:'String'},codec:{variants:['Olt','Onu'],order:[],parse:v=>v,encode:v=>v,decode:v=>v}};
model.types!['ic::Kind']=kind;
const dataset=model.datasets['ic::DeviceKpi'];
dataset.members.class={kind:'dimension',id:'class',symbol:'class',owner:dataset.id,type:kind};
let calls=0,captured:any;
model.check_type=(_intent,encoded)=>{calls++;captured=JSON.parse(encoded.json);throw Error('model-boundary');};
const source=(predicate:string)=>`data rows=query_remote! {let a=from(ic::DeviceKpi);a |> filter(${predicate}) |> project({name:a.name}) |> order_by(asc(out.name)) |> take(10)};answer tree! {Answer [Table(data = rows)]};`;
for(const [predicate,op]of [['a.class == ic::Kind::Olt','Eq'],['ic::Kind::Olt != a.class','Ne']]){
 assert.throws(()=>check(source(predicate),model),/model-boundary/);
 assert.deepEqual(captured.steps[0].body,{kind:'mapped_comparison',value:{kind:'member',node:captured.nodes[0].id,member:'class'},logical:'test::Kind',member:'Olt',op});
}
const previous=calls;
assert.throws(()=>check(source('a.name == ic::Kind::Olt'),model),/same business type/);
assert.throws(()=>check(source('a.class == "Olt"'),model),/same business type/);
assert.equal(calls,previous,'cross-type comparisons must fail before the model port');
console.log('Semantic equality: same-type Eq/Ne lowered with field identity and static variant; Raw/T mixing rejected before model proof');
