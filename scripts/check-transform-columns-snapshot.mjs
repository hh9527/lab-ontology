import assert from 'node:assert/strict';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const artifact = process.argv[2];
if (!artifact) throw new Error('Usage: node scripts/check-transform-columns-snapshot.mjs <icloud-snapshot.wasm>');
const graph = (entity, dimensions, measures = []) => ({
  op: 'Graph', root: 'x', nodes: [{ id: 'x', entity }], edges: [],
  select: dimensions.map(dimension => ({ node: 'x', dimension })),
  measures: measures.map(measure => ({ node: 'x', measure })), limit: 1,
});
await withKnowledgeRunner(artifact, async (_, request) => {
  const inputs = [
    graph('device', ['device_name']),
    graph('current_alarm', ['alarm_severity', 'current_alarm__CLEARUTC']),
    graph('device_kpi', ['device_kpi_ts_raw']),
    graph('device_kpi', [], ['cpu_usage']),
    graph('device', ['device_create_ms']),
  ];
  const response = await request('ic/transform', { intents: inputs });
  assert.equal(response.accepted, true, JSON.stringify(response.diagnostics));
  assert.deepEqual(response.queries.map(query => query.columns.map(column => [column.name, column.type])), [
    [['x_device_name', 'String']],
    [['x_alarm_severity', 'String'], ['x_current_alarm__CLEARUTC', 'EpochMillis']],
    [['x_device_kpi_ts_raw', 'DatetimeUtc']],
    [['x_cpu_usage', 'Float']],
    [['x_device_create_ms', 'EpochMillis']],
  ]);
  for (const query of response.queries) {
    assert.equal(typeof query.sql, 'string');
    assert.ok(Array.isArray(query.bindings));
    assert.ok(query.columns.every(column => typeof column.nullable === 'boolean'));
  }
  const invalid = await request('ic/transform', { intents: [inputs[0], { ...inputs[0], limit: 0 }] });
  assert.equal(invalid.accepted, false);
  assert.equal(invalid.queries, null);
  assert.ok(invalid.diagnostics.every(item => item.index === 1));
  const windowQuery = graph('device', ['device_create_ms']);
  const endOnly = { ...windowQuery, time_windows: [{ node: 'x', dimension: 'device_create_ms', end: 1792540800000 }] };
  const fixed = await request('ic/transform', { intents: [endOnly] });
  assert.equal(fixed.accepted, true, JSON.stringify(fixed.diagnostics));
  assert.ok(fixed.queries[0].bindings.includes(1792540800000));
  assert.deepEqual(await request('ic/transform', { intents: [endOnly] }), fixed, 'same intent gives same prepared query');
  for (const window of [{}, { end: null }]) {
    const rejected = await request('ic/transform', { intents: [{ ...windowQuery,
      time_windows: [{ node: 'x', dimension: 'device_create_ms', ...window }] }] });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.queries, null);
    assert.match(JSON.stringify(rejected.diagnostics), /end.*required|end.*missing/);
  }
  console.log('Published transform columns: String/canonical IDs/EpochMillis/DatetimeUtc/Float/local business label with epoch encoding, ordering, nullability and rejected-batch contract passed without a database.');
});
