import assert from 'node:assert/strict';
import {check} from './src/compiler.ts';
import {DiagnosticFailure,modelErrorText} from './src/diagnostics.ts';
function failure(source:string){try{check(source);assert.fail('Expected diagnostics');}catch(error){assert(error instanceof DiagnosticFailure);return error;}}
const syntax=failure(`answer tree! { Answer [
 UseValue(value: concat("x)","y")),
 UseValue(value: 2),
 UseValue(value: 3)
]};`);
assert.equal(syntax.diagnostics.length,3);
assert.match(syntax.message,/CheckFailed\n-----------/);
assert.match(syntax.message,/L2:/);assert.match(syntax.message,/L3:/);assert.match(syntax.message,/L4:/);
assert.match(syntax.message,/修复建议：tree!/);
assert(!syntax.message.includes('Missing attribute'));
const semantic=failure(`data bad=missing;
data dependent=bad + 1;
data fields={a:firstMissing,b:secondMissing};
answer tree! { Answer [p [UseValue(ref = thirdMissing),UseValue(ref = fourthMissing)]]};`);
assert.equal(semantic.diagnostics.length,5);
assert(!semantic.message.includes('Unknown binding bad'));
assert(!semantic.message.includes('One data answer'));
const mixed=failure('data bad = ;\ndata valid = 42;\ndata other = notDefined;\nanswer tree! {Answer [UseValue(ref = valid)]};');
assert.equal(mixed.diagnostics.length,2);
assert(!mixed.message.includes('Unknown binding valid'));
const types=failure('type Bad=Schema({a:Missing,b:OtherMissing});data input:Bad=input();answer tree! { Answer []};');
assert.equal(types.diagnostics.length,2);
const capped=failure(Array.from({length:25},(_,i)=>'data x'+i+' = missing'+i+';').join('\n')+'\nanswer tree! {Answer []};');
assert.equal(capped.diagnostics.length,25);
assert.equal((capped.message.match(/^- L/gm)??[]).length,20);
assert.match(capped.message,/另有 5 条错误/);
assert.equal(modelErrorText(JSON.stringify([{message:'unsupported comparison',locs:[{x:1}]}])),'unsupported comparison');
check('answer tree! { Answer [p ["正常"]]};');
console.log('DARI-style diagnostics: sibling syntax recovery, independent errors, upstream suppression, text/suggestions and bounded receipts passed');

