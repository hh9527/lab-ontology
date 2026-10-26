import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {collectProgrammedKnowledge} from '../../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {derivePublishedKnowledge} from '../../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
const source=readFileSync(new URL('./build.js',import.meta.url),'utf8');
const declarations=source.slice(0,source.lastIndexOf('const state = initialize(data.revision);'));
const helpers=new Function(declarations+'\nreturn {sha256,address,json};')();
for(const value of ['', 'abc', '中文/🙂', 'a'.repeat(10000)]) assert.equal(helpers.sha256(value),createHash('sha256').update(value).digest('hex'));
assert.equal(helpers.address('datasets',"a!()'*/%中文"),'datasets/a%21%28%29%27%2A%2F%25%E4%B8%AD%E6%96%87');
assert.equal(helpers.json({z:1,a:{z:2,a:0}}),'{"a":{"a":0,"z":2},"z":1}');
const build=new Function('data',source);
assert.deepEqual(build({revision:'empty',types:[],datasets:[],capabilities:{dimensions:[],measures:[],relations:[],links:[]},relations:{relations:[],alternatives:[]}}),
 {graph:{knowledge_contract:'ontology-knowledge-v4',intent_contract:'ontology-intent-v1',addressing:'node-member-uri-v1',revision:'empty',facts:[],items:[]},vocabulary:[]});
if(process.argv[2]) {
 const publication=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const replace=value=>typeof value==='string' ? ({owners_1:'__proto__','features_runtime::OwnerId1':'__proto__',id:"a!()'*/%中文"}[value]??value)
   : Array.isArray(value) ? value.map(replace) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)])) : value;
 publication.data=replace(publication.data);
 const before=JSON.stringify(publication.data);
 const actual=build(publication.data);
 assert.equal(JSON.stringify(publication.data),before);
 const expected=await collectProgrammedKnowledge(publication,{enginePath:fileURLToPath(new URL('../../../dsh-oks/packages/dsh-oks/lib/oks-wti.wasm',import.meta.url))});
 const normalize=result=>({...result,graph:{...result.graph,facts:result.graph.facts.map(f=>({...f,references:[...new Set(f.references)].sort()})).sort((a,b)=>a.key.localeCompare(b.key,'en'))},vocabulary:[...result.vocabulary].sort((a,b)=>a.key.localeCompare(b.key,'en'))});
 assert.deepEqual(normalize(actual),normalize(expected));
 const index=derivePublishedKnowledge(actual.graph,undefined,actual.vocabulary);
 assert.ok(Object.hasOwn(index.knowledge.datasets,'__proto__'));
 assert.equal(Object.getPrototypeOf(index.knowledge.datasets),Object.prototype);
}
console.log('SHA256, URI/canonical encoding, empty graph, special identities, input reuse and graph/vocabulary equivalence passed');
