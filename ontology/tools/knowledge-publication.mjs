import assert from 'node:assert/strict';
import { discoveryKeys } from './knowledge-export.mjs';

export const responseSize = node => JSON.stringify({ Document: { Found: node } }, null, 2).length;
const itemSize = item => JSON.stringify(item, null, 2).length;
const compareKeys = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

export function inspectKnowledge(domain, nodes, maxNodeChars) {
  assert.ok(Number.isSafeInteger(maxNodeChars) && maxNodeChars > 0, 'max-node-chars must be a positive integer');
  const byKey = new Map();
  for (const node of nodes) {
    assert.equal(typeof node.key, 'string');
    assert.equal(typeof node.type, 'string');
    assert.ok(!byKey.has(node.key), `duplicate knowledge key: ${node.key}`);
    byKey.set(node.key, node);
  }
  const revision = byKey.get('index')?.detail.revision;
  assert.equal(typeof revision, 'string', `${domain}: index must publish Model revision`);
  assert.ok(revision.length > 0, `${domain}: empty Model revision`);
  const counts = {};
  const nodeSizes = [];
  let largestEntry = null;
  let largestLink = null;
  for (const node of nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    for (const key of discoveryKeys(node)) assert.ok(byKey.has(key), `dangling knowledge key: ${key}`);
    nodeSizes.push({ key: node.key, type: node.type, chars: responseSize(node) });
    for (const [kind, items] of [['entry', node.detail.entries ?? []], ['link', node.links]]) {
      for (const item of items) {
        const size = { node_key: node.key, target_key: item.key, chars: itemSize(item) };
        if (kind === 'entry' && (!largestEntry || size.chars > largestEntry.chars)) largestEntry = size;
        if (kind === 'link' && (!largestLink || size.chars > largestLink.chars)) largestLink = size;
      }
    }
  }
  nodeSizes.sort((a, b) => b.chars - a.chars || compareKeys(a, b));
  const oversized = nodeSizes.filter(item => item.chars > maxNodeChars);
  return {
    manifest: { domain, revision, counts,
      entries: nodes.map(({ key, type }) => ({ key, type })).sort(compareKeys) },
    sizes: { domain, revision, count: nodes.length, max_node_chars: maxNodeChars,
      oversized, node_sizes: nodeSizes, largest_entry: largestEntry, largest_link: largestLink },
  };
}

export function publicationMetadata(artifactSha256, domains, maxNodeChars) {
  const inspected = domains.map(({ domain, nodes }) => inspectKnowledge(domain, nodes, maxNodeChars));
  const manifest = { schema: 'ontology.knowledge-manifest/v1', artifact_sha256: artifactSha256,
    domains: inspected.map(item => item.manifest) };
  const sizes = { schema: 'ontology.knowledge-sizes/v1', artifact_sha256: artifactSha256,
    measurement: 'JSON.stringify({Document:{Found:node}}, null, 2).length',
    max_node_chars: maxNodeChars, status: inspected.some(item => item.sizes.oversized.length) ? 'failed' : 'passed',
    domains: inspected.map(item => item.sizes) };
  return { manifest, sizes };
}

export async function verifyManifest(manifest, artifactSha256, info, notFound = []) {
  assert.equal(manifest.schema, 'ontology.knowledge-manifest/v1');
  assert.equal(manifest.artifact_sha256, artifactSha256, 'manifest does not match snapshot SHA-256');
  let samples = 0;
  const domains = new Set();
  for (const domain of manifest.domains) {
    assert.ok(!domains.has(domain.domain), 'duplicate manifest domain');
    domains.add(domain.domain);
    const root = (await info(domain.domain, { key: 'index' }))?.Document?.Found;
    assert.equal(root?.detail.revision, domain.revision, 'manifest Model revision does not match snapshot');
    const keys = new Set();
    const counts = {};
    const selected = new Map();
    for (const entry of domain.entries) {
      assert.ok(!keys.has(entry.key), 'duplicate manifest key');
      keys.add(entry.key);
      counts[entry.type] = (counts[entry.type] ?? 0) + 1;
      if (!selected.has(entry.type)) selected.set(entry.type, entry);
    }
    assert.deepEqual(counts, domain.counts, 'manifest counts do not match entries');
    // One per type plus evenly spaced entries keep large manifests affordable.
    for (let i = 0; i < Math.min(8, domain.entries.length); i++) {
      const entry = domain.entries[Math.floor(i * domain.entries.length / Math.min(8, domain.entries.length))];
      selected.set(entry.key, entry);
    }
    for (const entry of new Map([...selected.values()].map(entry => [entry.key, entry])).values()) {
      const node = (await info(domain.domain, { key: entry.key }))?.Document?.Found;
      assert.equal(node?.key, entry.key, `manifest sample not Found: ${entry.key}`);
      assert.equal(node.type, entry.type, `manifest sample type mismatch: ${entry.key}`);
      samples++;
    }
  }
  for (const request of notFound) {
    assert.ok(domains.has(request.domain), 'NotFound check domain is not in manifest');
    assert.deepEqual(await info(request.domain, { key: request.key }), { Document: 'NotFound' },
      'hidden/nonexistent key was published');
    assert.ok(!manifest.domains.find(domain => domain.domain === request.domain).entries.some(entry => entry.key === request.key),
      'NotFound key leaked into manifest');
  }
  return { samples, not_found_checks: notFound.length };
}
