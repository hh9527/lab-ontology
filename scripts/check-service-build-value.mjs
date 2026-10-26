import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendBuildValue, readBuildValue } from './service-build-value.mjs';

const artifact = process.argv[2], verificationArtifact = process.argv[3];
assert(artifact && verificationArtifact, 'Usage: node scripts/check-service-build-value.mjs <runtime> <verified A+B>');
const bytes = readFileSync(artifact), metadata = readBuildValue(bytes);
const base = readFileSync(`${artifact}.runtime.wasm`);
const output = mkdtempSync(join(dirname(artifact), 'check-build-value-'));
const host = fileURLToPath(new URL('./run-verified-service.mjs', import.meta.url));
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
function run(command, args, input) {
  const result = spawnSync(command, args, { input: JSON.stringify(input), encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  return result;
}
const graph = { op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: 'dataset_1' }], edges: [],
  select: [{ node: 'r', dimension: 'dataset_1_id' }] };
try {
  for (const input of [
    { intents: [graph] },
    { intents: [{ ...graph, filters: [{ node: 'r', dimension: 'dataset_1_id', op: 'Eq', value: 'x' }] }] },
    { intents: [{ ...graph, select: [], measures: [{ node: 'r', measure: 'dataset_1_count' }] }] },
  ]) {
    const request = { method: 'scale/transform', input };
    const expected = run(runner, [verificationArtifact], request);
    const actual = run(process.execPath, [host, artifact], request);
    assert.equal(expected.status, 0, expected.stderr);
    assert.equal(actual.status, 0, actual.stderr);
    assert.deepEqual(JSON.parse(actual.stdout), JSON.parse(expected.stdout));
  }
  for (const input of [
    { intents: [{ ...graph, select: [{ node: 'r', dimension: 'unknown' }] }] },
    { intents: [{ ...graph, filters: [{ node: 'r', dimension: 'dataset_1_id', op: 'Eq', value: 42 }] }] },
  ]) {
    const result = run(process.execPath, [host, artifact], { method: 'scale/transform', input });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).accepted, false);
  }
  // Host 格式与绑定校验，不重复执行模型语义自检。
  for (const patch of [{ value: false }, { value: 'true' }, { type: 'String' },
    { runtimeHash: '0'.repeat(64) }, { schema: 'unknown' }]) {
    assert.throws(() => readBuildValue(appendBuildValue(base, { ...metadata, ...patch })));
  }
  assert.throws(() => readBuildValue(base), /missing Service build value/);
  assert.throws(() => readBuildValue(appendBuildValue(bytes, metadata)));
  assert.throws(() => readBuildValue(bytes.subarray(0, bytes.length - 1)));
  const changed = Buffer.from(base); changed[changed.length - 1] ^= 1;
  assert.throws(() => readBuildValue(appendBuildValue(changed, metadata)), /another runtime/);

  // 即使绕过 metadata host，B 自己也拒绝 False 和错误类型。
  for (const value of [false, 'true']) {
    const source = join(output, 'source.json'); writeFileSync(source, JSON.stringify(value));
    const result = run(runner, [artifact, '--source', `verified=${source}`], { method: 'scale/transform', input: { intents: [graph] } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert(result.stderr.length > 0);
  }
  const missing = run(runner, [artifact], { method: 'scale/transform', input: { intents: [graph] } });
  assert.equal(missing.status, 1);
  const absent = run(process.execPath, [host, artifact], { method: 'scale/self_check', input: null });
  assert.equal(absent.status, 1, absent.stdout + absent.stderr);
  console.log(JSON.stringify({ status: 'ok', metadataBytes: bytes.length - base.length,
    initializationConsumesBool: true, requestChecksPreserved: true, selfCheckAbsent: true,
    verifiedArtifactHash: metadata.verifiedArtifactHash, runtimeHash: metadata.runtimeHash }));
} finally { rmSync(output, { recursive: true, force: true }); }
