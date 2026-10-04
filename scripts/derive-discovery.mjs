import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { discoveryKeys } from '../ontology/tools/knowledge-export.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const groups = { Dataset: 'datasets', Dimension: 'dimensions', Measure: 'measures',
  Relation: 'rels', DataType: 'types', Value: 'values' };
const distinct = strings => [...new Set(strings.filter(value => typeof value === 'string' && value !== ''))];
const edgeKey = edge => JSON.stringify([edge.source, edge.target, edge.kind]);

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

export function derive(nodes) {
  const byKey = new Map(nodes.map(node => [node.key, node]));
  assert.equal(byKey.size, nodes.length, 'Duplicate knowledge nodes');
  const revision = byKey.get('index')?.detail.revision;
  assert.equal(typeof revision, 'string', 'Missing revision');
  const terminology = { revision, datasets: [], dimensions: [], measures: [], rels: [], types: [], values: [] };
  const edges = new Map();
  for (const node of [...nodes].sort((a, b) => a.key.localeCompare(b.key, 'en'))) {
    for (const link of node.links) {
      assert(byKey.has(link.key), `Unresolved reference: ${node.key} -> ${link.key}`);
      assert(['Member', 'Traversable', 'Related'].includes(link.type), 'Invalid reference kind');
      const edge = { source: node.key, target: link.key, kind: link.type };
      edges.set(edgeKey(edge), edge);
    }
    const group = groups[node.type];
    if (!group || (node.type === 'DataType' && typeof node.detail.storage !== 'string')) continue;
    const parts = node.key.split('/').map(decodeURIComponent);
    const scoped = ['Dimension', 'Measure', 'Value'].includes(node.type);
    assert.equal(parts.length, scoped ? 3 : 2, `Invalid business key: ${node.key}`);
    assert.equal(parts[0], node.type === 'DataType' ? 'Type' : node.type, 'Key/type mismatch');
    const name = parts.at(-1);
    assert.equal(node.detail.id, name, `Key/id mismatch: ${node.key}`);
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
    if (['Dimension', 'Measure'].includes(node.type)) {
      assert.equal(node.detail.dataset, parts[1], `Dataset owner mismatch: ${node.key}`);
      entry.dataset = parts[1];
    }
    if (node.type === 'Value') {
      assert.equal(node.detail.type_id, parts[1], `Type owner mismatch: ${node.key}`);
      entry.type_id = parts[1];
    }
    terminology[group].push(entry);
  }
  return { terminology, links: { revision, links: [...edges.values()] } };
}

export function compareDiscovery(result, baseline) {
  assert.equal(result.terminology.revision, baseline.terminology.revision, 'Terminology revision mismatch');
  assert.equal(result.links.revision, baseline.links.revision, 'Links revision mismatch');
  const terminology = {};
  for (const group of Object.values(groups)) {
    const identity = entry => JSON.stringify([entry.dataset ?? entry.type_id ?? '', entry.name]);
    const expected = new Map(baseline.terminology[group].map(entry => [identity(entry), entry]));
    const actual = new Map(result.terminology[group].map(entry => [identity(entry), entry]));
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
  const nodes = await withKnowledgeRunner(artifact, async (info, request) => {
    roots = values.keys ? JSON.parse(readFileSync(values.keys, 'utf8')) : await request(`${values.domain}/discovery`, {});
    return discover(input => info(values.domain, input), roots,
      count => { if (count % 500 === 0) process.stderr.write(`Discovered ${count} nodes\n`); });
  }, { memory: '2048' });
  const result = derive(nodes);
  assert.equal(result.terminology.revision, domain.revision, 'Manifest revision mismatch');
  const found = new Set(nodes.map(node => node.key));
  const expected = new Set(domain.entries.map(entry => entry.key));
  const report = { artifact_sha256: sha, revision: domain.revision, roots: roots.length, nodes: nodes.length,
    coverage: { missing: [...expected].filter(key => !found.has(key)), extra: [...found].filter(key => !expected.has(key)) },
    counts: Object.fromEntries(Object.values(groups).map(group => [group, result.terminology[group].length])),
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
