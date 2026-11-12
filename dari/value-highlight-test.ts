import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
try{
 const result=resolve(check(`
 data inputs=table([{n:42}]);
 data summary=query! {let r=from(inputs);r |> project({n:max(r.n)})};
 data label="<script>&\\\"";
 report report=tree! {Report [p ["Count: ",Value(data=summary,field=project!(n))," / ",Value(value=label)," literal"]]};
 answer tree! {Answer [Value(data=summary,field=project!(n)),UseReport(ref=report)]};
 `),db);
 const report=result.artifacts['report.html'];
 assert.match(report,/<span data-oks-ref="summary.n" title="summary">42<\/span>/);
 assert.match(report,/<span data-oks-ref="label" title="label">&lt;script>&amp;&quot;<\/span>/);
 assert.match(report,/ literal<\/p>/);
 assert(result.answer.startsWith('*42*'));
 assert(!result.answer.includes('data-oks-ref'));
 const markdown=resolve(check('data text="a*b_[x]";answer tree! {Answer [p [Value(value=text),"正文"]]};'),db).answer;
 assert.equal(markdown,'*a\\*b\\_\\[x\\]*正文');
 const tooltip=resolve(check('data prepared={cpu:42};report report=tree! {Report [Value(value = (prepared.cpu)),Value(value = "a\\\"b")]};answer tree! {Answer [UseReport(ref=report)]};'),db).artifacts['report.html'];
 assert.match(tooltip,/title="\(prepared.cpu\)"/);
 assert.match(tooltip,/title="&quot;a\\&quot;b&quot;"/);
 console.log('Value highlights: report data/scalar markers, Markdown emphasis and escaping passed');
}finally{db.close();}
