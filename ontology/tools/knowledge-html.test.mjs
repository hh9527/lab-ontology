import test from 'node:test';
import assert from 'node:assert/strict';
import { renderKnowledge } from './knowledge-html.mjs';

const node = (key, type = 'Dataset', detail = {}, links = []) => ({
  key, type, description: { label: '<script>unsafe</script>', aliases: ['A&B'], localized: [], summary: '"quoted"' }, links, detail,
});

test('one generic template renders schema index and concrete nodes using opaque keys', () => {
  const key = 'Dimension/设备%2F位置/状态?#';
  const target = node(key);
  const nodes = [
    node('index', 'Index', { schemas: ['Schema/a'], key_patterns: [{ kind: 'Dimension', pattern: 'Dimension/{dataset}/{dimension}' }], encoding: '<img onerror=bad>' }),
    node('Schema/a', 'Schema', {}, [{ type: 'Related', key }]),
    target,
  ];
  const html = renderKnowledge(nodes);
  assert.ok(html.includes(`href="#${encodeURIComponent(key)}"`));
  assert.ok(html.includes('id="Dimension/设备%2F位置/状态?#"'));
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img onerror=bad&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Dimension/{dataset}/{dimension}'));
});

test('the rendered graph must have unique keys and closed references', () => {
  assert.throws(() => renderKnowledge([node('a'), node('a')]), /Duplicate/);
  assert.throws(() => renderKnowledge([node('a', 'Dataset', {}, [{ type: 'Related', key: 'missing' }])]), /Unresolved/);
  assert.throws(() => renderKnowledge([node('index', 'Index', { schemas: ['missing'] })]), /Unresolved/);
});
