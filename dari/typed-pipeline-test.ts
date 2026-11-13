import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
const prefix=`
type Device = Schema({id:Int,seen:EpochMillis,cpu:Percent});
type Label = Schema({id:Int,name:String});
data devices:Table(Device)=table([{id:1,seen:EpochMillis(0),cpu:Percent(20.0)},{id:2,seen:EpochMillis(1000),cpu:Percent(80.0)}]);
data labels:Table(Label)=table([{id:2,name:"B"}]);
`;
const source=prefix+`
data rows=query! {
 let a=from(devices);
 let b=from(labels);
 let related=left_join({a,b},a.id==b.id);
 let result=related |> project({id:a.id,name:b.name,seen:to_datetime_utc(a.seen),cpu:a.cpu});
 result |> order_by(desc(result.cpu)) |> take(2)
};
data named=query! {
 let a=from(rows);
 let result=project({name:not_none(a.name),seen:a.seen,cpu:a.cpu});
 result |> take(1)
};
data first=query! {let a=from(named);a |> take_opt()};
data title=map_opt(first,$.name);
answer tree! { Answer [Table(data = rows),Table(data = named),UseValue(ref = title)]};
`;
// An inherited order and bound remain usable across named data boundaries.
const program=check(source);
assert.equal(show(program.bindings.get('rows')!.type),'Table(Schema({id: Int, name: Option(String), seen: DateTimeUtc, cpu: Percent}))');
assert.equal(show(program.bindings.get('named')!.type),'Table(Schema({name: String, seen: DateTimeUtc, cpu: Percent}))');
assert.equal(program.bindings.get('named')!.result!.maxRows,1);
assert.equal(program.bindings.get('first')!.type.kind,'option');
const output=resolve(program,db);
assert.deepEqual(output.values.named,[{name:'B',seen:'1970-01-01T00:00:01.000Z',cpu:80}]);
assert.match(output.answer,/80%/);
assert.throws(()=>check(prefix+'data bad=query! {let a=from(devices);let result=project({cpu:a.cpu+1.0});result |> order_by(desc(result.cpu)) |> take(1)};answer tree! { Answer [Table(data = bad)]};'),/does not allow Add/);
assert.equal(show(check(source.replace('name:not_none(a.name)','name:a.name')).bindings.get('title')!.type),'Option(String)');
db.close();
console.log('Typed pipeline: lexical plans, nullable join, narrowing projection, time conversion, nominal policy, inherited order/bound and optional row passed');
