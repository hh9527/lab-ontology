import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
let calls=0;
const host={contractId:'unwrap-test',components:[],reportStyle:'',checkFigure(){},renderFigure(){return {kind:'table' as const,content:''};},functions:{fallback:{sql:{},check(){return {kind:'scalar',name:'Int'};},run(){calls++;return 7;}}}};
try{
 for(const expr of ['unwrap_or!(request.n, fallback())','request.n.unwrap_or!(fallback())']){
  const program=check(`data request:Schema({n:Option(Int)})=input();data prepared={n:${expr}};answer tree! {Answer [UseValue(ref=prepared.n)]};`,undefined,{host});
  calls=0;assert.equal(resolve(program,db,{request:{n:42}}).answer,'*42*');assert.equal(calls,0);
  assert.equal(resolve(program,db,{request:{n:null}}).answer,'*7*');assert.equal(calls,1);
 }
 db.exec('CREATE TABLE sample(n INTEGER);INSERT INTO sample VALUES(42)');
 const program=check('data src:Table(Schema({n:Option(Int)}))=source("sample");data rows=query! {from(src).as!(r) |> project({n:r.n.unwrap_or!(fallback())}).as!(result) |> order_by(desc(result.n)) |> take(10)};answer tree! {Answer [Table(data =rows)]};',undefined,{host,allowTestSources:true});
 calls=0;assert.deepEqual(resolve(program,db).values.rows,[{n:42}]);assert.equal(calls,0);db.exec('INSERT INTO sample VALUES(NULL)');assert.deepEqual(resolve(program,db).values.rows,[{n:42},{n:7}]);assert(calls>0);assert.equal(show(program.bindings.get('rows')!.type),'Table(Schema({n: Int}))');
 assert.throws(()=>check('data x=ratio(1,2).unwrap_or!(0.0);answer tree! {Answer []};'),/Option\(T\) and T/);
 assert.throws(()=>check('data x=1.unwrap_or!(2);answer tree! {Answer []};'),/Option\(T\) and T/);
 assert.throws(()=>check('data x=unwrap_or!(ratio(1,2),Ratio(0.0),Ratio(1.0));answer tree! {Answer []};'),/value and fallback/);
 assert.throws(()=>check('data x=unwrap_or(ratio(1,2),Ratio(0.0));answer tree! {Answer []};'),/macro syntax/);
 assert.throws(()=>check('data x=coalesce(ratio(1,2),Ratio(0.0));answer tree! {Answer []};'),/Unknown built-in/);
 for(const ref of ['42','1 + 2','ratio(1,2).unwrap_or!(Ratio(0.0))'])assert.throws(()=>check(`answer tree! {Answer [UseValue(ref=${ref})]};`),/direct scalar reference/);
 assert.throws(()=>check('data x=42;answer tree! {Answer [Value(value=x)]};'),/Unknown component/);
 assert.throws(()=>check('data x={n:42};answer tree! {Answer [UseValue(ref=x)]};'),/logical scalar reference/);
 console.log('unwrap_or!: prefix/postfix, lazy scalar and SQL fallback, nominal types, strict UseValue refs passed');
}finally{db.close();}
