import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openModel} from './model-bridge.ts';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 db.exec("CREATE TABLE I_EnterpriseFrame(name TEXT,refParentNE TEXT);CREATE TABLE I_EntNetworkElement(id TEXT,name TEXT);INSERT INTO I_EnterpriseFrame VALUES('matched','d1'),('missing',NULL);INSERT INTO I_EntNetworkElement VALUES('d1','device one')");
 const source=`data rows = query_remote! {
   let linked = from(ic::frame).as!(f)
     |> connect(ic::relations::frame_belongs_to_device).as!(d);
   let output = linked |> project({frame:f.frame_name,device:d.device_name});
   output |> order_by(asc(output.frame)) |> take(10)
 }; answer tree! { Answer [UseTable(ref = rows)] };`;
 const local=check('data input=table([{n:1}]);data rows=query! {from(input).as!(a) |> project({n:a.n})};answer tree! {Answer [UseTable(ref=rows)]};');
 assert.deepEqual(resolve(local,db).values.rows,[{n:1}]);
 const program=check(source,host.model);
 assert.match(show(program.bindings.get('rows')!.type),/device: Option\(String\)/);
 const rows=resolve(program,db).values.rows;
 assert.equal(rows.length,2);
 assert.equal(rows.find((r:any)=>r.frame==='missing').device,null);
 assert.equal(rows.find((r:any)=>r.frame==='matched').device,'device one');
 const reverse=source.replace('from(ic::frame).as!(f)','from(ic::device).as!(d)').replace('frame_belongs_to_device).as!(d)','frame_belongs_to_device).as!(f)');
 let reversed:any;
 assert.throws(()=>check(reverse,{...host.model,check_type(intent,encoded){reversed=intent;return host.model.check_type(intent,encoded);}}),/multiplying relation/);
 const edge=reversed.steps.find((s:any)=>s.kind==='connect');
 assert.equal(reversed.nodes[edge.from].dataset.id,'frame');
 assert.equal(reversed.nodes[edge.to].dataset.id,'device');
 assert.throws(()=>check(source.replace('.as!(d)','.as!(f)'),host.model),/Unknown model member/);
 assert.throws(()=>check(source.replace('from(ic::frame)','from(ic::tenant)'),host.model),/does not connect/);
 const projected=check(source.replace('project({frame:f.frame_name,device:d.device_name})','project({frame:f.frame_name,device:d.device_name}).as!(row)'),host.model);
 assert.deepEqual(resolve(projected,db).values.rows,rows);
 const shadow=check(`data rows=query_remote! {
  from(ic::frame).as!(r) |> connect(ic::relations::frame_belongs_to_device).as!(r)
  |> project({device:r.device_name}).as!(r) |> order_by(asc(r.device)) |> take(10)
 };answer tree! {Answer [UseTable(ref=rows)]};`,host.model);
 assert.deepEqual(resolve(shadow,db).values.rows,[{device:null},{device:'device one'}]);
 console.log('Postfix node bindings: inferred peers, named plans, reverse traversal, optional LEFT JOIN and diagnostics passed');
}finally{db.close();await host.close();}
