import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildValue } from './service-build-value.mjs';

if (!process.argv[2]) throw new Error('Usage: node scripts/run-verified-service.mjs <wasm>');
const metadata = readBuildValue(readFileSync(process.argv[2]));
const temporary = process.env.TMPDIR || join(homedir(), '.cache/tmp');
mkdirSync(temporary, { recursive: true });
const directory = mkdtempSync(join(temporary, 'service-build-value-'));
try {
  const source = join(directory, 'verified.json');
  writeFileSync(source, JSON.stringify(metadata.value));
  const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
  const result = spawnSync(runner, [process.argv[2], '--source', `verified=${source}`], {
    input: readFileSync(0), encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
