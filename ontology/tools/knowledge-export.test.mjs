import test from 'node:test';
import assert from 'node:assert/strict';
import { collectKnowledge } from './knowledge-export.mjs';

test('discovery follows opaque keys from the root, including cycles, without duplicates', async () => {
  const key = '设备%2F位置/状态?#';
  const calls = [];
  const nodes = new Map([
    ['index', { key: 'index', type: 'Index', detail: { entries: [{ key: 'directory', type: 'Directory', label: 'Objects' }] }, links: [] }],
    ['directory', { key: 'directory', type: 'Directory', detail: { entries: [{ key, type: 'Dataset', label: 'Object', from: 'endpoint', to: key }] }, links: [] }],
    [key, { key, type: 'Dataset', links: [{ type: 'Related', key: 'index' }] }],
    ['endpoint', { key: 'endpoint', type: 'Dataset', links: [] }],
  ]);
  const result = await collectKnowledge(async (input) => {
    calls.push(input);
    return { Document: { Found: nodes.get(input.key) } };
  });
  assert.deepEqual(calls, [{ key: 'index' }, { key: 'directory' }, { key }, { key: 'endpoint' }]);
  assert.deepEqual(result, [...nodes.values()]);
});

test('dangling or mismatched nodes cannot silently produce a partial export', async () => {
  await assert.rejects(collectKnowledge(async () => ({ Document: 'NotFound' })), /did not resolve/);
  await assert.rejects(collectKnowledge(async () => ({ Document: { Found: { key: 'wrong', links: [] } } })), /did not resolve/);
});
