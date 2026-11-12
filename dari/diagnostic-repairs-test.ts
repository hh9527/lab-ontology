import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {DiagnosticFailure} from './src/diagnostics.ts';
const failure=(source:string)=>{try{check(source,undefined,{allowTestSources:true});assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);return e;}};
const prefix='type Row=Schema({x:Option(Int)});data src:Table(Row)=source("samples");';
const query=(predicate:string)=>prefix+'data rows=query! {let a=from(src);let chosen=a |> filter('+predicate+');let result=chosen |> project({x:chosen.x});result |> order_by(asc(result.x)) |> take(10)};answer tree! {Answer [UseTable(ref = rows)]};';
const nullable=failure(query('a.x > 1'));
assert.equal(nullable.diagnostics[0].code,'nullable-predicate');
assert.match(nullable.message,/原因：可空/);
assert.match(nullable.message,/coalesce\(\(a.x > 1\), False\)/);
assert.match(nullable.message,/仅当空值应表示不满足/);
assert(!nullable.message.includes('r0.x'));assert(!nullable.message.includes('??'));
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE samples(x INTEGER);INSERT INTO samples VALUES(NULL),(2)');
assert.equal(resolve(check(query('coalesce(a.x > 1, False)'),undefined,{allowTestSources:true}),db).values.rows.length,1);
assert.equal(resolve(check(query('coalesce(a.x > 1, True)'),undefined,{allowTestSources:true}),db).values.rows.length,2);
const scalar=failure(prefix+'data request:Schema({x:Option(Int)})=input();data bad:Int=request.x;answer tree! {Answer []};');
assert.equal(scalar.diagnostics[0].code,'nullable-value');assert.match(scalar.message,/expects Int; got Option\(Int\)/);
const nonBool=failure(query('a.x'));
assert.equal(nonBool.diagnostics[0].code,'predicate-type');assert(!nonBool.message.includes('coalesce('));
const coalesce=failure('data bad=coalesce(1,0);answer tree! {Answer []};');
assert.equal(coalesce.diagnostics[0].code,'coalesce-types');assert.match(coalesce.message,/已经是非空值/);
const operation=failure('data bad=Percent(12.0)+Percent(2.0);answer tree! {Answer []};');
assert.equal(operation.diagnostics[0].code,'business-operation');assert.match(operation.message,/不剥离类型/);
const order=failure('data src=table([{x:1},{x:2}]);data rows=query! {let a=from(src);a |> take(1)};answer tree! {Answer []};');
assert.equal(order.diagnostics[0].code,'ordering-required');assert(!order.message.includes('out.field'));
assert.equal(failure('data bad=to_datetime_utc(42);answer tree! {Answer []};').diagnostics[0].code,'time-semantics');
const input=check('data request:Schema({n:Int})=input();answer tree! {Answer [Value(value = request.n)]};');
assert.throws(()=>resolve(input,db,{request:{n:'bad'}}),(error:Error)=>{assert.match(error.message,/SubmitFailed/);assert.match(error.message,/\[request\]/);assert.match(error.message,/原因：运行期输入/);return true;});
db.close();
const grouped=(body:string)=>'data src=table([{id:1},{id:2}]);data total=query! {let r=from(src);'+body+'};answer tree! {Answer []};';
for(const body of ['let g=group_by(r,{});g |> project({n:count()})','group_by(r,{}) |> project({n:count()})']){
 const error=failure(grouped(body));
 assert.equal(error.diagnostics[0].code,'group-by-input');
 assert.match(error.message,/r \|> group_by\(\{key: r.field\}\)/);
 assert.match(error.message,/r \|> project\(\{n: count\(\)\}\)/);
 assert(!error.message.includes('@local/'));
 assert(!error.message.includes('is not an input'));
}
for(const args of ['r.id','r,{}','']){
 const error=failure(grouped('r |> group_by('+args+') |> project({n:count()})'));
 assert.equal(error.diagnostics[0].code,'group-by-keys');
 assert.match(error.message,/唯一参数/);
}
const countDb=new DatabaseSync(':memory:');
const unusedGroup=failure(grouped('let g=r |> group_by({id:r.id});r |> project({id:r.id,n:count()})'));
assert.equal(unusedGroup.diagnostics[0].code,'ungrouped-column');
assert.match(unusedGroup.message,/Ungrouped column r.id/);
assert.match(unusedGroup.message,/从 g \|> project/);
assert(!unusedGroup.message.includes('r0.id'));
const countSource=grouped('r |> project({n:count()})').replace('Answer []','Answer [UseTable(ref = total)]');
assert.equal(resolve(check(countSource),countDb).values.total[0].n,2);
countDb.close();
const numericText=check('answer tree! {Answer [p ["告警 1094 条", "普通文字", Lit(value = "最近 3 天")]]};');
assert.equal(numericText.warnings.length,1);
assert.equal(numericText.warnings[0].code,'numeric-text');
assert.equal(numericText.warnings[0].at,'answer tree! {Answer [p ['.length);
assert.match(numericText.warnings[0].suggestion!,/Value/);
assert.match(numericText.warnings[0].suggestion!,/Lit\(value = "告警 1094 条"\)/);
assert.equal(check('answer tree! {Answer [Lit(value = "最近 3 天")]};').warnings.length,0);
for(const text of ['Lit "最近 3 天"','Lit("最近 3 天")','Lit(text = "最近 3 天")']){
 const error=failure('answer tree! {Answer ['+text+']};');
 assert.match(error.message,/修复建议：固定文案写 Lit\(value =/);
}
console.log('Diagnostic repairs: structured causes, exact original predicate, executable fixes, policy choices and located runtime errors passed');
