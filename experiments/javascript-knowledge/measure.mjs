// Isolated end-to-end trial using the production plugin's graph/vocabulary consumer.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {collectProgrammedKnowledge} from '../../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {createJaqEngine} from '../../../dsh-oks/packages/dsh-oks/src/jaq.ts';
import {derivePublishedKnowledge} from '../../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
import {renderWholeVocabulary} from '../../../dsh-oks/packages/dsh-oks/src/retrieval.ts';
const [inputFile, mode='js', outputFile, expectedFile] = process.argv.slice(2);
assert.ok(inputFile && ['js','js-ops','jq','jq-single'].includes(mode));
const start = performance.now();
const text = readFileSync(inputFile, 'utf8');
const publication = JSON.parse(text);
const parsed = performance.now();
let source = readFileSync(new URL('./build.js', import.meta.url), 'utf8');
const enginePath = fileURLToPath(new URL('../../../dsh-oks/packages/dsh-oks/lib/oks-wti.wasm',import.meta.url));
let result, compiled, compileMs = 0;
let modelData = publication.data;
if (mode === 'js-ops') {
  modelData = {revision:publication.data.revision,instructions:[
    ['types', publication.data.types],
    ...publication.data.datasets.flatMap(d => d.roles.map(r => ['entity', r])),
    ...publication.data.datasets.map(d => ['dataset', d]),
    ['capabilities', publication.data.capabilities], ['relations', publication.data.relations],
  ]};
  source = source.replace('    entity(s, r);', '');
  source = source.slice(0, source.lastIndexOf('const state = initialize(data.revision);')) + `
const operations = {types,entity,dataset,capabilities,relations};
const state = initialize(data.revision);
for (const [operation,...args] of data.instructions) operations[operation](state,...args);
return finish(state);`;
}
if (mode === 'js' || mode === 'js-ops') {
  const t = performance.now();
  compiled = new Function('data', source);
  compileMs = performance.now() - t;
  result = compiled(modelData);
} else if (mode === 'jq') {
  result = await collectProgrammedKnowledge(publication,{enginePath});
} else {
  const engine = createJaqEngine(enginePath);
  // Same domain helpers, but one fold eliminates discovery/state transport overhead.
  const single = publication.program.slice(0, publication.program.lastIndexOf('if .op=="discovery"')) + `
.data as $d |
{revision:$d.revision,facts:{},types:(reduce $d.types[] as $t ({};.[$t.id]=$t)),remaining:0,phase:"aux"} |
reduce ($d.types[]|select(.inline|not)) as $t (.;mergefact(typefact(.types;$t))) |
reduce $d.datasets[] as $item (.;reduce datasetfacts(.types;$item) as $f (.;mergefact($f))) |
reduce capabilities($d.capabilities) as $f (.;mergefact($f)) |
reduce relationsources($d.relations) as $f (.;mergefact($f)) |
build_knowledge_graph(.)`;
  try {
    const reply=await engine.run(single,{input:{data:publication.data},timeoutMs:60000,maxBytes:64*1024*1024});
    assert.ok(reply.ok); result=reply.data;
  } finally {engine.dispose();}
}
const built = performance.now();
const index = derivePublishedKnowledge(result.graph,undefined,result.vocabulary);
const derived = performance.now();
const vocabulary = renderWholeVocabulary(index);
const rendered = performance.now();
const serialized = JSON.stringify(result);
const finished = performance.now();
const maxRssKiB = process.resourceUsage().maxRSS;
// All correctness and diagnostics are outside measured stages.
function normalize(value) {
  return {...value,graph:{...value.graph,facts:value.graph.facts.map(f=>({...f,references:[...new Set(f.references)].sort()})).sort((a,b)=>a.key.localeCompare(b.key,'en'))},
    vocabulary:[...value.vocabulary].sort((a,b)=>a.key.localeCompare(b.key,'en'))};
}
if(expectedFile) assert.deepEqual(normalize(result),normalize(JSON.parse(readFileSync(expectedFile,'utf8'))));
if(outputFile) writeFileSync(outputFile,serialized);
let warmMs;
if(compiled) {
  const observations=[];
  for(let i=0;i<5;i++){const t=performance.now();const next=compiled(modelData);observations.push(performance.now()-t);assert.deepEqual(normalize(next),normalize(result));}
  warmMs=observations;
  // Input remains reusable; construction must not mutate the published JSON.
  assert.deepEqual(publication,JSON.parse(text));
}
console.log(JSON.stringify({mode,inputFile,parseMs:parsed-start,compileMs,collectMs:built-parsed,deriveMs:derived-built,vocabularyMs:rendered-derived,
  serializeMs:finished-rendered,totalMs:finished-start,facts:result.graph.facts.length,terms:result.vocabulary.length,vocabularyBytes:Buffer.byteLength(vocabulary),
  resultBytes:Buffer.byteLength(serialized),jsonDataBytes:Buffer.byteLength(JSON.stringify(modelData)),staticJsBytes:Buffer.byteLength(source),
  maxRssKiB,warmMs,equivalent:!!expectedFile}));
