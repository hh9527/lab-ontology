import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { discoveryKeys } from '../ontology/tools/knowledge-export.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const distinct = strings => [...new Set(strings.filter(value => typeof value === 'string' && value !== ''))];
const edgeKey = edge => JSON.stringify([edge.source, edge.target, edge.kind]);

export function vocabularyFromDiscovery(detail) {
  assert(Array.isArray(detail?.key_patterns), 'Missing key_patterns declaration');
  assert(Array.isArray(detail.vocabulary), 'Missing vocabulary declaration');
  const patterns = new Map();
  const identifier = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value);
  for (const entry of detail.key_patterns) {
    assert(identifier(entry.kind) && typeof entry.pattern === 'string', 'Invalid key pattern');
    assert(!patterns.has(entry.kind), `Duplicate key pattern kind: ${entry.kind}`);
    const parts = entry.pattern.split('/');
    assert(parts[0] === entry.kind && parts.length >= 2, `Invalid key pattern: ${entry.pattern}`);
    const placeholders = parts.slice(1).map(part => /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(part)?.[1]);
    assert(placeholders.every(Boolean) && new Set(placeholders).size === placeholders.length, 'Invalid key placeholders');
    patterns.set(entry.kind, { parts, placeholders });
  }
  const rules = new Map();
  const groups = new Set();
  for (const entry of detail.vocabulary) {
    assert(patterns.has(entry.kind), `Vocabulary kind has no key pattern: ${entry.kind}`);
    assert(!rules.has(entry.kind), `Duplicate vocabulary kind: ${entry.kind}`);
    assert(identifier(entry.group) && entry.group !== 'revision' && !groups.has(entry.group), 'Invalid or duplicate vocabulary group');
    assert(entry.owner == null || (identifier(entry.owner) && !['name', 'doc', 'aliases'].includes(entry.owner)), 'Invalid vocabulary owner');
    assert(entry.require == null || identifier(entry.require), 'Invalid vocabulary require field');
    assert(Object.keys(entry).every(key => ['kind', 'group', 'owner', 'require'].includes(key)), 'Unknown vocabulary field');
    const pattern = patterns.get(entry.kind);
    const ownerIndex = entry.owner == null ? -1 : pattern.parts.indexOf(`{${entry.owner}}`);
    assert(entry.owner == null || ownerIndex > 0, `Owner missing from key pattern: ${entry.kind}`);
    assert(pattern.parts.length === (entry.owner == null ? 2 : 3) && ownerIndex !== pattern.parts.length - 1,
      `Unsupported vocabulary key shape: ${entry.kind}`);
    groups.add(entry.group);
    rules.set(entry.kind, { ...entry, pattern, ownerIndex });
  }
  return { patterns, rules, groups: [...groups] };
}

export async function discover(info, roots, onProgress = () => {}) {
  assert(Array.isArray(roots) && roots.length > 0, 'Dataset/Relation roots are required');
  assert(roots.every(key => typeof key === 'string' && /^(Dataset|Relation)\/[^/]+$/.test(key)), 'Invalid discovery root');
  const pending = [...new Set(['index', ...roots])];
  const seen = new Set(pending);
  const nodes = [];
  for (const key of pending) {
    const node = (await info({ key }))?.Document?.Found;
    assert(node?.key === key && Array.isArray(node.links), `Unresolved knowledge key: ${key}`);
    nodes.push(node);
    for (const target of discoveryKeys(node)) {
      if (!seen.has(target)) { seen.add(target); pending.push(target); }
    }
    onProgress(nodes.length);
  }
  return nodes;
}

export function derive(nodes, discovery) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  assert.equal(byKey.size, nodes.length, 'Duplicate knowledge nodes');
  const index = byKey.get('index')?.detail;
  const revision = index?.revision;
  assert.equal(typeof revision, 'string', 'Missing revision');
  assert.equal(discovery?.revision, revision, 'Discovery/knowledge revision mismatch');
  const vocabulary = vocabularyFromDiscovery(discovery);
  const terminology = { revision, ...Object.fromEntries(vocabulary.groups.map(group => [group, []])) };
  const edges = new Map();
  for (const node of [...nodes].sort((a, b) => a.key.localeCompare(b.key, 'en'))) {
    for (const link of node.links) {
      assert(byKey.has(link.key), `Unresolved reference: ${node.key} -> ${link.key}`);
      assert(['Member', 'Traversable', 'Related'].includes(link.type), 'Invalid reference kind');
      const edge = { source: node.key, target: link.key, kind: link.type };
      edges.set(edgeKey(edge), edge);
    }
    const rule = vocabulary.rules.get(node.type);
    if (!rule || (rule.require != null && node.detail[rule.require] == null)) continue;
    const parts = node.key.split('/').map(decodeURIComponent);
    assert.equal(parts.length, rule.pattern.parts.length, `Invalid business key: ${node.key}`);
    assert.equal(parts[0], node.type, 'Key/kind mismatch');
    assert(parts.slice(1).every(part => part !== ''), `Empty key component: ${node.key}`);
    const name = parts.at(-1);
    if (node.detail.id != null) assert.equal(node.detail.id, name, `Key/id mismatch: ${node.key}`);
    const localized = [...(node.description.localized ?? []), ...(node.detail.localized ?? [])];
    // Alias terms use the display label when the node has no declared summary.
    const terms = node.description.terms ?? [];
    const aliasDoc = node.description.aliases?.some(alias => !terms.some(term => term.term === alias))
      ? node.description.summary || node.description.label : '';
    const entry = { name,
      doc: distinct([node.description.summary, ...localized.map(text => text.summary),
        ...terms.map(term => term.description), aliasDoc]).join('\n'),
      aliases: distinct([node.description.label, ...(node.description.aliases ?? []),
        ...localized.map(text => text.label), ...terms.map(term => term.term)]).filter(alias => alias !== name) };
    if (rule.owner != null) {
      assert.equal(node.detail[rule.owner], parts[rule.ownerIndex], `Vocabulary owner mismatch: ${node.key}`);
      entry[rule.owner] = parts[rule.ownerIndex];
    }
    terminology[rule.group].push(entry);
  }
  return { terminology, links: { revision, links: [...edges.values()] } };
}

