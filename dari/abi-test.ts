import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {check} from './src/compiler.ts';
import {type EncodedIntent,type IntentType} from './src/model.ts';
import {openModel} from './model-bridge.ts';

const host=await openModel(process.argv[2]);
try{
    assert.equal(host.contract.abi_version,'dari-model/v2');
    assert.deepEqual(Object.keys(host.model.datasets),host.contract.datasets.map(d=>d.symbol));
    assert.deepEqual(Object.keys(host.model.types!),host.contract.types.map(t=>t.name));
    for(const name of Object.keys(host.model.types!))assert.match(name,/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/);
    for(const d of host.contract.datasets)assert.deepEqual(Object.keys(host.model.datasets[d.symbol].members),d.members.map(m=>m.symbol));
    let json='';
    const recording={...host.model,check_type(intent:IntentType,encoded:EncodedIntent){json=encoded.json;return host.model.check_type(intent,encoded);}};
    const source=readFileSync(new URL('./examples/ic-device.dari',import.meta.url),'utf8');
    check(source,recording);
    const checked=host.checkWire(json),wire=JSON.parse(json);
    assert.equal(checked.receipt.contractId,host.model.contractId);
    assert.equal(checked.receipt.inputDigest,createHash('sha256').update(json).digest('hex'));
    assert.deepEqual(checked.receipt.consumedStepIds,wire.steps.map((s:any)=>s.id));
    const mutate=(change:(w:any)=>void)=>{const w=JSON.parse(json);change(w);return JSON.stringify(w);};
    assert.throws(()=>host.checkWire(mutate(w=>w.steps.splice(-1,0,{id:'unknown-step',kind:'unknown-op',body:{}}))),/unsupported model operation/);
    assert.throws(()=>host.checkWire(mutate(w=>w.steps[1].id=w.steps[0].id)),/step identity/);
    assert.throws(()=>host.checkWire(mutate(w=>w.steps.find((s:any)=>s.kind==='filter').body.left.node='missing')),/declared query node|declared node/);
    assert.throws(()=>host.checkWire(mutate(w=>w.steps=w.steps.filter((s:any)=>s.kind!=='project'))),/preceding projection|requires a projection/);
    assert.throws(()=>host.checkWire(mutate(w=>w.nodes.push({id:'second',dataset:w.nodes[0].dataset}))),/disconnected|connected|edge/);
    assert.throws(()=>host.checkWire(mutate(w=>w.steps.find((s:any)=>s.kind==='project').body.fields[0].value={kind:'binary',op:'*',left:{kind:'member',node:w.nodes[0].id,member:'cpu_usage'},right:{kind:'parameter',index:4,input_type:'Float',nullable:false}})),/direct member reference/);
    assert.throws(()=>host.checkWire(mutate(w=>{const p=w.steps.find((s:any)=>s.kind==='filter').body;[p.left,p.right]=[p.right,p.left];})),/single comparison/);
    assert.throws(()=>host.checkWire(mutate(w=>{const p=w.steps.find((s:any)=>s.kind==='filter').body;p.op='&&';})),/compound row filter requires comparisons/);
    const dimension=host.contract.datasets.find(d=>d.symbol==='ic::device_kpi')!.members.find(m=>m.kind==='dimension'&&m.symbol!=='device_kpi_res_id')!;
    const hidden=host.checkWire(mutate(w=>w.steps.find((s:any)=>s.kind==='order_by').body.terms[0].value={kind:'member',node:w.nodes[0].id,member:dimension.symbol}));
    assert.deepEqual(hidden.columns.map(c=>c.name),checked.columns.map(c=>c.name));
    check(source.replaceAll(/\ba\b/g,'device'),host.model);
    const badTime='data q=query_remote! {let a=from(ic::current_alarm);a |> filter(a.alarm_occur_utc_raw >= "2026-11-01T00:00:00Z") |> project({total:a.alarm_count}) |> take(1)};answer tree! { Answer []};';
    assert.throws(()=>check(badTime,host.model),(error:Error)=>{
        assert.match(error.message,/a.alarm_occur_utc_raw expects EpochMillis \(EpochMillis\), got String \(String\)/);
        assert(error.message.includes('L1:'+(badTime.indexOf('"2026-')+1)));
        return true;
    });
    console.log(JSON.stringify({status:'passed',receiptSteps:checked.receipt.consumedStepIds.length,datasets:host.contract.datasets.length,typeSymbols:host.contract.types.length}));
}finally{await host.close();}
