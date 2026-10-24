// Dataset 数量实验：node scripts/generate-dataset-scale-samples.mjs
// 分离自检实验：增加 --staged，产物公开 scale/self_check 和 scale/transform
// 成员宽度实验：node scripts/generate-dataset-scale-samples.mjs --counts 5 --dimensions 2,10,20,40,80,160
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  output: { type: 'string' }, counts: { type: 'string', default: '5,10,20,40' },
  dimensions: { type: 'string', default: '2' },
  'field-types': { type: 'string', default: 'plain' },
  'value-fields': { type: 'string' },
  staged: { type: 'boolean', default: false },
  'runtime-only': { type: 'boolean', default: false },
  'verification-input': { type: 'boolean', default: false },
} });
const positiveIntegers = value => {
  const numbers = value.split(',').map(Number);
  if (!numbers.length || numbers.some(n => !Number.isSafeInteger(n) || n < 1)) {
    throw new Error('counts and dimensions must be comma-separated positive integers');
  }
  return [...new Set(numbers)];
};
const fieldTypes = values['field-types'];
if (!['plain', 'shared', 'distinct'].includes(fieldTypes)) throw new Error('field-types must be plain, shared or distinct');
const fixedFields = values['value-fields'] === undefined ? undefined : positiveIntegers(values['value-fields'])[0];
const valueFieldCount = dimensionCount => fixedFields ?? dimensionCount - 1;
if (values['verification-input'] && !values['runtime-only']) throw new Error('--verification-input requires --runtime-only');
if (values['runtime-only'] && !values.staged) throw new Error('--runtime-only requires --staged');
const counts = positiveIntegers(values.counts);
const dimensions = positiveIntegers(values.dimensions);
const cases = counts.flatMap(count => dimensions.map(dimensionCount => ({
  count, dimensions: dimensionCount,
  name: (dimensionCount === 2 ? `scale_${count}` : `scale_${count}_d${dimensionCount}`)
    + (fieldTypes === 'plain' ? '' : `_${fieldTypes}`)
    + (fixedFields === undefined ? '' : `_f${fixedFields}`)
    + (values.staged ? '_staged' : '')
    + (values['runtime-only'] ? '_runtime' : '')
    + (values['verification-input'] ? '_verified' : ''),
})));
const temporary = process.env.TMPDIR || join(homedir(), '.cache/tmp');
mkdirSync(temporary, { recursive: true });
// Explicit output paths must be new, so earlier experiments remain intact.
const output = values.output ? resolve(values.output) : mkdtempSync(join(temporary, 'dataset-scale-'));
if (values.output) mkdirSync(output);
const write = (path, value) => writeFileSync(join(output, path), value);
const json = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);

