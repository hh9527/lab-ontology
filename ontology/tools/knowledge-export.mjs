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
    for (const link of node.links) {
      if (typeof link.key !== 'string') throw new Error('Knowledge link requires a string key');
      if (!seen.has(link.key)) {
        seen.add(link.key);
        pending.push(link.key);
      }
    }
  }
  return nodes;
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
