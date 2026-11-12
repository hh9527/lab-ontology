import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,cpSync,mkdtempSync,openSync,closeSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
let casesFile=process.argv[2];
if(!casesFile){
 const root=fileURLToPath(new URL('../../',import.meta.url));
 const work=mkdtempSync(join(process.env.TMPDIR||join(homedir(),'.cache/tmp'),'ic-mapped-pon-'));
 for(const crate of ['ontology','icloud_model'])cpSync(join(root,crate),join(work,crate),{recursive:true});
 // 验收库模型的原始 property，隔离服务专用的 build-time stage 入口。
 writeFileSync(join(work,'icloud_model/src/lib.telora'),'pub mod typed;\n');
 writeFileSync(join(work,'telora-config.json'),JSON.stringify({version:1,members:['ontology','icloud_model']}));
 const bin=resolve(root,'bin/telora');
 let result=spawnSync(bin,['-C',work,'lock'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 casesFile=join(work,'cases.json');const output=openSync(casesFile,'w');
 result=spawnSync(bin,['-C',join(work,'icloud_model'),'eval','@test/mapped_pon:runtime_cases','--initialization-fuel','100000','--with-memory-limit','512'],{stdio:['ignore',output,'pipe'],encoding:'utf8'});
 closeSync(output);assert.equal(result.status,0,result.stderr);
}
const cases=JSON.parse(readFileSync(casesFile,'utf8'));
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE I_EntPonElement(id TEXT,name TEXT,classification TEXT,parentOltResId TEXT);
CREATE TABLE PonDeviceOnuKPI(resId TEXT,tenantId TEXT,ts TEXT,onuHwOpticsRxPower REAL);
INSERT INTO I_EntPonElement VALUES
 ('olt-a','OLT A','ne.category.olt',''),('olt-b','OLT B','ne.category.olt',''),
 ('onu-a','ONU A','ne.category.pon.onu','olt-a'),('onu-b','ONU B','ne.category.pon.onu','olt-a'),
 ('onu-c','ONU C','ne.category.pon.onu','olt-b'),('spl','Splitter','ne.category.pon.spl','olt-a');
INSERT INTO PonDeviceOnuKPI VALUES
 ('onu-a','t','2026-11-09T00:00:00.000Z',-30),
 ('onu-b','t','2026-11-10T00:00:00.000Z',-10),
 ('onu-b','t','2026-11-11T00:00:00.000Z',-10),
 ('onu-c','t','2026-11-10T00:00:00.000Z',-20),
 ('onu-a','t','2026-11-12T00:00:00.000Z',-100),
 ('onu-c','t','2026-11-08T23:59:59.999Z',-100);`);
const run=i=>db.prepare(cases[i].sql).all(...cases[i].bindings).map(row=>({...row}));
assert.deepEqual(run(0),[{a_pon_olt_id:'olt-a'},{a_pon_olt_id:'olt-b'}]);
assert.deepEqual(run(1),[{a_pon_onu_id:'onu-a'},{a_pon_onu_id:'onu-b'},{a_pon_onu_id:'onu-c'}]);
const rows=run(2);
assert.equal(rows.length,2);
assert.equal(rows[0].c_pon_olt_id,'olt-b');
assert.equal(rows[0].a_onu_rx_power,-20);
assert.equal(rows[0].a_onu_rx_power_min,-20);
assert.equal(rows[1].c_pon_olt_id,'olt-a');
assert.equal(rows[1].a_onu_rx_power,-50/3);
assert.equal(rows[1].a_onu_rx_power_min,-30);
db.close();
console.log('IC PON roles and T8: source-coded role scopes, raw-sample AVG/MIN at OLT grain, half-open time filter, ranking and take passed');
