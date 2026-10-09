# Ontology Service Usage

This file covers packaging, starting, and using an ontology-backed query
service. Sections 1-3 apply to any model exposing the same three methods.
Section 4 is this repository's domain inventory; an integrating application
can replace or omit it. Run the build command from the repository root;
the runner can start from any directory where the artifact is accessible.
Sections 1-2 are for the trusted host, not the querying Agent.

This is the current external service and Intent contract. Model-author and
QueryAst boundaries are documented in [ONTOLOGY.md](ontology/docs/ONTOLOGY.md)
and [QUERY.md](ontology/docs/QUERY.md). The domain `docs/DOMAIN.md` files
describe business vocabulary; their `docs/INTENT.md` files point back to this
shared syntax. `goals/`, the disabled `lab-plan.toml`, and evaluation results
record earlier experiments, not current API contracts. Telora language and
CLI documentation belongs to the Telora project, not a copied directory in
this repository.

## 1. Build a snapshot

```sh
node scripts/build-knowledge-snapshot.mjs --module <module> \
  --domain <domain> --output <artifact>.wasm
```

`<module>` is a Telora workspace member with a `MainService`; it is not the
domain name used in requests. The build initializes the service and embeds its
ready state in the Wasm artifact. If a module declares external sources, provide
all of them with `--source name=path` at build time. Initialization fuel,
request fuel, and memory limits can be set with the corresponding CLI options
when deployment requires them. Use a compatible `telora-run` version with the
resulting experimental artifact.
The wrapper compiles with `--snapshot`, traverses the actual artifact's visible
knowledge, and publishes only after checks pass. Repeat `--domain` for every
domain in a collection (for example `dog`, `spider`, `world`). It writes
`<artifact>.wasm.knowledge.json` (visible keys/types, counts, Model revisions and
artifact SHA-256) and `<artifact>.wasm.knowledge-sizes.json` (full size rankings,
largest entry/link, threshold and runtime verification results).
The default concrete-document budget is 16,000 characters, measured exactly as
`JSON.stringify({Document:{Found:node}}, null, 2).length`, not UTF-8 bytes.
Index metadata is measured but exempt from this budget. The full terminology
is obtained through a separate capability for consumer-side caching and search.
Use `--max-node-chars <number>` to set the deployment budget. Oversize fails
before replacing any previous artifact; `--on-oversize warn` explicitly permits
publication with a warning report. `--not-found <checks.json>` additionally
checks hidden keys using a JSON array of `{domain,key}` requests.
Use `--context <crate-directory>` if the crate context differs from its module
name. The wrapper forwards repeated `--source` and fuel/memory options.
`node scripts/check-knowledge-manifest.mjs <artifact>.wasm` verifies the artifact
hash, revision, counts and real `info` samples after transport or deployment.
Direct `bin/telora -C <module> build <module> --snapshot -o <artifact>.wasm`
is available for experiments, but bypasses these publication checks.

## 2. Start the service

```sh
telora-run <artifact>.wasm --serve stdio+jsonl://
telora-run <artifact>.wasm --serve http://127.0.0.1:8080
```

Keep this process running. Write one JSON request per line to stdin and read
one JSON response per line from stdout. Do not mix other stdout text into this
stream. A runner started without `--serve` reads one complete JSON request and
exits after one response. `telora-run` executes the built artifact without
the source tree, workspace configuration, or compiler; only the artifact and
a compatible runner are needed at deployment.

The models in this repository explicitly declare POST routes
`/<domain>/info` and `/<domain>/transform`. The HTTP body is
the slot input, without the JSONL `method`/`input` envelope. For example:

```sh
curl -sS -X POST http://127.0.0.1:8080/ic/info \
  -H 'Content-Type: application/json' -d '{"key":"index"}'
```

`telora-run` has no authentication. Bind only to a host-private loopback or
Unix socket, and expose these two operations to an Agent through a trusted
tool adapter or authenticated gateway. The Agent environment must not mount
the snapshot, runner, source tree, tests, or evaluator material, and must not
have a shell or file tool that can read the host's deployment directory. Keep
the gateway's credentials and runner command outside the Agent's context.
Simply omitting the artifact path from the prompt is not isolation. A local
tool process with unrestricted host filesystem access is not isolation either.
Rate limits, request-size limits, access logging, and any SQL execution
authorization belong to the host. `transform` only produces a Query; it does
not execute it. `--serve` is the current CLI option; `--bind` belongs to older
Telora documentation.