export function compareDiscovery(result, baseline) {
  assert.equal(result.terminology.revision, baseline.terminology.revision, 'Terminology revision mismatch');
  assert.equal(result.links.revision, baseline.links.revision, 'Links revision mismatch');
  const terminology = {};
  for (const group of new Set([...Object.keys(result.terminology), ...Object.keys(baseline.terminology)])) {
    if (group === 'revision') continue;
    const identity = entry => JSON.stringify(Object.entries(entry).filter(([key]) => !['doc', 'aliases'].includes(key)).sort());
    const expected = new Map((baseline.terminology[group] ?? []).map(entry => [identity(entry), entry]));
    const actual = new Map((result.terminology[group] ?? []).map(entry => [identity(entry), entry]));
    terminology[group] = {
      missing: [...expected.keys()].filter(key => !actual.has(key)),
      extra: [...actual.keys()].filter(key => !expected.has(key)),
      different: [...actual].flatMap(([key, entry]) => {
        const prior = expected.get(key);
        if (!prior) return [];
        const fields = ['doc', 'aliases'].filter(field => field === 'aliases'
          ? JSON.stringify([...entry.aliases].sort()) !== JSON.stringify([...prior.aliases].sort())
          : entry.doc !== prior.doc);
        return fields.length ? [{ key, fields }] : [];
      }),
    };
  }
  const expected = new Set(baseline.links.links.map(edgeKey));
  const actual = new Set(result.links.links.map(edgeKey));
  const links = { missing: [...expected].filter(key => !actual.has(key)), extra: [...actual].filter(key => !expected.has(key)) };
  return { equal: Object.values(terminology).every(group => !group.missing.length && !group.extra.length && !group.different.length)
    && !links.missing.length && !links.extra.length, terminology, links };
}

async function main() {
  const { values } = parseArgs({ options: {
    artifact: { type: 'string', default: 'bin/icloud_model.snapshot.wasm' },
    domain: { type: 'string', default: 'ic' }, keys: { type: 'string' },
    'output-prefix': { type: 'string', default: 'bin/icloud_model.derived' },
    'compare-prefix': { type: 'string' },
  } });
  const artifact = resolve(values.artifact);
  const manifest = JSON.parse(readFileSync(`${artifact}.knowledge.json`, 'utf8'));
  const sha = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  assert.equal(sha, manifest.artifact_sha256, 'Snapshot/manifest hash mismatch');
  const domain = manifest.domains.find(domain => domain.domain === values.domain);
  assert(domain, 'Unknown domain');
  let roots;
  let discovery;
  const nodes = await withKnowledgeRunner(artifact, async (info, request) => {
    discovery = await request(`${values.domain}/discovery`, {});
    roots = values.keys ? JSON.parse(readFileSync(values.keys, 'utf8')) : discovery.roots;
    return discover(input => info(values.domain, input), roots,
      count => { if (count % 500 === 0) process.stderr.write(`Discovered ${count} nodes\n`); });
  }, { memory: '2048' });
  const result = derive(nodes, discovery);
  assert.equal(result.terminology.revision, domain.revision, 'Manifest revision mismatch');
  const found = new Set(nodes.map(node => node.key));
  const expected = new Set(domain.entries.map(entry => entry.key));
  const report = { artifact_sha256: sha, revision: domain.revision, roots: roots.length, nodes: nodes.length,
    coverage: { missing: [...expected].filter(key => !found.has(key)), extra: [...found].filter(key => !expected.has(key)) },
    counts: Object.fromEntries(Object.entries(result.terminology).filter(([group]) => group !== 'revision').map(([group, entries]) => [group, entries.length])),
    links: result.links.links.length };
  if (values['compare-prefix']) {
    const prefix = values['compare-prefix'];
    report.comparison = compareDiscovery(result, {
      terminology: JSON.parse(readFileSync(`${prefix}.terminology.json`, 'utf8')),
      links: JSON.parse(readFileSync(`${prefix}.links.json`, 'utf8')),
    });
  }
  const prefix = resolve(values['output-prefix']);
  mkdirSync(dirname(prefix), { recursive: true });
  for (const [suffix, value] of Object.entries({ terminology: result.terminology, links: result.links, report, keys: roots })) {
    writeFileSync(`${prefix}.${suffix}.json`, JSON.stringify(value, null, 2) + '\n');
  }
  console.log(JSON.stringify({ prefix, revision: report.revision, roots: report.roots, nodes: report.nodes,
    counts: report.counts, links: report.links, missing_nodes: report.coverage.missing.length,
    extra_nodes: report.coverage.extra.length, comparison_equal: report.comparison?.equal }));
  if (report.coverage.missing.length || report.coverage.extra.length || report.comparison?.equal === false) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
