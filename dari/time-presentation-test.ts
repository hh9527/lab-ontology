import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {formatValue} from './src/format.ts';
import {sharedTypes as T} from './src/shared-types.ts';
import {dariHost,formatTimeChart} from '../../dsh-oks/packages/dsh-oks/src/dari-host.ts';
const stamp='2026-11-09T16:00:00Z';
const contextType={kind:'schema',fields:{epochMillis:T.EpochMillis,timeZone:{kind:'scalar',name:'String'}}};
const context={epochMillis:Date.parse(stamp),timeZone:'Asia/Shanghai'};
const source=`data ctx=context! {now:Context::Now,tz:Context::ClientTz};
data fmt={time_zone:ctx.tz,date_style:DateStyle::Date};
data moment=DateTimeUtc("${stamp}");
data zoned=to_datetime_tz(moment,ctx.tz);
data day=date_of(zoned);
data epoch=to_epoch_millis(moment);
data raw:Table(Schema({at:DateTimeUtc,v:Float}))=source("samples");
data rows=query! {let r=from(raw);let result=r |> project({at:r.at,zoned:to_datetime_tz(r.at,ctx.tz),v:r.v}).as!(out);result |> order_by(asc(result.at)) |> take(10)};
report full=tree! {Report [Table(data=rows,spec={formats:{at:fmt,zoned:{date_style:DateStyle::Date}}}),LineChart(data=rows,spec={x:$.zoned,value:$.v,formats:{zoned:fmt}})]};
answer tree! {Answer [UseValue(ref=moment,format=fmt),UseValue(ref=zoned),UseValue(ref=day),UseValue(ref=epoch,format=fmt),UseReport(ref=full)]};`;
const options={host:dariHost,contextType,allowTestSources:true};
const db=new DatabaseSync(':memory:');
try{
 db.exec(`CREATE TABLE samples(at TEXT,v REAL);INSERT INTO samples VALUES('${stamp}',1.0),('2026-11-10T16:00:00Z',2.0)`);
 const p=check(source,undefined,options),run=resolve(p,db,{}, {context});
 assert.equal(show(p.bindings.get('rows')!.type),'Table(Schema({at: DateTimeUtc, zoned: DateTimeTz, v: Float}))');
 assert.equal(run.values.rows[0].at,'2026-11-09T16:00:00.000Z');
 assert.equal(run.values.epoch,Date.parse(stamp));
 assert.equal(run.values.day,'2026-11-10');
 const other=resolve(p,db,{}, {context:{...context,timeZone:'America/Los_Angeles'}});
 assert.match(other.answer,/2026-11-09/);assert.equal(other.values.day,'2026-11-09');
 assert.equal(other.values.rows[0].at,run.values.rows[0].at);
 assert.match(run.answer,/2026-11-10/);assert.match(run.answer,/00:00:00/);assert.match(run.answer,/Asia\/Shanghai/);
 assert.match(run.artifacts['full.html'],/<td>2026-11-10<\/td>/);
 assert.match(run.dataDocument,/2026-11-10/);
 const svg=run.artifacts['full.html'];
 const labels=[...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(m=>m[1]).join('\n');
 assert.match(labels,/2026-11-10/);assert(!labels.includes('2026-11-09'));
 for(const [from,to,message]of [
  ['time_zone:ctx.tz','time_zone:"Asia/Shanghai"',/nonnullable TimeZone/],
  ['date_style:DateStyle::Date','date_style:"Date"',/DateStyle/],
  ['formats:{at:fmt','formats:{v:fmt',/Time format requires/],
  ['formats:{at:fmt','formats:{absent:fmt',/Unknown format field/],
 ] as const)assert.throws(()=>check(source.replace(from,to),undefined,options),message);
 const missing=check('data request:Schema({at:Option(DateTimeUtc)})=input();data zone=TimeZone("Asia/Shanghai");answer tree! {Answer [UseValue(ref=request.at,format={time_zone:zone,date_style:DateStyle::Date})]};');
 assert.match(resolve(missing,db,{request:{at:null}}).answer,/无数据/);
 assert.match(resolve(missing,db,{request:{at:stamp}}).answer,/2026-11-10/);
 const localDateFigure=dariHost.renderFigure('LineChart',{x:'at',value:'v'},[{at:'2026-11-10',v:1}],{at:T.LocalDate,v:T.Ratio});
 assert.match(localDateFigure.content,/2026-11-10/);
 const core='data zone=TimeZone("Asia/Shanghai");data t=DateTimeUtc("'+stamp+'");data rows=table([{at:t}]);answer tree! {Answer [UseValue(ref=t,format={time_zone:zone,date_style:DateStyle::Date}),Table(data=rows,spec={formats:{at:{time_zone:zone,date_style:DateStyle::Date}}})]};';
 const bare=resolve(check(core),db);assert.match(bare.answer,/2026-11-10/);assert(!bare.answer.includes('2026-11-09'));
 assert.equal(formatValue(T.DateTimeUtc,stamp,undefined,{time_zone:'America/New_York',date_style:'Date'}),'2026-11-09');
 for(const [instant,expected]of [['2026-03-08T06:30:00Z','01:30:00'],['2026-03-08T07:30:00Z','03:30:00']])assert.equal(formatValue(T.DateTimeUtc,instant,undefined,{time_zone:'America/New_York',date_style:'Time'}),expected);
 const repeated=['2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'].map(t=>String(formatValue(T.DateTimeUtc,t,undefined,{time_zone:'America/New_York'})));
 assert.match(repeated[0],/01:30:00 -04:00/);assert.match(repeated[1],/01:30:00 -05:00/);
 assert.equal(formatValue(T.LocalDate,'2026-11-10'),'2026-11-10');
 const originalTZ=process.env.TZ;try{process.env.TZ='Pacific/Honolulu';assert.match(String(formatValue(T.DateTimeUtc,stamp)),/2026-11-09 16:00:00 \+00:00/);}finally{if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;}
 for(const [type,value]of [[T.EpochMillis,Date.parse(stamp)],[T.DateTimeUtc,stamp],[T.DateTimeTz,'2026-11-10T00:00:00+08:00[Asia/Shanghai]']]){
  for(const date_style of ['Date','DateTime','Time'] as const)assert.equal(dariHost.formatValue(type as any,value,undefined,{time_zone:'Asia/Shanghai',date_style}),formatValue(type as any,value,undefined,{time_zone:'Asia/Shanghai',date_style}));
  dariHost.checkFigure('LineChart',{x:'at',value:'v'},{at:type as any,v:T.Ratio});
  const f=dariHost.renderFigure('LineChart',{x:'at',value:'v',formats:{at:{time_zone:'Asia/Shanghai',date_style:'Date'}}},[{at:value,v:0.12}],{at:type as any,v:T.Ratio});
  assert.match(f.content,/<svg/);assert.match(f.dataText!,/2026-11-10/);
 }
 const mixed=[{at:'2026-11-10T00:00:00+08:00[Asia/Shanghai]',v:1},{at:'2026-11-10T00:00:00-05:00[America/New_York]',v:2}];
 assert.throws(()=>dariHost.renderFigure('LineChart',{x:'at',value:'v'},mixed,{at:T.DateTimeTz,v:T.Ratio}),/Mixed DateTimeTz/);
 dariHost.renderFigure('LineChart',{x:'at',value:'v',formats:{at:{time_zone:'UTC'}}},mixed,{at:T.DateTimeTz,v:T.Ratio});
 assert.throws(()=>dariHost.checkFigure('LineChart',{x:'at',value:'v',x_axis:{[Symbol.for('dari.enum')]:true,enum:'Axis',variant:'Time'}},{at:{kind:'scalar',name:'String'},v:T.Ratio}),/Axis::Time requires/);
 const category={x:'at',value:'v',x_axis:{[Symbol.for('dari.enum')]:true,enum:'Axis',variant:'Category'},formats:{at:{date_style:'Date'}}};
 assert.throws(()=>dariHost.renderFigure('LineChart',category,[{at:'2026-11-10T01:00:00Z',v:1},{at:'2026-11-10T02:00:00Z',v:2}],{at:T.DateTimeUtc,v:T.Ratio}),/collapse distinct instants/);
 assert.throws(()=>formatValue(T.LocalDate,'2026-11-10',undefined,{time_zone:'UTC'}),/no instant/);
 assert.throws(()=>formatValue(T.DateTimeUtc,stamp,undefined,{time_zone:'not-a-zone'}),/time zone/i);
 const option:any={xAxis:{type:'time'},series:[{tooltip:{valueFormatter:(v:unknown)=>String(v)+'%'}}]};
 formatTimeChart(option,{at:T.DateTimeUtc},{x:'at',kind:'line',xType:'Rfc3339'},[{at:stamp}],{at:{time_zone:'Asia/Shanghai',date_style:'Date'}});
 assert.equal(option.xAxis.axisLabel.formatter(Date.parse(stamp)),'2026-11-10');
 assert.equal(option.xAxis.axisPointer.label.formatter({value:Date.parse(stamp)}),'2026-11-10');
 assert.match(option.tooltip.formatter([{axisValue:Date.parse(stamp),value:[Date.parse(stamp),12],seriesIndex:0,seriesName:'CPU'}]),/^2026-11-10<br\/>CPU: 12%$/);
 const example=check(readFileSync(new URL('./examples/time-display.dari',import.meta.url),'utf8'),undefined,{host:dariHost,contextType});
 assert.match(resolve(example,db,{}, {context}).answer,/2026-11-10/);
 console.log('Time presentation: typed formats, table/value/chart parity, unchanged instants, contextual zones, DST and diagnostics passed');
}finally{db.close();}
