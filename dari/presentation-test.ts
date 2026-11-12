import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const hostModule=new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href;
const {dariHost}=await import(hostModule);
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE samples(label TEXT,n REAL); INSERT INTO samples VALUES('甲',99.1),('乙',99.8)");
const source=`
type Row = Schema({label:String,n:Float});
data raw: Table(Row) = source("samples");
data rows = query! {let r = from(raw);r |> project({label:r.label,n:r.n}) |> order_by(desc(out.n)) |> take(10)};


report report = tree! { Report [h1 ["设备报告"],BarChart(data = rows, spec = {category:project!(label),value:project!(n),value_min:99.0,title:"可用率"}),Table(data = rows, spec = {columns:["label","n"],labels:{label:"设备",n:"可用率"}})]};
answer tree! { Answer [BarChart(data = rows, spec = {category:project!(label),value:project!(n),value_min:99.0,title:"可用率"}),Table(data = rows, spec = {columns:["label","n"],labels:{label:"设备",n:"可用率"}}),UseReport(ref = report)]};
`;
const options={allowTestSources:true,host:dariHost};
let chartRenders=0;
const trackedHost={...dariHost,renderFigure(...args:any[]){if(args[0]==='BarChart')chartRenders++;return dariHost.renderFigure(...args);}};
const output=resolve(check(source,undefined,{...options,host:trackedHost}),db);
assert.equal(chartRenders,2); // Answer and report render separately.
assert.equal(output.queries,1); // Both positions share the data node.
assert(!output.artifacts['report.html'].includes('src="chart_'));
assert.match(output.answer,/设备/);
assert.match(output.artifacts['chart_1.svg'],/dari-data/);
assert.match(output.artifacts['chart_1.svg'],/99.8/);
assert.match(output.artifacts['report.html'],/<svg/);
assert.match(output.artifacts['report.html'],/<table/);
assert.match(output.artifacts['report.html'],/id="dari-context"/);
assert.match(output.artifacts['report.html'],/<title>report<\/title>/);
const titledOutput=resolve(check(source.replace('Report [','Report(title = "运维 & 健康周报") ['),undefined,options),db);
const titled=titledOutput.artifacts['report.html'];
assert.match(titledOutput.answer,/\[运维 & 健康周报\]\(report.html\)/);
assert.match(output.answer,/\[report\]\(report.html\)/);
const bracketTitle=resolve(check(source.replace('Report [','Report(title = "周报 [网络]") ['),undefined,options),db);
assert(bracketTitle.answer.includes('[周报 \\[网络\\]](report.html)'));
assert.match(titled,/<title>运维 &amp; 健康周报<\/title>/);
assert(!/<article[^>]*\btitle=/.test(titled));
assert.match(titled,/<figcaption>[\s\S]*?可用率/);
assert.match(titled,/data-oks-ref/);
const extractModule=new URL('../../dsh-oks/packages/dsh-oks/src/report-extract.ts',import.meta.url).href;
const {extractDariSource}=await import(extractModule);
const restored=extractDariSource(output.artifacts['report.html']);
assert(restored.endsWith(source));
assert.match(restored,/Report execution metadata/);
assert.equal(resolve(check(restored,undefined,options),db).answer,output.answer);
assert.equal(Object.keys(output.artifacts).length,2);
assert.throws(()=>check(source.replace('project!(n),value_min','project!(missing),value_min'),undefined,options),/Unknown figure field/);
assert.throws(()=>check(source.replace('value:project!(n)','value:project!(label)'),undefined,options),/numeric mapping/);
db.exec('DELETE FROM samples');
assert.throws(()=>resolve(check(source,undefined,options),db),/allow_no_data|无数据|empty/i);
assert.throws(()=>resolve(check(source,undefined,options),db),(error:Error)=>{
 assert.match(error.message,/SubmitFailed\n------------/);
 assert.match(error.message,/L\d+:\d+ \[answer\]: BarChart\(data = rows\)/);
 return true;
});
const empty=source.replaceAll('value_min:99.0','allow_no_data:True,value_min:99.0').replaceAll('columns:[','allow_no_data:True,columns:[');
assert.match(resolve(check(empty,undefined,options),db).artifacts['chart_1.svg'],/无数据/);
const contextType={kind:'schema',fields:{epochMillis:{kind:'scalar',name:'EpochMillis'},timeZone:{kind:'scalar',name:'String'}}};
const calendar=check(`data ctx = context! { epoch_millis: Context::Now , time_zone: Context::ClientTz };data weeks = time_windows(ctx,{unit:TimeUnit::Week,count:2,mode:WindowMode::Complete});data start = weeks[0].start.epoch_millis;answer tree! { Answer [p [Value(value = start)]]};`,undefined,{host:dariHost,contextType});
assert.match(resolve(calendar,db,{}, {context:{epochMillis:Date.parse('2026-11-11T06:00:00Z'),timeZone:'Asia/Shanghai'}}).answer,/179/);
db.close();
console.log('production presentation: chart, inline table, self-contained report, empty data and calendar passed');

