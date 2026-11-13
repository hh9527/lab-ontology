import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE data(id INTEGER, score REAL); INSERT INTO data VALUES(1,10),(2,30),(3,20),(4,40)");
const compile=(steps:string)=>check(`
type Row = Schema({id:Int, score:Float});
data src: Table(Row) = source("data");
data rows = query! { let a = from(src); a ${steps} };
answer tree! { Answer [Table(data = rows)] };
`,undefined,{allowTestSources:true});
const run=(steps:string)=>resolve(compile(steps),db).values.rows;
assert.deepEqual(run(`|> filter(a.id > 1) |> filter(a.score < 40.0)
 |> project({id:a.id, score:a.score}) |> filter(out.score > 20.0)
 |> project({id:out.id, doubled:out.score * 2})
 |> order_by(desc(out.doubled)) |> take(10)`),[{id:2,doubled:60}]);
// Sorting by a source field does not require exposing it in the result.
assert.deepEqual(run('|> project({id:a.id}) |> order_by(desc(a.score)) |> take(2)'),[{id:4},{id:2}]);
assert.deepEqual(run('|> project({id:a.id}) |> order_by(desc(a.score)) |> take(3) |> take(2)'),[{id:4},{id:2}]);
assert.deepEqual(run('|> project({id:a.id}) |> order_by(desc(a.score)) |> take(3) |> order_by(asc(out.id))'),[{id:2},{id:3},{id:4}]);
assert.deepEqual(run('|> project({id:a.id,score:a.score}) |> order_by(desc(out.score)) |> project({id:out.id}) |> take(2)'),[{id:4},{id:2}]);
assert.throws(()=>compile('|> project({id:a.id}) |> order_by(desc(out.id)) |> order_by(asc(out.id)) |> take(2)'),/Repeated order_by/);
assert.throws(()=>compile('|> group_by({id:a.id}) |> group_by({id:a.id})'),/duplicate group_by/);
// take is a finite table node, so later table operations can consume it.
assert.deepEqual(run(`|> project({id:a.id,score:a.score}) |> order_by(desc(out.score)) |> take(3)
 |> filter(out.score > 20.0) |> project({id:out.id}) |> order_by(asc(out.id))`),[{id:2},{id:4}]);
assert.deepEqual(run(`|> project({id:a.id,score:a.score}) |> order_by(desc(out.score)) |> take(3)
 |> filter(out.score > 20.0) |> order_by(asc(out.id)) |> take(1)`),[{id:2,score:30}]);
assert.deepEqual(run(`|> project({id:a.id, score:a.score}) |> project({total:sum(out.score)})
 |> filter(unwrap_or!(out.total,0.0) > 0.0)`),[{total:100}]);
assert.equal(show(compile('|> project({id:a.id}) |> order_by(asc(out.id)) |> take(2)').bindings.get('rows')!.type),'Table(Schema({id: Int}))');
assert.throws(()=>compile('|> project({id:a.id}) |> project({score:a.score}) |> order_by(asc(out.score)) |> take(2)'),/Unknown binding a/);
assert.throws(()=>compile('|> project({id:a.id}) |> filter(out.missing > 1) |> order_by(asc(out.id)) |> take(2)'),/Unknown field/);
assert.throws(()=>compile('|> project({id:a.id}) |> project({id:out.id})'),/proven bound/);
assert.throws(()=>compile('|> group_by({id:a.id}) |> filter(a.score > 1.0) |> project({id:a.id}) |> order_by(asc(out.id)) |> take(10)'),/group_by requires project/);
assert.throws(()=>compile('|> project({total:sum(a.score)}) |> order_by(desc(a.id)) |> take(10)'),/Ungrouped/);
// A later projection's parameters precede its nested input's SQL parameters.
assert.deepEqual(run(`|> filter(a.score > 10.0) |> project({id:a.id,score:a.score + 3.0})
 |> project({id:out.id,score:out.score * 2.0}) |> filter(out.score > 50.0)
 |> order_by(asc(out.id)) |> take(2)`),[{id:2,score:66},{id:4,score:86}]);
db.close();
console.log('select composition: passed');
