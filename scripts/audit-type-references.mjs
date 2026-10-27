// Audit a built model's type navigation policy without discovery requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readBuildInformation} from '../../dsh-oks/packages/dsh-oks/src/service-metadata.ts';
import {collectProgrammedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {derivePublishedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
import {resolveFact} from '../../dsh-oks/packages/dsh-oks/src/knowledge-graph.ts';
const info=readBuildInformation(readFileSync(process.argv[2]));
assert.ok(info?.['ontology.knowledge'],'model must publish knowledge');
const result=await collectProgrammedKnowledge(info['ontology.knowledge']);
const index=derivePublishedKnowledge(result.graph,undefined,result.vocabulary);
const types=result.graph.facts.filter(f=>f.key.startsWith('types/')&&!f.key.includes('#'));
const disabled=types.filter(t=>t.value.reverse_references!==true);
const typeKeys=new Set(types.map(t=>t.key));
for(const t of disabled){
 const node=resolveFact(index.knowledge,t.key);
 assert.equal(node.referenced_by,undefined,t.key);
 assert.equal(index.links.some(edge=>edge.target===t.key),false,t.key);
}
let nounPaths=0;
for(const t of types.filter(t=>t.value.reverse_references===true)){
 const values=result.graph.facts.filter(f=>f.key.startsWith(t.key+'#values/'));
 assert.ok(values.length>0,`opt-in must represent a business value domain: ${t.key}`);
 const dimensions=resolveFact(index.knowledge,t.key).referenced_by?.dimensions??[];
 assert.ok(dimensions.length>0,`business noun must reach dimensions: ${t.key}`);
 for(const value of values)assert.ok(resolveFact(index.knowledge,value.key).related?.types?.includes(t.key));
 for(const key of dimensions){
  const owner=key.split('#')[0];
  assert.ok(resolveFact(index.knowledge,key).referenced_by?.datasets?.includes(owner));
 }
 nounPaths+=values.length;
}
let forward=0;
for(const f of result.graph.facts)for(const target of f.references){
 if(!typeKeys.has(target))continue;
 const node=resolveFact(index.knowledge,f.key);
 assert.ok(node.related?.types?.includes(target),`${f.key} → ${target}`);
 forward++;
}
const timeTypes=types.filter(t=>['Date','DateTime','DateTimeUtc','EpochMillis'].some(name=>t.value.name?.endsWith('::'+name)||t.value.name?.endsWith('/'+name)||t.value.name===name));
for(const t of timeTypes)assert.equal(t.value.reverse_references,false,t.key);
assert.ok(timeTypes.length>0,'expected time types in IC');
const nonTypeLinks=index.links.filter(edge=>!edge.target.startsWith('types/'));
assert.ok(nonTypeLinks.some(edge=>edge.target.startsWith('entities/')));
assert.ok(nonTypeLinks.some(edge=>edge.target.startsWith('datasets/')));
console.log(JSON.stringify({types:types.length,reverseEnabled:types.length-disabled.length,reverseDisabled:disabled.length,timeTypes:timeTypes.map(t=>t.value.name),forwardTypeReferences:forward,nounValuePaths:nounPaths,nonTypeLinks:nonTypeLinks.length,datasets:Object.keys(index.knowledge.datasets).length,entities:Object.keys(index.knowledge.entities).length,relations:Object.keys(index.knowledge.relations).length}));
