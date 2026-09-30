import test from 'node:test';
import assert from 'node:assert/strict';
import { collectKnowledge } from './knowledge-export.mjs';

test('discovery follows opaque keys from the root, including cycles, without duplicates', async () => {
  const key = '设备%2F位置/状态?#';
  const calls = [];
  const nodes = new Map([
    ['index', { key: 'index', links: [{ type: 'Member', key }] }],
    [key, { key, links: [{ type: 'Related', key: 'index' }] }],
  ]);
  const result = await collectKnowledge(async (input) => {
    calls.push(input);
    return { Document: { Found: nodes.get(input.key) } };
  });
  assert.deepEqual(calls, [{ key: 'index' }, { key }]);
  assert.deepEqual(result, [...nodes.values()]);
});

test('dangling or mismatched nodes cannot silently produce a partial export', async () => {
  await assert.rejects(collectKnowledge(async () => ({ Document: 'NotFound' })), /did not resolve/);
  await assert.rejects(collectKnowledge(async () => ({ Document: { Found: { key: 'wrong', links: [] } } })), /did not resolve/);
});
