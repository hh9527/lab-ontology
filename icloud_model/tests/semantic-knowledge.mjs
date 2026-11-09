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
assert.deepEqual(device.subjects.map(s => s.entity), ['entities/Device']);
assert.ok(device.props.find(p => p.name === 'cpu_usage').measures.includes('datasets/device_kpi#measures/cpu_usage'));
// An SSID sample has a Device reference; that does not make its measures Device properties.
assert.deepEqual(facts.get('datasets/ap_radio_ssid_kpi').subjects.map(s => s.entity), ['entities/Ssid']);
assert.deepEqual(new Set(facts.get('datasets/source_StorageDeviceKPI').subjects.map(s => s.entity)), new Set(['entities/Storage', 'entities/FcSwitch']));
assert.ok(facts.get('datasets/current_alarm').props.some(p => p.counters.includes('datasets/current_alarm#measures/alarm_count')));
const severity = facts.get('datasets/current_alarm').props.find(p => p.name === 'severity');
assert.ok(severity?.types.some(type => type.includes('AlarmSeverity')), 'enum property must retain its logical value type');
console.log('Passed: all 50 IC conceptual subjects, property/query mappings, counters, enum types and multiple subjects');
