import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

assert(process.argv[2], 'generated workspace path required');
const workspace = resolve(process.argv[2]);
const { copies } = JSON.parse(readFileSync(join(workspace, 'experiment.json')));
for (const mode of ['staged', 'runtime']) {
  const code = readFileSync(join(workspace, `features_${mode}/src/lib.telora`), 'utf8');
  assert(!code.includes('experimental::staged') && !code.includes('staged::'),
    'acceptance must exercise unchanged default modeling APIs');
}
const compiler = fileURLToPath(new URL('../bin/telora', import.meta.url));
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
function execute(command, args, input) {
  const result = spawnSync(command, args, { input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
const artifacts = {};
const measurements = {};
for (const mode of ['baseline', 'staged', 'runtime']) {
  const name = `features_${mode}`, artifact = join(workspace, `${name}.wasm`);
  const result = process.argv.includes('--skip-build')
    ? { status: 0, stdout: '', stderr: readFileSync(join(workspace, `${name}.build.log`), 'utf8') }
    : execute(compiler, ['-C', join(workspace, name), 'build', name, '--snapshot', '-o', artifact,
    '--initialization-fuel', '400000', '--request-fuel', '100000', '--with-memory-limit', '2048', '--report-usage']);
  writeFileSync(join(workspace, `${name}.build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const timings = result.stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    .filter(record => record.code === 'build-phase-timing');
  measurements[mode] = { bytes: statSync(artifact).size,
    phases: Object.fromEntries(timings.map(record => [record.phase, record.elapsed_seconds])) };
  artifacts[mode] = artifact;
}
function request(mode, method, input) {
  const result = execute(runner, [artifacts[mode]], { method, input });
  assert([0, 1].includes(result.status), result.stderr);
  return result.status === 0 ? { error: false, value: JSON.parse(result.stdout) }
    : { error: true, diagnostic: result.stderr };
}
const graph = (entity, dimensions = [], measures = []) => ({ op: 'Graph', root: 'r',
  nodes: [{ id: 'r', entity }], edges: [], select: dimensions.map(dimension => ({ node: 'r', dimension })),
  measures: measures.map(measure => ({ node: 'r', measure })) });
let positive = 0;
for (let n = 1; n <= copies; n++) {
  const owner = graph(`owners_${n}`, [`owner_id_${n}`, `owner_name_${n}`, `owner_state_${n}`, `owner_ip_${n}`]);
  const queries = [
    owner,
    { ...owner, filters: [{ node: 'r', dimension: `owner_state_${n}`, op: 'Eq', value: 'on' }] },
    graph(`owners_${n}`, [], [`load_avg_${n}`, `load_max_${n}`, `bytes_total_${n}`, `rate_max_${n}`, `rate_avg_${n}`]),
    graph(`owners_${n}`, [], [`owner_count_${n}`, `load_count_${n}`, `on_count_${n}`, `off_count_${n}`]),
    graph(`readings_${n}`, [], [`reading_avg_${n}`, `reading_latest_${n}`, `reading_max_${n}`]),
    graph(`readings_${n}`, [`reading_hour_${n}`], [`reading_avg_${n}`, `reading_latest_${n}`]),
    { ...graph(`readings_${n}`, [`reading_ts_${n}`]), filters: [{ node: 'r', dimension: `reading_ts_${n}`, op: 'Ge', value: '2026-01-01T00:00:00Z' }] },
    graph(`events_${n}`, [`event_id_${n}`]),
    ...['hub_a', 'hub_either'].map(relation => ({ op: 'Graph', root: 'r', ...(relation === 'hub_either' ? { row_grain: 'Association', distinct: true } : {}),
      nodes: [{ id: 'r', entity: `hubs_${n}` }, { id: 'o', entity: `owners_${n}` }],
      edges: [{ relation: `${relation}_${n}`, from: 'r', to: 'o' }],
      select: [{ node: 'r', dimension: `hub_id_${n}` }, { node: 'o', dimension: `owner_name_${n}` }] })),
    { op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: `events_${n}` }, { id: 'o', entity: `owners_${n}` }],
      edges: [{ relation: `event_owner_${n}`, from: 'r', to: 'o' }], select: [{ node: 'r', dimension: `event_id_${n}` }, { node: 'o', dimension: `owner_name_${n}` }] },
    { op: 'Graph', root: 'r', row_grain: 'Association', distinct: true, nodes: [{ id: 'r', entity: `owners_${n}` }, { id: 'o', entity: `owners_${n}` }],
      edges: [{ relation: `connection_${n}`, from: 'r', to: 'o' }], select: [{ node: 'r', dimension: `owner_id_${n}` }, { node: 'o', dimension: `owner_id_${n}` }] },
  ];
  for (const query of queries) {
    const before = request('baseline', 'scale/transform', { intents: [query] });
    assert.equal(before.error, false, JSON.stringify({ query, before }));
    assert.equal(before.value.accepted, true, JSON.stringify({ query, before }));
    for (const mode of ['staged', 'runtime']) assert.deepEqual(request(mode, 'scale/transform', { intents: [query] }), before);
    // 这些数据必须由准备路径生成，不能通过丢掉功能换取加速。
    const sql = before.value.queries[0].sql;
    if (query === owner) assert(sql.includes('DISPLAY_NAME') && sql.includes('peer'));
    positive++;
  }
}
const valid = graph('owners_1', ['owner_id_1']);
const invalid = [
  null, { intents: [] }, { intents: Array(6).fill(valid) }, { intents: 'wrong' },
  { intents: [{ ...valid, select: [{ node: 'r', dimension: 'unknown' }] }] },
  { intents: [{ ...valid, filters: [{ node: 'r', dimension: 'owner_state_1', op: 'Eq', value: 'unknown' }] }] },
  { intents: [{ ...valid, filters: [{ node: 'r', dimension: 'owner_state_1', op: 'Eq', value: 0 }] }] },
  { intents: [{ ...valid, filters: [{ node: 'r', dimension: 'owner_name_1', op: 'Contains', value: 'x' }] }] },
  { intents: [{ ...graph('readings_1', ['reading_ts_1']), filters: [{ node: 'r', dimension: 'reading_ts_1', op: 'Ge', value: 'bad time' }] }] },
  { intents: [{ ...valid, measures: [{ node: 'r', measure: 'unknown' }] }] },
  { intents: [valid, { ...valid, nodes: [{ id: 'r', entity: 'unknown' }] }] },
];
for (const input of invalid) for (const mode of ['baseline', 'staged', 'runtime']) {
  const result = request(mode, 'scale/transform', input);
  assert(result.error || result.value.accepted === false, JSON.stringify({ mode, input, result }));
  if (!result.error) assert.equal(result.value.queries, null);
}
assert.deepEqual(request('staged', 'scale/self_check', null), { error: false, value: true });
assert.equal(request('runtime', 'scale/self_check', null).error, true);
assert.deepEqual(request('staged', 'scale/transform', { intents: [valid] }), request('baseline', 'scale/transform', { intents: [valid] }));
const report = { status: 'ok', copies, datasets: copies * 4, positive, invalid: invalid.length, measurements };
writeFileSync(join(workspace, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
