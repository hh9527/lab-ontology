import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const [verification, runtime] = process.argv.slice(2).map(path => resolve(path));
assert(verification && runtime, 'verification and runtime crate paths required');
const root = mkdtempSync(join(tmpdir(), 'service-build-gate-'));
const builder = fileURLToPath(new URL('./build-verified-service.mjs', import.meta.url));
for (const mode of ['false', 'source-mismatch', 'dependency-mismatch']) {
  const directory = join(root, mode);
  for (const [name, source] of [['a', verification], ['b', runtime]]) {
    cpSync(resolve(source, '..'), join(directory, name), { recursive: true });
  }
  const a = join(directory, 'a', verification.split('/').at(-1));
  const b = join(directory, 'b', runtime.split('/').at(-1));
  const path = mode === 'dependency-mismatch'
    ? join(directory, 'b/ontology/src/staged.telora') : join(a, 'src/lib.telora');
  const original = readFileSync(path, 'utf8');
  const changed = mode === 'false' ? original.replace('Value::True', 'Value::False')
    : mode === 'source-mismatch' ? original.replace('dataset-scale-v1', 'different-model') : `${original}\n// changed dependency\n`;
  assert.notEqual(changed, original);
  writeFileSync(path, changed);
  const output = join(directory, 'result.wasm');
  const result = spawnSync(process.execPath, [builder, '--verification', a, '--runtime', b, '--output', output],
    { encoding: 'utf8', timeout: 180000 });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, mode === 'false' ? /self_check did not return true/
    : mode === 'source-mismatch' ? /declarations differ/ : /dependency sources differ/);
  assert(!existsSync(output) && !existsSync(`${output}.runtime.wasm`));
  if (mode !== 'false') assert(!existsSync(`${output}.verification.wasm`));
}
console.log(JSON.stringify({ status: 'ok', rejected: ['false', 'source-mismatch', 'dependency-mismatch'], root }));
