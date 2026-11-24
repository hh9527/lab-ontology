import assert from 'node:assert/strict';
import { createAvailability } from '../icloud-availability.mjs';

const hour = 3600000, day = 24 * hour;
const start = Date.parse('2026-09-24T11:28:22Z'), end = start + 60 * day;
const availability = createAvailability(20260926);
const resource = {id: 'I_EntNetworkElement-0001', classification: 'ne.category.switch'};
const events = availability.events(resource, start, end);
assert.ok(events.length > 0);
assert.deepEqual(events, createAvailability(20260926).events(resource, start, end));
assert.notDeepEqual(events, createAvailability(20260927).events(resource, start, end));
assert.notDeepEqual(events, availability.events({...resource,id:'I_EntNetworkElement-0002'}, start, end));
assert.notDeepEqual(events, availability.events({...resource,classification:'ne.category.printer'}, start, end));
assert.ok(new Set(events.map(e => e.end-e.start)).size > 3, 'Repair durations vary between events');
assert.ok(events.some(e => e.start % hour !== 0), 'Outages are independent of hour boundaries');

// Exact overlap, half-open boundaries and instantaneous state.
const event = events[0];
assert.equal(availability.rate(resource,event.start,event.end-event.start),0);
assert.equal(availability.rate(resource,event.start,1),0);
assert.equal(availability.rate(resource,event.start-1,1),100);
assert.equal(availability.rate(resource,event.end,1),100);
assert.ok(Math.abs(availability.rate(resource,event.start-60000,120000)-50)<1e-9);
assert.throws(()=>availability.rate(resource,start,0),/positive interval/);

// Sum of partitions must equal the same physical downtime at coarse resolution.
for (const at of [start,event.start-37*60000,Date.parse('1969-12-31T23:28:22Z')]) {
  const fine = Array.from({length:48},(_,i)=>availability.rate(resource,at+i*hour,hour));
  assert.ok(Math.abs(fine.reduce((a,b)=>a+b,0)/48-availability.rate(resource,at,48*hour))<1e-10);
}
assert.deepEqual(availability.events(resource, start+day,end-day),events.filter(e=>e.end>start+day&&e.start<end-day));

// Reproduce the original 150-device sampling grid. Interior minima and mean
// values must have real event-derived diversity; 0/100 remain valid boundaries.
const means=[],partialValues=new Set(),classMeans=new Map();
for (let i=0;i<150;i++) {
  const r={id:`I_EntNetworkElement-${String(i+1).padStart(4,'0')}`,classification:`class-${i%10}`};
  const samples=Array.from({length:1440},(_,j)=>availability.rate(r,start+j*hour,hour));
  assert.ok(samples.every(v=>v>=0&&v<=100));
  means.push(samples.reduce((a,b)=>a+b,0)/samples.length);
  for (const v of samples) if(v>0&&v<100)partialValues.add(v.toFixed(2));
  const group=classMeans.get(r.classification)??[];group.push(means.at(-1));classMeans.set(r.classification,group);
}
assert.ok(partialValues.size>100, 'Partial outages retain diverse actual overlap values');
assert.ok(means.some(v=>v<95)&&means.some(v=>v>99), 'Stable and unreliable populations remain distinguishable');
const grouped=[...classMeans.values()].map(values=>values.reduce((a,b)=>a+b,0)/values.length);
assert.ok(Math.max(...grouped)-Math.min(...grouped)>5, 'Class differences survive averaging over multiple devices');
console.log('Availability events: reproducible, identity-specific, interval-additive and diverse');