// Reproductions of the failed repair loops in the 10924 conversation.
const alias=failure('data rows=table([{v:1}]);data joined=query! {let a=from(rows);let b=from(rows);a |> join(b, a.v==b.v) |> project({v:out.v}).as!(out)};answer tree! { Answer []};');
assert.match(alias.message,/source fields: a.v, b.v/);assert.match(alias.message,/首次 project/);
const set=failure('type A=struct(Float);type B=struct(Float);data left=table([{value:A(1.0)}]);data right=table([{value:B(1.0)}]);data merged=query! {let a=from(left);let b=from(right);a |> union_all(b)};answer tree! { Answer []};');
assert.match(set.message,/value: a = A, b = B/);assert.match(set.message,/保留需要的指标/);
const {createFixtureModel}=await import('./fixture-model.ts');
const {model}=createFixtureModel();
try{check('data q=query_remote! {let alarm=from(ic::DeviceKpi);let selected=alarm |> project({tenant:alarm.tenant_name}).as!(out);selected |> order_by(asc(selected.tenant)) |> take(10)};answer tree! {Answer []};',model);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.equal(e.diagnostics[0].code,'unknown-model-member');assert.match(e.message,/alarm.tenant_name/);assert.match(e.message,/先 connect/);assert(!e.message.includes('r0.'));}
try{check('data q=query_remote! {let d=from(ic::DeviceKpi);d |> project({name:unwrap_or!(d.name,"unknown")}).as!(out) |> order_by(asc(out.name)) |> take(1)};answer tree! { Answer []};',model);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/Computed model expression unwrap_or!/);assert(!e.message.includes('Unknown binding d'));}
const mismatchModel={...model,check_type(){throw Error('filter parameter type does not match dimension');}};
const loweredSource='data q=query_remote! {let d=from(ic::DeviceKpi).as!(device);let selected=d |> filter(device.name > 1);let output=selected |> project({name:device.name}).as!(out);output |> order_by(asc(output.name)) |> take(1)};answer tree! {Answer []};';
try{check(loweredSource,mismatchModel);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/device.name expects String/);assert(!/\br\d+\./.test(e.message));assert(!e.message.includes('@local/'));}
const aliasModel={...model,check_type(){throw Error('Unsupported predicate on r0.name at node_0');}};
try{check(loweredSource,aliasModel);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/device.name/);assert(!/\b(?:r\d+|node_\d+)\b/.test(e.message));}
try{check('data q=query_remote! {let d=from(ic::DeviceKpi);d |> filter(d.name > 1) |> project({name:d.name}).as!(out) |> order_by(asc(out.name)) |> take(1)};answer tree! { Answer []};',mismatchModel);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/d.name expects String \(String\), got Int \(Int\)/);assert.equal(e.diagnostics[0].at,'data q=query_remote! {let d=from(ic::DeviceKpi);d |> filter(d.name > '.length);}
const hostModule=new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href;
const {dariHost}=await import(hostModule);
try{check('type R=Schema({x:String,n:Int});data rows:Table(R)=source("samples");answer tree! { Answer [Table(data = rows, columns = ["x"])]};',undefined,{allowTestSources:true,host:dariHost});assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/Unknown figure attribute columns/);assert.match(e.message,/proven bound/);}
console.log('Conversation diagnostics: scoped aliases, set field differences, computed model expressions, parameter locations and independent component constraints passed');
for(const operation of ['join','left_join','semi_join','anti_join','union','union_all','intersect','except']){
 const args=['union','union_all','intersect','except'].includes(operation)?'{a,b}':'{a,b},a.id==b.id';
 const result=failure(`data rows=table([{id:1}]);data bad=query! {let a=from(rows);let b=from(rows);a |> ${operation}(${args})};answer tree! { Answer []};`);
 assert.match(result.message,/supported as a query! starting expression, not after \|>/);
 assert.match(result.message,/修复建议：在 query! 中先 let a/);
 assert(!result.message.includes('Unsupported plan operation'));
}
console.log('Join and set operations in pipeline positions report supported syntax and repair guidance');

const staticSource='data rows=table([{label:"a",n:1,share:0.5}]);\nanswer tree! {Answer [\nTable(data = rows, spec = {columns:[label,n,share]})\n]};';
try{check(staticSource,undefined,{host:dariHost});assert.fail('Expected failure');}catch(e){
 assert(e instanceof DiagnosticFailure);assert.equal(e.diagnostics.length,3);
 for(const [i,name] of ['label','n','share'].entries()){
  assert.equal(e.diagnostics[i].code,'static-option');assert.equal(e.diagnostics[i].at,staticSource.indexOf(name,staticSource.indexOf('columns:[')+9));
  assert.match(e.diagnostics[i].message,new RegExp('Table.spec.columns\\['+i+'\\]'));
  assert(e.diagnostics[i].suggestion?.includes('$.'+name+''));
 }
 assert(!e.message.includes('L1:1'));
}
for(const columns of ['[$.label,$.n,$.share]','["label","n","share"]'])check(staticSource.replace('[label,n,share]',columns),undefined,{host:dariHost});
check('data ctx=context! {now:Context::Now,tz:Context::ClientTz};data days=time_windows({epoch_millis:ctx.now,time_zone:ctx.tz},{unit:TimeUnit::Day,count:3,mode:WindowMode::Complete});answer tree! {Answer []};',undefined,{host:dariHost,contextType:{kind:'schema',fields:{epochMillis:{kind:'scalar',name:'EpochMillis'},timeZone:{kind:'scalar',name:'String'}}}});
const compositeModel={...model,check_type(){throw Error('final order column node_0_name has no declared business ordering');}};
try{check(loweredSource,compositeModel);assert.fail('Expected failure');}catch(e){assert(e instanceof DiagnosticFailure);assert.match(e.message,/device.name/);assert(!e.message.includes('node_0_name'));}
console.log('Static configuration: original locations, option paths, sibling diagnostics and accepted column forms; composite model aliases passed');
