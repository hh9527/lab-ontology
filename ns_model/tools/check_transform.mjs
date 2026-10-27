// Validate transform and execute emitted SQL; no knowledge discovery requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {withKnowledgeRunner as withRunner} from '../../ontology/tools/knowledge-runner.mjs';
const model=JSON.parse(readFileSync(new URL('../data/source-model.json',import.meta.url)));
const db=new DatabaseSync(':memory:');
const quote=s=>{assert.match(s,/^[A-Za-z_][A-Za-z_0-9]*$/);return `"${s}"`;};
for(const d of model.datasets) db.exec(`CREATE TABLE ${quote(d.table)} (${d.fields.map(f=>`${quote(f.column)} ${f.storage==='String'?'TEXT':f.storage==='Float'?'REAL':'INTEGER'}`).join(',')})`);
const graph=(d,dimension)=>({op:'Graph',root:'r',nodes:[{id:'r',entity:d.id}],edges:[],select:[{node:'r',dimension}]});
const dim=d=>d.fields.find(f=>f.dimension.some(x=>x[1])).dimension.find(x=>x[1])[0];
const execute=q=>db.prepare(q.sql).all(...q.bindings).map(r=>({...r}));
await withRunner(process.argv[2],async(_,request)=>{
 const batch=async intents=>{const res=await request('ns/transform',{intents});assert.equal(res.accepted,true,JSON.stringify(res.diagnostics));return res.queries;};
 for(let i=0;i<model.datasets.length;i+=5){const ds=model.datasets.slice(i,i+5);for(const q of await batch(ds.map(d=>graph(d,dim(d)))))assert.deepEqual(execute(q),[]);}
 // Every direct relation must produce executable SQL, including composite keys
 // and guarded source roles. Empty fixtures verify the physical schema mapping.
 const byId=new Map(model.datasets.map(d=>[d.id,d]));
 for(let i=0;i<model.relations.length;i+=5){
  const intents=model.relations.slice(i,i+5).map(rel=>({op:'Graph',root:'a',...(rel.cardinality.to.startsWith('Many')?{row_grain:'Association',distinct:true}:{}),nodes:[{id:'a',entity:rel.from},{id:'b',entity:rel.to}],edges:[{relation:rel.id,from:'a',to:'b'}],select:[{node:'a',dimension:dim(byId.get(rel.from))},{node:'b',dimension:dim(byId.get(rel.to))}]}));
  for(const q of await batch(intents))assert.deepEqual(execute(q),[]);
 }
 const metricCases=[];
 for(const d of model.datasets){
  for(const f of d.fields){
   if(metricCases.some(c=>c.nodes[0].entity===d.id))break;
   let names=[];
   if(f.measure_family.length){const spec=f.measure_family[0][0];const suffix=new Map(spec.naming.args[0].map(x=>[x.role.symbol.split('::').at(-1),x.suffix]));names=spec.variants.map(v=>spec.id+suffix.get(v.symbol.split('::').at(-1)));}
   else if(f.sample_measure.length)names=[...(f.sample_measure[0][1].symbol.endsWith('::Sum')?[]:[f.sample_measure[0][0]]),...f.sample_aggregate.map(x=>x[0])];
   if(names.length)metricCases.push({op:'Graph',root:'r',nodes:[{id:'r',entity:d.id}],edges:[],select:[],measures:names.map(measure=>({node:'r',measure}))});
  }
 }
 for(let i=0;i<metricCases.length;i+=5)for(const q of await batch(metricCases.slice(i,i+5)))execute(q);
 const ne=model.datasets.find(d=>d.id==='network-element');
 db.prepare(`INSERT INTO ${quote(ne.table)} (id,name,classification) VALUES (?,?,?)`).run('n1','Alpha','ne.category.switch');
 db.prepare(`INSERT INTO ${quote(ne.table)} (id,name,classification) VALUES (?,?,?)`).run('n2','Beta','ne.category.router');
 const canonical=graph(ne,'ne_id');canonical.filters=[{node:'r',dimension:'ne_classification',op:'Eq',value:'switch'}];
 const q=await batch([canonical]);assert.deepEqual(execute(q[0]),[{r_ne_id:'n1'}]);
 const sub=model.datasets.find(d=>d.id==='subnet');
 db.prepare(`INSERT INTO ${quote(sub.table)} (id,name) VALUES (?,?)`).run('s1','Subnet');
 const ref=ne.fields.find(f=>f.name==='ref_parent_subnet').column;
 db.prepare(`UPDATE ${quote(ne.table)} SET ${quote(ref)}=? WHERE id=?`).run('s1','n1');
 const joined={...graph(ne,'ne_id'),nodes:[{id:'r',entity:ne.id},{id:'s',entity:sub.id}],edges:[{relation:'ne_located_in_subnet',from:'r',to:'s'}],select:[{node:'r',dimension:'ne_id'},{node:'s',dimension:'subnet_name'}]};
 assert.ok(execute((await batch([joined]))[0]).some(r=>r.r_ne_id==='n1'&&r.s_subnet_name==='Subnet'));
 const bad=await request('ns/transform',{intents:[{...canonical,filters:[{node:'r',dimension:'ne_classification',op:'Eq',value:'not-a-member'}]}]});assert.equal(bad.accepted,false);
 console.log(`Passed ${model.datasets.length} dataset projections, ${model.relations.length} relation SQL cases, ${metricCases.length} sample families, canonical domain and invalid input checks`);
});
db.close();
