import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';
import {infoContracts} from './info-contract.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 const percent=host.model.types!['ic::Percent'],ratio=host.model.types!['ic::Ratio'];
 assert(percent);assert(ratio);
 const allowed=['Compare','Mean','Min','Max','Round','Difference','Ratio','GrowthRate'];
 assert.deepEqual(percent.codec!.operations,allowed);assert.deepEqual(ratio.codec!.operations,allowed);
 assert.deepEqual(host.model.types!['ic::CpuFloor'].codec!.operations,allowed);
 assert(!Object.keys(host.model.types!).some(name=>/ReportedPercent|AssumedOnlinePercent|ReportedOnlinePercent|AssumedCpuPercent|::Fraction$/.test(name)));
 const metricNames=['CpuUtilization','MemoryUtilization','OnlineProportion'].map(suffix=>Object.keys(host.model.types!).find(name=>name.endsWith('::'+suffix))!);
 assert(metricNames.every(Boolean),'All business metric codecs must be published');
 for(const name of metricNames)assert.deepEqual(host.model.types![name].codec!.operations,allowed);
 assert.throws(()=>check('data a='+metricNames[0]+'(20.0);data b='+metricNames[1]+'(10.0);data bad=a>b;answer tree! { Answer []};',host.model),/Cannot compare/);
 assert.deepEqual(percent.presentation,{multiplier:1,suffix:'%'});
 assert.deepEqual(ratio.presentation,{multiplier:100,suffix:'%'});
 assert.deepEqual(host.model.types![metricNames[0]].presentation,{multiplier:1,suffix:'%',precision:2});
 const displayed=resolve(check('data r=ic::Ratio(0.12);data p=ic::Percent(12.0);data rows=table([{r:r}]);data single=query! {let a=from(rows);a |> project({r:avg(a.r)}) |> take_opt()};answer tree! { Answer [UseValue(ref = r),UseValue(ref = p),if let Some(value_row) = single [UseValue(ref = value_row.r)] else ["无数据"]]};',host.model),db);
 assert.equal((displayed.answer.match(/12%/g)??[]).length,3);
 assert.equal(ratio.codec!.encode(0.12),0.12);
 const prefix='data a=ic::Percent(20.0);data b=ic::Percent(10.0);';
 for(const expression of ['a+b','a-b','a*b','a/b','-a','a*1.0']){
  assert.throws(()=>check(prefix+'data bad='+expression+';answer tree! { Answer []};',host.model),/does not allow/);
 }
 assert.throws(()=>check(prefix+'data rows=table([{v:a},{v:b}]);data bad=query! {let r=from(rows);r |> project({v:sum(r.v)})};answer tree! { Answer []};',host.model),/does not allow Sum/);
 const program=check(prefix+`
 data rows=table([{v:a},{v:b}]);
 data stats=query! {let r=from(rows);r |> project({mean:avg(r.v),lo:min(r.v),hi:max(r.v)}) |> take_opt()};
 data delta=difference(a,b);
 data relative=ratio(a,b);
 data growth=growth_rate(a,b);
 data rounded=round(a,1);
 data compared=a>b;
 answer tree! { Answer [UseValue(ref = delta),if let Some(value_row) = stats [UseValue(ref = value_row.mean)] else ["无数据"]]};`,host.model);
 assert.equal(show(program.bindings.get('delta')!.type),'Percent');
 assert.equal(show(program.bindings.get('relative')!.type),'Option(Ratio)');
 assert.equal(show(program.bindings.get('rounded')!.type),'Percent');
 const result=resolve(program,db);assert.match(result.answer,/10/);assert.match(result.answer,/15/);
 const info=infoContracts(host.model,[{id:'types/percent',kind:'Ty',type:percent.name}]);
 assert.deepEqual((info['types/percent'] as any).calculations,allowed);
 console.log('Numeric policies: actual model capabilities, restricted arithmetic/aggregation, allowed statistics/comparison, derived result types, SQL execution and info publication passed');
}finally{db.close();await host.close();}
