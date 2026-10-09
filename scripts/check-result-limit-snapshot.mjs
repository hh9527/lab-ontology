import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';
import { OUTPUT_ROW_LIMIT, withOutputLimit } from '../evaluations/icloud-agent/ontology-output-limit.mjs';

const artifact = process.argv[2];
if (!artifact) throw new Error('Usage: node scripts/check-result-limit-snapshot.mjs <icloud-snapshot.wasm>');
const database = new DatabaseSync(':memory:');
try {
  database.exec('CREATE TABLE I_EntNetworkElement(id TEXT, tenantId TEXT, name TEXT)');
  for (let i = 0; i < 130; i++) {
    database.prepare('INSERT INTO I_EntNetworkElement VALUES (?, ?, ?)').run(`device-${i}`, 'tenant', `name-${i}`);
  }
  const graph = { op: 'Graph', root: 'd', nodes: [{ id: 'd', entity: 'device' }], edges: [],
    select: [{ node: 'd', dimension: 'device_name' }] };
  await withKnowledgeRunner(artifact, async (_, request) => {
    const schema = (await request('ic/info', { key: 'Schema/syntax/intent' })).Document.Found;
    assert.match(JSON.stringify(schema), /optional limit/);
    for (const limit of [1, 100, 101]) {
      const batch = await request('ic/transform', { intents: [{ ...graph, limit }] });
      assert.equal(batch.accepted, true, JSON.stringify(batch.diagnostics));
      const query = batch.queries[0];
      assert.equal(query.bindings.at(-1), limit);
      assert.equal(database.prepare(query.sql).all(...query.bindings).length, limit);
    }
    const invalid = await request('ic/transform', { intents: [
      { ...graph, limit: 1 }, graph, { ...graph, limit: null },
      { ...graph, limit: 101 }, { ...graph, limit: '100' },
    ] });
    assert.equal(invalid.accepted, false);
    assert.equal(invalid.queries, null);
    assert.deepEqual(invalid.diagnostics.map(item => item.index), [4]);
    assert.ok(invalid.diagnostics.every(item => item.diagnostic.message.includes('limit')));
    assert.ok(invalid.diagnostics.every(item => item.diagnostic.locs.length >= 2));
    const legacy = await request('ic/transform', { intents: [graph, { ...graph, limit: null }] });
    assert.equal(legacy.accepted, true);
    assert.equal(legacy.queries.length, 2);
    assert.deepEqual(legacy.queries[1], legacy.queries[0]);
    assert.deepEqual(legacy.queries[0].bindings, []);
    assert.doesNotMatch(legacy.queries[0].sql, /LIMIT/);
    assert.equal(database.prepare(legacy.queries[0].sql).all().length, 130);
    const forwarded = withOutputLimit({ intents: [{ ...graph, limit: 101 }] });
    const capped = await request('ic/transform', forwarded);
    assert.equal(capped.accepted, true);
    const query = capped.queries[0];
    assert.equal(database.prepare(query.sql).all(...query.bindings).length, OUTPUT_ROW_LIMIT);
    console.log('Published snapshot: syntax, omitted/null/1/100/101 rows, mixed-batch origins and plugin-enforced output cap passed.');
  });
} finally {
  database.close();
}
