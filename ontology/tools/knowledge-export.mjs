import { pathToFileURL } from 'node:url';

export async function collectKnowledge(info) {
  const nodes = [];
  const pending = ['index'];
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
  if (['Index', 'Directory', 'Terminology'].includes(node.type)) {
    for (const entry of node.detail.entries) {
      keys.push(entry.key);
      if ('from' in entry) keys.push(entry.from);
      if ('to' in entry) keys.push(entry.to);
    }
  }
  if (keys.some(key => typeof key !== 'string')) {
    throw new Error('Knowledge references require opaque string keys');
  }
  return [...new Set(keys)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.argv[2];
  if (!endpoint) throw new Error('Usage: node knowledge-export.mjs <HTTP info endpoint>');
  const nodes = await collectKnowledge(async (input) => {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Info endpoint returned HTTP ${response.status}`);
    const envelope = await response.json();
    if (envelope.error) throw new Error(JSON.stringify(envelope.diagnostics));
    return envelope.ok;
  });
  process.stdout.write(JSON.stringify(nodes));
}
