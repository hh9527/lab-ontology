// Verify actual model time columns against the plugin's public result contract.
import assert from 'node:assert/strict';
import {withKnowledgeRunner as withRunner} from '../ontology/tools/knowledge-runner.mjs';
import {isResultColumn} from '../../dsh-oks/packages/dsh-oks/src/results.ts';
const cases=[['device','device_create_ms','EpochMillis'],['device_kpi','device_kpi_ts_raw','DateTimeUtc'],['source_SYS_BackupPower','source_SYS_BackupPower__manufacturedDate','String']];
await withRunner(process.argv[2],async(_,request)=>{
 const intents=cases.map(([entity,dimension])=>({op:'Graph',root:'r',nodes:[{id:'r',entity}],edges:[],select:[{node:'r',dimension}]}));
 const result=await request('ic/transform',{intents});
 assert.equal(result.accepted,true,JSON.stringify(result.diagnostics));
 assert.equal(result.queries.length,cases.length);
 for(const [i,q] of result.queries.entries()){
  assert.equal(q.columns.length,1);assert.equal(q.columns[0].type,cases[i][2]);
  assert.equal(isResultColumn(q.columns[0]),true,JSON.stringify(q.columns[0]));
 }
});
console.log('IC → plugin time column contract passed: EpochMillis, DateTimeUtc and Date text');
