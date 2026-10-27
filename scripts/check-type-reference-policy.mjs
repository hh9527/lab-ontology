// Tiny Telora publication fixture only; no full model knowledge traversal.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectProgrammedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {derivePublishedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
import {resolveFact} from '../../dsh-oks/packages/dsh-oks/src/knowledge-graph.ts';
const publication=JSON.parse(readFileSync(process.argv[2],'utf8'));
const {graph}=await collectProgrammedKnowledge(publication);
const disabled=['Date','DateTime','DateTimeUtc','EpochMillis','SharedCode','OrdinaryCode'];
const types=new Map();
for(const name of [...disabled,'OptInCode']){
 const matches=graph.facts.filter(f=>f.value.name?.endsWith('::'+name)||f.value.name?.endsWith('/'+name)||f.value.name===name);
 assert.equal(matches.length,1,name);types.set(name,matches[0]);
 assert.equal(matches[0].value.reverse_references,!disabled.includes(name),name);
}
graph.facts.push({key:'datasets/fixture',value:{},references:[]});
for(const [name,type] of types)graph.facts.push({key:`datasets/fixture#fields/${name}`,value:{type:type.key},references:[type.key]});
const index=derivePublishedKnowledge(graph);
for(const [name,type] of types){
 const source=`datasets/fixture#fields/${name}`;
 assert.deepEqual(resolveFact(index.knowledge,source).related.types,[type.key]);
 assert.equal(index.links.some(edge=>edge.target===type.key),!disabled.includes(name));
 if(disabled.includes(name))assert.equal(resolveFact(index.knowledge,type.key).referenced_by,undefined);
 else assert.deepEqual(resolveFact(index.knowledge,type.key).referenced_by.fields,[source]);
}
console.log('Type property → publication JSON → static JS → plugin policy passed');
