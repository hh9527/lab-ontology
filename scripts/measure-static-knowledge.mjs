// Measure actual model custom-section loading plus the production knowledge path.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {readBuildInformation} from '../../dsh-oks/packages/dsh-oks/src/service-metadata.ts';
import {collectProgrammedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/programmed-knowledge.ts';
import {derivePublishedKnowledge} from '../../dsh-oks/packages/dsh-oks/src/published-knowledge.ts';
import {renderWholeVocabulary} from '../../dsh-oks/packages/dsh-oks/src/retrieval.ts';
const start=performance.now();
const bytes=readFileSync(process.argv[2]);
const publication=readBuildInformation(bytes)?.['ontology.knowledge'];
const loaded=performance.now();
const result=await collectProgrammedKnowledge(publication);
const built=performance.now();
const index=derivePublishedKnowledge(result.graph,undefined,result.vocabulary);
const derived=performance.now();
const text=renderWholeVocabulary(index);
const rendered=performance.now();
assert.ok(index.terms.length>0);
console.log(JSON.stringify({artifact:process.argv[2],readAndParseMs:loaded-start,buildMs:built-loaded,deriveMs:derived-built,vocabularyMs:rendered-derived,totalMs:rendered-start,
 facts:result.graph.facts.length,terms:index.terms.length,vocabularyBytes:Buffer.byteLength(text),maxRssKiB:process.resourceUsage().maxRSS}));
