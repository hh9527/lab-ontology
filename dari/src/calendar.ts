import type {Type} from './compiler.ts';
import {dateTimeUtc,epochMillis,timeZone,parseDateTimeTz} from './time-values.ts';
import type {ValueCodec} from './model.ts';
const DAY=86400000;
export function localDate(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||value<'0001-01-01'||value>'9999-12-31')throw Error('LocalDate requires YYYY-MM-DD in 0001..9999');
 const d=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw Error('Invalid LocalDate '+value);
 return value;
}
const dateMillis=(date:unknown)=>Date.parse(localDate(date)+'T00:00:00.000Z');
const fromMillis=(ms:number)=>localDate(new Date(ms).toISOString().slice(0,10));
const scalar=(name:string):Type=>({kind:'scalar',name});
function closed(name:string,variants:string[]):Type{
 const parse=(v:unknown)=>{if(typeof v!=='string'||!variants.includes(v))throw Error('Expected '+name+'::'+variants.join(' / '));return v;};
 const codec:ValueCodec={parse,decode:parse,encode:parse,variants,operations:[]};
 return{kind:'nominal',name,inner:scalar('String'),codec};
}
export const calendarTypes:Record<string,Type>={
 DateStyle:closed('DateStyle',['Date','DateTime','Time']),
 CalendarUnit:closed('CalendarUnit',['Year','Quarter','Month','Week','Day']),
 Weekday:closed('Weekday',['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']),
 DateOverflow:closed('DateOverflow',['Reject','Clamp']),
};
const rangeType=(name:string,endpoint:Type):Type=>({kind:'range',name,fields:{start:endpoint,end:endpoint}});
export const dateRangeType=rangeType('DateRange',scalar('LocalDate'));
export const timeRangeType=rangeType('TimeRange',scalar('EpochMillis'));
Object.assign(calendarTypes,{DateRange:dateRangeType,TimeRange:timeRangeType});
const rangeBrand=Symbol('dari.time-range');
type Range={start:string|number;end:string|number;[rangeBrand]:string};
function range(start:string|number,end:string|number,name:string):Range{
 if(start>end)throw Error(name+' requires start <= end');
 return Object.freeze({start,end,[rangeBrand]:name});
}
function trusted(value:any):Range{if(!value||!['DateRange','TimeRange'].includes(value[rangeBrand]))throw Error('Expected a constructed DateRange or TimeRange');return value;}
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const formatters=new Map<string,Intl.DateTimeFormat>();
function dateLabel(instant:unknown,zone:unknown):string{
 const key=String(zone);let formatter=formatters.get(key);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:timeZone(zone),calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',era:'short'});if(formatters.size>=64)formatters.delete(formatters.keys().next().value!);formatters.set(key,formatter);}
 const parts=formatter.formatToParts(epochMillis(instant));
 const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 if(fields.era!=='AD')return '0000-01-01';
 if(Number(fields.year)>9999)return '~~~~';
 return fields.year.padStart(4,'0')+'-'+fields.month+'-'+fields.day;
}
export function dateOf(instant:unknown,zone:unknown):string{return localDate(dateLabel(instant,zone));}
function shift(date:unknown,unit:string,count:number,overflow='Reject'):string{
 localDate(date);if(!Number.isSafeInteger(count))throw Error('Calendar shift requires a safe integer count');
 const d=new Date(dateMillis(date));
 if(['Day','Week'].includes(unit))return fromMillis(d.getTime()+count*(unit==='Week'?7:1)*DAY);
 const months=count*(unit==='Year'?12:unit==='Quarter'?3:1),day=d.getUTCDate();
 if(!Number.isSafeInteger(months))throw Error('Calendar shift exceeds supported range');
 d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 if(!Number.isFinite(d.getTime())||d.getUTCFullYear()<1||d.getUTCFullYear()>9999)throw Error('Calendar shift exceeds 0001..9999');
 const last=new Date(d.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 if(day>last.getUTCDate()&&overflow==='Reject')throw Error('Calendar shift overflows target month; explicitly select DateOverflow::Clamp if intended');
 d.setUTCDate(Math.min(day,last.getUTCDate()));return fromMillis(d.getTime());
}
function floor(date:unknown,unit:string,weekday='Monday'):string{
 const text=localDate(date),d=new Date(dateMillis(date));
 if(unit==='Day')return text;
 if(unit==='Week')return fromMillis(d.getTime()-((d.getUTCDay()+6-weekdays.indexOf(weekday)+7)%7)*DAY);
 d.setUTCDate(1);if(unit==='Year')d.setUTCMonth(0);if(unit==='Quarter')d.setUTCMonth(Math.floor(d.getUTCMonth()/3)*3);
 return fromMillis(d.getTime());
}
// Locate the beginning of a civil day by timezone-aware calendar comparison.
// This handles midnight gaps and 23/25-hour days without assuming a fixed UTC offset.
function dayStart(date:unknown,zone:unknown):number{
 const target=localDate(date);timeZone(zone);
 let low=dateMillis(target)-2*DAY,high=dateMillis(target)+2*DAY;
 while(low<high){const mid=low+Math.floor((high-low)/2);if(dateLabel(mid,zone)<target)low=mid+1;else high=mid;}
 if(dateOf(low,zone)!==target)throw Error('Local date '+target+' does not exist in '+zone);
 return low;
}
export const calendarFunctions:Record<string,{check(args:Type[]):Type;run(args:any[]):any}>={};
function define(name:string,required:string[],optional:string[],output:Type,run:(args:any[])=>any){
 calendarFunctions[name]={check(args){if(args.length<required.length||args.length>required.length+optional.length)throw Error(name+' requires '+required.join(', ')+(optional.length?' [, '+optional.join(', ')+']':''));
  args.forEach((t,i)=>{const expected=[...required,...optional][i];if(t.kind==='option'||!(expected==='Instant'?['EpochMillis','DateTimeUtc','DateTimeTz'].includes(t.semantic??t.name??''):t.name===expected))throw Error(name+' argument '+(i+1)+' requires '+expected+'; got '+(t.name??t.kind));});return output;},run};
}
calendarFunctions.date_of={
 check(args){
  if(args.length===1&&args[0].kind!=='option'&&(args[0].semantic??args[0].name)==='DateTimeTz')return scalar('LocalDate');
  if(args.length===2&&args[0].kind!=='option'&&['EpochMillis','DateTimeUtc','DateTimeTz'].includes(args[0].semantic??args[0].name??'')&&args[1].kind!=='option'&&(args[1].semantic??args[1].name)==='TimeZone')return scalar('LocalDate');
  throw Error('date_of requires a nonnullable instant and TimeZone, or one nonnullable DateTimeTz using its own zone');
 },
 run([instant,zone]){return dateOf(instant,zone??/\[([^\]]+)\]$/.exec(parseDateTimeTz(instant))![1]);}
};
define('calendar_floor',['LocalDate','CalendarUnit'],['Weekday'],scalar('LocalDate'),([date,unit,weekday])=>floor(date,unit,weekday));
define('calendar_ceil',['LocalDate','CalendarUnit'],['Weekday'],scalar('LocalDate'),([date,unit,weekday])=>{const start=floor(date,unit,weekday);return start===date?start:shift(start,unit,1);});
define('calendar_period',['LocalDate','CalendarUnit'],['Weekday'],dateRangeType,([date,unit,weekday])=>{const start=floor(date,unit,weekday);return range(start,shift(start,unit,1),'DateRange');});
define('shift_date',['LocalDate','CalendarUnit','Int'],['DateOverflow'],scalar('LocalDate'),([date,unit,count,overflow])=>shift(date,unit,count,overflow));
define('shift_dates',['DateRange','CalendarUnit','Int'],['DateOverflow'],dateRangeType,([value,unit,count,overflow])=>{const r=trusted(value);return range(shift(r.start,unit,count,overflow),shift(r.end,unit,count,overflow),'DateRange');});
define('date_range',['LocalDate','LocalDate'],[],dateRangeType,([a,b])=>range(localDate(a),localDate(b),'DateRange'));
define('time_range',['Instant','Instant'],[],timeRangeType,([a,b])=>range(epochMillis(a),epochMillis(b),'TimeRange'));
define('at_zone',['DateRange','TimeZone'],[],timeRangeType,([value,zone])=>{const r=trusted(value);return range(dayStart(r.start,zone),dayStart(r.end,zone),'TimeRange');});
for(const name of ['intersection','overlaps','contains','is_empty'])calendarFunctions[name]={
 check(args){const a=args[0];if(a?.kind!=='range'||args.length!==(name==='is_empty'?1:2))throw Error(name+' requires constructed ranges'+(name==='contains'?' and an endpoint':''));
  if(name!=='is_empty'){const b=args[1],expected=name==='contains'?a.fields!.start.name:a.name;if(b.kind==='option'||b.name!==expected)throw Error(name+' requires matching '+expected);}
  return name==='intersection'?a:scalar('Bool');},
 run(args){const a=trusted(args[0]);if(name==='is_empty')return a.start===a.end;if(name==='contains')return a.start<=args[1]&&args[1]<a.end;
  const b=trusted(args[1]);if(a[rangeBrand]!==b[rangeBrand])throw Error('Range types must match');
  const start=a.start>b.start?a.start:b.start,end=a.end<b.end?a.end:b.end;
  return name==='overlaps'?start<end:range(start,end<start?start:end,a[rangeBrand]);}
};

