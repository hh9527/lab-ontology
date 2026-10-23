// 在临时 snapshot 上验收 transform，不发送发现或知识请求。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { withKnowledgeRunner as withTransformRunner } from '../ontology/tools/knowledge-runner.mjs';

const artifact = process.argv[2];
if (!artifact) throw new Error('Usage: node scripts/check-typed-icloud-service.mjs <typed-service.wasm>');
// 旧声明只用于独立构造物理空表与 50 个公开投影请求，不参与服务初始化。
const legacy = readFileSync(new URL('../icloud_model/src/model.telora', import.meta.url), 'utf8');
const tables = new Map();
const smoke = [];
const identifier = value => { assert.match(value, /^[A-Za-z_][A-Za-z_0-9]*$/); return `"${value}"`; };
for (const match of legacy.matchAll(/@edsl::entity_id\("([^"]+)"\)([\s\S]*?)type (\w+) = struct \{([\s\S]*?)\n\};/g)) {
  const [, entity, annotations, , body] = match;
  const table = /@edsl::entity_source\("([^"]+)"/.exec(annotations)?.[1];
  assert.ok(table, entity);
  const columns = tables.get(table) ?? new Map();
  for (const field of body.matchAll(/@edsl::column\("([^"]+)"\)([\s\S]*?)\b(\w+): (String|Int|Float|Bool),/g)) {
    const type = field[4] === 'String' ? 'TEXT' : field[4] === 'Float' ? 'REAL' : 'INTEGER';
    assert.ok(!columns.has(field[1]) || columns.get(field[1]) === type, `${table}/${field[1]}`);
    columns.set(field[1], type);
  }
  tables.set(table, columns);
  const dimension = /@edsl::dimension\("([^"]+)", True, True/.exec(body)?.[1];
  assert.ok(dimension, entity);
  smoke.push({ op: 'Graph', root: 'r', nodes: [{ id: 'r', entity }], edges: [], select: [{ node: 'r', dimension }] });
}
assert.equal(smoke.length, 50);
assert.equal(new Set(smoke.map(request => request.nodes[0].entity)).size, 50);
const database = new DatabaseSync(':memory:');
database.function('regexp', (pattern, value) => value === null ? null : Number(new RegExp(pattern).test(value)));
for (const [table, columns] of tables) {
  database.exec(`CREATE TABLE ${identifier(table)} (${[...columns].map(([name, type]) => `${identifier(name)} ${type}`).join(',')})`);
}
const insert = (table, values) => {
  const names = Object.keys(values);
  database.prepare(`INSERT INTO ${identifier(table)} (${names.map(identifier).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(values));
};
const execute = query => {
  const rows = database.prepare(query.sql).all(...query.bindings).map(row => ({ ...row }));
  assert.deepEqual(database.prepare(query.sql).columns().map(column => column.name), query.columns.map(column => column.name));
  assert.ok(query.columns.every(column => typeof column.type === 'string' && typeof column.nullable === 'boolean'));
  return rows;
};
const graph = (entity, dimensions = [], measures = []) => ({ op: 'Graph', root: 'r', nodes: [{ id: 'r', entity }], edges: [],
  select: dimensions.map(dimension => ({ node: 'r', dimension })), measures: measures.map(measure => ({ node: 'r', measure })) });
try {
  await withTransformRunner(artifact, async (_, request) => {
    const batch = async intents => {
      const queries = [];
      // 公共批量契约每次最多五个独立 intent。
      for (let index = 0; index < intents.length; index += 5) {
        const part = intents.slice(index, index + 5);
        const response = await request('ic/transform', { intents: part });
        assert.equal(response.accepted, true, JSON.stringify(response.diagnostics));
        assert.equal(response.queries.length, part.length);
        queries.push(...response.queries);
      }
      return queries;
    };
    const empty = await batch(smoke);
    for (const query of empty) assert.deepEqual(execute(query), []);
    for (const [id, tenantId, name, commuState, ipAddress] of [
      ['d1', 't1', 'Alpha', '0', '10.0.0.1'], ['d2', 't2', 'Beta', '1', '::1'], ['d3', 't1', 'Gamma', 'offline', '10.0.0.128'],
    ]) insert('I_EntNetworkElement', { id, tenantId, name, commuState, ipAddress, alias: name, classification: 'AR', createTime: 1790812800000 });
    for (const [resId, tenantId, day, cpuUsage, memUsage] of [
      ['d1', 't1', '01', 10, 1], ['d1', 't1', '02', 50, 2], ['d1', 't1', '03', null, 3],
      ['d2', 't2', '01', 20, 4], ['d2', 't2', '02', 80, 5], ['d2', 't2', '03', 90, null],
    ]) insert('NetworkDeviceKPI', { resId, tenantId, ts: `2026-10-${day}T00:00:00Z`, cpuUsage, memUsage });
    for (const [CSN, SEVERITY, CLEARED] of [[1, 1, 0], [2, 2, 0], [3, 3, 1], [4, 99, 0], [null, 1, 0]]) {
      insert('T_CURRENT_ALARM', { CSN, SEVERITY, CLEARED });
    }
    const projection = { ...graph('device', ['device_id', 'device_name']), limit: 2 };
    const offline = { ...graph('device', ['device_id']), filters: [{ node: 'r', dimension: 'device_commu_state', op: 'Eq', value: 'offline' }] };
    const subnet = { ...graph('device', ['device_id']), filters: [{ node: 'r', dimension: 'device_ip_address_ipv4', op: 'InSubnet', value: '10.0.0.0/24' }] };
    const alarm = graph('current_alarm', [], ['alarm_open_count', 'critical_alarm_count', 'major_alarm_count', 'critical_or_major_alarm_count', 'weighted_severe_alarm_score']);
    const sampleGraph = (start, end, latest = false) => ({ op: 'Graph', root: 'd',
      nodes: [{ id: 'd', entity: 'device' }, { id: 'k', entity: 'device_kpi' }],
      edges: [{ relation: 'device_kpi_of_device', from: 'k', to: 'd' }],
      select: latest ? [{ node: 'd', dimension: 'device_id' }] : [], group_by_identity: ['d'],
      measures: (latest ? ['device_cpu_latest', 'device_memory_latest', 'cpu_usage'] : ['cpu_usage']).map(measure => ({ node: 'k', measure })),
      time_windows: [{ node: 'k', dimension: 'device_kpi_ts_raw', start, end }] });
    const latest = sampleGraph('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z', true);
    const pair = { op: 'GraphPair', left: sampleGraph('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      right: sampleGraph('2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z'),
      align_by: [{ left: { node: 'd' }, right: { node: 'd' } }], select: [{ side: 'Left', node: 'd', dimension: 'device_id' }],
      rank_by: { op: 'Subtract', minuend: 'Right', subtrahend: 'Left', direction: 'Desc', take: 10 } };
    const union = { op: 'GraphUnion', branches: [graph('device', ['device_id']), offline].map(graph => ({ result_node: 'r', graph })) };
    const queries = await batch([projection, offline, subnet, alarm, latest, pair, union]);
    assert.equal(execute(queries[0]).length, 2);
    assert.equal(queries[0].bindings[queries[0].limit_slot], 2);
    assert.deepEqual(execute(queries[1]).map(row => row.r_device_id).sort(), ['d2', 'd3']);
    assert.deepEqual(execute(queries[2]).map(row => row.r_device_id).sort(), ['d1', 'd3']);
    assert.deepEqual(execute(queries[3]), [{ r_alarm_open_count: 3, r_critical_alarm_count: 1, r_major_alarm_count: 1,
      r_critical_or_major_alarm_count: 2, r_weighted_severe_alarm_score: 3 }]);
    const latestRows = execute(queries[4]).sort((a, b) => a.d_device_id.localeCompare(b.d_device_id));
    assert.deepEqual(latestRows, [
      { d_device_id: 'd1', k_device_cpu_latest: null, k_device_memory_latest: 3, k_cpu_usage: 30 },
      { d_device_id: 'd2', k_device_cpu_latest: 90, k_device_memory_latest: null, k_cpu_usage: 190 / 3 },
    ]);
    assert.deepEqual(execute(queries[5]).map(row => [Object.values(row).find(value => typeof value === 'string'), row.comparison_value]), [['d2', 60], ['d1', 40]]);
    assert.deepEqual(execute(queries[6]).map(row => row.r_device_id).sort(), ['d1', 'd2', 'd3']);
    assert.deepEqual(await batch([projection]), [queries[0]], 'repeated requests are deterministic');
    const rejected = await request('ic/transform', { intents: [projection, { ...projection, limit: 0 }, offline] });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.queries, null);
    assert.ok(rejected.diagnostics.length > 0 && rejected.diagnostics.every(item => item.index === 1));
    console.log('Passed typed MainService: 50 Dataset SQL projections, seeded limits/canonical filters/IPv4/filtered counts/computed counts/Latest/GraphPair/GraphUnion, deterministic requests and atomic mixed-batch rejection; no knowledge requests.');
  }, { requestFuel: '100000', memory: '2048' });
} finally {
  database.close();
}
