// 对照两个制品的知识、公开目录及全部 codec/mapping 行为，不比较契约身份。
import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const [before, after, adapter] = process.argv.slice(2);
assert(before && after && adapter, 'Expected baseline Wasm, candidate Wasm and plugin adapter');
const url = pathToFileURL(resolve(adapter));
const {openModel} = await import(url);
const require = createRequire(url);
const {primaryCodecs} = await import(pathToFileURL(require.resolve('@hh9527/dari-core/codecs')));
function knowledge(file) {
  const wasm = new WebAssembly.Module(readFileSync(file));
  const section = WebAssembly.Module.customSections(wasm, 'telora.build.information');
  assert.equal(section.length, 1);
  const k = JSON.parse(new TextDecoder().decode(section[0])).entries['ontology.knowledge'];
  return new Function('data', k.program)(k.data);
}
const outcome = fn => {try {return {value: fn()};} catch (error) {return {error: error.constructor.name, message: error.message};}};
const probes = [null, true, false, -1, 0, 1, 0.12, 50, 101, '', '0', 'unknown', 'Asia/Shanghai', '2026-11-16T00:00:00.000Z', {tag: 'unknown'}, {tag: 'unknown', extra: true}, []];
const baseline = await openModel(before);
let candidate;
try {
  candidate = await openModel(after);
  assert.deepEqual(knowledge(after), knowledge(before), 'Knowledge graph and vocabulary must remain identical');
  for (const field of ['abi_version', 'datasets', 'relations', 'types']) assert.deepEqual(candidate.contract[field], baseline.contract[field], field);
  const load = source => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const old = await load(baseline.contract.codec_module), current = await load(candidate.contract.codec_module);
  const a = old.createCodecs(primaryCodecs), b = current.createCodecs(primaryCodecs);
  assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), 'Codec keys');
  let calls = 0;
  for (const [key, codec] of Object.entries(a)) {
    assert.deepEqual(b[key].operations, codec.operations, key + ' operations');
    assert.deepEqual(b[key].variants, codec.variants, key + ' variants');
    assert.deepEqual(b[key].order, codec.order, key + ' business order');
    const values = [...probes, ...(codec.variants ?? []).flatMap(tag => [tag, {tag}])];
    for (const operation of ['parse', 'encode', 'decode']) for (const value of values) {
      assert.deepEqual(outcome(() => b[key][operation](value)), outcome(() => codec[operation](value)), key + ' ' + operation + ' ' + JSON.stringify(value));
      calls++;
    }
  }
  for (const field of ['presentations', 'semantics']) for (const [key, value] of Object.entries(old[field])) assert.deepEqual(current[field][key], value, field + ' ' + key);
  assert.deepEqual(Object.keys(current.mappings).sort(), Object.keys(old.mappings).sort());
  for (const [key, mapping] of Object.entries(old.mappings)) {
    const actual = current.mappings[key];
    assert.deepEqual(actual.cases, mapping.cases, key);
    assert.equal(actual.fallback, mapping.fallback, key);
    for (const value of [...probes, ...mapping.cases.flatMap(c => c.wires)]) {
      assert.deepEqual(outcome(() => actual.map(value)), outcome(() => mapping.map(value)), key + ' mapping ' + JSON.stringify(value));
      calls++;
    }
  }
  console.log(JSON.stringify({before: {bytes: statSync(before).size, codecBytes: Buffer.byteLength(JSON.stringify(baseline.contract.codec_module))}, after: {bytes: statSync(after).size, codecBytes: Buffer.byteLength(JSON.stringify(candidate.contract.codec_module))}, datasets: candidate.contract.datasets.length, publicTypes: candidate.contract.types.length, codecKeys: Object.keys(b).length, mappings: Object.keys(current.mappings).length, behaviorComparisons: calls, knowledge: 'identical'}));
} finally {await baseline.close(); if (candidate) await candidate.close();}
