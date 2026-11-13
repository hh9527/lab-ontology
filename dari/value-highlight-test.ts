import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
try{
 const result=resolve(check(`
 data inputs=table([{n:42}]);
 data summary=query! {let r=from(inputs);r |> project({n:max(r.n)}) |> take_opt()};
 data label="<script>&\\\"";
 report report=tree! {Report [p ["Count: ",if let Some(value_row) = summary [UseValue(ref = value_row.n)] else ["无数据"]," / ",UseValue(ref =label)," literal"]]};
 answer tree! {Answer [if let Some(value_row) = summary [UseValue(ref = value_row.n)] else ["无数据"],UseReport(ref=report)]};
 `),db);
 const report=result.artifacts['report.html'];
 assert.match(report,/<span data-oks-ref="value_row.n" title="value_row.n">42<\/span>/);
 assert.match(report,/<span data-oks-ref="label" title="label">&lt;script>&amp;&quot;<\/span>/);
 assert.match(report,/ literal<\/p>/);
 assert(result.answer.startsWith('*42*'));
 assert(!result.answer.includes('data-oks-ref'));
 const markdown=resolve(check('data text="a*b_[x]";answer tree! {Answer [p [UseValue(ref =text),"正文"]]};'),db).answer;
 assert.equal(markdown,'*a\\*b\\_\\[x\\]*正文');
 const tooltip=resolve(check('data prepared={cpu:42};data label="a\\\"b";report report=tree! {Report [UseValue(ref = (prepared.cpu)),UseValue(ref = label)]};answer tree! {Answer [UseReport(ref=report)]};'),db).artifacts['report.html'];
 assert.match(tooltip,/title="\(prepared.cpu\)"/);
 assert.match(tooltip,/title="label"/);
 console.log('Value highlights: report data/scalar markers, Markdown emphasis and escaping passed');
}finally{db.close();}
