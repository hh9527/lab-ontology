import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Local acceptance only: node icloud_model/tests/semantic-knowledge.mjs /tmp/ic.wasm
const module = new WebAssembly.Module(readFileSync(process.argv[2]));
const sections = WebAssembly.Module.customSections(module, 'telora.build.information');
assert.equal(sections.length, 1);
const publication = JSON.parse(new TextDecoder().decode(sections[0])).entries['ontology.knowledge'];
const {graph} = new Function('data', publication.program)(publication.data);
const facts = new Map([...graph.facts, ...graph.relations].map(f => [f.key, f.value]));
const datasets = [...facts].filter(([key]) => key.startsWith('datasets/'));
assert.equal(datasets.length, 50);
const resolve = ref => {
  const [root, suffix] = ref.split('#');
  return suffix ? suffix.split('/').map(decodeURIComponent).reduce((value, key) => value?.[key], facts.get(root)) : facts.get(root);
};
for (const [id, dataset] of datasets) {
  assert.ok(dataset.subjects?.length, `${id}: missing conceptual subject`);
  assert.ok(dataset.props?.length, `${id}: missing queryable properties`);
  for (const subject of dataset.subjects) {
    assert.ok(resolve(subject.entity), `${id}: unknown subject entity`);
    assert.ok(resolve(subject.field), `${id}: unknown subject field`);
  }
  for (const prop of dataset.props) {
    assert.ok(resolve(prop.field), `${id}: unknown property field`);
    for (const ref of [...prop.dimensions, ...prop.measures, ...prop.counters]) {
      assert.ok(resolve(ref), `${id}: unknown property query address ${ref}`);
    }
  }
}
const device = facts.get('datasets/device_kpi');
const noEntityCount = new Set(['datasets/frame']);
for (const [id, dataset] of datasets) {
  const counters = dataset.props.flatMap(prop => prop.counters);
  if (noEntityCount.has(id)) {
    assert.equal(dataset.grain.length, 0, `${id}: no unique grain evidence`);
    assert.equal(counters.length, 0, `${id}: do not invent an entity count`);
  } else assert(counters.length, `${id}: missing declared inventory or sample counter`);
  for (const [name, dimension] of Object.entries(dataset.dimensions)) {
    assert.equal(typeof dimension.groupable, 'boolean', `${id}/${name}: missing grouping capability`);
    if (dimension.groupable) assert(dimension.projectable && dimension.authorized, `${id}/${name}: grouping cannot expand projection`);
  }
}
for(const id of ['source_EnterpriseOpticalModule','source_SYS_StorageDisk']){
  assert.deepEqual(facts.get('datasets/'+id).grain,['source_id']);
}
assert.deepEqual(facts.get('datasets/onu_kpi').grain,['res_id','ts']);
assert.equal(facts.get('datasets/device').dimensions.device_name.groupable, false);
assert.equal(facts.get('datasets/device').dimensions.device_class.groupable, true);
assert.equal(device.dimensions.device_cpu_sample.groupable, false);
assert.deepEqual(device.subjects.map(s => s.entity), ['entities/Device']);
assert.ok(device.props.find(p => p.name === 'cpu_usage').measures.includes('datasets/device_kpi#measures/cpu_usage'));
// An SSID sample has a Device reference; that does not make its measures Device properties.
assert.deepEqual(facts.get('datasets/ap_radio_ssid_kpi').subjects.map(s => s.entity), ['entities/Ssid']);
assert.deepEqual(new Set(facts.get('datasets/source_StorageDeviceKPI').subjects.map(s => s.entity)), new Set(['entities/Storage', 'entities/FcSwitch']));
assert.ok(facts.get('datasets/current_alarm').props.some(p => p.counters.includes('datasets/current_alarm#measures/alarm_count')));
const severity = facts.get('datasets/current_alarm').props.find(p => p.name === 'severity');
assert.ok(severity?.types.some(type => type.includes('AlarmSeverity')), 'enum property must retain its logical value type');
console.log('Passed: all 50 IC conceptual subjects, property/query mappings, counters, enum types and multiple subjects');

// Author-facing field types survive lowering; physical representations remain explicit.
const cpu = device.fields.cpu_usage;
assert(cpu.type.endsWith('CpuUtilization'));
assert.equal(cpu.storage_type, 'Float');
assert.deepEqual(cpu.unit, {symbol:'%', quantity:'ratio', scale:0.01});
assert.equal(device.dimensions.device_cpu_sample.type, cpu.type);
assert(facts.get('datasets/device').fields.id.type.endsWith('DeviceById'));
assert.equal(facts.get('datasets/device').fields.id.storage_type, 'String');
assert(facts.get('datasets/device').fields.tenant_id.type.startsWith('Reference('));
assert(facts.get('datasets/device').fields.tenant_id.roles.includes('Reference'));
assert(facts.get('datasets/tenant').fields.name.roles.includes('Appellation'));
assert(facts.get('datasets/tenant').fields.industry.roles.includes('Classification'));
for (const [,dataset] of datasets) for (const field of Object.values(dataset.fields)) {
  assert.equal(typeof field.storage_type, 'string');
  assert.equal(new Set(field.roles).size, field.roles.length);
}
const relationValues = graph.relations.map(r=>r.value);
assert.equal(relationValues.length, 104);
const names=relationValues.flatMap(r=>r.source_names ?? []);
assert.equal(names.length,22);
assert(names.includes('source_EntNetworkElement_NetworkDeviceKPI'));
assert(names.includes('source_EntNetworkElement_X_SITE_VIEW'));
assert(!graph.relations.some(r=>names.includes(r.value.relation)),'Provenance names must not create extra query paths');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function reverseKey(k) {return k.op==='eq'?{...k,from:k.to,to:k.from}:{...k,inputs:k.inputs.map(reverseKey)};}
const edges=new Set();
for(const relation of relationValues){
  const {relation:id,source_names,...forward}=relation;
  const backward={...forward,from_dataset:forward.to_dataset,to_dataset:forward.from_dataset,from_role:forward.to_role,to_role:forward.from_role,
    cardinality:{from:forward.cardinality.to,to:forward.cardinality.from},key:reverseKey(forward.key)};
  const identity=[canonical(forward),canonical(backward)].sort()[0];
  assert(!edges.has(identity),'Duplicate forward/reverse relation '+id);
  edges.add(identity);
}
assert.deepEqual(facts.get('datasets/device').dimensions.device_class.canonical_values,
  device.dimensions.device_kpi__classification.canonical_values,'Both fields bind the same source mapping');
console.log('Passed: logical/storage type publication, role coverage, inherited units, shared classifications and 104 canonical relations with 22 provenance names');
