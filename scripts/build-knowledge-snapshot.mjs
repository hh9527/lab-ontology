import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectKnowledge } from '../ontology/tools/knowledge-export.mjs';
import { publicationMetadata, verifyManifest } from '../ontology/tools/knowledge-publication.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: options } = parseArgs({ options: {
  module: { type: 'string' }, context: { type: 'string' }, domain: { type: 'string', multiple: true }, output: { type: 'string' },
  'max-node-chars': { type: 'string', default: '16000' },
  'on-oversize': { type: 'string', default: 'error' },
  'initialization-fuel': { type: 'string', default: '100000' },
  'request-fuel': { type: 'string', default: '100000' },
  'with-memory-limit': { type: 'string', default: '1024' },
  source: { type: 'string', multiple: true }, 'not-found': { type: 'string' },
} });
if (!options.module || !options.output || !options.domain?.length) {
  throw new Error('Required: --module <module> --domain <domain> [--domain ...] --output <snapshot.wasm>');
}
if (new Set(options.domain).size !== options.domain.length || options.domain.some(domain => !domain)) {
  throw new Error('Domains must be nonempty and unique');
}
const maxNodeChars = Number(options['max-node-chars']);
if (!Number.isSafeInteger(maxNodeChars) || maxNodeChars <= 0) throw new Error('max-node-chars must be a positive integer');
if (!['error', 'warn'].includes(options['on-oversize'])) throw new Error('on-oversize must be error or warn');
const output = resolve(options.output);
const notFound = options['not-found'] ? JSON.parse(readFileSync(options['not-found'], 'utf8')) : [];
mkdirSync(dirname(output), { recursive: true });
const staging = mkdtempSync(join(dirname(output), '.knowledge-build-'));
try {
  const artifact = join(staging, basename(output));
  const args = ['-C', options.context ?? options.module, 'build', options.module, '--snapshot', '-o', artifact,
    '--initialization-fuel', options['initialization-fuel'], '--request-fuel', options['request-fuel'],
    '--with-memory-limit', options['with-memory-limit']];
  for (const source of options.source ?? []) args.push('--source', source);
  const build = spawnSync(join(root, 'bin/telora'), args, { cwd: root, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`snapshot compilation failed (${build.status})`);
  const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const metadata = await withKnowledgeRunner(artifact, async info => {
    const domains = [];
    for (const domain of options.domain) {
      let calls = 0;
      const nodes = await collectKnowledge(async input => {
        if (++calls % 250 === 0) process.stderr.write(`Checking ${domain}: ${calls} nodes\n`);
        return info(domain, input);
      });
      domains.push({ domain, nodes });
    }
    const metadata = publicationMetadata(sha256, domains, maxNodeChars);
    metadata.sizes.verification = await verifyManifest(metadata.manifest, sha256, info, notFound);
    return metadata;
  }, { requestFuel: options['request-fuel'], memory: options['with-memory-limit'] });
  for (const domain of metadata.sizes.domains) {
    console.log(JSON.stringify({ domain: domain.domain, revision: domain.revision,
      status: domain.oversized.length ? 'oversized' : 'passed', max_node_chars: maxNodeChars,
      largest_nodes: domain.node_sizes.slice(0, 10), largest_entry: domain.largest_entry,
      largest_link: domain.largest_link }));
  }
  if (metadata.sizes.status === 'failed' && options['on-oversize'] === 'error') {
    throw new Error('knowledge response exceeds max-node-chars; snapshot and sidecars were not published');
  }
  if (metadata.sizes.status === 'failed') {
    metadata.sizes.status = 'warning';
    process.stderr.write('WARNING: oversized knowledge nodes; see knowledge-sizes sidecar\n');
  }
  const manifest = join(staging, 'manifest.json');
  const sizes = join(staging, 'sizes.json');
  writeFileSync(manifest, JSON.stringify(metadata.manifest, null, 2) + '\n');
  writeFileSync(sizes, JSON.stringify(metadata.sizes, null, 2) + '\n');
  // No public artifact is replaced until compilation and all checks pass.
  renameSync(manifest, `${output}.knowledge.json`);
  renameSync(sizes, `${output}.knowledge-sizes.json`);
  renameSync(artifact, output);
  console.log(JSON.stringify({ artifact: output, artifact_sha256: sha256,
    manifest: `${output}.knowledge.json`, sizes: `${output}.knowledge-sizes.json`, status: metadata.sizes.status }));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
