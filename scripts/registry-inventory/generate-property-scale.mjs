// 只生成 property 路径的规模夹具；输出到临时目录，不改 IC/NS。
import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const count = Number(process.argv[2] ?? 50);
if (!Number.isSafeInteger(count) || count < 1) throw Error('count must be positive');
const output = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'property-scale-'));
cpSync(join(repo, 'ontology'), join(output, 'ontology'), {recursive: true});
mkdirSync(join(output, 'relation_model/src'), {recursive: true});
const write = (path, value) => writeFileSync(join(output, path), value);
const config = JSON.parse(readFileSync(join(repo, 'telora-config.json')));
config.members = ['ontology', 'relation_model'];
write('telora-config.json', JSON.stringify(config));
const lock = JSON.parse(readFileSync(join(repo, 'telora-lock.json')));
lock.packages = Object.fromEntries(config.members.map(key => [key, lock.packages[key]]));
write('telora-lock.json', JSON.stringify(lock));
cpSync(join(repo, 'relation_model/telora-crate.json'), join(output, 'relation_model/telora-crate.json'));
let source = `use ontology::registry as registry;
use ontology::model as m;
use ontology::groups as g;
use ontology::samples as samples;
use ontology::scalars as scalars;
use ontology::relations as r;
use ontology::ontology as edsl;
use ontology::query as q;
use std::array as array;
use std::transform_service as service;
use std::value::{Value};
use ontology::intent as intent;
use ontology::sqlite as sqlite;
type TenantId = struct(String);
type ItemId = struct(String);
type Percent = struct(Float);
@registry::entity("peer")
type PeerIdentity = struct {local: ItemId, tenant: TenantId};
`;
for (let k = 0; k < 27; k++) source += `def sample${k}: samples::Group(Percent) = samples::group("sample_${k}", Percent.type, samples::Statistic::Mean, [samples::Statistic::Min, samples::Statistic::Max], Some("%"));\n`;
for (let i = 1; i <= count; i++) {
    source += `type Text${i}A = struct(String);
type Text${i}B = struct(String);
def group${i}A: g::DimensionGroup(Text${i}A) = g::dimension_group("text_${i}_a", Text${i}A.type, True, g::equality_filters);
def group${i}B: g::DimensionGroup(Text${i}B) = g::dimension_group("text_${i}_b", Text${i}B.type, True, g::equality_filters);
@registry::entity("entity_${i}")
type Identity${i} = struct {local: ItemId, tenant: TenantId};
@registry::dataset("dataset_${i}", "table_${i}", ["id", "tenant_id"])
@registry::roles([subject${i}, peer${i}])
@registry::metric("at")
@registry::record_counts(["row_count"])
@registry::relations([edge${i}, reverse${i}])
@registry::reported_samples([samples::bind(registry::dataset_of(Row${i}.type), sample${i % 27}, m::field(Row${i}.type, Percent.type, "reading"), [{statistic: samples::Statistic::Mean, publish: "mean_load"}, {statistic: samples::Statistic::Min, publish: "min_load"}, {statistic: samples::Statistic::Max, publish: "max_load"}])])
type Row${i} = struct {
    @g::exact("id") id: ItemId,
    tenant_id: TenantId,
    at: scalars::DateTimeUtc,
    reading: Percent,
${Array.from({length: 9}, (_, k) => `    @g::field_view(group${i}${k % 2 ? 'B' : 'A'}, "name_${k + 1}", True, g::equality_filters) name_${k + 1}: Text${i}${k % 2 ? 'B' : 'A'}`).join(',\n')}
};
`;
    for (const [role, identity] of [['subject', `Identity${i}`], ['peer', 'PeerIdentity']]) source += `def ${role}${i}: m::Role(Row${i}) = m::role(registry::dataset_of(Row${i}.type), registry::entity_of(${identity}.type), "${role}", False, [m::identity_part(m::field(Row${i}.type, ItemId.type, "id"), m::field(${identity}.type, ItemId.type, "local")), m::identity_part(m::field(Row${i}.type, TenantId.type, "tenant_id"), m::field(${identity}.type, TenantId.type, "tenant"))]);\n`;
    const next = i % count + 1;
    source += `def edge${i}: r::Relation = r::relation("edge_${i}", r::endpoint(Row${i}.type, "peer"), r::endpoint(Row${next}.type, "peer"), cardinality);
def reverse${i}: r::Relation = r::relation("reverse_${i}", r::endpoint(Row${next}.type, "peer"), r::endpoint(Row${i}.type, "peer"), cardinality);\n`;
}
source += `def cardinality: edsl::RelationCardinality = {from: edsl::Cardinality::Optional, to: edsl::Cardinality::Optional};
def roots: Array(Type) = [PeerIdentity.type, ${Array.from({length: count}, (_, k) => `Row${k + 1}.type, Identity${k + 1}.type`).join(', ')}];
def profile: q::PlanProfile = {
    allowed_operators: [q::Operator::Source, q::Operator::Column, q::Operator::Bind, q::Operator::Scalar, q::Operator::Filter, q::Operator::Aggregate, q::Operator::Project, q::Operator::Group, q::Operator::Join, q::Operator::Exists],
    allowed_aggregates: [q::AggregateFunction::Count, q::AggregateFunction::Avg, q::AggregateFunction::Min, q::AggregateFunction::Max],
    allowed_scalars: [q::ScalarFunction::Eq, q::ScalarFunction::Ne, q::ScalarFunction::And, q::ScalarFunction::IsNotNull],
    allowed_join_kinds: [q::JoinKind::Inner, q::JoinKind::Left], allow_distinct: True
};
def lower: Fn(Value) -> Value = registry::stage("property-scale", roots, profile, fn(payload) {intent::query_request_method_factory(payload, sqlite::build_query)});
type Query = struct {lower: Fn(Value) -> Value};
impl service::TransformService for Query {init: fn(ctx) {{lower}.ty!(Self)}, transform: fn(self, input) {self.lower(input)}};
@service::collection
pub type MainService = struct {@service::slot("relation/transform") query: Query};
`;
write('relation_model/src/lib.telora', source);
write('scale.json', JSON.stringify({datasets: count, entities: count + 1, fields: count * 13, roles: count * 2, dimensions: count * 10, measures: count * 4, dimension_groups: count * 2 + 1, measure_groups: 27, relations: count * 2}, null, 2));
console.log(output);
