// ontology 分阶段准备的组合样本；生成到独立临时工作区。
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, copies: { type: 'string', default: '1' },
} });
const copies = Number(values.copies);
if (!Number.isSafeInteger(copies) || copies < 1) throw new Error('--copies must be a positive integer');
const repository = fileURLToPath(new URL('../', import.meta.url));
const temporary = process.env.TMPDIR || join(homedir(), '.cache/tmp');
mkdirSync(temporary, { recursive: true });
const output = values.output ? resolve(values.output) : mkdtempSync(join(temporary, 'staged-features-'));
if (values.output) mkdirSync(output);
const json = (path, value) => writeFileSync(join(output, path), JSON.stringify(value, null, 2) + '\n');
cpSync(join(repository, 'ontology/src'), join(output, 'ontology/src'), { recursive: true });
cpSync(join(repository, 'ontology/telora-crate.json'), join(output, 'ontology/telora-crate.json'));

const fixture = n => `
type OwnerId${n} = struct(String);
type State${n} = struct(String);
type Identity${n} = struct { id: OwnerId${n} };
type Owner${n} = struct { id: OwnerId${n}, state: Int, name: String, peer: String, ip: String, bytes: q::Bytes, elapsed: q::Milliseconds, load: Option(Float) };
type Reading${n} = struct { owner: OwnerId${n}, ts: s::DateTimeUtc, value: Option(Float) };
type Event${n} = struct { id: String, owner: String, ts: s::DateTimeUtc };
type Hub${n} = struct { id: String, a: OwnerId${n}, z: OwnerId${n}, tag: String };
def entity${n}: m::Entity(Identity${n}) = m::entity("owner_${n}", Identity${n}.type);
def owners${n}: m::Dataset(Owner${n}) = m::dataset("owners_${n}", "owner_rows_${n}", Owner${n}.type, ["id"]);
def readings${n}: m::Dataset(Reading${n}) = m::dataset("readings_${n}", "reading_rows_${n}", Reading${n}.type, ["owner", "ts"]);
def events${n}: m::Dataset(Event${n}) = m::dataset("events_${n}", "event_rows_${n}", Event${n}.type, ["id"]);
def hubs${n}: m::Dataset(Hub${n}) = m::dataset("hubs_${n}", "hub_rows_${n}", Hub${n}.type, ["id"]);
def subject${n}: m::Role(Owner${n}) = m::role(owners${n}, entity${n}, "subject", False, [m::identity_part(m::field(Owner${n}.type, OwnerId${n}.type, "id"), m::field(Identity${n}.type, OwnerId${n}.type, "id"))]);
def reading_owner${n}: m::Role(Reading${n}) = m::role(readings${n}, entity${n}, "owner", False, [m::identity_part(m::field(Reading${n}.type, OwnerId${n}.type, "owner"), m::field(Identity${n}.type, OwnerId${n}.type, "id"))]);
def event_owner${n}: m::Role(Event${n}) = m::role(events${n}, entity${n}, "owner", False, [m::reference_part(m::field(Event${n}.type, String.type, "owner"), m::field(Identity${n}.type, OwnerId${n}.type, "id"))]);
def hub_a${n}: m::Role(Hub${n}) = m::role(hubs${n}, entity${n}, "a", False, [m::identity_part(m::field(Hub${n}.type, OwnerId${n}.type, "a"), m::field(Identity${n}.type, OwnerId${n}.type, "id"))]);
def hub_z${n}: m::Role(Hub${n}) = m::role(hubs${n}, entity${n}, "z", False, [m::identity_part(m::field(Hub${n}.type, OwnerId${n}.type, "z"), m::field(Identity${n}.type, OwnerId${n}.type, "id"))]);
def state${n}: v::Domain(State${n}, Int) = v::ordered(v::domain("State${n}", State${n}.type, Int.type, [v::member(State${n}("on"), [0, 2]), v::member(State${n}("off"), [1])], False), [State${n}("on"), State${n}("off")]);
def state_binding${n}: v::Binding(Owner${n}) = v::bind(owners${n}, v::dimension_group(state${n}, True, g::equality_filters), g::input(m::field(Owner${n}.type, Int.type, "state")), "owner_state_${n}", True, g::equality_filters);
def name${n}: g::Binding(Owner${n}) = g::dimension(owners${n}, g::dimension_group("text", String.type, True, g::equality_filters), g::input(m::field(Owner${n}.type, String.type, "name")), "owner_name_${n}", True, g::equality_filters);
def peer${n}: g::Binding(Owner${n}) = g::dimension(owners${n}, g::dimension_group("text", String.type, True, g::equality_filters), g::input(m::field(Owner${n}.type, String.type, "peer")), "owner_peer_${n}", True, g::equality_filters);
def field_count${n}: t::FieldCount(Owner${n}) = t::field_count(owners${n}, m::optional_field(Owner${n}.type, Float.type, "load"), "load_count_${n}");
def on_count${n}: t::FieldCount(Owner${n}) = t::filtered_count(t::field_count(owners${n}, m::optional_field(Owner${n}.type, Float.type, "load"), "on_count_${n}"), state_binding${n}, State${n}("on"));
def owner_decl${n}: t::Declaration = t::with_native_pairs(t::with_scope(t::with_computed_counts(t::with_field_counts(t::with_domains(t::map_columns(t::declare(owners${n}, [subject${n}], [
    g::identity_dimensions(owners${n}, subject${n}, [{member: "id", publish: "owner_id_${n}"}]), name${n}, peer${n},
    g::dimension(owners${n}, g::dimension_group("ipv4", s::Ipv4.type, True, g::ipv4_filters), g::ipv4(g::input(m::field(Owner${n}.type, String.type, "ip"))), "owner_ip_${n}", True, g::ipv4_filters),
    g::numeric_binding(owners${n}, g::numeric_group("load", Float.type, [g::Statistic::Mean, g::Statistic::Max]), g::input(m::optional_field(Owner${n}.type, Float.type, "load")), [{member: g::Statistic::Mean, publish: "load_avg_${n}"}, {member: g::Statistic::Max, publish: "load_max_${n}"}]),
    g::transfer_binding(owners${n}, g::transfer, g::input(m::field(Owner${n}.type, q::Bytes.type, "bytes")), g::seconds(g::input(m::field(Owner${n}.type, q::Milliseconds.type, "elapsed"))), [{member: g::TransferMember::AmountTotal, publish: "bytes_total_${n}"}, {member: g::TransferMember::RatePeak, publish: "rate_max_${n}"}, {member: g::TransferMember::RateMean, publish: "rate_avg_${n}"}]),
], ["owner_count_${n}"]), [t::column(m::field(Owner${n}.type, String.type, "name"), "DISPLAY_NAME")]), [state_binding${n}]), [field_count${n}, on_count${n}]), [t::combine_counts("off_count_${n}", qb::ComputedOp::Sub, t::count_ref(field_count${n}), t::count_ref(on_count${n}))]), [t::scope_equal(owners${n}, m::field(Owner${n}.type, String.type, "peer"), "visible")]), [t::native_pair("text_pair_${n}", name${n}, peer${n})]);
def sample_group${n}: samples::Group(Float) = samples::group("gauge", Float.type, samples::Statistic::Mean, [samples::Statistic::Latest, samples::Statistic::Max], Some("%"));
def reading_decl${n}: t::Declaration = t::with_samples(t::metric(t::declare(readings${n}, [reading_owner${n}], [
    g::dimension(readings${n}, g::dimension_group("clock", s::DateTimeUtc.type, True, g::time_filters), g::input(m::field(Reading${n}.type, s::DateTimeUtc.type, "ts")), "reading_ts_${n}", True, g::time_filters),
    g::dimension(readings${n}, g::dimension_group("bucket", s::DateTimeUtc.type, True, g::time_filters), g::utc_bucket(g::input(m::field(Reading${n}.type, s::DateTimeUtc.type, "ts")), qb::UtcBucketUnit::Hour), "reading_hour_${n}", True, g::time_filters),
], []), m::field(Reading${n}.type, s::DateTimeUtc.type, "ts")), [samples::bind(readings${n}, sample_group${n}, m::optional_field(Reading${n}.type, Float.type, "value"), [{statistic: samples::Statistic::Mean, publish: "reading_avg_${n}"}, {statistic: samples::Statistic::Latest, publish: "reading_latest_${n}"}, {statistic: samples::Statistic::Max, publish: "reading_max_${n}"}])]);
def event_decl${n}: t::Declaration = t::event(t::declare(events${n}, [event_owner${n}], [g::dimension(events${n}, g::dimension_group("event_id", String.type, True, g::equality_filters), g::input(m::field(Event${n}.type, String.type, "id")), "event_id_${n}", True, g::equality_filters)], ["event_count_${n}"]), m::field(Event${n}.type, s::DateTimeUtc.type, "ts"));
def hub_decl${n}: t::Declaration = t::declare(hubs${n}, [hub_a${n}, hub_z${n}], [g::dimension(hubs${n}, g::dimension_group("hub_id", String.type, True, g::equality_filters), g::input(m::field(Hub${n}.type, String.type, "id")), "hub_id_${n}", True, g::equality_filters)], ["hub_count_${n}"]);
def relation_a${n}: r::Relation = r::relation("hub_a_${n}", hubs${n}, hub_a${n}, owners${n}, subject${n}, {from: edsl::Cardinality::Many0, to: edsl::Cardinality::One});
def relation_z${n}: r::Relation = r::relation("hub_z_${n}", hubs${n}, hub_z${n}, owners${n}, subject${n}, {from: edsl::Cardinality::Many0, to: edsl::Cardinality::One});
def relation_reading${n}: r::Relation = r::relation("reading_owner_${n}", readings${n}, reading_owner${n}, owners${n}, subject${n}, {from: edsl::Cardinality::Many0, to: edsl::Cardinality::One});
def relation_event${n}: r::Relation = r::guarded(r::relation("event_owner_${n}", events${n}, event_owner${n}, owners${n}, subject${n}, {from: edsl::Cardinality::Many0, to: edsl::Cardinality::One}), m::field(Event${n}.type, String.type, "id"), edsl::FilterOp::Ne, "hidden");
def link${n}: r::Link = r::guarded_link(r::link("connection_${n}", relation_a${n}, relation_z${n}, edsl::LinkDirection::Undirected), m::field(Hub${n}.type, String.type, "tag"), edsl::FilterOp::Eq, "live");
`;
const prefix = `use ontology::model as m;
use ontology::groups as g;
use ontology::samples as samples;
use ontology::values as v;
use ontology::relations as r;
use ontology::transform as t;
use ontology::scalars as s;
use ontology::quantity as q;
use ontology::ontology as edsl;
use ontology::query as qb;
use ontology::intent as intent;
use ontology::sqlite as sqlite;
use std::transform_service as service;
use std::value::{Value};
`;
const numbers = Array.from({ length: copies }, (_, i) => i + 1);
const model = prefix + numbers.map(fixture).join('\n') + `
def declarations: Array(t::Declaration) = [${numbers.flatMap(n => [`owner_decl${n}`, `reading_decl${n}`, `event_decl${n}`, `hub_decl${n}`]).join(', ')}];
def relations: Array(r::Relation) = [${numbers.flatMap(n => [`relation_a${n}`, `relation_z${n}`, `relation_reading${n}`, `relation_event${n}`]).join(', ')}];
def alternatives: Array(t::Alternative) = [${numbers.map(n => `{id: "hub_either_${n}", choices: [relation_a${n}, relation_z${n}], cardinality: {from: edsl::Cardinality::Many0, to: edsl::Cardinality::Many0}}`).join(', ')}];
def links: Array(r::Link) = [${numbers.map(n => `link${n}`).join(', ')}];
def profile: qb::PlanProfile = {
    allowed_operators: [qb::Operator::Source, qb::Operator::Project, qb::Operator::Column, qb::Operator::Bind, qb::Operator::Scalar, qb::Operator::Aggregate, qb::Operator::Filter, qb::Operator::Exists, qb::Operator::Join, qb::Operator::Group, qb::Operator::Having, qb::Operator::Order, qb::Operator::Partition, qb::Operator::Limit, qb::Operator::Offset],
    allowed_join_kinds: [qb::JoinKind::Inner, qb::JoinKind::Left],
    allowed_aggregates: [qb::AggregateFunction::Count, qb::AggregateFunction::Avg, qb::AggregateFunction::Max, qb::AggregateFunction::Min, qb::AggregateFunction::Sum, qb::AggregateFunction::Latest],
    allowed_scalars: [qb::ScalarFunction::If, qb::ScalarFunction::RegexMatch, qb::ScalarFunction::Not, qb::ScalarFunction::BinaryText, qb::ScalarFunction::Eq, qb::ScalarFunction::Ne, qb::ScalarFunction::Gt, qb::ScalarFunction::Ge, qb::ScalarFunction::Lt, qb::ScalarFunction::Le, qb::ScalarFunction::And, qb::ScalarFunction::Or, qb::ScalarFunction::IsNotNull, qb::ScalarFunction::Sub, qb::ScalarFunction::Div, qb::ScalarFunction::UtcTimeBucket({unit: qb::UtcBucketUnit::Hour, encoding: qb::UtcBucketEncoding::DateTimeUtc})],
    allow_distinct: True,
};
`;
const entries = ['baseline', 'staged', 'runtime'];
const packages = { ontology: { source: { workspace: 'ontology' }, dependencies: [] } };
for (const mode of entries) {
  const name = `features_${mode}`;
  let code = model;
  code += `def prepared: t::Prepared = ${mode === 'baseline' ? 't::checked_build' : 't::build'}("feature-v1", declarations, relations, alternatives, links, profile);
type QueryService = struct { lower: Fn(Value) -> Value };
impl service::TransformService for QueryService {
    init: fn(ctx) { {lower: intent::query_request_method_factory(prepared.payload, sqlite::build_query)}.ty!(Self) },
    transform: fn(self, input) { self.lower(input) },
};
`;
  if (mode === 'staged') code += `type SelfCheckService = struct {};
impl service::TransformService for SelfCheckService {
    init: fn(ctx) { {}.ty!(Self) },
    transform: fn(self, input) { t::self_check("feature-v1", declarations, relations, alternatives, links, profile); Value::True },
};
`;
  code += `@service::collection
pub type MainService = struct {
    @service::slot("scale/transform") query: QueryService,
    ${mode === 'staged' ? '@service::slot("scale/self_check") check: SelfCheckService,' : ''}
};
`;
  mkdirSync(join(output, name, 'src'), { recursive: true });
  json(`${name}/telora-crate.json`, { name, dependencies: ['ontology'] });
  writeFileSync(join(output, name, 'src/lib.telora'), code);
  packages[name] = { source: { workspace: name }, dependencies: ['ontology'] };
}
json('telora-config.json', { version: 1, members: ['ontology', ...entries.map(mode => `features_${mode}`)] });
json('telora-lock.json', { version: 1, packages });
json('experiment.json', { copies, datasets: copies * 4, modes: entries });
console.log(JSON.stringify({ output, copies, datasets: copies * 4, entries: entries.map(mode => `features_${mode}`) }));
