import assert from 'node:assert/strict';
import {createKpiWaves} from '../kpi-waveforms.mjs';
const start=Date.parse('2026-10-01T00:00:00.000Z');
const sample=wave=>Array.from({length:7*24*4},(_,i)=>wave.at(start+i*900000));
const first=createKpiWaves(20261031),again=createKpiWaves(20261031);
const a=first('device','cpu',0),b=first('device','cpu',1),c=first('device','memory',0);
assert.deepEqual(sample(a),sample(again('device','cpu',0)),'Fixed seed reproduces the full series');
assert.notDeepEqual(sample(a),sample(createKpiWaves(20261030)('device','cpu',0)));
assert.notDeepEqual(sample(a),sample(b),'Devices have independent phases, amplitudes and jitter');
assert.notDeepEqual(sample(a),sample(c),'Metrics have independent phases, amplitudes and jitter');
assert.notEqual(a.phase,b.phase);assert.notEqual(a.amplitude,b.amplitude);assert.notEqual(a.jitterHours,b.jitterHours);
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
for(const wave of [a,b,c]) {
 const values=sample(wave);
 const day=values.filter((_,i)=>{const h=(i/4+8)%24;return h>=12&&h<16;}).map(v=>v.load);
 const night=values.filter((_,i)=>{const h=(i/4+8)%24;return h>=0&&h<5;}).map(v=>v.load);
 assert(avg(day)>avg(night)*2,'Broad wave retains a daytime business peak');
 const jitter=values.map(v=>v.jitter);
 assert(Math.max(...jitter)-Math.min(...jitter)>0.02,'Small wave adds visible stochastic jitter');
 assert(jitter.every(v=>Math.abs(v)<0.16),'Jitter stays smaller than the broad wave');
 assert(values.some((v,i)=>i>=96&&v.jitter!==values[i-96].jitter),'Noise does not repeat every day');
}
console.log('KPI waves: seeded reproducibility, per-device/metric variation, day/night envelope and bounded nonperiodic jitter passed');
