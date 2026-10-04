import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectKnowledge } from '../ontology/tools/knowledge-export.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

export function renderMarkdown(nodes, metadata) {
  const keys = new Set(nodes.map(node => node.key));
  if (keys.size !== nodes.length) throw new Error('Duplicate knowledge keys');
  const sourceCount = nodes.length;
  const sorted = [...nodes].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const escapeText = value => String(value).replace(/([\\`*[\]<>])/g, '\\$1').replaceAll('\n', '<br>');
  const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const referenced = new Set();
  const reference = (key, label) => {
    const target = byKey.get(key);
    if (!target) throw new Error(`Unresolved link: ${key}`);
    referenced.add(key);
    return `[${escapeText(label ?? (target.description.label || key))}](#${key})`;
  };
  const identities = new Map();
  for (const node of nodes) {
    const owner = node.detail.dataset ?? node.detail.type_id ?? node.detail.hub ?? node.detail.from_dataset ?? '';
    const id = node.detail.id ?? (node.type === 'TimeRole' ? node.detail.field : undefined);
    if (id !== undefined) identities.set(JSON.stringify([node.type, owner, id]), node.key);
  }
  const resolveIdentity = (type, owner, id) => identities.get(JSON.stringify([type, owner, id]));
  const textTargets = new Map(nodes.map(node => [node.key, node.key]));
  for (const node of nodes.filter(node => node.type === 'DataType')) textTargets.set(node.detail.id, node.key);
  const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const textPattern = new RegExp(`(?<![\\p{L}\\p{N}_/])(?:${[...textTargets.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join('|')})(?![\\p{L}\\p{N}_/])`, 'gu');
  function prose(value, context) {
    let offset = 0;
    const parts = [];
    for (const match of value.matchAll(textPattern)) {
      parts.push(escapeText(value.slice(offset, match.index)));
      const key = textTargets.get(match[0]);
      parts.push(key === context.nodeKey ? escapeText(match[0]) : reference(key, match[0]));
      offset = match.index + match[0].length;
    }
    parts.push(escapeText(value.slice(offset)));
    return parts.join('');
  }
  function scalar(value, field, owner, context = {}) {
    if (typeof value !== 'string') return `\`${JSON.stringify(value)}\``;
    let key;
    if (byKey.has(value)) key = value;
    else if (['id', 'label', 'term'].includes(field) && context.target) key = context.target;
    else if (['dataset', 'from_dataset', 'to_dataset', 'hub', 'required_dataset_ids'].includes(field)) key = resolveIdentity('Dataset', '', value);
    else if (['field', 'fields', 'grain'].includes(field)) key = resolveIdentity('Field', owner, value);
    else if (['dimension', 'dimension_ids'].includes(field)) {
      const matches = nodes.filter(node => node.type === 'Dimension' && node.detail.id === value);
      key = resolveIdentity('Dimension', owner, value) ?? (matches.length === 1 ? matches[0].key : undefined);
    } else if (['type_id', 'logical_type', 'input_kinds', 'kind', 'encoding', 'semantics'].includes(field)) key = resolveIdentity('DataType', '', value);
    else if (['left', 'right'].includes(field) && context.computed) key = resolveIdentity('Measure', owner, value);
    else if (field === 'canonical_order') key = resolveIdentity('Value', context.type_id, value);
    return key && key !== context.nodeKey ? reference(key, value) : value === '' ? '`""`'
      : ['summary', 'description', 'text', 'value_contract'].includes(field) ? prose(value, context) : escapeText(value);
  }
  function inline(value, owner, field = '', context = {}) {
    if (value === null || typeof value !== 'object') return scalar(value, field, owner, context);
    if (Array.isArray(value)) {
      return value.length ? `[${value.map(item => inline(item, owner, field, context)).join(', ')}]` : '`[]`';
    }
    owner = value.dataset ?? owner;
    context = { ...context, computed: context.computed || field === 'computed',
      target: byKey.has(value.key) ? value.key
        : ['values', 'mapping'].includes(field) ? resolveIdentity('Value', context.type_id, value.id)
        : field === 'sampling' ? resolveIdentity('Measure', owner, value.id) : undefined };
    const entries = Object.entries(value);
    return entries.length
      ? `{ ${entries.map(([name, item]) => `${escapeText(name)}: ${inline(item, owner, name, context)}`).join(', ')} }`
      : '`{}`';
  }
  function properties(value, owner, depth = 0, context = {}) {
    const indent = '  '.repeat(depth);
    return Object.entries(value).flatMap(([name, item]) => {
      const prefix = `${indent}- **${escapeText(name)}**:`;
      if (Array.isArray(item) && item.some(entry => entry !== null && typeof entry === 'object')) {
        return [prefix, ...item.map(entry => `${indent}  - ${inline(entry, owner, name, context)}`)];
      }
      return [`${prefix} ${inline(item, owner, name, context)}`];
    });
  }
  const datasetOwner = node => node.type === 'Dataset' ? node.detail.id
    : node.detail.dataset ?? node.detail.from_dataset ?? node.detail.hub;
  const owners = new Map();
  for (const node of sorted) {
    const owner = datasetOwner(node);
    if (resolveIdentity('Dataset', '', owner)) owners.set(node.key, owner);
  }
  // Render properties first so semantic references also participate in chapter selection.
  const bodies = new Map(sorted.map(node => {
    const owner = owners.get(node.key) ?? '';
    const context = { nodeKey: node.key, type_id: node.type === 'DataType' ? node.detail.id : node.detail.type_id };
    const associations = new Map();
    for (const link of node.links) {
      if (!associations.has(link.type)) associations.set(link.type, []);
      associations.get(link.type).push(reference(link.key));
    }
    return [node.key, [
      `- **type**: ${escapeText(node.type)}`,
      `- **description**: ${inline(node.description, owner, 'description', context)}`,
      ...properties(node.detail, owner, 0, context),
      ...[...associations].map(([type, targets]) => `- **${escapeText(type)}**: ${targets.join(', ')}`),
    ]];
  }));
  const counts = {};
  for (const node of sorted) counts[node.type] = (counts[node.type] ?? 0) + 1;
  const lines = ['# Model Knowledge', '',
    'Mechanical export of schema and concrete model knowledge. Dataset members are direct references.', '',
    ...properties({ ...metadata, source_nodes: sourceCount, nodes: nodes.length, counts }, ''), ''];
  const emitted = new Set();
  function emit(node, level) {
    if (emitted.has(node.key)) throw new Error(`Duplicate rendered node: ${node.key}`);
    emitted.add(node.key);
    if (referenced.has(node.key)) {
      lines.push(`<a id="${escapeAttribute(node.key)}"></a>`, '', `${'#'.repeat(level)} ${escapeText(node.key)}`, '', ...bodies.get(node.key), '');
    } else {
      lines.push(`- **${escapeText(node.key)}**:`, ...bodies.get(node.key).map(line => `  ${line}`), '');
    }
  }
  const groups = {
    Field: 'fields', Relation: 'rels', Dimension: 'dimensions', Value: 'values',
    Measure: 'measures', TimeRole: 'time_roles', BusinessLink: 'business_links',
  };
  lines.push('# Datasets', '');
  for (const dataset of sorted.filter(node => node.type === 'Dataset')) {
    emit(dataset, 2);
    for (const [type, label] of Object.entries(groups)) {
      const members = sorted.filter(node => node.type === type && owners.get(node.key) === dataset.detail.id);
      if (!members.length) continue;
      lines.push(`### ${escapeText(dataset.key)}/${label}`, '');
      for (const member of members) emit(member, 4);
    }
  }
  for (const type of ['DataType', 'Schema', 'Index', ...Object.keys(counts)]) {
    const remaining = sorted.filter(node => node.type === type && !emitted.has(node.key));
    if (!remaining.length) continue;
    lines.push(`# ${escapeText(type)}`, '');
    for (const node of remaining) emit(node, 2);
  }
  if (emitted.size !== nodes.length) throw new Error('Markdown does not cover every knowledge node');
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    artifact: { type: 'string', default: 'bin/icloud_model.snapshot.wasm' },
    domain: { type: 'string', default: 'ic' },
    output: { type: 'string', default: 'bin/icloud_model.knowledge.md' },
  } });
  const artifact = resolve(values.artifact);
  const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  let calls = 0;
  const nodes = await withKnowledgeRunner(artifact, async (info, request) => {
    const roots = await request(`${values.domain}/discovery`, {});
    return collectKnowledge(async input => {
    if (++calls % 500 === 0) process.stderr.write(`Exported ${calls} nodes\n`);
    return info(values.domain, input);
    }, roots);
  }, { memory: '2048' });
  const revision = nodes.find(node => node.key === 'index')?.detail.revision;
  if (!revision) throw new Error('Missing model revision');
  const manifest = JSON.parse(readFileSync(`${artifact}.knowledge.json`, 'utf8'));
  if (manifest.artifact_sha256 !== sha256) throw new Error('Snapshot/manifest hash mismatch');
  const domain = manifest.domains.find(domain => domain.domain === values.domain);
  if (!domain || domain.revision !== revision) throw new Error('Manifest revision mismatch');
  const expected = domain.entries.map(entry => entry.key).sort();
  const actual = nodes.map(node => node.key).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Export does not cover the complete manifest');
  const markdown = renderMarkdown(nodes, { domain: values.domain, revision, artifact_sha256: sha256 });
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, markdown);
  console.log(JSON.stringify({ output, revision, source_nodes: nodes.length,
    nodes: nodes.length,
    bytes: Buffer.byteLength(markdown), lines: markdown.split('\n').length }));
}
