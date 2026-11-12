import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {check as checkProgram,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const source=`
type Row = Schema({id: Int, code: Option(String)});
data source_rows: Table(Row) = source("rows");
data caption = coalesce(lookup("switch", [{value: "switch", label: "交换机"}]), "其他");
data rows = query! {
    let r = from(source_rows);
    r |> project({id: r.id, label: coalesce(lookup(r.code, [
        {value: "switch", label: "交换机"},
        {value: "router", label: "路由器"}
    ]), "其他"), doubled: r.id * 2})
      |> order_by(asc(out.id)) |> take(10)
};
answer tree! { Answer [p [Value(value = caption)], UseTable(ref = rows)] };
`;
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE rows(id INTEGER, code TEXT); INSERT INTO rows VALUES(1,'switch'),(2,'router'),(3,'unknown'),(4,NULL)`);
const program=check(source),result=resolve(program,db);
assert.equal(show(program.bindings.get('rows')!.type),'Table(Schema({id: Int, label: String, doubled: Int}))');
assert.deepEqual(result.values.rows,[{id:1,label:'交换机',doubled:2},{id:2,label:'路由器',doubled:4},{id:3,label:'其他',doubled:6},{id:4,label:'其他',doubled:8}]);
assert.match(result.answer,/交换机/);
const nullable=check(source.replace('coalesce(lookup(r.code, [','lookup(r.code, [').replace(']), "其他"), doubled',']), doubled'));
assert.match(show(nullable.bindings.get('rows')!.type),/label: Option\(String\)/);
assert.equal(resolve(nullable,db).values.rows[3].label,null);
for(const [from,to,error]of [
 ['{value: "router", label: "路由器"}','{value: "switch", label: "路由器"}',/Duplicate lookup key/],
 ['{value: "router", label: "路由器"}','{value: 1, label: "路由器"}',/key type must match/],
 ['{value: "router", label: "路由器"}','{value: "router", label: 1}',/labels must have the same type/],
 ['{value: "router", label: "路由器"}','{value: r.code, label: "路由器"}',/static scalar constants/],
 ['Value(value = caption)','Value(value = lookup("switch", [{value:"switch",label:"交换机"}]))',/Prepare computed values before tree/],
] as const)assert.throws(()=>check(source.replace(from,to)),error);
// SQL placeholder order remains correct with lookup in an outer projection.
const nested=source.replace('answer',`data nested = query! {
 let r = from(rows); r |> project({id:r.id, label:coalesce(lookup(r.label,[{value:"交换机",label:"SW"}]),"other")})
 |> order_by(asc(out.id)) |> take(10)
}; answer`).replace('UseTable(ref = rows)','UseTable(ref = nested)');
assert.equal(resolve(check(nested),db).values.nested[0].label,'SW');
db.close();
console.log('lookup and presentation boundary: passed');

function check(source: string, model?: import("./src/model.ts").ModelPort){return checkProgram(source,model,{allowTestSources:true});}
