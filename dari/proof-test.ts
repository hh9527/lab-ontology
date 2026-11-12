import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {check} from './src/compiler.ts';
import {createFixtureModel} from './fixture-model.ts';
import type {CheckedIntent,ProofReceipt} from './src/model.ts';

const source=readFileSync(new URL('./examples/device.dari',import.meta.url),'utf8');
const {model}=createFixtureModel();
for(const change of [
    (r:ProofReceipt)=>({...r,inputDigest:'stale'}),
    (r:ProofReceipt)=>({...r,contractId:'other-model'}),
    (r:ProofReceipt)=>({...r,consumedStepIds:r.consumedStepIds.slice(1)}),
    (r:ProofReceipt)=>({...r,consumedStepIds:[...r.consumedStepIds].reverse()}),
    (r:ProofReceipt)=>({...r,consumedStepIds:[r.consumedStepIds[0],...r.consumedStepIds.slice(0,-1)]}),
    (_r:ProofReceipt)=>undefined,
]){
    const altered={...model,check_type(intent:Parameters<typeof model.check_type>[0],encoded:Parameters<typeof model.check_type>[1]):CheckedIntent{
        const checked=model.check_type(intent,encoded);return {...checked,receipt:change(checked.receipt)!};
    }};
    assert.throws(()=>check(source,altered),/proof receipt does not cover the complete intent/);
}
assert.doesNotThrow(()=>check(source,model));
console.log('proof receipts: passed');