function source(count, dimensionCount) {
  const fieldCount = valueFieldCount(dimensionCount);
  const fieldIndex = j => j % fieldCount + 1;
  const fieldType = (dataset, field) => fieldTypes === 'plain' ? 'String'
    : fieldTypes === 'shared' ? 'TextValue' : `TextValue${dataset}_${field}`;
  const typeDefinitions = fieldTypes === 'shared' ? 'type TextValue = struct(String);'
    : fieldTypes === 'distinct' ? Array.from({ length: count }, (_, i) =>
      Array.from({ length: fieldCount }, (_, j) =>
        `type TextValue${i + 1}_${j + 1} = struct(String);`).join('\n')).join('\n') : '';
  const declarations = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return `type Identity${n} = struct { tenant: TenantId, local: ItemId };
type Row${n} = struct { id: ItemId, tenant_id: TenantId, ${Array.from({ length: fieldCount }, (_, i) => `name_${i + 1}: ${fieldType(n, i + 1)}`).join(', ')} };
def entity${n}: m::Entity(Identity${n}) = m::entity("entity_${n}", Identity${n}.type);
def dataset${n}: m::Dataset(Row${n}) = m::dataset("dataset_${n}", "table_${n}", Row${n}.type, ["id", "tenant_id"]);
def subject${n}: m::Role(Row${n}) = m::role(dataset${n}, entity${n}, "subject", False, [
    m::identity_part(m::field(Row${n}.type, TenantId.type, "tenant_id"), m::field(Identity${n}.type, TenantId.type, "tenant")),
    m::identity_part(m::field(Row${n}.type, ItemId.type, "id"), m::field(Identity${n}.type, ItemId.type, "local")),
]);
def declaration${n}: t::Declaration = t::declare(dataset${n}, [subject${n}], [
    g::dimension(dataset${n}, g::dimension_group("identity_value", ItemId.type, True, [g::Filter::Eq]),
        g::input(m::field(Row${n}.type, ItemId.type, "id")), "dataset_${n}_id", True, [g::Filter::Eq]),
${Array.from({ length: dimensionCount - 1 }, (_, j) => `    g::dimension(dataset${n}, g::dimension_group("name_value", ${fieldType(n, fieldIndex(j))}.type, True, [g::Filter::Eq]),
        g::input(m::field(Row${n}.type, ${fieldType(n, fieldIndex(j))}.type, "name_${fieldIndex(j)}")), "dataset_${n}_name_${j + 1}", True, [g::Filter::Eq]),`).join('\n')}
], ["dataset_${n}_count"]);
`;
  }).join('\n');
  let generated = `# 同构 Dataset 规模实验；所有声明均进入 Service 的 transform payload。
use ontology::experimental::model as m;
use ontology::experimental::groups as g;
use ontology::experimental::transform as t;
use ontology::query as qb;
use ontology::intent as intent;
use ontology::sqlite as sqlite;
use std::transform_service as service;
use std::value::{Value};

type TenantId = struct(String);
type ItemId = struct(String);
${typeDefinitions}
${declarations}
def declarations: Array(t::Declaration) = [${Array.from({ length: count }, (_, i) => `declaration${i + 1}`).join(', ')}];
def profile: qb::PlanProfile = {
    allowed_operators: [qb::Operator::Source, qb::Operator::Project, qb::Operator::Column,
        qb::Operator::Bind, qb::Operator::Scalar, qb::Operator::Aggregate,
        qb::Operator::Filter, qb::Operator::Exists, qb::Operator::Join, qb::Operator::Group],
    allowed_join_kinds: [qb::JoinKind::Inner, qb::JoinKind::Left],
    allowed_aggregates: [qb::AggregateFunction::Count],
    allowed_scalars: [qb::ScalarFunction::Eq, qb::ScalarFunction::And, qb::ScalarFunction::IsNotNull],
    allow_distinct: True,
};
def prepared: t::Prepared = t::build("dataset-scale-v1", declarations, [], [], [], profile);
type QueryService = struct { lower: Fn(Value) -> Value };
impl service::TransformService for QueryService {
    init: fn(ctx) { {lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)}.ty!(Self) },
    transform: fn(self, input) { self.lower(input) },
};
@service::collection
pub type MainService = struct {
    @service::slot("scale/transform") query: QueryService,
};
`;
  if (values.staged) {
    generated = 'use ontology::experimental::staged as staged;\n' + generated;
    for (const [module, names] of Object.entries({ m: ['entity', 'dataset', 'field', 'identity_part', 'role'],
      g: ['input', 'dimension_group', 'dimension'], t: ['declare'] })) {
      for (const name of names) generated = generated.replaceAll(`${module}::${name}(`, `staged::${name}(`);
    }
    generated = generated.replace('t::build("dataset-scale-v1", declarations, [], [], [], profile)',
      'staged::prepare("dataset-scale-v1", declarations, profile)');
    if (!values['runtime-only']) generated = generated.replace('@service::collection', `type SelfCheckService = struct {};
impl service::TransformService for SelfCheckService {
    init: fn(ctx) { {}.ty!(Self) },
    transform: fn(self, input) {
        staged::self_check("dataset-scale-v1", declarations, profile);
        Value::True
    },
};
@service::collection`);
    if (!values['runtime-only']) generated = generated.replace('pub type MainService = struct {', 'pub type MainService = struct {\n    @service::slot("scale/self_check") self_check: SelfCheckService,');
  }
  if (values['verification-input']) {
    generated = generated.replace('type QueryService =', 'use std::codec as codec;\n@service::source("verified")\ntype QueryService =');
    generated = generated.replace('init: fn(ctx) { {lower:', `init: fn(ctx) {
        let verified: Bool = codec::decode@[Bool](ctx.sources.verified).unwrap!();
        if !verified { fail!("build verification must be true") } else { () };
        {lower:`);
  }
  return generated;
}