export function utcBucket(value:unknown,unit:string):string|null{
 if(value===null)return null;
 if(typeof value!=='string')throw Error('utc_bucket requires a DateTimeUtc encoded string');
 if(!['Year','Quarter','Month','Week','Day'].includes(unit))throw Error('Unsupported UTC calendar bucket '+unit);
 return dateTimeUtc(dateMillis(floor(dateOf(value,'UTC'),unit)));
}

// Match PostgreSQL's interpretation of local midnight: choose the later instant
// when midnight repeats; when midnight is skipped, use the pre-transition offset.
// This is an explicit bucket-key convention, not a fixed-offset approximation.
const clockFormatters=new Map<string,Intl.DateTimeFormat>();
function offsetAt(ms:number,zone:string):number {
 let formatter=clockFormatters.get(zone);
 if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:timeZone(zone),calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});if(clockFormatters.size>=64)clockFormatters.delete(clockFormatters.keys().next().value!);clockFormatters.set(zone,formatter);}
 const fields=Object.fromEntries(formatter.formatToParts(ms).map(p=>[p.type,p.value]));
 const local=new Date(0);local.setUTCFullYear(Number(fields.year),Number(fields.month)-1,Number(fields.day));local.setUTCHours(Number(fields.hour),Number(fields.minute),Number(fields.second),0);
 return local.getTime()-Math.floor(ms/1000)*1000;
}
const zonedBuckets=new Map<string,string>();
const validatedZones=new Map<string,string>();
function canonicalZone(zone:unknown):string{if(typeof zone==='string'){const prior=validatedZones.get(zone);if(prior!==undefined)return prior;}const id=timeZone(zone);if(validatedZones.size>=64)validatedZones.delete(validatedZones.keys().next().value!);validatedZones.set(String(zone),id);return id;}
export function calendarBucket(value:unknown,unit:string,zone:unknown):string|null {
 if(value===null)return null;
 if(typeof value!=='string')throw Error('calendar_bucket requires DateTimeUtc');
 if(!['Year','Quarter','Month','Week','Day'].includes(unit))throw Error('Unsupported calendar bucket '+unit);
 const id=canonicalZone(zone),date=floor(dateOf(value,id),unit),key=id+'/'+date;
 const previous=zonedBuckets.get(key);if(previous!==undefined)return previous;
 const nominal=dateMillis(date),offsets=new Set<number>();
 for(let delta=-48;delta<=48;delta+=12)offsets.add(offsetAt(nominal+delta*3600000,id));
 const candidates=[...offsets].map(offset=>nominal-offset);
 const exact=candidates.filter(ms=>ms+offsetAt(ms,id)===nominal);
 const instant=Math.max(...(exact.length?exact:candidates));
 const result=dateTimeUtc(instant);
 if(zonedBuckets.size>=512)zonedBuckets.delete(zonedBuckets.keys().next().value!);
 zonedBuckets.set(key,result);return result;
}
export function registerCalendarSqlite(db:{function(name:string,options:{deterministic:boolean},fn:(...args:any[])=>any):unknown}){
 db.function('dari_calendar_bucket',{deterministic:true},(value:any,unit:any,zone:any)=>calendarBucket(value,unit,zone));
}
