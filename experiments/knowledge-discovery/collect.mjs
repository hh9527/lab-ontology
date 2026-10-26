// 通用实验采集器：不含 Entity、Dataset、Group 或知识地址规则。
import {readFileSync, writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const [engineFile, publicationFile, outputFile, batchArg = '1000000', repeatArg = '3'] = process.argv.slice(2);
const publication = JSON.parse(readFileSync(publicationFile, 'utf8'));
const batchSize = Number(batchArg), repeats = Number(repeatArg);
if (!(batchSize > 0 && repeats > 0)) throw Error('positive batch size and repeats required');
const loadStart = performance.now();
const module = new WebAssembly.Module(readFileSync(engineFile));
if (WebAssembly.Module.imports(module).length) throw Error('experiment requires pure jq engine');
const moduleMs = performance.now() - loadStart;
const call = (e, program, input) => {
  const allocations = [];
  const put = text => {
    const bytes = Buffer.from(text); const ptr = e.alloc(bytes.length);
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    allocations.push([ptr, bytes.length]); return [ptr, bytes.length];
  };
  const p = put(program), path = put('model-discovery.jq'), data = put(JSON.stringify(input));
  const out = e.run(...p, ...path, ...data, 0);
  const view = new DataView(e.memory.buffer);
  const status = view.getUint8(out), length = view.getUint32(out + 1, true);
  const text = Buffer.from(new Uint8Array(e.memory.buffer, out + 5, length)).toString();
  e.dealloc(out, 5 + length); for (const [ptr, len] of allocations) e.dealloc(ptr, len);
  if (status !== 0) throw Error(`jq ${status}: ${text}`);
  return JSON.parse(text);
};
const fetch = key => {
  if (!key || !Array.isArray(key.path)) throw Error('invalid path fetch key');
  let data = publication.data;
  for (const part of key.path) {
    if (data === null || !Object.hasOwn(data, part)) throw Error(`missing key ${JSON.stringify(key)}`);
    data = data[part];
  }
  return {key, data};
};
const observations = [];
let graph;
for (let repeat = 0; repeat < repeats; repeat++) {
  const began = performance.now();
  const e = new WebAssembly.Instance(module, {}).exports;
  const instanceMs = performance.now() - began;
  const verify = call(e, '"abc" | sha256', null);
  if (verify !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw Error('sha256 check failed');
  const collectStart = performance.now();
  const initial = call(e, publication.program, {op:'discovery', data:publication.data});
  let state = initial.initial_state, queue = initial.keys, fetched = new Set(), calls = 0, fetchMs = 0;
  while (queue.length) {
    const keys = queue.splice(0, batchSize).filter(key => !fetched.has(JSON.stringify(key)));
    if (!keys.length) continue;
    const fetchStart = performance.now();
    const items = keys.map(key => {fetched.add(JSON.stringify(key)); return fetch(key);});
    fetchMs += performance.now() - fetchStart;
    const result = call(e, publication.program, {op:'expand', state, items});
    state = result.new_state; queue.push(...result.keys); calls++;
    if (calls > 100000) throw Error('experiment did not converge');
  }
  graph = state;
  observations.push({collectMs:performance.now()-collectStart,instanceMs,fetchMs,calls,fetched:fetched.size});
}
writeFileSync(outputFile, JSON.stringify(graph));
console.log(JSON.stringify({moduleMs,batchSize,observations,graphBytes:Buffer.byteLength(JSON.stringify(graph))}));
