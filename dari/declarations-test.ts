import assert from 'node:assert/strict';
import {check} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:');
const source=`
data rows=table([{name:"A",value:1}]);

report summary=tree! {Report [ColumnChart(data = rows,x = $.name,value = $.value)]};
answer tree! {Answer [UseReport(ref = summary)]};
`;
const p=check(source),result=resolve(p,db);
assert.equal(p.bindings.get('rows')!.type.kind,'table');
assert(!p.bindings.has('chart'));
assert.equal(p.bindings.get('summary')!.type.kind,'report');
assert.equal(p.bindings.get('answer')!.type.kind,'answer');
assert.match(result.artifacts['summary.html'],/<svg/);
for(const [text,error]of [
 ['data x=tree! {Answer []};',/data requires a data value/],
 ['figure x=42;',/Use type, data, report or answer/],
 ['answer tree! {Answer [UseFigure(ref = x)]};',/Unknown component UseFigure/],
 ['answer tree! {Answer [UseTable(ref = x)]};',/Unknown component UseTable/],
 ['report x=tree! {Answer []};',/report requires tree!/],
 ['answer tree! {Report []};',/answer requires tree!/],
 ['answer = tree! {Answer []};',/without =/],
 ['def x=42;',/Use type, data, report or answer/],
 ['answer tree! {Answer []};answer tree! {Answer []};',/Duplicate declaration answer/]
] as const)assert.throws(()=>check(text),error);
db.close();
console.log('Declarations: typed data/report roots and inline charts, unique answer, legacy syntax rejection and rendering passed');
