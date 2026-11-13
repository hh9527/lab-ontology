import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {openModel} from './model-bridge.ts';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';

const host=await openModel(process.argv[2]);
const db=new DatabaseSync(':memory:');
try{
 const relation=host.model.relations!['ic::relations::frame_belongs_to_device'];
 assert.equal(relation.from,'frame');assert.equal(relation.to,'device');assert.equal(relation.toCardinality,'Optional');
 db.exec("CREATE TABLE I_EnterpriseFrame(name TEXT,refParentNE TEXT);CREATE TABLE I_EntNetworkElement(id TEXT,name TEXT);INSERT INTO I_EnterpriseFrame VALUES('有设备','d1'),('无设备',NULL);INSERT INTO I_EntNetworkElement VALUES('d1','交换机一')");
 const source=`data rows = query_remote! {
 let f = from(ic::frame);let d = from(ic::device);
 f |> connect(ic::relations::frame_belongs_to_device,f,d)
   |> project({frame:f.frame_name,device:d.device_name}).as!(out)
   |> order_by(asc(out.frame)) |> take(10)
};answer tree! { Answer [Table(data = rows)]};`;
 const program=check(source,host.model);
 assert.match(show(program.bindings.get('rows')!.type),/device: Option\(String\)/);
 const result=resolve(program,db);
 assert.equal(result.values.rows.length,2);
 assert.equal(result.values.rows.find((r:any)=>r.frame==='无设备').device,null);
 assert.equal(result.values.rows.find((r:any)=>r.frame==='有设备').device,'交换机一');
 const required=source.replace('device:d.device_name','device:not_none(d.device_name)').replace('take(10)','take(1)');
 const requiredProgram=check(required,host.model);
 assert.match(show(requiredProgram.bindings.get('rows')!.type),/device: String/);
 assert.deepEqual(resolve(requiredProgram,db).values.rows,[{frame:'有设备',device:'交换机一'}]);
 const classification=source.replace('device:d.device_name','classification:d.device_class').replace('asc(out.frame)','asc(out.classification)');
 assert.throws(()=>check(classification,host.model),(error:Error)=>{
  assert.match(error.message,/d.device_class/);assert.match(error.message,/没有声明业务排序/);
  assert(!error.message.includes('node_1_device_class'));return true;
 });
 assert.throws(()=>check(source.replace('frame_belongs_to_device,f,d','frame_belongs_to_device,d,f'),host.model),/relation|endpoint|entity/i);
 assert.throws(()=>check(source.replace('connect(ic::relations::frame_belongs_to_device,f,d)\n   |> ',''),host.model),/disconnected|connected|edge|grain/i);
 console.log('multi-node Relation: published symbols, optional LEFT JOIN, nullable Schema, endpoint and connectivity checks passed');
}finally{db.close();await host.close();}
