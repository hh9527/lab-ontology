import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const payload={kind:'schema',fields:{item:{kind:'option',inner:{kind:'schema',fields:{nested:{kind:'schema',fields:{value:{kind:'option',inner:{kind:'scalar',name:'Int'}}}}}}}}};
const host={contractId:'selector-test',types:{Payload:payload},components:[],functions:{},reportStyle:'',checkFigure(){},renderFigure(){return {kind:'table' as const,content:''};}};
const source='data request:Payload=input();data selected=map_opt(request.item,$.nested.value);answer tree! {Answer [UseValue(ref=selected)]};';
const db=new DatabaseSync(':memory:');
try{
 const nullableHost={...host,types:{Payload:{...payload,fields:{item:{kind:'option',inner:{kind:'schema',fields:{nested:{kind:'option',inner:{kind:'schema',fields:{value:{kind:'scalar',name:'Int'}}}}}}}}}}};
 assert.throws(()=>check(source,undefined,{host:nullableHost}),/Cannot project value on Option/);
 const shortSource=source.replace('$.nested.value','$.nested?.value');
 const short=check(shortSource,undefined,{host:nullableHost});
 assert.equal(show(short.bindings.get('selected')!.type),'Option(Int)');
 for(const [item,value]of [[{nested:{value:42}},42],[{nested:null},null],[null,null]])assert.equal(resolve(short,db,{request:{item}}).values.selected,value);
 assert.throws(()=>check(shortSource,undefined,{host}),/requires Option/);
 const nullableLeafHost={...nullableHost,types:{Payload:structuredClone(nullableHost.types.Payload)}};
 nullableLeafHost.types.Payload.fields.item.inner.fields.nested.inner.fields.value={kind:'option',inner:{kind:'scalar',name:'Int'}};
 assert.equal(show(check(shortSource,undefined,{host:nullableLeafHost}).bindings.get('selected')!.type),'Option(Int)');
 assert.equal(resolve(check(shortSource,undefined,{host:nullableLeafHost}),db,{request:{item:{nested:{value:null}}}}).values.selected,null);
 const p=check(source,undefined,{host});
 assert.equal(show(p.bindings.get('selected')!.type),'Option(Int)');
 for(const [item,value]of [[{nested:{value:42}},42],[{nested:{value:null}},null],[null,null]])assert.equal(resolve(p,db,{request:{item}}).values.selected,value);
 assert.throws(()=>check(source.replace('$.nested.value','$.nested.missing'),undefined,{host}),/Unknown field missing/);
 assert.throws(()=>check(source.replace('$.nested.value','$.nested.value.extra'),undefined,{host}),/Cannot project extra/);
 assert.throws(()=>check(source.replace('$.nested.value','project!(value)'),undefined,{host}),/Unknown macro/);
}finally{db.close();}
console.log('Selectors: nested typed paths, optional leaves, null rows and invalid paths passed');
