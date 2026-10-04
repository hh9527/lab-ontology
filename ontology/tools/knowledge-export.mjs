import { pathToFileURL } from 'node:url';

export function terminologyKeys(terminology) {
  const component = encodeURIComponent;
  return [
    ...terminology.datasets.map(entry => `Dataset/${component(entry.name)}`),
    ...terminology.dimensions.map(entry => `Dimension/${component(entry.dataset)}/${component(entry.name)}`),
    ...terminology.measures.map(entry => `Measure/${component(entry.dataset)}/${component(entry.name)}`),
    ...terminology.rels.map(entry => `Relation/${component(entry.name)}`),
    ...terminology.types.map(entry => `Type/${component(entry.name)}`),
    ...terminology.values.map(entry => `Value/${component(entry.type_id)}/${component(entry.name)}`),
  ];
}

export async function collectKnowledge(info, roots) {
  const nodes = [];
  if (!Array.isArray(roots) || roots.some(key => !/^(Dataset|Relation)\/[^/]+$/.test(key))) {
    throw new Error('Discovery requires Dataset/Relation keys');
  }
  const pending = [...new Set(['index', ...roots])];
  const seen = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index];
    const response = await info({ key });
    const node = response?.Document?.Found;
    if (node?.key !== key || !Array.isArray(node.links)) {
      throw new Error(`Knowledge key did not resolve to a node: ${key}`);
    }
    nodes.push(node);
    for (const key of discoveryKeys(node)) {
      if (!seen.has(key)) {
        seen.add(key);
        pending.push(key);
      }
    }
  }
  return nodes;
}

export function discoveryKeys(node) {
  const keys = node.links.map(link => link.key);
  if (node.type === 'Index') keys.push(...node.detail.schemas);
  if (keys.some(key => typeof key !== 'string')) {
    throw new Error('Knowledge references require opaque string keys');
  }
  return [...new Set(keys)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.argv[2];
  if (!endpoint) throw new Error('Usage: node knowledge-export.mjs <HTTP info endpoint>');
  async function request(endpoint, input) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Info endpoint returned HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope.error) throw new Error(JSON.stringify(envelope.diagnostics));
    return envelope.ok;
  }
  const discoveryEndpoint = new URL(endpoint);
  if (!discoveryEndpoint.pathname.endsWith('/info')) throw new Error('Info endpoint must end with /info');
  discoveryEndpoint.pathname = discoveryEndpoint.pathname.slice(0, -4) + 'discovery';
  const roots = await request(discoveryEndpoint, {});
  const nodes = await collectKnowledge(input => request(endpoint, input), roots);
  process.stdout.write(JSON.stringify(nodes));
}
