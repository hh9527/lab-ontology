// 坏模型可以完成必要准备，完整模型校验由显式 self_check 执行。
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

assert(process.argv[2], 'generated single-copy feature workspace required');
const source = resolve(process.argv[2]);
assert.equal(JSON.parse(readFileSync(join(source, 'experiment.json'))).copies, 1);
const temporary = process.env.TMPDIR || join(homedir(), '.cache/tmp');
mkdirSync(temporary, { recursive: true });
const root = mkdtempSync(join(temporary, 'staged-feature-negative-'));
cpSync(join(source, 'ontology'), join(root, 'ontology'), { recursive: true });
const original = readFileSync(join(source, 'features_staged/src/lib.telora'), 'utf8');
const cases = [
  ['sample-statistics', '[samples::Statistic::Latest, samples::Statistic::Max]', '[samples::Statistic::Latest, samples::Statistic::Max, samples::Statistic::Max]', 'sample group statistics must be distinct'],
  ['domain-overlap', 'v::member(State1("off"), [1])', 'v::member(State1("off"), [0])', 'business domain wire values must be disjoint'],
  ['relation-source', 'relation_a1, relation_z1, relation_reading1', 'relation_a1 <~ {from: relation_a1.from <~ {dataset: relation_a1.from.dataset <~ {source: "wrong"}}}, relation_z1, relation_reading1', 'relation endpoint conflicts with the registered dataset role'],
  ['numeric-members', ', {member: g::Statistic::Max, publish: "load_max_1"}', '', 'numeric binding must preserve its complete group'],
  ['metric-clock', 'owner_decl1, reading_decl1, event_decl1', 'owner_decl1, reading_decl1 <~ {clock: Some("owner")}, event_decl1', 'metric clock requires a UTC instant field'],
  ['column-collision', '"DISPLAY_NAME"', '"PEER"', 'typed column mappings collide on a physical column'],
  ['count-cycle', 't::count_ref(field_count1), t::count_ref(on_count1)', 't::count_ref(field_count1) <~ {id: "off_count_1"}, t::count_ref(on_count1)', 'computed measure dependency cycle'],
  ['duplicate-relation', 'relation_a1, relation_z1, relation_reading1', 'relation_a1, relation_z1 <~ {id: "hub_a_1"}, relation_reading1', 'typed relation ids must be unique'],
  ['dimension-witness', 'g::dimension_group("text", String.type, True, g::equality_filters)', 'g::dimension_group("text", String.type, True, g::equality_filters) <~ {value: Int.type}', 'dimension group witness does not match its binding'],
  ['sample-witness', 'sample_group1, m::optional_field', 'sample_group1 <~ {value: Int.type}, m::optional_field', 'group input field has incompatible type'],
  ['relation-guard', 'edsl::FilterOp::Ne, "hidden"', 'edsl::FilterOp::Gt, "hidden"', 'relation guard supports only Eq or Ne'],
];
const packages = { ontology: { source: { workspace: 'ontology' }, dependencies: [] } };
for (const [id, from, to] of cases) {
  assert(original.includes(from), id);
  const name = id.replaceAll('-', '_');
  mkdirSync(join(root, name, 'src'), { recursive: true });
  writeFileSync(join(root, name, 'src/lib.telora'), original.replace(from, to));
  writeFileSync(join(root, name, 'telora-crate.json'), JSON.stringify({ name, dependencies: ['ontology'] }));
  packages[name] = { source: { workspace: name }, dependencies: ['ontology'] };
}
writeFileSync(join(root, 'telora-config.json'), JSON.stringify({ version: 1, members: Object.keys(packages) }));
writeFileSync(join(root, 'telora-lock.json'), JSON.stringify({ version: 1, packages }));
const compiler = fileURLToPath(new URL('../bin/telora', import.meta.url));
const runner = fileURLToPath(new URL('../bin/telora-run', import.meta.url));
function execute(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
for (const [id, , , diagnostic] of cases) {
  const name = id.replaceAll('-', '_'), artifact = join(root, `${name}.wasm`);
  const built = execute(compiler, ['-C', join(root, name), 'build', name, '--snapshot', '-o', artifact,
    '--initialization-fuel', '400000', '--request-fuel', '100000', '--with-memory-limit', '2048']);
  writeFileSync(join(root, `${name}.build.log`), built.stdout + built.stderr);
  assert.equal(built.status, 0, `${id}: ${built.stdout}${built.stderr}`);
  const checked = execute(runner, [artifact], JSON.stringify({ method: 'scale/self_check', input: null }));
  assert.equal(checked.status, 1, `${id}: ${checked.stdout}${checked.stderr}`);
  assert(checked.stderr.includes(diagnostic), `${id}: ${checked.stderr}`);
}
console.log(JSON.stringify({ status: 'ok', root, deferredChecks: cases.map(([id]) => id) }));
