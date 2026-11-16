import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const path=process.argv[2];assert.ok(path,'Usage: node scripts/check-ns-source.mjs <audit.json>');
const audit=JSON.parse(readFileSync(path));
const source=JSON.parse(readFileSync(new URL('../ns_model/data/source-model.json',import.meta.url)));
const contract=JSON.parse(readFileSync(new URL('../ns_model/data/generation-contract.json',import.meta.url)));
assert.equal(audit.datasets.length,151);assert.equal(audit.relations.length,302);
assert.equal(audit.datasets.reduce((n,d)=>n+d.fields.length,0),2118);
const datasets=new Map(audit.datasets.map(d=>[d.id,d]));
const dimensions=new Map(audit.dimensions.map(d=>[d.dataset+'/'+d.id,d]));
let measures=0;
for(const expected of contract.datasets){
 const actual=datasets.get(expected.id);assert.ok(actual,expected.id);assert.equal(actual.table,expected.table);
 assert.deepEqual([...actual.grain].sort(),[...expected.grain].sort());
 for(const f of expected.fields){
  const field=actual.fields.find(x=>x.name===f.name);assert.ok(field,expected.id+'/'+f.name);
  assert.equal(field.column,f.column);assert.equal(field.scalar,f.storage);assert.equal(field.nullable,f.nullable);
  for(const d of f.dimensions){
   const dim=dimensions.get(expected.id+'/'+d.id);assert.ok(dim,'lost dimension '+d.id);
   if(f.domain){
    const domain=contract.domains[f.domain];assert.ok(domain,'unknown domain '+f.domain);
    // canonical values describe explicit wire mappings; the open fallback has no wire entry.
    for(const member of domain.members){
     const value=dim.values.find(v=>v.wires.length===member.wires.length&&v.wires.every(w=>member.wires.includes(Object.values(w)[0])));assert.ok(value,'lost canonical value '+d.id+'/'+member.id);
     assert.equal(value.label,member.label,'canonical label '+d.id+'/'+member.id);
     assert.deepEqual(value.wires.map(w=>Object.values(w)[0]).sort(),[...member.wires].sort(),'canonical wires '+d.id+'/'+member.id);
    }
   }
  }
  for(const m of f.measures){assert.ok(actual.sample_measures.some(x=>x.id===m.id),'lost statistic '+m.id);measures++;}
 }
}
assert.equal(measures,3038);
for(const name of ['clear_utc','occur_utc']){
 const field=datasets.get('alarm-record').fields.find(f=>f.name===name);
 assert.equal(field.nullable,true);assert.equal(field.time.encoding,'EpochMillis');
}
const pairs=(key,from,to)=>key.Eq?[[from,key.Eq.from_column,to,key.Eq.to_column]]:key.And?key.And.flatMap(k=>pairs(k,from,to)):(()=>{throw Error('source audit requires conjunctive relation keys')})();
const edgePairs=r=>pairs(r.key,r.from_table,r.to_table).map(p=>p.join('.'));
let reviewed=0;const missing=[];
for(const relation of source.catalog.relations){
 if(!relation.condition){missing.push(relation.name);continue;}
 const expected=[...relation.condition.matchAll(/([\w]+)\.([\w]+)\s*=\s*([\w]+)\.([\w]+)/g)].map(m=>m.slice(1));
 assert.ok(expected.length,relation.name);
 const candidates=audit.relations.filter(r=>expected.every(p=>edgePairs(r).some(k=>k===p.join('.')||k===[p[2],p[3],p[0],p[1]].join('.'))));
 assert.ok(candidates.length,'source equality not represented: '+relation.name);reviewed++;
}
assert.deepEqual(missing.sort(),['BondPortBondEthPort','OpticalModuleBondPort','SubnetLocatedInSubnet']);
const front=audit.relations.find(r=>r.id==='efp2__stpo_rev');
assert.ok(front.guard?.all,'front-port relation must retain all source conditions');
assert.equal(front.guard.all[0].field,'logic_type');assert.deepEqual(front.guard.all[0].input,{Text:'0'});
assert.deepEqual(front.guard.all[1].any.map(x=>x.input.Text),['FC','FCoE','ETH','RoCE']);
const forward=audit.relations.find(r=>r.id==='efp2__stpo');
assert.ok(forward.guard.all.every(x=>x.to||x.any?.every(y=>y.to)),'forward relation guard must bind target port fields');
console.log(`Passed: 151 datasets, 2118 fields, 3038 statistics, all original dimensions, ${reviewed} source relation conditions and explicit 3 missing-source exclusions`);