## 3. Request protocol and agent workflow

For JSONL, every request has exactly `method` and `input`. The method selects a
slot; only `input` is passed to that slot. For HTTP, POST the same `input`
directly to the matching path. The knowledge and query methods are:

```json
{"method":"<domain>/info","input":{"key":"index"}}
{"method":"<domain>/info","input":{"key":"<key returned by index or links>"}}
```

The `index` topic returns `{revision,schemas,key_patterns,encoding}`. It lists
exact schema keys and `{kind,pattern}` rules for concrete knowledge keys;
business instances are discovered through consumer-side terminology search.
Read a matching key through `info`, then follow direct `links[].key` references
for capabilities, units, population semantics and related knowledge. Dataset
members are direct references. A `Related` link explains knowledge but does not
authorize query traversal. Labels, translations, aliases and physical column
names are not substitutes for canonical Intent IDs.

Every knowledge node has `{key,type,description,links,detail}`. Public keys include
`Dataset/{name}`, `Dimension/{dataset}/{name}`, `Field/{dataset}/{name}`, `Relation/{name}`, `Type/{name}`
and `Value/{type}/{value}`. Name components are URI-encoded exactly once; `Type` keys return
nodes whose response type is `DataType`. Prefer returned keys when following references.
The response `type` determines the `detail` shape. `info` returns Index, Schema
or a concrete knowledge point. `DataType` describes logical values and operations;
a field must still authorize an operation. Search vocabulary and reverse references
are generated outside the model. A term may match multiple nodes; read the matching
nodes and use canonical business IDs in Intent. Structured descriptions include
`terms:[{term,description}]` for explicit business terminology.
Use `index.detail.schemas` to discover request contracts.

Models mount `<domain>/discovery` with input `{}`. It returns a JSON array of
complete visible Dataset and Relation keys. The consumer follows these roots
through `info` to discover dimensions, measures, business types and values.
Mount `knowledge::knowledge_discovery_method_factory(payload)` for this capability.

Generate consumer data with:

```sh
node scripts/derive-discovery.mjs --output-prefix bin/icloud_model
```

The script writes `.terminology.json`, `.links.json`, `.keys.json` and
`.report.json`. `--artifact`, `--domain` and `--output-prefix` select the model
and output. `--keys roots.json` supplies roots instead of calling discovery.

Terminology has `{revision,datasets,dimensions,measures,rels,types,values}`.
Dataset, Relation and business Type entries contain `{name,doc,aliases}`;
Dimension and Measure entries add `dataset`; Value entries add `type_id`.
Physical Fields and primitive Types are available through info and are excluded
from search vocabulary. Aliases and descriptions come from structured metadata,
localized labels and explicit terms.

Links has `{revision,links:[{source,target,kind}]}`. The consumer indexes it by
target for reverse discovery. Edges are unique by `(source,target,kind)`;
different kinds preserve both sides of self-relations. Full definitions and
local dimension constraints remain in info documents.

Dimensions identify business projections and filters; Measures identify declared
aggregations. Their documents supply permitted query capabilities.

Use the index topic and `info` to discover the Model, then express the user's business
request as an Intent using discovered stable IDs. Use `transform` diagnostics to
repair the Intent without changing the requested business meaning. Lowering
success establishes that an Intent is legal under the Model, not that it answers
the user's question. Aim to serve the user's business purpose with one accepted
Intent. When one plan is insufficient, you may offer up to five independent
Intents in one `transform` call. Explain in business terms what each result
would show and how the separate results help answer the question. The service
does not merge or deduplicate results across plans, so do not claim that it has.
If no supported plan gives a useful answer, explain the limitation or ask a
focused business question. Do not change the user's meaning just to obtain a
successful transform. SQL and bindings are intermediate output for an
authorized execution layer, not the basis for clarification or the final
user-facing result.

Submit one to five Intents with the same outer envelope. Even one Intent must
be wrapped in an array:

```text
{"method":"<domain>/transform","input":{"intents":[<Intent>, ...]}}
```

