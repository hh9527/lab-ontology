import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const {dariHost}=await import(new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href);
const db=new DatabaseSync(':memory:');
try{
 const source=`data share=ratio(12,100);
 data growth=growth_rate(112,100);
 data zero=ratio(1,0);
 data invalid_growth=growth_rate(1,0);
 data gap=difference(Ratio(0.25),Ratio(0.12));
 data src=table([{part:12,total:100},{part:1,total:0}]);
 data shares=query! {from(src).as!(r) |> project({share:ratio(r.part,r.total)})};
 data rounded=query! {from(shares).as!(r) |> project({share:round(r.share,2)})};
 data average=query! {from(rounded).as!(r) |> project({share:avg(r.share)})};
 answer tree! {Answer [UseValue(ref =share),UseValue(ref =growth),UseValue(ref =gap),UseValue(ref =zero),UseValue(ref =invalid_growth),Table(data=rounded,spec={columns:["share"]})]};`;
 const program=check(source,undefined,{host:dariHost});
 for(const name of ['share','growth','zero','invalid_growth'])assert.equal(show(program.bindings.get(name)!.type),'Option(Ratio)');
 assert.equal(show(program.bindings.get('gap')!.type),'Ratio');
 for(const name of ['shares','rounded','average'])assert.equal(show(program.bindings.get(name)!.type),'Table(Schema({share: Option(Ratio)}))');
 const result=resolve(program,db);
 assert.equal(result.values.share,0.12);assert.equal(result.values.zero,null);assert.equal(result.values.invalid_growth,null);
 assert.deepEqual(result.values.rounded,[{share:0.12},{share:null}]);
 assert.match(result.answer,/12%/);assert.match(result.answer,/13%/);
 assert.throws(()=>check('data p=ratio(12,100);data n=unwrap_or!(p,Ratio(0.0))+Ratio(0.1);answer tree! {Answer []};'),/does not allow Add/);
 assert.throws(()=>check('data a=table([{p:Ratio(0.1)}]);data b=query! {from(a).as!(r) |> project({p:sum(r.p)})};answer tree! {Answer []};'),/does not allow Sum/);
 console.log('Ratio types: scalar and SQL inference, nulls, projection/round/mean retention, percentage display and operator restrictions passed');
}finally{db.close();}
