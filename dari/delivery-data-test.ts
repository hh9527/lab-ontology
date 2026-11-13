import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const {dariHost}=await import('../../dsh-oks/packages/dsh-oks/src/dari-host.ts');
const db=new DatabaseSync(':memory:');
const source=`data rows:Table(Schema({name:String,ratio:Ratio,secret:String}))=table([{name:"A",ratio:Ratio(0.12),secret:"HIDDEN"}]);
data total=12;
data detail={count:7};
data unused_value=999;
report unused=tree! {Report [UseValue(ref = unused_value)]};
report shown=tree! {Report [BarChart(data=rows,spec={category:$.name,value:$.ratio}),Table(data =rows),UseValue(ref =total),UseValue(ref =detail.count),UseValue(ref =total)]};
answer tree! {Answer [UseValue(ref =total),UseValue(ref =detail.count),UseReport(ref=shown),UseReport(ref=shown),if False [UseValue(ref = unused_value)] else []]};`;
try{
 let renders=0;
 const host={...dariHost,renderFigure(...args:Parameters<typeof dariHost.renderFigure>){renders++;return dariHost.renderFigure(...args);}};
 const result=resolve(check(source,undefined,{host}),db);
 assert.equal(renders,2);assert.equal(result.queries,0);
 assert.match(result.dataDocument,/## answer\/values\n\n- total: 12\n- detail.count: 7/);
 assert.match(result.dataDocument,/## reports\/shown\/figures\/1\n\n```csv\nname,ratio \(%\)\nA,12/);
 assert.match(result.dataDocument,/## reports\/shown\/tables\/1/);
 assert.match(result.dataDocument,/## report\/shown\/values\n\n- total: 12\n- detail.count: 7/);
 assert.equal(result.dataDocument.split('## report/shown/values').length,2);
 assert.equal(result.dataDocument.split('- total: 12').length,3);
 assert(!/999|123456|<svg|<html/.test(result.dataDocument));
 const csv=result.dataDocument.split('```csv')[1].split('```')[0];assert(!csv.includes('secret'));assert(!csv.includes('HIDDEN'));
 assert.match(result.deliveryId,/^[a-f0-9-]{36}$/);
 console.log('Delivery data: shared evaluation, displayed scope, CSV scale, table, values and dedup passed');
}finally{db.close();}