cpSync(join(repository, 'ontology'), join(output, 'ontology'), { recursive: true });
const packages = { ontology: { source: { workspace: 'ontology' }, dependencies: [] } };
for (const { count, dimensions: dimensionCount, name } of cases) {
  mkdirSync(join(output, name, 'src'), { recursive: true });
  json(`${name}/telora-crate.json`, { name, dependencies: ['ontology'] });
  const code = source(count, dimensionCount);
  write(`${name}/src/lib.telora`, code);
  // 比较双入口与运行期变体的声明来源，不将它冒充为二进制裁剪证明。
  json(`${name}/model-source.json`, { sha256: createHash('sha256')
    .update(code.split('type QueryService =')[0].replace('use std::codec as codec;\n', '').replace('@service::source("verified")\n', '')).digest('hex'),
    boundary: 'source prefix before QueryService', runtimeOnly: values['runtime-only'] });
  packages[name] = { source: { workspace: name }, dependencies: ['ontology'] };
  json(`${name}/request.json`, { method: 'scale/transform', input: { intents:
    Array.from({ length: count }, (_, i) => ({ op: 'Graph', root: 'r',
      nodes: [{ id: 'r', entity: `dataset_${i + 1}` }], edges: [],
      select: [{ node: 'r', dimension: `dataset_${i + 1}_id` }] })).slice(0, 5),
  } });
}
json('telora-config.json', { version: 1, members: ['ontology', ...cases.map(c => c.name)] });
json('telora-lock.json', { version: 1, packages });
json('experiment.json', { verificationInput: values['verification-input'], runtimeOnly: values['runtime-only'], staged: values.staged, fieldTypes, cases: cases.map(c => ({ ...c, fieldsPerDataset: valueFieldCount(c.dimensions) + 2 })),
  recordCountsPerDataset: 1, entityPerDataset: true, distinctRowTypes: true, relations: 0,
  serviceMethod: 'scale/transform' });
write('README.md', `# Dataset 规模实验\n\n每个 Dataset 使用独立的 Entity、Identity 和 Row 类型，包含复合身份、可配置数量的维度和一个计数度量。字段类型模式为 ${fieldTypes}（plain／shared／distinct）。显式自检服务：${values.staged}。没有关系边，全部声明进入 transform payload。\n\n在此目录执行，各样本使用相同预算：\n\n\`\`\`sh\n${cases.map(({ name }) => `${join(repository, 'bin/telora')} -C ${name} build ${name} --snapshot -o ${name}.wasm --initialization-fuel 400000 --request-fuel 100000 --with-memory-limit 2048 --report-usage 2> ${name}.timing.jsonl`).join('\n')}\n\`\`\`\n\nrequest.json 提供前五个 Dataset 的投影请求，符合批量上限。${values['runtime-only'] ? '运行期变体不提供 self_check；它是同声明重新构建的收益实验，不是对已验证二进制的裁剪证明。' : '分阶段产物的 scale/self_check 方法以 null 为输入，成功返回 true，失败返回 Service 诊断；发布前应针对同一 wasm 调用并记录 SHA256。'}计时阶段按 parent_phase 分层统计。\n`);
console.log(JSON.stringify({ output, cases }, null, 2));
