// 校验数据清单，并通过统一模型转换执行真实数据库查询。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {validate} from './generate-ns-data.mjs';
const [directory,artifact,adapter,audit]=process.argv.slice(2);
assert(directory&&artifact&&adapter&&audit,'Usage: node scripts/check-ns-data.mjs <data-directory> <ns.wasm> <telora-model.ts> <audit.json>');
const root=resolve(directory),model=JSON.parse(readFileSync(join(root,'model.json'))),manifest=JSON.parse(readFileSync(join(root,'manifest.json')));
const sha=data=>createHash('sha256').update(data).digest('hex');
assert.equal(sha(readFileSync(join(root,'ns.sqlite'))),manifest.databaseSha256);
assert.equal(sha(JSON.stringify(model)),manifest.modelSha256);
const database=new DatabaseSync(join(root,'ns.sqlite'),{readOnly:true});
try{const result=validate(database,model,manifest);assert.equal(result.cardinalityExceptions.length,0);}finally{database.close();}
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../ns_model/tools/check_transform.mjs',import.meta.url)),artifact,adapter,audit,join(root,'ns.sqlite')],{encoding:'utf8',timeout:180000});
if(result.error)throw result.error;
process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0,'model-backed NS fixture query validation failed');
