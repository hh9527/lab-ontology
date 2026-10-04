import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectKnowledge, publicationMetadata, responseSize, verifyManifest } from './knowledge-publication.mjs';

const node = (key, type, detail = {}, links = []) => ({ key, type,
  description: { label: key, aliases: [], localized: [], summary: '' }, links, detail });
const nodes = () => [
  node('index', 'Index', { revision: 'foo-v1', schemas: [] }),
  node('opaque', 'Dataset', { id: 'foo' }, [{ type: 'Member', key: 'index' }]),
];

test('manifest keys/types, counts and revision come from visible nodes only', () => {
  const { manifest, sizes } = publicationMetadata('digest', [{ domain: 'foo', nodes: nodes() }], 16000);
  assert.deepEqual(manifest.domains[0], { domain: 'foo', revision: 'foo-v1',
    counts: { Index: 1, Dataset: 1 }, entries: [{ key: 'index', type: 'Index' }, { key: 'opaque', type: 'Dataset' }] });
  assert.equal(sizes.status, 'passed');
  assert.equal(sizes.domains[0].largest_entry, null);
  assert.equal(sizes.domains[0].largest_link.target_key, 'index');
});

test('one added field crosses the exact full-response character boundary', () => {
  const input = nodes();
  input[1].description.summary = 'x'.repeat(1000);
  const threshold = responseSize(input[1]);
  assert.equal(inspectKnowledge('foo', input, threshold).sizes.oversized.length, 0);
  input[1].detail.field_roles = [{ field: 'new_field', roles: ['Appellation'] }];
  const report = inspectKnowledge('foo', input, threshold).sizes;
  assert.deepEqual(report.oversized.map(item => item.key), ['opaque']);
  assert.equal(report.node_sizes[0].chars, JSON.stringify({ Document: { Found: input[1] } }, null, 2).length);
});

test('the budget counts JavaScript UTF-16 characters, not UTF-8 bytes', () => {
  const item = nodes()[1];
  item.description.summary = '\u4e2d\u{1f642}';
  const rendered = JSON.stringify({ Document: { Found: item } }, null, 2);
  assert.equal(responseSize(item), rendered.length);
  assert.notEqual(responseSize(item), Buffer.byteLength(rendered));
});

test('index metadata is measured without the concrete document size limit', () => {
  const input = nodes();
  input[0].detail.encoding = 'x'.repeat(20000);
  const report = inspectKnowledge('foo', input, 16000).sizes;
  assert.equal(report.oversized.length, 0);
  assert(report.node_sizes.find(item => item.key === 'index').chars > 16000);
});

test('duplicate/dangling keys and missing revision cannot generate a valid publication', () => {
  assert.throws(() => inspectKnowledge('foo', [nodes()[0], nodes()[0]], 16000), /duplicate/);
  const dangling = nodes();
  dangling[0].detail.schemas = ['missing'];
  assert.throws(() => inspectKnowledge('foo', dangling, 16000), /dangling/);
  const input = nodes();
  delete input[0].detail.revision;
  assert.throws(() => inspectKnowledge('foo', input, 16000), /revision/);
});

test('real-call verification checks hash, revision, type and hidden keys', async () => {
  const input = nodes();
  const { manifest } = publicationMetadata('digest', [{ domain: 'foo', nodes: input }], 16000);
  const calls = [];
  const info = async (domain, { key }) => {
    calls.push({ domain, key });
    const found = input.find(node => node.key === key);
    return { Document: found ? { Found: found } : 'NotFound' };
  };
  const checked = await verifyManifest(manifest, 'digest', info, [{ domain: 'foo', key: 'hidden' }]);
  assert.equal(checked.samples, 2);
  assert.equal(checked.not_found_checks, 1);
  assert.ok(calls.some(call => call.key === 'hidden'));
  await assert.rejects(verifyManifest(manifest, 'stale', info), /SHA-256/);
  input[0].detail.revision = 'foo-v2';
  await assert.rejects(verifyManifest(manifest, 'digest', info), /revision/);
  input[0].detail.revision = 'foo-v1';
  input[1].type = 'Field';
  await assert.rejects(verifyManifest(manifest, 'digest', info), /type mismatch/);
});
