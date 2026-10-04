import test from 'node:test';
import assert from 'node:assert/strict';
import { collectKnowledge } from './knowledge-export.mjs';

test('discovery follows Dataset roots, schema and member links', async () => {
  const key = '设备%2F位置/状态?#';
  const calls = [];
  const nodes = new Map([
    ['index', { key: 'index', type: 'Index', detail: { schemas: ['schema'] }, links: [] }],
    ['Dataset/a%2Fb', { key: 'Dataset/a%2Fb', type: 'Dataset', links: [{ type: 'Member', key }, { type: 'Traversable', key: 'endpoint' }] }],
    ['schema', { key: 'schema', type: 'Schema', links: [] }],
    [key, { key, type: 'Field', links: [{ type: 'Related', key: 'index' }] }],
    ['endpoint', { key: 'endpoint', type: 'Dataset', links: [] }],
  ]);
  const result = await collectKnowledge(async (input) => {
    calls.push(input);
    return { Document: { Found: nodes.get(input.key) } };
  }, ['Dataset/a%2Fb']);
  assert.deepEqual(calls, [{ key: 'index' }, { key: 'Dataset/a%2Fb' }, { key: 'schema' }, { key }, { key: 'endpoint' }]);
  assert.deepEqual(result, [...nodes.values()]);
});

test('dangling or mismatched nodes cannot silently produce a partial export', async () => {
  await assert.rejects(collectKnowledge(async () => ({ Document: 'NotFound' }), []), /did not resolve/);
  await assert.rejects(collectKnowledge(async () => ({ Document: { Found: { key: 'wrong', links: [] } } }), []), /did not resolve/);
});
