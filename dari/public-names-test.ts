import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const {dariHost}=await import(new URL('../../dsh-oks/packages/dsh-oks/src/dari-host.ts',import.meta.url).href);
const db=new DatabaseSync(':memory:');
const contextType:any={kind:'schema',fields:{epochMillis:{kind:'scalar',name:'EpochMillis'},timeZone:{kind:'scalar',name:'String'}}};
try{
 const source=`data ctx=context! {epoch_millis:Context::Now,time_zone:Context::ClientTz};
 data windows=time_windows(ctx,{unit:TimeUnit::Day,count:1,mode:WindowMode::Complete});
 data start=windows[0].start.epoch_millis;
 data utc=windows[0].start.date_time_utc;
 data bucket=time_bucket(start,{unit:TimeUnit::Day,time_zone:"Asia/Shanghai"});
 answer tree! {Answer [UseValue(ref =start),UseValue(ref =utc),UseValue(ref =bucket)]};`;
 const program=check(source,undefined,{host:dariHost,contextType});
 const result=resolve(program,db,{}, {context:{epochMillis:Date.parse('2026-11-12T00:00:00Z'),timeZone:'Asia/Shanghai'}});
 assert.equal(result.values.utc,'2026-11-10T16:00:00.000Z');
 assert.equal(result.values.bucket,result.values.utc);
 assert.throws(()=>check(source.replace('.start.epoch_millis','.start.epochMillis'),undefined,{host:dariHost,contextType}),/Unknown field/);
 assert.throws(()=>check(source.replace('time_zone:"Asia/Shanghai"','timeZone:"Asia/Shanghai"'),undefined,{host:dariHost,contextType}),/time_zone/);
 const fields:any={label:{kind:'scalar',name:'String'},value:{kind:'scalar',name:'Float'}};
 dariHost.checkFigure('BarChart',{category:'label',value:'value',value_min:99,allow_no_data:true,x_label:'设备',value_label:'可用率',layout:{label_font:12,title_font:16,tick_count:5,slant_ticks:false}},fields);
 for(const key of ['valueMin','allowNoData','xLabel','valueLabel','xType','connectNulls','entityColor'])assert.throws(()=>dariHost.checkFigure('BarChart',{category:'label',value:'value',[key]:true},fields),/Use .* instead of/);
 assert.throws(()=>dariHost.checkFigure('BarChart',{category:'label',value:'value',layout:{labelFont:12}},fields),/label_font/);
 console.log('Public naming: snake_case time schemas, calendar values, chart options and rejection of legacy names passed');
}finally{db.close();}
