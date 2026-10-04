import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, derive as deriveWithDiscovery, compareDiscovery, vocabularyFromDiscovery } from '../derive-discovery.mjs';
const derive = (nodes, discovery = discoveryFixture()) => deriveWithDiscovery(nodes, discovery);

const node = (key, type, detail, links = [], description = {}) => ({ key, type, detail, links,
  description: { label: detail.id ?? key, summary: '', aliases: [], localized: [], ...description } });
function discoveryFixture() {
  return { revision: 'v1', roots: ['Dataset/a%2Fb', 'Relation/self'],
      key_patterns: [
        {kind: 'Dataset', pattern: 'Dataset/{dataset}'},
        {kind: 'Dimension', pattern: 'Dimension/{dataset}/{dimension}'},
        {kind: 'Measure', pattern: 'Measure/{dataset}/{measure}'},
        {kind: 'Relation', pattern: 'Relation/{relation}'},
        {kind: 'Ty', pattern: 'Ty/{ty}'},
        {kind: 'Value', pattern: 'Value/{ty}/{value}'},
        {kind: 'BusinessLink', pattern: 'BusinessLink/{hub}/{link}'},
        {kind: 'TimeRole', pattern: 'TimeRole/{dataset}/{field}'},
      ], vocabulary: [
        {kind: 'Dataset', group: 'datasets'},
        {kind: 'Dimension', group: 'dimensions', owner: 'dataset'},
        {kind: 'Measure', group: 'measures', owner: 'dataset'},
        {kind: 'Relation', group: 'rels'},
        {kind: 'Ty', group: 'types', require: 'storage'},
        {kind: 'Value', group: 'values', owner: 'ty'},
        {kind: 'BusinessLink', group: 'business_links', owner: 'hub'},
      ] };
}
function fixture() {
  return [
    node('index', 'Index', {revision: 'v1', schemas: ['Schema/test'], key_patterns: discoveryFixture().key_patterns}),
    node('Schema/test', 'Schema', {}, [{ key: 'index', type: 'Member' }]),
    node('Dataset/a%2Fb', 'Dataset', { id: 'a/b' }, [{ key: 'Dimension/a%2Fb/status', type: 'Member' }]),
    node('Dimension/a%2Fb/status', 'Dimension', { id: 'status', dataset: 'a/b', ty: 'Status' },
      [{ key: 'Ty/Status', type: 'Member' }, { key: 'Ty/Int', type: 'Member' }],
      { label: 'Status', summary: 'Current status', localized: [{ label: '状态', summary: '当前状态', locale: 'zh' }] }),
    node('Ty/Status', 'Ty', { id: 'Status', storage: 'Int' }, [{ key: 'Value/Status/online', type: 'Member' }]),
    node('Ty/Int', 'Ty', { id: 'Int' }),
    node('Value/Status/online', 'Value', { id: 'online', ty: 'Status' }, [{ key: 'Ty/Status', type: 'Member' }]),
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
  assert.equal(result.terminology.values[0].ty, 'Status');
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
  const status = nodes.find(node => node.key === 'Ty/Status');
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
  assert.throws(() => derive(fixture().filter(node => node.key !== 'Ty/Status')), /Unresolved reference/);
});

test('wrong owner and duplicate node keys cannot generate a search index', () => {
  const nodes = fixture();
  nodes.find(node => node.type === 'Dimension').detail.dataset = 'wrong';
  assert.throws(() => derive(nodes), /owner mismatch/);
  assert.throws(() => derive([...fixture(), fixture()[0]]), /Duplicate knowledge/);
});

test('business links retain hub ownership, business descriptions and searchable terms', () => {
  const nodes = fixture();
  nodes.push(node('BusinessLink/a%2Fb/peer', 'BusinessLink', { id: 'peer', hub: 'a/b' },
    [{ key: 'Dataset/a%2Fb', type: 'Member' }], {
      label: 'Peer device', summary: 'Bidirectional peer traversal',
      terms: [{ term: '对端设备', description: '双向物理链路的另一端设备' }],
    }));
  const result = derive(nodes);
  assert.deepEqual(result.terminology.business_links, [{
    name: 'peer', hub: 'a/b', doc: 'Bidirectional peer traversal\n双向物理链路的另一端设备',
    aliases: ['Peer device', '对端设备'],
  }]);
  assert(compareDiscovery(result, result).equal);
  nodes.at(-1).detail.hub = 'wrong';
  assert.throws(() => derive(nodes), /owner mismatch/);
});

test('vocabulary additions, removals and group names need no kind-specific code', () => {
  const nodes = fixture();
  nodes.push(node('TimeRole/a%2Fb/ts', 'TimeRole', {dataset: 'a/b', field: 'ts'}, [], {label: '采样时间'}));
  const index = discoveryFixture();
  assert(!Object.hasOwn(derive(nodes, index).terminology, 'clocks'));
  index.vocabulary.push({kind: 'TimeRole', group: 'clocks', owner: 'dataset'});
  assert.deepEqual(derive(nodes, index).terminology.clocks, [{name: 'ts', dataset: 'a/b', doc: '', aliases: ['采样时间']}]);
  index.vocabulary = index.vocabulary.filter(entry => entry.kind !== 'Dimension');
  assert(!Object.hasOwn(derive(nodes, index).terminology, 'dimensions'));
  index.vocabulary = [];
  assert.deepEqual(derive(nodes, index).terminology, {revision: 'v1'});
  delete index.vocabulary;
  assert.throws(() => derive(nodes, index), /Missing vocabulary/);
});

test('declarations distinguish non-vocabulary kinds from unknown kinds and reject malformed contracts', () => {
  const detail = discoveryFixture();
  const policy = vocabularyFromDiscovery(detail);
  assert(policy.patterns.has('TimeRole') && !policy.rules.has('TimeRole'));
  assert(!policy.patterns.has('MissingKind'));
  assert.throws(() => vocabularyFromDiscovery({...detail, vocabulary: [{kind: 'MissingKind', group: 'missing'}]}), /no key pattern/);
  assert.throws(() => vocabularyFromDiscovery({...detail, vocabulary: [{kind: 'Value', group: 'values', owner: 'type_id'}]}), /Owner missing/);
  assert.throws(() => vocabularyFromDiscovery({...detail, vocabulary: [{kind: 'Ty', group: 'types', require: 'storage.value'}]}), /require field/);
  assert.throws(() => vocabularyFromDiscovery({...detail, vocabulary: [{kind: 'Dataset', group: 'revision'}]}), /group/);
});

test('discovery and knowledge must share a revision', () => {
  assert.throws(() => derive(fixture(), {...discoveryFixture(), revision: 'v2'}), /revision mismatch/);
  assert.throws(() => deriveWithDiscovery(fixture()), /revision mismatch/);
});
