import { isDeepStrictEqual } from 'node:util';

const indexes = new Map();
const flights = new Map();
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Build host lookup/reference indexes only after validating a complete export. */
export function buildKnowledgeIndex(publication, discovery) {
  if (publication?.format !== 'ontology-knowledge-export-v1') throw new Error('Unsupported knowledge export format');
  if (!record(discovery) || discovery.addressing !== 'node-member-uri-v1'
      || discovery.knowledge_contract !== 'ontology-knowledge-v3'
      || discovery.intent_contract !== 'ontology-intent-v1'
      || typeof discovery.revision !== 'string' || !discovery.revision
      || !Array.isArray(discovery.roots) || discovery.roots.some(key => typeof key !== 'string')
      || !Array.isArray(discovery.key_patterns) || !Array.isArray(discovery.vocabulary)) {
    throw new Error('Unsupported knowledge discovery contract');
  }
  if (!isDeepStrictEqual(publication.discovery, discovery)) throw new Error('Export and discovery contracts differ');
  if (!Array.isArray(publication.nodes)) throw new Error('Knowledge export requires nodes');
  const byKey = new Map();
  const outgoing = new Map();
  for (const node of publication.nodes) {
    if (!record(node) || typeof node.key !== 'string' || !node.key || typeof node.type !== 'string'
        || !record(node.address) || !record(node.description) || !record(node.detail)
        || !Array.isArray(node.links)) throw new Error('Invalid knowledge node');
    if (byKey.has(node.key)) throw new Error(`Duplicate knowledge key: ${node.key}`);
    byKey.set(node.key, node);
  }
  for (const node of publication.nodes) {
    for (const link of node.links) {
      if (!record(link) || typeof link.key !== 'string' || typeof link.role !== 'string'
          || !['Member', 'Traversable', 'Related'].includes(link.type)) throw new Error(`Invalid knowledge link: ${node.key}`);
      if (!byKey.has(link.key)) throw new Error(`Dangling knowledge link: ${node.key} -> ${link.key}`);
    }
    outgoing.set(node.key, node.links);
  }
  for (const key of ['index', ...discovery.roots]) {
    if (!byKey.has(key)) throw new Error(`Missing knowledge root: ${key}`);
  }
  return { discovery, nodes: publication.nodes, byKey, outgoing };
}

// A root can supply the complete node set or only entry nodes. Follow opaque
// keys through info when incomplete, then validate and publish the whole graph.
async function discoverKnowledge(request, domain) {
  const root = await request(`${domain}/discovery`, {});
  if (root?.format !== 'ontology-knowledge-export-v1' || typeof root.complete !== 'boolean'
      || !Array.isArray(root.nodes) || !Array.isArray(root.discovery?.roots)) {
    throw new Error('Invalid knowledge root');
  }
  if (root.complete) return buildKnowledgeIndex(root, root.discovery);
  const nodes = [...root.nodes];
  const known = new Set(nodes.map(node => node?.key));
  if (known.size !== nodes.length) throw new Error('Duplicate knowledge key in root');
  const queue = [...new Set(['index', ...root.discovery.roots])];
  const scheduled = new Set(queue);
  const schedule = node => {
    if (!Array.isArray(node?.links)) throw new Error('Invalid knowledge node links');
    for (const link of node.links) {
      if (typeof link?.key !== 'string') throw new Error('Invalid knowledge link key');
      if (!scheduled.has(link.key)) { scheduled.add(link.key); queue.push(link.key); }
    }
  };
  nodes.forEach(schedule);
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    if (known.has(key)) continue;
    const response = await request(`${domain}/info`, { key });
    const node = response?.Document?.Found;
    if (node?.key !== key) throw new Error(`Knowledge key did not resolve to a node: ${key}`);
    known.add(key); nodes.push(node); schedule(node);
  }
  return buildKnowledgeIndex({ ...root, nodes }, root.discovery);
}

/** request(method, input) returns the unwrapped successful Guest response.
 * Callers own transport errors and the lifetime of the cached artifact data.
 * Pass shared cache/flights maps to scope retention; defaults share by artifact.
 */
export function createKnowledgeHost({ request, artifactHash, domain, cache = indexes, pending = flights }) {
  if (typeof request !== 'function' || !/^[a-f0-9]{64}$/i.test(artifactHash ?? '')
      || typeof domain !== 'string' || !domain) throw new Error('Knowledge host requires request, artifact SHA-256 and domain');
  const identity = JSON.stringify([artifactHash.toLowerCase(), domain]);
  const load = async () => {
    if (cache.has(identity)) return cache.get(identity);
    let flight = pending.get(identity);
    if (!flight) {
      flight = (async () => {
        const index = await discoverKnowledge(request, domain);
        cache.set(identity, index);
        return index;
      })();
      pending.set(identity, flight);
    }
    try { return await flight; }
    finally { if (pending.get(identity) === flight) pending.delete(identity); }
  };
  return {
    load,
    discovery: async () => (await load()).discovery,
    info: async ({ key }) => {
      if (typeof key !== 'string') throw new Error('Info requires a string key');
      const node = (await load()).byKey.get(key);
      return { Document: node === undefined ? 'NotFound' : { Found: node } };
    },
  };
}