// Heterogeneous metrics stay in wide columns; normalization belongs to rendering only.
const wideFields={period:{kind:'scalar',name:'String'},cpu:{kind:'nominal',name:'Cpu',inner:{kind:'scalar',name:'Float'}},mem:{kind:'nominal',name:'Memory',inner:{kind:'scalar',name:'Float'}}};
const wideRows=[{period:'上周',cpu:42.1,mem:61.3},{period:'本周',cpu:44.2,mem:59.8}];
const wideSpec={category:'period',metrics:[{value:'cpu',label:'CPU',unit:'%'},{value:'mem',label:'内存',unit:'%'}]};
for(const component of ['MultiBarChart']){
 dariHost.checkFigure(component,wideSpec,wideFields);
 const figure=dariHost.renderFigure(component,wideSpec,wideRows,wideFields);
 assert.match(figure.content,/42.1/);assert.match(figure.content,/61.3/);assert.match(figure.content,/CPU/);assert.match(figure.content,/内存/);
 assert.throws(()=>dariHost.checkFigure(component,{...wideSpec,unit:'bytes'},wideFields),/units/);
 assert.throws(()=>dariHost.checkFigure(component,{...wideSpec,stack:{[Symbol.for('dari.enum')]:true,enum:'Stack',variant:'Total'}},wideFields),/parallel/);
 assert.throws(()=>dariHost.checkFigure(component,{...wideSpec,metrics:[...wideSpec.metrics,wideSpec.metrics[0]]},wideFields),/unique/);
}
console.log('Wide grouped charts: distinct nominal columns, labels, embedded source data and unit constraints passed');
const joinDb=new DatabaseSync(':memory:');
const keyed=`
type Cpu=struct(Float);type Memory=struct(Float);
data left=table([{period:"本周",cpu:Cpu(44.2)},{period:"上周",cpu:Cpu(42.1)}]);
data right=table([{period:"上周",memory:Memory(61.3)},{period:"本周",memory:Memory(59.8)}]);
data weekly=query! {let l=from(left);let r=from(right);join({l,r},l.period==r.period) |> project({period:l.period,cpu:l.cpu,memory:r.memory}) |> order_by(asc(out.period)) |> take(10)};

answer tree! { Answer [MultiBarChart(data=weekly,spec={category:project!(period),metrics:[{value:project!(cpu),label:"CPU",unit:"%"},{value:project!(memory),label:"内存",unit:"%"}]})]};`;
const keyedOutput=resolve(check(keyed,undefined,{host:dariHost}),joinDb);
assert.match(keyedOutput.artifacts['chart_1.svg'],/本周,44.2,59.8/);
assert.match(keyedOutput.artifacts['chart_1.svg'],/上周,42.1,61.3/);
joinDb.close();
console.log('Keyed join to wide chart passed with opposite source row orders and distinct metric types');
const ratioType={kind:'nominal',name:'Ratio',inner:{kind:'scalar',name:'Float'},presentation:{multiplier:100,suffix:'%'}};
const percentType={...ratioType,name:'Percent',presentation:{multiplier:1,suffix:'%'}};
const rateRows=[{label:'甲',ratio:0.12,percent:12},{label:'乙',ratio:null,percent:null}];
const rateFields={label:{kind:'scalar',name:'String'},ratio:ratioType,percent:percentType};
const rateTable=dariHost.renderFigure('Table',{},rateRows,rateFields);
assert.match(rateTable.content,/12%/);assert(!rateTable.content.includes('0.12'));
const rateChart=dariHost.renderFigure('BarChart',{category:'label',value:'ratio'},rateRows,rateFields);
assert.match(rateChart.content,/甲,0.12,12/); // embedded CSV keeps original values
assert.match(rateChart.content,/单位：%/);assert.match(rateChart.content,/>12%</);
assert.deepEqual(rateRows[0],{label:'甲',ratio:0.12,percent:12});
assert.throws(()=>dariHost.checkFigure('BarChart',{category:'label',value:'ratio',unit:'bytes'},rateFields),/unit conflicts/);
console.log('Typed percentage display: scale, suffix, original CSV, nulls and unit conflict passed');
