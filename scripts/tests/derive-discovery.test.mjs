import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, derive, compareDiscovery } from '../derive-discovery.mjs';

const node = (key, type, detail, links = [], description = {}) => ({ key, type, detail, links,
  description: { label: detail.id ?? key, summary: '', aliases: [], localized: [], ...description } });
function fixture() {
  return [
    node('index', 'Index', { revision: 'v1', schemas: ['Schema/test'] }),
    node('Schema/test', 'Schema', {}, [{ key: 'index', type: 'Member' }]),
    node('Dataset/a%2Fb', 'Dataset', { id: 'a/b' }, [{ key: 'Dimension/a%2Fb/status', type: 'Member' }]),
    node('Dimension/a%2Fb/status', 'Dimension', { id: 'status', dataset: 'a/b', type_id: 'Status' },
      [{ key: 'Type/Status', type: 'Member' }, { key: 'Type/Int', type: 'Member' }],
      { label: 'Status', summary: 'Current status', localized: [{ label: '状态', summary: '当前状态', locale: 'zh' }] }),
    node('Type/Status', 'DataType', { id: 'Status', storage: 'Int' }, [{ key: 'Value/Status/online', type: 'Member' }]),
    node('Type/Int', 'DataType', { id: 'Int' }),
    node('Value/Status/online', 'Value', { id: 'online', type_id: 'Status' }, [{ key: 'Type/Status', type: 'Member' }]),
    node('Relation/self', 'Relation', { id: 'self', from_dataset: 'a/b', to_dataset: 'a/b' }, [
      { key: 'Dataset/a%2Fb', type: 'Member' }, { key: 'Dataset/a%2Fb', type: 'Member' },
      { key: 'Dataset/a%2Fb', type: 'Traversable' },
    ]),
  ];
}

test('discovers from Dataset/Relation roots using only exact info, including cycles and schemas', async () => {
  const source = new Map(fixture().map(node => [node.key, node]));
  const calls = [];
  const nodes = await discover(async ({ key }) => {
    calls.push(key);
    return { Document: { Found: source.get(key) } };
  }, ['Dataset/a%2Fb', 'Relation/self']);
  assert.deepEqual(new Set(nodes.map(node => node.key)), new Set(source.keys()));
  assert.equal(calls.length, new Set(calls).size);
});

test('derives vocabulary, ownership and unique reference kinds from documents', () => {
  const result = derive(fixture());
  assert.deepEqual(result.terminology.dimensions[0], {
    name: 'status', dataset: 'a/b', doc: 'Current status\n当前状态', aliases: ['Status', '状态'],
  });
  assert.deepEqual(result.terminology.types.map(entry => entry.name), ['Status']);
  assert.equal(result.terminology.values[0].type_id, 'Status');
  assert.deepEqual(result.links.links.filter(link => link.source === 'Relation/self').map(link => link.kind),
    ['Member', 'Traversable']);
  assert(compareDiscovery(result, result).equal);
});

test('comparison exposes unavailable term metadata instead of inventing it', () => {
  const result = derive(fixture());
  const baseline = structuredClone(result);
  baseline.terminology.types[0].aliases.push('业务状态');
  baseline.terminology.types[0].doc = 'Term-specific explanation';
  const report = compareDiscovery(result, baseline);
  assert.equal(report.equal, false);
  assert.deepEqual(report.terminology.types.different[0].fields, ['doc', 'aliases']);
});

test('structured terms preserve explicit aliases and descriptions, including alias overrides', () => {
  const nodes = fixture();
  const status = nodes.find(node => node.key === 'Type/Status');
  status.description.aliases = ['业务状态'];
  status.description.terms = [{ term: '业务状态', description: '业务状态的说明' }];
  const entry = derive(nodes).terminology.types[0];
  assert.deepEqual(entry.aliases, ['业务状态']);
  assert.equal(entry.doc, '业务状态的说明');
});

test('alias descriptions preserve the display-label fallback alongside localized explanations', () => {
  const nodes = fixture();
  const dimension = nodes.find(node => node.type === 'Dimension');
  dimension.description.summary = '';
  dimension.description.aliases = ['状态'];
  assert.equal(derive(nodes).terminology.dimensions[0].doc, '当前状态\nStatus');
});

test('unresolved references and invalid discovery roots fail explicitly', async () => {
  await assert.rejects(discover(async () => ({ Document: 'NotFound' }), ['Dataset/a']), /Unresolved/);
  await assert.rejects(discover(async () => {}, ['Field/a/f']), /Invalid discovery root/);
  assert.throws(() => derive(fixture().filter(node => node.key !== 'Type/Status')), /Unresolved reference/);
});

test('wrong owner and duplicate node keys cannot generate a search index', () => {
  const nodes = fixture();
  nodes.find(node => node.type === 'Dimension').detail.dataset = 'wrong';
  assert.throws(() => derive(nodes), /owner mismatch/);
  assert.throws(() => derive([...fixture(), fixture()[0]]), /Duplicate knowledge/);
});
