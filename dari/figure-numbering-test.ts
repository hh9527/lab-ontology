import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const {dariHost}=await import(new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href);
const db=new DatabaseSync(':memory:');
try{
 const chart='BarChart(data=rows,spec={category:$.label,value:$.value,title:"数量"})';
 const table='Table(data=rows,spec={columns:["label","value"]})';
 const source=`data rows=table([{label:"a",value:1}]);
 report first=tree! {Report [${chart},${table},if False [${chart}] else [],${chart},${table}]};
 report second=tree! {Report [${chart}]};
 answer tree! {Answer [${chart},UseReport(ref=first),UseReport(ref=second),${table},if False [${chart}] else [],${chart},Table(data =rows)]};`;
 const result=resolve(check(source,undefined,{host:dariHost}),db);
 assert.match(result.answer,/图 1：数量/);assert.match(result.answer,/图 2：数量/);
 assert.match(result.answer,/表 1/);assert.match(result.answer,/表 2/);
 assert(!result.answer.includes('图 3'));
 const first=result.artifacts['first.html'];
 for(const label of ['图 1','图 2','表 1','表 2'])assert(first.includes('class="item-no">'+label+'</span>'));
 assert(!first.includes('class="item-no">图 3'));
 assert(result.artifacts['second.html'].includes('class="item-no">图 1</span>'));
 console.log('Figure numbering: independent Answer/Report scopes, separate chart/table sequences and selected branches passed');
}finally{db.close();}
