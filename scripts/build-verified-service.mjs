import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { appendBuildValue, modelPrefix, sha256 } from './service-build-value.mjs';

const { values } = parseArgs({ options: {
  verification: { type: 'string' }, runtime: { type: 'string' }, output: { type: 'string' },
} });
assert(values.verification && values.runtime && values.output,
  '--verification <generated crate> --runtime <generated crate> --output <new wasm> required');
const verification = resolve(values.verification), runtime = resolve(values.runtime), output = resolve(values.output);
assert(!existsSync(output) && !existsSync(`${output}.verification.wasm`) && !existsSync(`${output}.runtime.wasm`), 'output must be new');
const compiler = fileURLToPath(new URL('../bin/telora', import.meta.url));
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
const source = directory => readFileSync(join(directory, 'src/lib.telora'), 'utf8');
const a = modelPrefix(source(verification)), b = modelPrefix(source(runtime));
assert.equal(a, b, 'verification and runtime declarations differ');
function dependencyHash(directory) {
  const root = resolve(directory, '../ontology');
  const entries = [];
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(path);
      else { assert(entry.isFile(), 'dependency must contain ordinary files'); entries.push([path, sha256(readFileSync(join(root, path)))]); }
    }
  }
  visit('src');
  entries.push(['telora-crate.json', sha256(readFileSync(join(root, 'telora-crate.json')))]);
  return sha256(JSON.stringify(entries));
}
const dependencySourceHash = dependencyHash(verification);
assert.equal(dependencyHash(runtime), dependencySourceHash, 'ontology dependency sources differ');
const compilerHash = sha256(readFileSync(compiler));
function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function build(directory, file, snapshot) {
  const name = JSON.parse(readFileSync(join(directory, 'telora-crate.json'), 'utf8')).name;
  execute(compiler, ['-C', directory, 'build', name, ...(snapshot ? ['--snapshot'] : []), '-o', file,
    '--initialization-fuel', '400000', '--request-fuel', '100000', '--with-memory-limit', '2048']);
}
// A 失败时到此停止，不构建 B，也不写出最终制品。
const verifiedArtifact = `${output}.verification.wasm`;
build(verification, verifiedArtifact, true);
const value = JSON.parse(execute(runner, [verifiedArtifact], JSON.stringify({ method: 'scale/self_check', input: null })));
assert.equal(value, true, 'self_check did not return true');
const runtimeArtifact = `${output}.runtime.wasm`;
build(runtime, runtimeArtifact, false);
assert.equal(sha256(readFileSync(compiler)), compilerHash, 'compiler changed between stages');
assert.equal(modelPrefix(source(verification)), a, 'verification source changed');
assert.equal(modelPrefix(source(runtime)), b, 'runtime source changed');
assert.equal(dependencyHash(verification), dependencySourceHash, 'verification dependencies changed');
assert.equal(dependencyHash(runtime), dependencySourceHash, 'runtime dependencies changed');
const metadata = { schema: 'experiment.service-build-value/v1', type: 'Bool', value,
  verifiedArtifactHash: sha256(readFileSync(verifiedArtifact)), runtimeHash: sha256(readFileSync(runtimeArtifact)),
  modelSourceHash: sha256(a), dependencySourceHash, compilerHash };
writeFileSync(output, appendBuildValue(readFileSync(runtimeArtifact), metadata), { flag: 'wx' });
console.log(JSON.stringify({ output, bytes: readFileSync(output).length, ...metadata }));
