// 在生成样本上检查分阶段准备：合法请求等价、非法输入拒绝、自检显式执行。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, staged: { type: 'string' },
  'runtime-only': { type: 'boolean', default: false },
  count: { type: 'string', default: '5' }, dimensions: { type: 'string', default: '2' },
} });
assert(values.baseline && values.staged, '--baseline and --staged artifacts are required');
const hash = () => createHash('sha256').update(readFileSync(values.staged)).digest('hex');
const artifactHash = hash();
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
const count = Number(values.count), dimensions = Number(values.dimensions);
assert(Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(dimensions) && dimensions > 0);
function request(artifact, method, input) {
  const run = spawnSync(runner, [artifact], {
    input: JSON.stringify({ method, input }), encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ifError(run.error);
  assert([0, 1].includes(run.status), run.stderr);
  return run.status === 0 ? { error: false, ok: JSON.parse(run.stdout) }
    : { error: true, diagnostics: run.stderr };
}
function accepted(artifact, intents) {
  const response = request(artifact, 'scale/transform', { intents });
  assert.equal(response.error, false, JSON.stringify(response));
  assert.equal(response.ok.accepted, true, JSON.stringify(response));
  return response.ok;
}
const projection = i => ({ op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: `dataset_${i}` }], edges: [],
  select: [{ node: 'r', dimension: `dataset_${i}_id` },
    ...Array.from({ length: dimensions - 1 }, (_, j) => ({ node: 'r', dimension: `dataset_${i}_name_${j + 1}` }))] });
for (let i = 1; i <= count; i += 5) {
  const intents = Array.from({ length: Math.min(5, count - i + 1) }, (_, j) => projection(i + j));
  const before = accepted(values.baseline, intents);
  assert.deepEqual(accepted(values.staged, intents), before);
  assert(before.queries.every(query => query.columns.length === dimensions));
}
const valid = projection(1);
for (const query of [
  { ...valid, select: [], measures: [{ node: 'r', measure: 'dataset_1_count' }] },
  { ...valid, filters: [{ node: 'r', dimension: 'dataset_1_id', op: 'Eq', value: 'sample' }] },
]) assert.deepEqual(accepted(values.staged, [query]), accepted(values.baseline, [query]));

const invalid = [
  { intents: [{ ...valid, nodes: [{ id: 'r', entity: 'unknown_dataset' }] }] },
  { intents: [{ ...valid, select: [{ node: 'r', dimension: 'unknown_dimension' }] }] },
  { intents: [{ ...valid, filters: [{ node: 'r', dimension: 'dataset_1_id', op: 'Eq', value: 42 }] }] },
  { intents: [{ ...valid, filters: [{ node: 'r', dimension: 'dataset_1_id', op: 'Contains', value: 'x' }] }] },
  { intents: [{ ...valid, root: 'missing' }] },
  { intents: [{ ...valid, edges: [{ relation: 'unknown_relation', from: 'r', to: 'r' }] }] },
  { intents: [{ op: 'Unknown' }] },
  { intents: [] }, { intents: Array(6).fill(valid) }, { intents: 'wrong type' }, null,
  { intents: [valid, { ...valid, select: [{ node: 'r', dimension: 'unknown_dimension' }] }] },
];
for (const input of invalid) {
  for (const artifact of [values.baseline, values.staged]) {
    const response = request(artifact, 'scale/transform', input);
    assert(response.error === true || response.ok?.accepted === false, JSON.stringify(response));
    if (!response.error) assert.equal(response.ok.queries, null, 'invalid batch must reject atomically');
  }
}
const checked = request(values.staged, 'scale/self_check', null);
if (values['runtime-only']) {
  assert.equal(checked.error, true, 'runtime-only artifact must not expose self_check');
} else {
  assert.equal(checked.error, false, JSON.stringify(checked));
  assert.equal(checked.ok, true);
}
assert.deepEqual(accepted(values.staged, [valid]), accepted(values.baseline, [valid]));
assert.equal(hash(), artifactHash, 'artifact changed during validation');
console.log(JSON.stringify({ artifactHash, status: 'ok', datasets: count, dimensions, invalidCases: invalid.length,
  selfCheck: values['runtime-only'] ? 'absent' : 'passed', queriesEquivalent: true }));