Every top-level Intent must declare `limit`, a JSON integer from 1 through
9,223,372,036,854,775,807 (signed 64-bit). Missing, null, boolean, string,
fractional and nonpositive values are rejected with a diagnostic for `limit`.
GraphPair operands and GraphUnion branches do not require it. There is no
service product cap of 100: 101 and larger supported integers are valid.
A forwarding plugin can inject or override this field uniformly to enforce its
own fixed output cap without interpreting the business query.

`limit` caps final rows after filtering, aggregation, DISTINCT, ranking,
partitioned Top-N, pairing and set operations. Business `take` continues to
select its population; when both constrain the same final ordered rows, the
SQL uses the smaller bound. Partitioned Top-N runs before the global output cap.
The cap is a SQL binding, not client-side slicing. Existing ordering is retained;
without ordering, no particular subset or stable pagination is promised.
`transform` returns complete SQL and bindings, not database rows. The execution
layer must return every resulting row, including empty results and results
exactly at the cap; any additional execution-layer truncation must be disclosed.
No total count or `hasMore` is computed. Reaching the cap does not establish
that the result covers the entire population.

The response has `accepted`, `diagnostics`, and `queries`. Each diagnostic
entry has a zero-based `index` identifying its Intent and a `diagnostic`
containing `severity`, `message`, and ordered `locs`. For lowering failures
raised with `fail!`, `locs[0]` is the rule location and `locs[1..]` are
argument origins in order, including repeated origins. Source-file locations
carry a source name and `start`/`end` positions: lines start at 1, and each
`offset` is a zero-based UTF-8 byte offset within that line. Parsed request
arguments also carry origins. Their internal source ID is `0` (reported as
`<input>`); both points use `line: 0`, and each `offset` is a UTF-8 byte
offset in the entire input. This keeps the same location shape without
building a line index for dynamic input. Other diagnostics may use `locs[0]`
for the offending input. The array is empty when no Intent produces a
diagnostic.
All Intents are checked even if an earlier one fails. Only when every Intent
succeeds does `queries` contain one Query per
Intent in the same order; otherwise `queries` is null. A successful batch may
still have warnings; read them before using its Queries. This is a batch of
independent plans, not a union into one result set.

The caller resolves relative time before submitting an Intent. Reference time
and timezone may come from the application client or the Agent's environment;
neither is read by the service. Use concrete values in the dimension's declared
logical type, and state the resulting business dates in the answer. If no
reliable reference time or timezone is available, ask for the missing context.
See
[TIME.md](ontology/docs/TIME.md) for time value and window semantics. Knowledge
discovery describes the Model; the generic Intent syntax is below. The Model
and `transform` decide which combinations have valid business meaning.

The current iCloud time types are `DatetimeUtc` (RFC3339 UTC seconds,
`YYYY-MM-DDTHH:MM:SSZ`), `DateUtc` (`YYYY-MM-DD`), and `EpochMillis` (JSON
integer milliseconds). The former space-separated UTC input is rejected;
deploy a rebuilt snapshot and discover the current types through `info`.

### Graph Intent syntax

A top-level Graph Intent has six required fields, including `limit` and empty
arrays where needed:

```json
{"op":"Graph","limit":1000,"root":"item",
 "nodes":[{"id":"item","entity":"<dataset ID>"}],
 "edges":[],
 "select":[],"count":"item"}
```

`root` names a node instance in `nodes`, not a dataset ID by itself. Each
node has `id` (unique instance name within this graph) and `entity` (stable
dataset ID). Each edge has `relation` (stable named relation ID), `from`, and
`to` (node instance IDs); its direction and endpoint roles must match the
Model. `edges` may be listed in any order, but must form one rooted tree;
each edge must introduce one new node reachable from `root`. `select`
contains objects `{"node":"...","dimension":"..."}`.
For a count, `count` is the node instance ID to count, not a measure name.
The required `select` array may be empty when `count` is present.

Optional top-level graph fields and their shapes:

