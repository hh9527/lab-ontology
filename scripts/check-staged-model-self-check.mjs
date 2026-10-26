// 从已生成的小样本构造无效模型，验证构建延迟校验、自检拒绝。
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const workspace = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Usage: node scripts/check-staged-model-self-check.mjs <generated-workspace>');
const compiler = fileURLToPath(new URL('../bin/telora', import.meta.url));
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
const fixture = 'scale_5_staged';
const original = readFileSync(join(workspace, fixture, 'src/lib.telora'), 'utf8');
const output = mkdtempSync(join(workspace, 'invalid-models-'));
const cases = [
  ['duplicate-dimension', '"dataset_1_name_1"', '"dataset_1_id"', 'unique'],
  ['duplicate-grain', '["id", "tenant_id"]', '["id", "id"]', 'grain repeats'],
  ['expanded-capability', 'dimension_group("identity_value", ItemId.type, True',
    'dimension_group("identity_value", ItemId.type, False', 'expand group capabilities'],
];
for (const [name, before, after, diagnostic] of cases) {
  assert(original.includes(before), name);
  const root = join(output, name);
  mkdirSync(join(root, fixture, 'src'), { recursive: true });
  cpSync(join(workspace, 'ontology'), join(root, 'ontology'), { recursive: true });
  cpSync(join(workspace, fixture, 'telora-crate.json'), join(root, fixture, 'telora-crate.json'));
  writeFileSync(join(root, fixture, 'src/lib.telora'), original.replace(before, after));
  writeFileSync(join(root, 'telora-config.json'), JSON.stringify({ version: 1, members: ['ontology', fixture] }));
  const packages = Object.fromEntries(['ontology', fixture].map(id => [id, {
    source: { workspace: id }, dependencies: id === 'ontology' ? [] : ['ontology'],
  }]));
  writeFileSync(join(root, 'telora-lock.json'), JSON.stringify({ version: 1, packages }));
  const artifact = join(root, 'model.wasm');
  const build = spawnSync(compiler, ['-C', join(root, fixture), 'build', fixture,
    '--snapshot', '-o', artifact, '--initialization-fuel', '400000',
    '--request-fuel', '100000', '--with-memory-limit', '2048'], { encoding: 'utf8', timeout: 120000 });
  assert.ifError(build.error);
  assert.equal(build.status, 0, `${name}: model validation ran during preparation: ${build.stderr}`);
  const run = spawnSync(runner, [artifact], {
    input: JSON.stringify({ method: 'scale/self_check', input: null }), encoding: 'utf8', timeout: 120000,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert(run.stderr.includes(diagnostic), run.stderr);
  console.log(`${name}: preparation succeeded; explicit self-check rejected`);
}
console.log(JSON.stringify({ status: 'ok', output, invalidModels: cases.length }));
