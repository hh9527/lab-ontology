import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {check,show} from './src/compiler.ts';
import {resolve} from './src/runtime.ts';
import {openModel} from './model-bridge.ts';
import {testEnums} from './enum-test.ts';
import {primaryCodecs} from './src/primary-codecs.ts';

const artifact=process.argv[2];
if(!artifact)throw Error('Usage: node dari/ic-test.ts /path/to/ic-dari.wasm');
const start=performance.now();
const host=await openModel(artifact);
const source=readFileSync(new URL('./examples/ic-device.dari',import.meta.url),'utf8');
const db=new DatabaseSync(':memory:');
try{
    assert.equal(primaryCodecs.Bool.encode(true),1);
    assert.equal(primaryCodecs.Bool.decode(0),false);
    assert.equal(primaryCodecs.EpochMillis.parse(0),0);
    assert.equal(primaryCodecs.DateTimeUtc.parse('2026-11-10T00:00:00Z'),'2026-11-10T00:00:00.000Z');
    assert.throws(()=>primaryCodecs.Int.parse(1.5));
    assert.throws(()=>primaryCodecs.Float.parse(Infinity));
    assert.throws(()=>primaryCodecs.String.parse(1));
    assert.throws(()=>primaryCodecs.Bool.parse(1));
    assert.throws(()=>primaryCodecs.DateTimeUtc.parse('2026-11-10'));
    const sharedTypes=new Map<string,unknown>();
    for(const dataset of Object.values(host.model.datasets))for(const member of Object.values(dataset.members)){
        const type=member.type.kind==='option'?member.type.inner!:member.type;
        if(type.kind!=='nominal')continue;
        const key=type.name+'@'+(type.inner?.name??type.name);
        if(sharedTypes.has(key))assert.equal(type,sharedTypes.get(key),'members share the same type instance');
        else sharedTypes.set(key,type);
    }
    assert(host.model.datasets['ic::device_kpi']);
    assert(host.model.datasets['ic::device_kpi'].members.cpu_usage);
    assert.match(show(host.model.datasets['ic::device_kpi'].members.cpu_usage.type),/Percent|CpuUtilization/);
    db.exec(`CREATE TABLE NetworkDeviceKPI(resId TEXT, tenantId TEXT, ts TEXT, cpuUsage REAL);
        INSERT INTO NetworkDeviceKPI VALUES
        ('one','t','2026-11-01T00:00:00Z',10),('one','t','2026-11-01T01:00:00Z',90),
        ('two','t','2026-11-01T00:00:00Z',60),('two','t','2026-11-01T01:00:00Z',80)`);
    const first=performance.now();const program=check(source,host.model);const firstCheckMs=performance.now()-first;
    console.log('types',JSON.stringify([...program.bindings].map(([n,b])=>[n,show(b.type)])));
    const output=resolve(program,db,{request:{floor:60}});
    assert.equal(output.answer,'最高 CPU：*90%*');
    assert.equal(resolve(program,db,{request:{floor:100}}).answer,'最高 CPU：*无数据*');
    const singleton=`data row = query_remote! {
        let a = from(ic::device_kpi); a |> project({cpu:a.cpu_usage}) |> take_opt()
    }; answer tree! { Answer [Value(data = row, field = project!(cpu))] };`;
    assert.equal(resolve(check(singleton,host.model),db).answer,'*60%*');
    assert.equal(resolve(check(singleton.replace('take_opt()','take(1)'),host.model),db).answer,'*60%*');
    assert.throws(()=>check(singleton.replace('cpu:a.cpu_usage','cpu:a.device_kpi_res_id'),host.model),/multirow|order|bound/);
    const requestsBefore=host.stats.requests;
    resolve(program,db,{request:{floor:40}});
    assert.equal(host.stats.requests,requestsBefore,'resolve should only bind a checked plan');
    // This rejection must originate in the real model, not a duplicated JS checker.
    const before=host.stats.requests;
    assert.throws(()=>check(source.replace('floor: ic::CpuFloor','floor: String'),host.model),/threshold|output/);
    assert(host.stats.requests>before);
    assert.throws(()=>check(source.replace('group_by_identity(a)\n      |> ',''),host.model),/complete root identity/);
    assert.throws(()=>check(source.replace('a.cpu_usage >','a.not_a_measure >'),host.model),/Unknown model member/);
    const codecRequests=host.stats.requests;
    assert.throws(()=>resolve(program,db,{request:{floor:101}}),/outside model range/);
    assert.throws(()=>resolve(program,db,{request:{floor:'60'}}),/invalid model scalar/);
    assert.equal(host.stats.requests,codecRequests,'generated codec must validate locally');
    const emitted=await import('data:text/javascript;base64,'+Buffer.from(host.codecModuleSource).toString('base64'));
    const codecs=emitted.createCodecs(primaryCodecs);
    const floor=host.model.types!['ic::CpuFloor'].codec!;
    const entries=[...host.codecModuleSource.slice(0,host.codecModuleSource.indexOf('export const presentations')).matchAll(/"([^"\n]+@(?:Int|Float|String|Bool|EpochMillis|DateTimeUtc|DateTime))":/g)].map(match=>match[1]);
    assert.equal(entries.length,new Set(entries).size,'one definition per custom type and encoding');
    assert(entries.every(key=>!Object.hasOwn(primaryCodecs,key.split('@')[0])),'primary codecs must not be published by the model');
    for(const dataset of host.contract.datasets)for(const member of dataset.members)assert(!Object.hasOwn(member,'js_codec'),'members carry type references only');
    assert.equal(floor.parse(60),60);
    assert.equal(floor.encode(60),60);
    assert.equal(floor.decode(60),60);
    assert.throws(()=>floor.parse(-1),/outside model range/);
    const enumRequests=host.stats.requests;
    testEnums(host.model,codecs,emitted.mappings,db);
    assert.equal(host.stats.requests,enumRequests+4,'enum Graph checks use the model; codecs and mappings run locally');
    for(const [op,value,expected] of [['Eq','Unknown',['brand-new']],['Ne','Unknown',['LSW','ne.category.switch']],['Ne','Lsw',['brand-new']]] as const){
        const filtered=host.transform({intents:[{op:'Graph',root:'a',nodes:[{id:'a',entity:'device'}],edges:[],select:[{node:'a',dimension:'device_class_raw'}],measures:[],filters:[{node:'a',dimension:'device_class',op,value}],order_by:[{column:'a_device_class_raw',direction:'Asc'}],take:10}]});
        assert.equal(filtered.accepted,true,JSON.stringify(filtered));
        assert.deepEqual(db.prepare(filtered.queries[0].sql).all(...filtered.queries[0].bindings).map(row=>row.a_device_class_raw),expected);
    }
    const literal=source.replace('a.cpu_usage > request.floor','a.cpu_usage > 60');
    assert.equal(resolve(check(literal,host.model),db).answer,'最高 CPU：*90%*');
    // A changed value binds the same template; it never changes the result type.
    const at=performance.now();check(source,host.model);const checkMs=performance.now()-at;
    const run=performance.now();resolve(program,db,{request:{floor:60}});const resolveMs=performance.now()-run;
    const baseline={intents:[{op:'Graph',root:'n0',nodes:[{id:'n0',entity:'device_kpi'}],edges:[],group_by_identity:['n0'],select:[{node:'n0',dimension:'device_kpi_res_id'}],measures:[{node:'n0',measure:'cpu_usage'}],measure_having:[{node:'n0',measure:'cpu_usage',op:'Gt',value:60}],order_by:[{column:'n0_cpu_usage',direction:'Desc'}],take:5}]};
    const original=host.transform(baseline);
    assert.equal(original.accepted,true,JSON.stringify(original));
    assert.deepEqual(db.prepare(original.queries[0].sql).all(...original.queries[0].bindings).map(r=>r.n0_cpu_usage),[90,80]);
    const old=performance.now();host.transform(baseline);const transformMs=performance.now()-old;
    console.log(JSON.stringify({status:'passed',customCodecs:entries.length,codecModuleBytes:Buffer.byteLength(host.codecModuleSource),contractBytes:Buffer.byteLength(JSON.stringify(host.contract)),artifactBytes:statSync(artifact).size,contractMs:host.stats.contractMs,firstCheckMs,checkMs,resolveMs,transformMs,runnerChecks:host.stats.checkMs.length,totalMs:performance.now()-start}));
}finally{db.close();await host.close();}
