import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../export-knowledge-markdown.mjs';

const node = (key, type, detail = {}, links = []) => ({
  key, type, detail, links,
  description: { label: key, aliases: [], localized: [], summary: '' },
});

test('organizes directly referenced fields by semantic dataset ownership', () => {
  const nodes = [
    node('Dataset/a%20b', 'Dataset', { id: 'a', grain: ['f'] }, [{ key: 'opaque-field', type: 'Member' }]),
    node('opaque-field', 'Field', { dataset: 'a', id: 'f', logical_type: 'Int' }, [{ key: 'Dataset/a%20b', type: 'Member' }]),
    node('DataType/Int', 'DataType', { id: 'Int', operations: ['Eq', 'Ne'] }),
  ];
  const md = renderMarkdown(nodes, {});
  assert(!md.includes('Directory/'));
  assert(md.includes('## Dataset/a%20b'));
  assert(md.includes('### Dataset/a%20b/fields'));
  assert(md.includes('#### opaque-field'));
  assert(md.includes('[f](#opaque-field)'));
  assert(md.includes('[Int](#DataType/Int)'));
  assert(md.includes('](#Dataset/a%20b)'));
  assert(!md.includes('%2520'));
  assert(md.indexOf('#### opaque-field') < md.indexOf('# DataType'));
  const anchors = new Set([...md.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]));
  for (const match of md.matchAll(/\]\(#([^\n]+?)\)/g)) assert(anchors.has(match[1]), match[1]);
});

test('only referenced objects become chapters and inline properties preserve values', () => {
  const md = renderMarkdown([
    node('Schema/source', 'Schema', {
      key: 'Schema/target', examples: [{ empty: '', nullable: null, enabled: false, count: 0, list: [], object: {}, nested: { text: 'line1\nline2' } }],
    }),
    node('Schema/target', 'Schema', { operations: ['Eq', 'Ne'] }),
  ], {});
  assert(!md.includes('<a id="Schema/source">'));
  assert(!md.includes('## Schema/source'));
  assert(md.includes('- **Schema/source**:'));
  assert(md.includes('<a id="Schema/target"></a>'));
  assert(md.includes('## Schema/target'));
  assert(md.includes('empty: `""`, nullable: `null`, enabled: `false`, count: `0`, list: `[]`, object: `{}`, nested: { text: line1<br>line2 }'));
  assert(md.includes('**operations**: [Eq, Ne]'));
  assert(!md.includes('Item 1'));
});

test('rejects duplicate keys and unresolved references', () => {
  assert.throws(() => renderMarkdown([node('a', 'Schema'), node('a', 'Schema')], {}), /Duplicate/);
  assert.throws(() => renderMarkdown([node('a', 'Schema', {}, [{ type: 'Member', key: 'missing' }])], {}), /Unresolved/);
});

test('renders association kinds as direct references without a links wrapper', () => {
  const md = renderMarkdown([
    node('Schema/source', 'Schema', {}, [
      { type: 'Member', key: 'Schema/a' },
      { type: 'Related', key: 'Schema/a' },
      { type: 'Member', key: 'Schema/b' },
      { type: 'Traversable', key: 'Schema/b' },
    ]),
    node('Schema/a', 'Schema'),
    node('Schema/b', 'Schema'),
  ], {});
  assert(!md.includes('**links**'));
  assert(!md.includes('{ type: Member, key:'));
  assert(md.includes('**Member**: [Schema/a](#Schema/a), [Schema/b](#Schema/b)'));
  assert(md.includes('**Related**: [Schema/a](#Schema/a)'));
  assert(md.includes('**Traversable**: [Schema/b](#Schema/b)'));
});

test('links nested type documentation, prose, vocabulary entries, values and computed dependencies', () => {
  const source = node('Dimension/a/status', 'Dimension', {
    dataset: 'a', id: 'status', type_id: 'status',
    input_docs: [{ kind: 'DatetimeUtc', text: 'Use DatetimeUtc, not DatetimeUtcExtra; see DataType/DatetimeUtc.' }],
    values: [{ id: 'ready', label: 'Ready' }], canonical_order: ['ready'],
    sampling: { id: 'count', field: 'status' }, computed: { left: 'count', right: 'count', op: 'Add' },
  });
  source.description.summary = 'DatetimeUtc and Int are logical types.';
  const md = renderMarkdown([
    source,
    node('Dataset/a', 'Dataset', { id: 'a' }),
    node('Field/a/status', 'Field', { dataset: 'a', id: 'status' }),
    node('Value/status/ready', 'Value', { type_id: 'status', id: 'ready' }),
    node('Measure/a/count', 'Measure', { dataset: 'a', id: 'count' }),
    node('DataType/DatetimeUtc', 'DataType', { id: 'DatetimeUtc' }),
    node('DataType/Int', 'DataType', { id: 'Int' }),
    node('Terminology/types', 'Terminology', { entries: [{ key: 'DataType/DatetimeUtc', id: 'DatetimeUtc', label: 'UTC instant', term: 'UTC' }] }),
  ], {});
  assert(md.includes('kind: [DatetimeUtc](#DataType/DatetimeUtc)'));
  assert(md.includes('Use [DatetimeUtc](#DataType/DatetimeUtc), not DatetimeUtcExtra; see [DataType/DatetimeUtc](#DataType/DatetimeUtc).'));
  assert(md.includes('[DatetimeUtc](#DataType/DatetimeUtc) and [Int](#DataType/Int) are logical types.'));
  assert(md.includes('id: [ready](#Value/status/ready), label: [Ready](#Value/status/ready)'));
  assert(md.includes('**canonical_order**: [[ready](#Value/status/ready)]'));
  assert(md.includes('id: [count](#Measure/a/count), field: [status](#Field/a/status)'));
  assert(md.includes('left: [count](#Measure/a/count), right: [count](#Measure/a/count)'));
  assert(md.includes('id: [DatetimeUtc](#DataType/DatetimeUtc), label: [UTC instant](#DataType/DatetimeUtc), term: [UTC](#DataType/DatetimeUtc)'));
});