| Field | Shape |
| --- | --- |
| `constraints` | Array of edge objects, same shape as `edges` |
| `measures` | Array of `{"node":"...","measure":"<stable measure ID>"}` |
| `filters` | Array of `{"node":"...","dimension":"...","op":"Eq","value":...}` |
| `time_windows` | Array of `{"node":"...","dimension":"...","start":...,"end":...}`; `end` may be `null` or omitted |
| `any_of` | Array of `{"node":"...","dimension":"...","values":[...]}` |
| `exists` | Array of existence objects described below |
| `measure_having` | Array of `{"node":"...","measure":"...","op":"...","value":...}` |
| `count` | Node instance ID string |
| `count_value` | `{"node":"...","dimension":"..."}`, for distinct non-null value count |
| `count_having` | `{"op":"...","value":<integer>}` |
| `count_groups`, `include_empty`, `distinct` | Boolean |
| `group_by_identity` | Array of node instance ID strings |
| `row_grain` | `"Root"` or `"Association"` |
| `order_by` | Array of `{"node":"...","dimension":"...","direction":"Asc|Desc"}` |
| `limit` | Required on top-level Intent only; positive signed 64-bit integer; final output cap |
| `take` | Integer |
| `top_per` | `{"owner":"<node>","sample":"<node>","rank":"<dimension>","take":<integer>}` |
| `top_by_measure` | `{"node":"...","measure":"...","direction":"Asc|Desc","take":<integer>}` |

For aggregate Top-N, `select` names the visible dimensions and `measures`
names the aggregate being ranked. With no `group_by_identity`, Top-N ranks
groups of equal projected dimension values, provided the joined graph cannot
multiply the measure's source rows. A declared `group_by_identity` instead
keeps separate groups for the named entities: two entities with the same
visible dimension value may occupy separate rows. If hidden identity keys can
split visible groups, the transform reports a warning. Use identity grouping
only when the business question is about individual entities, not dimension
values such as types or categories.

For aggregate thresholds, discover the shared `Graph aggregate` knowledge
node: it describes the supported identity and contextual sample populations.
For filtering, `Declared filter capabilities` explains why the syntax's
operator vocabulary does not override a dimension's declared `ops`.
`Ordering and aggregate meaning` explains NULL placement and identity tie
breakers, and why raw Top-N is not a substitute for grouped Min/Max.
Find these nodes in `index` and pass their returned keys unchanged to `info`.
Do not change the business meaning merely to make an Intent lower.

Time windows are `[start, end)` with concrete values in the dimension's declared
logical type. `end:null` or an omitted `end` means `[start, None)`: no upper
time predicate. It does not mean `now`; future-dated rows may match. Resolve
`now`, elapsed durations, calendar boundaries and timezone effects before
submitting the Intent. The service rejects relative expressions and request
`ctx`.

An existence object has required `anchor` (an outer node instance ID),
`nodes` (inner node objects), and `edges` (named edge objects connecting
the anchor to inner nodes). Its edges may be in any order but must form a
tree rooted at `anchor`. It may also contain `constraints`, `filters`,
`time_windows`, `any_of`, `having` (same shape as `measure_having`), and
`negated` (boolean). `exists` qualifies outer entities without multiplying
their rows; use it when a related one-to-many entity must only establish
existence. The request may have multiple graph edges and multiple existence
objects; there is no fixed hop count in the Intent syntax.

Filter operators are `Eq`, `Ne`, `Gt`, `Ge`, `Lt`, `Le`, `Contains`,
`NotContains`, `StartsWith`, and `EndsWith`. The Model restricts which
operators and logical value types each dimension permits. Do not send `kind`:
the target dimension or measure determines the logical type of its JSON value.
Typed predicate inputs and canonical wires shown by `info` are Model facts,
not JSON Intent value syntax.
Find the Intent syntax entry in the index and follow its returned key and links
through `<domain>/info`. A diagnostic naming an info key can be
resolved through `<domain>/info` to repair the Intent. Business-value filters
use the stable value ID, not its physical wire or localized label.

### One deduplicated entity set

Use `GraphUnion` when two or more independently valid graph paths must return one
deduplicated population of the same entity:

```text
{"op":"GraphUnion","limit":1000,"branches":[
  {"result_node":"<node ID>","graph":<graph Intent>},
  {"result_node":"<node ID>","graph":<graph Intent>}
]}
```

