// 在临时 snapshot 上验收 transform，不发送发现或知识请求。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { withKnowledgeRunner as withTransformRunner } from '../ontology/tools/knowledge-runner.mjs';

const artifact = process.argv[2];
const runner = process.argv[3];
const reportPath = process.argv[4];
if (!artifact || !reportPath) throw new Error('Usage: node scripts/check-icloud-service.mjs <service.wasm> <telora-run> <source-audit.json>');
const model = JSON.parse(readFileSync(reportPath, 'utf8'));
const tables = new Map();
const smoke = [];
const identifier = value => { assert.match(value, /^[A-Za-z_][A-Za-z_0-9]*$/); return '\"' + value + '\"'; };
for (const dataset of model.datasets) {
  const columns = tables.get(dataset.table) ?? new Map();
  for (const field of dataset.fields) {
    const affinity = field.scalar === 'String' ? 'TEXT' : field.scalar === 'Float' ? 'REAL' : 'INTEGER';
    assert.ok(!columns.has(field.column) || columns.get(field.column) === affinity);
    columns.set(field.column, affinity);
  }
  tables.set(dataset.table, columns);
  const dimension = model.dimensions.find(d => d.dataset === dataset.id && d.authorized && !d.computed && !d.values.length && !d.input_kinds.includes('Ipv4') && !d.input_kinds.includes('Bool'));
  assert.ok(dimension, dataset.id);
  smoke.push({ op: 'Graph', root: 'r', nodes: [{ id: 'r', entity: dataset.id }], edges: [], select: [{ node: 'r', dimension: dimension.id }], order_by: [{node: 'r', dimension: dimension.id, direction: 'Asc'}], take: 500 });
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
  select: dimensions.map(dimension => ({ node: 'r', dimension })), measures: measures.map(measure => ({ node: 'r', measure })), ...(dimensions.length ? {order_by: [{node:'r',dimension:dimensions[0],direction:'Asc'}], take:500} : {}) });
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
    ]) insert('EntNetworkElement', { id, tenantId, name, commuState, ipAddress, alias: name, classification: 'AR', createTime: 1790812800000 });
    for (const [resId, tenantId, day, cpuUsage, memUsage] of [
      ['d1', 't1', '01', 10, 1], ['d1', 't1', '02', 50, 2], ['d1', 't1', '03', null, 3],
      ['d2', 't2', '01', 20, 4], ['d2', 't2', '02', 80, 5], ['d2', 't2', '03', 90, null],
    ]) insert('NetworkDeviceKPI', { resId, tenantId, ts: `2026-10-${day}T00:00:00.000Z`, cpuUsage, memUsage });
    for (const [CSN, SEVERITY, CLEARED] of [[1, 1, 0], [2, 2, 0], [3, 3, 1], [4, 99, 0], [null, 1, 0]]) {
      insert('T_CURRENT_ALARM', { CSN, SEVERITY, CLEARED });
    }
    const projection = { ...graph('device', ['device_id', 'device_name']), take: 2 };
    const offline = { ...graph('device', ['device_id']), filters: [{ node: 'r', dimension: 'device_commu_state', op: 'Eq', value: 'Offline' }] };
    const subnet = { ...graph('device', ['device_id']), filters: [{ node: 'r', dimension: 'device_ip_address_ipv4', op: 'InSubnet', value: '10.0.0.0/24' }] };
    const alarm = graph('current_alarm', [], ['alarm_open_count', 'critical_alarm_count', 'major_alarm_count', 'critical_or_major_alarm_count', 'weighted_severe_alarm_score']);
    const sampleGraph = (start, end, latest = false) => ({ op: 'Graph', root: 'd',
      nodes: [{ id: 'd', entity: 'device' }, { id: 'k', entity: 'device_kpi' }],
      edges: [{ relation: 'device_kpi_of_device', from: 'k', to: 'd' }],
      select: latest ? [{ node: 'd', dimension: 'device_id' }] : [], group_by_identity: ['d'],
      measures: (latest ? ['device_cpu_latest', 'device_memory_latest', 'cpu_usage'] : ['cpu_usage']).map(measure => ({ node: 'k', measure })),
      time_windows: [{ node: 'k', dimension: 'device_kpi_ts_raw', start, end }] });
    const latest = {...sampleGraph('2026-10-01T00:00:00.000Z', '2026-10-04T00:00:00.000Z', true), order_by:[{node:'d',dimension:'device_id',direction:'Asc'}],take:500};
    const pair = { op: 'GraphPair', left: sampleGraph('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
      right: sampleGraph('2026-10-02T00:00:00Z', '2026-10-03T00:00:00Z'),
      align_by: [{ left: { node: 'd' }, right: { node: 'd' } }], select: [{ side: 'Left', node: 'd', dimension: 'device_id' }],
      rank_by: { op: 'Subtract', minuend: 'Right', subtrahend: 'Left', direction: 'Desc', take: 10 } };
    const union = { op: 'GraphUnion', order_by:[{column:'r_device_id',direction:'Asc'}],take:500, branches: [graph('device', ['device_id']), offline].map(({order_by,take,...graph}) => ({ result_node: 'r', graph })) };
    const queries = await batch([projection, offline, subnet, alarm, latest, pair, union]);
    assert.equal(execute(queries[0]).length, 2);
    assert.equal(queries[0].max_rows, 2);
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
    const rejected = await request('ic/transform', { intents: [projection, { ...projection, take: 0 }, offline] });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.queries, null);
    assert.ok(rejected.diagnostics.length > 0 && rejected.diagnostics.every(item => item.index === 1));
    let checkedStatistics = 0;
    for (const dataset of model.datasets.filter(d => d.sample_measures.length)) {
      const summaries = dataset.sample_measures.filter(m => m.aggregate !== 'Latest');
      if (!summaries.length) continue;
      database.exec('DELETE FROM ' + identifier(dataset.table));
      const rows = [0, 1, 2].map(rowIndex => Object.fromEntries(dataset.fields.map((field, fieldIndex) => [field.column,
        field.time ? (field.scalar === 'String' ? '2026-10-0' + (rowIndex + 1) + 'T00:00:00.000Z' : 1790812800000 + rowIndex * 86400000)
          : field.scalar === 'String' ? field.column + '_' + rowIndex : rowIndex === 2 ? null : 10 + fieldIndex * 3 + rowIndex * 20])));
      for (const row of rows) insert(dataset.table, row);
      const intent = graph(dataset.id, [], summaries.map(m => m.id));
      const [query] = await batch([intent]);
      const actual = execute(query);
      assert.equal(actual.length, 1, dataset.id);
      for (const measure of summaries) {
        const field = dataset.fields.find(f => f.name === measure.field);
        assert.ok(field, measure.id);
        const values = rows.map(row => row[field.column]).filter(value => value !== null);
        const expected = measure.aggregate === 'Avg' ? values.reduce((a,b)=>a+b,0) / values.length
          : measure.aggregate === 'Sum' ? values.reduce((a,b)=>a+b,0)
          : measure.aggregate === 'Min' ? Math.min(...values) : Math.max(...values);
        assert.equal(actual[0]['r_' + measure.id], expected, dataset.id + '/' + measure.id);
        checkedStatistics++;
      }
      database.exec('DELETE FROM ' + identifier(dataset.table));
      const emptyRows = execute(query);
      assert.equal(emptyRows.length, 1, dataset.id + ': empty aggregate');
      assert.ok(Object.values(emptyRows[0]).every(value=>value === null), dataset.id + ': empty statistic');
    }
    // 来源定义独立于 prepared audit，种子同时覆盖匹配与逐个键不匹配。
    const sourceCatalog = JSON.parse(readFileSync(new URL('../icloud_model/data/source_catalog.json', import.meta.url)));
    const requiredRelations = JSON.parse(readFileSync(new URL('../icloud_model/tests/source-relations.json', import.meta.url)));
    for (const name of requiredRelations) {
      const source = sourceCatalog.relations.find(r => r.name === name);
      assert.ok(source, name);
      const relation = model.relations.find(r => r.id === 'source_' + name);
      assert.ok(relation, name + ': missing relation');
      const fromTable = sourceCatalog.datasets.find(d => d.name === source.source).table;
      const toTable = sourceCatalog.datasets.find(d => d.name === source.target).table;
      assert.equal(relation.from_table, fromTable, name + ': direction');
      assert.equal(relation.to_table, toTable, name + ': direction');
      const keys = source.condition.split(/\s+and\s+/i).map(term => {
        const m = /^\s*(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)\s*$/.exec(term);
        assert.ok(m, term);
        assert.equal(m[1], source.source);
        assert.equal(m[3], source.target);
        return {from: m[2], to: m[4]};
      });
      database.exec('DELETE FROM ' + identifier(fromTable));
      database.exec('DELETE FROM ' + identifier(toTable));
      const left = Object.fromEntries(keys.map((key, index) => [key.from, 'match-' + index]));
      const right = Object.fromEntries(keys.map((key, index) => [key.to, 'match-' + index]));
      insert(fromTable, left);
      insert(toTable, right);
      // 每一个连接键单独错配；联合条件若漏一个键，就会多出一行。
      for (const key of keys) insert(toTable, {...right, [key.to]: 'wrong'});
      // A/Z 以及 radio parentId/resId 不能混用。
      const alternate = keys[0].to === 'parentId' ? 'resId'
        : /^a(NeResId|PortDn)$/.test(keys[0].to) ? keys[0].to.replace(/^a/, 'z')
        : /^z(NeResId|PortDn)$/.test(keys[0].to) ? keys[0].to.replace(/^z/, 'a') : null;
      if (alternate) insert(toTable, {...right, [keys[0].to]: 'wrong', [alternate]: 'match-0'});
      const dimension = model.dimensions.find(d => d.dataset === relation.from_dataset && d.column === keys[0].from && d.authorized && !d.computed);
      assert.ok(dimension, name + ': source key dimension');
      const targetDimension = model.dimensions.find(d => d.dataset === relation.to_dataset && d.column === keys[0].to && d.authorized && !d.computed);
      assert.ok(targetDimension, name + ': target key dimension');
      const intent = {op: 'Graph', ...(source.cardinality === '1:M' ? {row_grain: 'Association'} : {}), root: 'l', nodes: [{id: 'l', entity: relation.from_dataset}, {id: 'r', entity: relation.to_dataset}],
        edges: [{relation: relation.id, from: 'l', to: 'r'}], select: [{node: 'l', dimension: dimension.id}, {node: 'r', dimension: targetDimension.id}],
        order_by: [{node: 'l', dimension: dimension.id, direction: 'Asc'}], take: 10};
      const [query] = await batch([intent]);
      assert.deepEqual(execute(query), [{['l_' + dimension.id]: 'match-0', ['r_' + targetDimension.id]: 'match-0'}], name + ': exact matching keys');
      database.exec('DELETE FROM ' + identifier(toTable));
      // Association 粒度只返回匹配行；可选的一对一投影保留主行并返回 NULL。
      const [emptyQuery] = await batch([intent]);
      assert.deepEqual(execute(emptyQuery), source.cardinality === '1:M' ? [] : [{['l_' + dimension.id]: 'match-0', ['r_' + targetDimension.id]: null}], name + ': absent target follows relation cardinality');
    }
    console.log('Passed ' + requiredRelations.length + ' source relation SQL cases: individual key mismatches, compound port identity, A/Z direction, radio parent and absent associations');
    console.log('Passed current IC service: 50 dataset projections, ' + checkedStatistics + ' independently calculated sample statistics and empty populations; seeded canonical filters/IPv4/counts/Latest/GraphPair/GraphUnion; deterministic requests and atomic rejection');
  }, { requestFuel: '100000', memory: '2048', ...(runner ? { runner } : {}) });
} finally {
  database.close();
}
