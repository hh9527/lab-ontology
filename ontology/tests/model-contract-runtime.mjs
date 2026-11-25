import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const publication=JSON.parse(readFileSync(process.argv[2]??0,'utf8'));
const {graph}=new Function('data',publication.program)(publication.data);
const facts=new Map(graph.facts.map(f=>[f.key,f.value]));
const d=facts.get('datasets/items');
assert(d,'The fixture dataset must be published');
assert.deepEqual(d.subjects.map(s=>s.entity),['entities/Item'],'An explicit identity binding supplies the conceptual subject');
assert.equal(d.fields.id.storage_type,'String');
assert(d.fields.id.type.startsWith('types/'),'Business identity must survive storage lowering');
assert.equal(d.fields.value.storage_type,'Float');
assert(d.fields.value.type.endsWith('Utilization'));
assert.equal(d.fields.value.nullable,true);
assert.deepEqual(d.fields.value.unit,{symbol:'%',quantity:'ratio',scale:0.01});
assert.equal(d.dimensions.value.type,d.fields.value.type,'A direct view and its logical field share the same type');
assert(d.fields.peer.type.startsWith('Reference('));
assert.equal(d.fields.peer.storage_type,'String');
assert.equal(d.fields.peer.nullable,true);
for(const [name,role]of [['id','Reference'],['peer','Reference'],['name','Appellation'],['raw','Classification'],['value','Metric']]){
 assert(d.fields[name].roles.includes(role),name+' requires '+role);
 assert.equal(new Set(d.fields[name].roles).size,d.fields[name].roles.length,'Roles are deduplicated');
}
assert.equal(d.measures.mean.type,d.fields.value.type);
assert.equal(d.measures.mean.unit,'%');
assert(facts.get(d.fields.value.type).calculations.includes('Mean'),'Knowledge inherits the same calculation policy as the checker');
assert(!facts.get(d.fields.value.type).calculations.includes('Sum'));
console.log('Model publication: logical/storage types, nullable References, inherited units and policies, conceptual subjects and derived roles passed');