Each `Graph` is complete and follows its own declared relations, filters,
authorization, and grain rules. Its `result_node` may differ from the root
and from other branches' result nodes. All result nodes must name the same
dataset. Select only dimensions of that result node, in the same dimension
order across all branches, including plain dimensions for **every field of the
dataset's declared identity grain**. This may be a composite identity.
Identity fields are visible result columns in the current form. Other
selected dimensions must be the same across branches; SQL `UNION` then
deduplicates complete result rows without merging distinct entity identities.

`GraphUnion` accepts at least two raw-row branches. A branch may
qualify rows using `filters`, `exists`, and named graph edges, but cannot use
counts, measures, identity grouping, local ordering, Top-N, or pagination.
It cannot reverse a directed relation or turn two separately valid result
types into one entity. Use separate accepted Intents when the user wants
distinct result categories rather than one entity set.

### Independent aggregate pair

Use `GraphPair` to aggregate two populations independently, explicitly align
their complete identities, and choose the side of each output column.

```text
{"op":"GraphPair","limit":1000,"left":<Graph intent>,"right":<Graph intent>,
 "align_by":[{"left":{"node":"d"},"right":{"node":"d"}}],
 "select":[{"side":"Right","node":"d","dimension":"device_name"}],
 "rank_by":{"op":"Subtract","minuend":"Right","subtrahend":"Left",
            "direction":"Desc","take":5}}
```

Each side has exactly one measure and empty or omitted select. Its
group_by_identity must exactly match its aligned nodes in order, beginning
with root. Paired nodes belong to the same entity; their IDs may differ.
Outer select is required (may be empty); display dimensions must belong to
aligned nodes and never become alignment keys. Outputs follow select order
then both measures, using left_<node>_<dimension or measure> and
right_<node>_<dimension or measure> aliases.

Ranking supports Subtract (minuend/subtrahend), Ratio (numerator/denominator)
and GrowthRate (current/baseline). Side parameters explicitly choose different
Left/Right sides. Every rank needs direction Asc|Desc and take 1..1000.
Numeric measures must be the same measure or declare matching non-null units.
Exclude NULL measures, zero Ratio denominators and nonpositive GrowthRate
baselines. Arithmetic uses approximate double precision; a growth rate of
0.2 means 20%. Ties use complete aligned identities ascending, NULLS FIRST.

Populations remain independent; filters, exists, time_windows and
measure_having stay inside their respective Graph. Operand counts, distinct,
include_empty, ordering and Top-N remain forbidden. Unranked count_groups:true
counts all aligned identities and cannot combine with rank_by.

Old implicit pairs require migration. See the [complete GraphPair contract](ontology/docs/GRAPH-PAIR.md)
for shapes, output aliases, profile requirements and migration steps.

In JSONL service mode, responses use the `telora.service/v1` envelope. On
success, `ok.Document` holds `Found` or `NotFound`; the Found Index node contains
the complete `detail.entries` list. `ok` from `transform` contains the
batch response described above. A rejected Intent is reported as
`ok.accepted:false` with indexed diagnostics and `queries:null`; malformed
requests and uncaptured service failures have `error:true` and top-level
structured diagnostics. Inspect diagnostics and repair the Intent using the
relevant knowledge points. Each accepted Query contains parameterized `sql`
and `bindings`, not database results. Pass both together to an authorized
execution layer; never interpolate values into SQL. Present the resulting data
to the user in an appropriate form.
When no execution layer is available, state that only an intermediate Query was
produced and do not invent results.

## 4. Domains in this repository

| Build module | Domain | Scope |
| --- | --- | --- |
| `example_models` | `dog` | Dog and breed example model |
| `example_models` | `spider` | Student and school example model |
| `example_models` | `world` | Geographic example model |
| `icloud_model` | `ic` | iMaster Cloud modeling-pressure fixture |

For example, one `example_models` snapshot serves the `dog`, `spider`, and
`world` domains; `icloud_model` serves `ic` independently. Every domain
exposes `<domain>/info` and `<domain>/transform`.
Neither module requires external build sources. Both collections explicitly
declare the HTTP POST routes listed above. Snapshot builds and index-topic requests were checked
with the commands above. The `ic` fixture is not a complete production domain
model. A missing knowledge point or valid lowering path must not be filled in
by guessing.
