import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
const evaluate=(expression:string)=>{
 const p=check(`data result=${expression};answer tree! {Answer []};`);
 // Force the data node through a scalar consumer, keeping range internals private.
 const t=p.bindings.get('result')!.type;
 const suffix=t.kind==='range'?'.start':'';
 return resolve(check(`data result=${expression};answer tree! {Answer [Value(value=result${suffix})]};`),db).answer.replaceAll('*','');
};
assert.equal(evaluate('calendar_period(LocalDate("2026-02-15"), CalendarUnit::Month)'),'2026-02-01');
assert.equal(evaluate('calendar_floor(LocalDate("2026-02-01"), CalendarUnit::Week)'),'2026-01-26');
assert.equal(evaluate('calendar_floor(LocalDate("2026-02-01"), CalendarUnit::Week, Weekday::Sunday)'),'2026-02-01');
assert.equal(evaluate('calendar_ceil(LocalDate("2026-02-01"), CalendarUnit::Week)'),'2026-02-02');
assert.equal(evaluate('calendar_ceil(LocalDate("2026-02-02"), CalendarUnit::Week)'),'2026-02-02');
assert.equal(evaluate('shift_date(LocalDate("2024-02-29"),CalendarUnit::Year,1,DateOverflow::Clamp)'),'2025-02-28');
assert.throws(()=>evaluate('shift_date(LocalDate("2024-02-29"),CalendarUnit::Year,1)'),/overflows target month/);
assert.throws(()=>evaluate('LocalDate("2026-02-29")'),/Invalid LocalDate/);
assert.throws(()=>evaluate('date_range(LocalDate("2026-02-02"),LocalDate("2026-02-01"))'),/start <= end/);
assert.equal(evaluate('is_empty(intersection(date_range(LocalDate("2026-02-01"),LocalDate("2026-02-02")),date_range(LocalDate("2026-03-01"),LocalDate("2026-03-02"))))'),'true');
assert.equal(evaluate('contains(date_range(LocalDate("2026-02-01"),LocalDate("2026-02-02")),LocalDate("2026-02-02"))'),'false');
const periods=check(`data february=calendar_period(LocalDate("2026-02-01"),CalendarUnit::Month);
data first=do {let week=calendar_period(february.start,CalendarUnit::Week);at_zone(intersection(week,february),TimeZone("Asia/Shanghai"))};
data second=do {let week=calendar_period(february.start,CalendarUnit::Week);at_zone(intersection(shift_dates(week,CalendarUnit::Week,1),february),TimeZone("Asia/Shanghai"))};
answer tree! {Answer [Value(value=first.start),Value(value=first.end),Value(value=second.start),Value(value=second.end)]};`);
assert.equal(resolve(periods,db).answer.replaceAll('*',''),[Date.parse('2026-02-01T00:00:00+08:00'),Date.parse('2026-02-02T00:00:00+08:00'),Date.parse('2026-02-02T00:00:00+08:00'),Date.parse('2026-02-09T00:00:00+08:00')].join('\n\n'));
for(const [date,hours]of [['2026-03-08',23],['2026-11-01',25]] as const){
 const p=check(`data window=at_zone(calendar_period(LocalDate("${date}"),CalendarUnit::Day),TimeZone("America/New_York"));answer tree! {Answer [Value(value=window.start),Value(value=window.end)]};`);
 const values=resolve(p,db).answer.replaceAll('*','').split('\n\n').map(Number);assert.equal(values[1]-values[0],hours*3600000);
}
assert.equal(evaluate('at_zone(calendar_period(LocalDate("2018-11-04"),CalendarUnit::Day),TimeZone("America/Sao_Paulo"))'),String(Date.parse('2018-11-04T03:00:00Z')));
assert.throws(()=>evaluate('at_zone(calendar_period(LocalDate("2011-12-30"),CalendarUnit::Day),TimeZone("Pacific/Apia"))'),/does not exist/);
for(const expr of ['date_of(42,TimeZone("UTC"))','date_of(EpochMillis(0),"UTC")','calendar_period(LocalDate("2026-01-01"),"month")','at_zone({start:LocalDate("2026-01-01"),end:LocalDate("2026-01-02")},TimeZone("UTC"))'])assert.throws(()=>check(`data x=${expr};answer tree! {Answer []};`),/requires/);
// Existing text containment and table emptiness retain their separate typed contracts.
assert.equal(evaluate('contains("abc","b")'),'true');
assert.throws(()=>check('data t=table([{x:1}]);data r=query! {let a=from(t);a |> project({x:calendar_floor(LocalDate("2026-01-01"),CalendarUnit::Month)})};answer tree! {Answer []};'),/top-level data\/do/);
const example=check(readFileSync(new URL('./examples/calendar.dari',import.meta.url),'utf8'),undefined,{contextType:{kind:'schema',fields:{epochMillis:{kind:'scalar',name:'EpochMillis'},timeZone:{kind:'scalar',name:'String'}}}});
assert.match(resolve(example,db,{}, {context:{epochMillis:Date.parse('2026-11-12T00:00:00Z'),timeZone:'Asia/Shanghai'}}).answer,/2026-02-01/);
const bounded=check(`data w=at_zone(calendar_period(LocalDate("2026-02-01"),CalendarUnit::Month),TimeZone("UTC"));
data t=table([{ts:EpochMillis(1769904000000)},{ts:EpochMillis(1772323200000)}]);
data rows=query! {let a=from(t);let selected=a |> filter(a.ts>=w.start && a.ts<w.end) |> project({ts:a.ts});selected |> order_by(asc(selected.ts)) |> take(5)};
answer tree! {Answer [UseTable(ref=rows)]};`);
assert.equal(resolve(bounded,db).values.rows.length,1);
db.close();
console.log('Calendar periods, February weeks, leap dates, range algebra, timezone boundaries and diagnostics passed');
