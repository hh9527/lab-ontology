// Check the actual static model resource, independently of the build-time embedding.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {collectProgrammedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {derivePublishedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
const source=readFileSync(new URL('../ontology/src/knowledge.js',import.meta.url),'utf8');
const declarations=source.slice(0,source.indexOf('if (!data ||'));
const helpers=new Function(declarations+'\nreturn {sha256,address,json};')();
for(const value of ['', 'abc', '中文/🙂', 'a'.repeat(10000)]) assert.equal(helpers.sha256(value),createHash('sha256').update(value).digest('hex'));
assert.equal(helpers.address('datasets',"a!()'*/%中文"),'datasets/a%21%28%29%27%2A%2F%25%E4%B8%AD%E6%96%87');
assert.equal(helpers.json({z:1,a:{z:2,a:0}}),'{"a":{"a":0,"z":2},"z":1}');
const build=new Function('data',source), empty={revision:'empty',instructions:[['types',[]]]};
assert.deepEqual(build(empty),{graph:{knowledge_contract:'ontology-knowledge-v4',intent_contract:'ontology-intent-v1',addressing:'node-member-uri-v1',revision:'empty',facts:[],items:[]},vocabulary:[]});
for(const value of [null,{}, {revision:'',instructions:[]},{revision:'bad',instructions:[]},
 {revision:'bad',instructions:[['toString',{}]]}, {revision:'bad',instructions:[['dataset',{}]]},
 {revision:'bad',instructions:[['types',[]],['types',[]]]}, {revision:'bad',instructions:[['types',[]],['entity']]},
 {revision:'bad',instructions:[['types',[]],['entity',{entity:'bad',identity:'missing'}]]}]) assert.throws(()=>build(value));
let facts=0;
for(const file of process.argv.slice(2)) {
 const publication=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(publication.program,source,'program must be static and identical across models');
 const before=structuredClone(publication.data);
 const first=await collectProgrammedKnowledge(publication),second=await collectProgrammedKnowledge(publication);
 assert.deepEqual(first,second);
 assert.deepEqual(publication.data,before);
 derivePublishedKnowledge(first.graph,undefined,first.vocabulary);
 facts+=first.graph.facts.length;
 // Model strings remain data even when they resemble code or object prototype names.
 const dataset=publication.data.instructions.find(([op])=>op==='dataset')?.[1];
 if(dataset) {
  const replacements=new Map([[dataset.id,'__proto__'],['id',"a!()'*/%中文"]]);
  const replace=value=>typeof value==='string' ? replacements.get(value)??value : Array.isArray(value) ? value.map(replace)
    : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])) : value;
  const modified=replace(publication.data);
  const built=build(modified),index=derivePublishedKnowledge(built.graph,undefined,built.vocabulary);
  assert.ok(Object.hasOwn(index.knowledge.datasets,'__proto__'));
  assert.equal(Object.getPrototypeOf(index.knowledge.datasets),Object.prototype);
 }
}
console.log(JSON.stringify({staticResource:true,publications:process.argv.length-2,facts,sha256:true,encoding:true,instructions:true,inputReusable:true}));
