// 使用插件适配器和 Node 原生 Wasm 验收统一转换；不调用 telora-run。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const [artifact,adapter,auditFile,databaseFile]=process.argv.slice(2);
assert(artifact&&adapter&&auditFile,'Usage: node ns_model/tools/check_transform.mjs <ns.wasm> <telora-model.ts> <audit.json> [data.sqlite]');
const adapterUrl=pathToFileURL(resolve(adapter));
const {openModel}=await import(adapterUrl);
const {encodeIntent,verifyReceipt,proofTarget,check}=await import(pathToFileURL(createRequire(adapterUrl).resolve('@hh9527/dari-core')));
const audit=JSON.parse(readFileSync(auditFile));
const host=await openModel(artifact),db=new DatabaseSync(databaseFile??':memory:',databaseFile?{readOnly:true}:{});
const quote=s=>'"'+s.replaceAll('"','""')+'"';
if(!databaseFile)for(const dataset of audit.datasets)db.exec(`CREATE TABLE ${quote(dataset.table)} (${dataset.fields.map(f=>quote(f.column)+' '+({String:'TEXT',Float:'REAL'}[f.scalar]??'INTEGER')).join(',')})`);
const datasets=new Map(Object.values(host.model.datasets).map(d=>[d.id,d]));
const member=(node,m)=>({kind:'member',node,member:m});
const dimension=d=>Object.values(d.members).find(m=>m.kind==='dimension');
let datasetCount=0,relationCount=0,measureCount=0,fanoutRejections=0;
function transform(nodes,fields,steps=[],root=0){
 if(nodes.length===2&&steps[0]?.kind==='connect'&&['Many0','Many1'].includes(steps[0].relation.toCardinality))root=1;
 const intent={kind:'query',root,nodes:nodes.map((dataset,index)=>({kind:'node',id:'n'+index,index,dataset})),steps:[...steps,{id:'projection',kind:'project',value:{kind:'record',fields}}, {id:'order',kind:'order_by',terms:[{direction:'Asc',value:{kind:'output',name:Object.keys(fields)[0]}}]},{id:'take',kind:'take',count:10}]};
 const encoded=encodeIntent(intent),checked=host.model.check_type(intent,encoded);
 verifyReceipt(checked.receipt,proofTarget(intent,host.model.contractId,encoded));
 const query=host.bind(checked.plan,[]);assert.ok(checked.maxRows<=10);
 assert.deepEqual(query.columns.map(c=>c.name),Object.keys(fields));
 return {query,checked};
}
const run=query=>db.prepare(query.sql).all(...query.bindings).map(row=>({...row}));
try{
 assert.equal(datasets.size,151);assert.equal(host.contract.relations.length,302);
 const wasm=new WebAssembly.Module(readFileSync(artifact));
 const publication=JSON.parse(new TextDecoder().decode(WebAssembly.Module.customSections(wasm,'telora.build.information')[0])).entries['ontology.knowledge'];
 const {graph}=new Function('data',publication.program)(publication.data);
 const facts=new Map([...graph.facts,...graph.relations].map(f=>[f.key,f.value]));
 assert.deepEqual(new Set([...facts.keys()].filter(k=>k.startsWith('datasets/')).map(k=>k.slice(9))),new Set(datasets.keys()));
 for(const d of datasets.values()){
  assert.match(d.symbol,/^ns::[A-Za-z_][A-Za-z_0-9]*$/);
  const rows=run(transform([d],{value:member(0,dimension(d))}).query);assert(rows.length<=10);if(!databaseFile)assert.deepEqual(rows,[]);datasetCount++;
  const measures=Object.values(d.members).filter(m=>m.kind==='measure');
  if(measures.length){
   const fields=Object.fromEntries(measures.map((m,i)=>['value_'+i,member(0,m)]));
   run(transform([d],fields).query);measureCount+=measures.length;
  }
 }
 for(const relation of Object.values(host.model.relations)){
  const a=datasets.get(relation.from),b=datasets.get(relation.to);
  const fields={left:member(0,dimension(a)),right:member(1,dimension(b))};
  const steps=[{id:'connection',kind:'connect',relation,from:0,to:1}];
  if(['Many0','Many1'].includes(relation.fromCardinality)&&['Many0','Many1'].includes(relation.toCardinality)){
   assert.throws(()=>transform([a,b],fields,steps),/multiplying relation|multiply root rows/);fanoutRejections++;continue;
  }
  const plan=transform([a,b],fields,steps);
  const rows=run(plan.query);assert(rows.length<=10);if(!databaseFile)assert.deepEqual(rows,[]);relationCount++;
 }
 const insert=(table,values)=>{const keys=Object.keys(values);db.prepare(`INSERT INTO ${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(values));};
 // 同键但端口类型或逻辑类型不符的行，正反向都不得穿透关系。
 if(!databaseFile){
 for(const [id,portType,logicType] of [['good','FC','0'],['wrong_kind','SAS','0'],['wrong_logic','FC','1']]){
  insert('SYS_StoragePort',{id,objSysId:id,portType,logicType});insert('enterpriseFrontPort2KPI',{OBJSYSID:id,OBJ_ID:id});
 }
 for(const id of ['efp2__stpo','efp2__stpo_rev']){
  const relation=Object.values(host.model.relations).find(r=>r.id===id),a=datasets.get(relation.from),b=datasets.get(relation.to);
  const projected=Object.values(a.members).find(m=>m.id===(id.endsWith('_rev')?'stpo_obj_sys_id':'efp2_obj_sys_id'));
  const peer=Object.values(b.members).find(m=>m.id===(id.endsWith('_rev')?'efp2_obj_sys_id':'stpo_obj_sys_id'));
  const plan=transform([a,b],{id:member(0,projected),peer:member(1,peer)},[{id:'connect',kind:'connect',relation,from:0,to:1}]);
  const matched=run(plan.query).filter(row=>row.peer!==null&&row.id!==null);
  assert.deepEqual(matched,[{id:'good',peer:'good'}]);
 }
 }
 // 实际 DARI 语法必须能访问规范化后的公开符号。
 check('data rows=query_remote! {from(ns::network_element).as!(a) |> project({id:a.ne_id}).as!(r) |> order_by(asc(r.id)) |> take(2)};answer tree! {Answer []};',host.model);
 console.log(`Passed: one NS artifact; ${datasetCount} datasets, ${relationCount} relation SQL cases, ${fanoutRejections} explicit many-to-many fanout rejections, ${measureCount} measures, conceptual knowledge, public symbols and guarded negative rows`);
}finally{db.close();await host.close();}
