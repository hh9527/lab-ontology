import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyManifest } from '../ontology/tools/knowledge-publication.mjs';
import { withKnowledgeRunner } from '../ontology/tools/knowledge-runner.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'not-found': { type: 'string' }, 'request-fuel': { type: 'string', default: '100000' },
  'with-memory-limit': { type: 'string', default: '1024' },
} });
if (positionals.length !== 1) throw new Error('Usage: node scripts/check-knowledge-manifest.mjs <snapshot.wasm> [--not-found checks.json]');
const artifact = resolve(positionals[0]);
const manifest = JSON.parse(readFileSync(`${artifact}.knowledge.json`, 'utf8'));
const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
const notFound = values['not-found'] ? JSON.parse(readFileSync(values['not-found'], 'utf8')) : [];
console.log(JSON.stringify(await withKnowledgeRunner(artifact,
  info => verifyManifest(manifest, digest, info, notFound),
  { requestFuel: values['request-fuel'], memory: values['with-memory-limit'] })));
