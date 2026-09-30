# Ontology query service

Use only the host-provided `ontology_index`, `ontology_info`, and `ontology_transform` tools for the `ic` domain. The host runs the service; do not run or inspect an artifact. The host supplies this guide and the question as attachments.

## Tool protocol and Intent syntax

Pass the following objects directly as tool arguments:

```json
{"offset":0,"limit":50}
{"topic":"<exact topic>"}
{"target":{"kind":"dataset","owner":"","id":"<stable ID>"}}
```

The first object is for `ontology_index`; the latter two are alternatives for
`ontology_info`. `ontology_transform` takes an `intents` array of one to five
independent Intents.

`index` returns a paginated catalog of visible knowledge points. Follow
`next_offset` until the relevant area is found; do not treat the first page as
the entire Model. `info` resolves a topic by exact Unicode matching or a
target by its kind, owner, and stable ID. A topic may return `Candidates`:
inspect them and request the intended target explicitly. Follow references to
check entity grain, dimensions, measures, business values, time roles, and
named relations. A `Related` link explains knowledge but does not authorize a
query traversal. Labels, translations, aliases, and physical column names are
not substitutes for stable Intent IDs.

Response targets encode their kinds as enum names (for example, `Dataset`);
`info` target input expects the corresponding lowercase spelling (for
example, `dataset`). Convert `BusinessLink` to `business_link` and
`TimeRole` to `time_role`; preserve the returned owner and ID exactly.

Use `index` and `info` to discover the Model, then express the user's business
request as an Intent using discovered stable IDs. Use `transform` diagnostics to
repair the Intent without changing the requested business meaning. Lowering
success establishes that an Intent is legal under the Model, not that it answers
the user's question. Aim to serve the user's business purpose with one accepted
Intent. When one plan is insufficient, you may offer up to five accepted Intents
in one `ontology_transform` call. Explain in business terms what each result
would show and how the separate results help answer the question.
The service does not merge or deduplicate results across plans, so do not claim
that it has. If no supported plan gives a useful answer, explain the limitation
or ask a focused business question. Do not change the user's meaning just to
obtain a successful transform. Before answering, compare the business meaning
of the accepted plan or plans with the user's request.

When one reasonable interpretation is supported, submit its plan or plans and
tell the user in ordinary business language what each accepted Intent means.
Make any consequential assumption visible so the user can correct it. Ask a focused
business question when the request cannot responsibly be interpreted, or when
the alternatives have materially different meanings and no reasonable default.
Do not require clarification just because another interpretation is possible.
Never write SQL yourself or present a Query as the answer. The host retains
SQL and bindings for its authorized execution layer; the Agent sees only an
acceptance receipt or structured diagnostics.

If the request uses relative time, obtain its reference time and timezone from
the application context or your environment, then calculate concrete boundaries
before submitting the Intent. Do not send `now`, relative calendar/delta
expressions, or `ctx` to `ontology_transform`. In the business-language reverse
explanation, state the concrete start and end times and the timezone used. An
omitted upper boundary means no upper time restriction, not "until now". If
the needed reference time or timezone is unavailable, ask for that context.

Submit one or more Intents to `ontology_transform`:

```text
{"intents":[<Intent>, ...]}
```

Even a single plan uses a one-element array. The tool returns one receipt only
when all plans are accepted; otherwise it reports each plan's status and
diagnostics by zero-based array index, without storing a partial bundle. In a
failed batch, `valid:true` means that plan lowered, not that it was persisted.

Knowledge discovery describes the Model; the generic Intent syntax is below.
The Model and `transform` decide which combinations have valid business meaning.

### Graph Intent syntax

A graph Intent has five required fields, including empty arrays where needed:

```json
{"op":"Graph","root":"item",
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
| `take` | Integer |
| `top_per` | `{"owner":"<node>","sample":"<node>","rank":"<dimension>","take":<integer>}` |
| `top_by_measure` | `{"node":"...","measure":"...","direction":"Asc|Desc","take":<integer>}` |

Time windows use concrete values in the dimension's declared logical type.
`end:null` or an omitted `end` means `[start, None)` with no upper predicate;
it does not mean `now`. Relative expressions are rejected.

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
Discover the Intent contract under `syntax/intent` and its linked topics in
`<domain>/index` and `<domain>/info`. A diagnostic naming a topic can be
resolved through `<domain>/info` to repair the Intent. Business-value filters
use the stable value ID, not its physical wire or localized label.

### One deduplicated entity set

Use `GraphUnion` when at least two independently valid graph paths must
return one deduplicated population of the same entity:

```text
{"op":"GraphUnion","branches":[
  {"result_node":"<node ID>","graph":<graph Intent>},
  {"result_node":"<node ID>","graph":<graph Intent>}
]}
```

Each branch has its own complete graph and names the node whose entity should
appear in the result. All result nodes must denote the same dataset. Select
the same dimensions in the same order in every branch, including plain
dimensions for every field of the dataset's full identity grain. Identity
fields remain visible result columns. Branches are raw-row plans; counts,
measures, grouping, local ordering, Top-N, and pagination are not supported.
The union deduplicates complete result rows, not merely display labels. It
does not merge different entity types or reverse directed relations. For
different result categories, submit separate Intents instead.

### Independent aggregate pair

Use `GraphPair` when two measure populations must be aggregated separately
and then matched by their complete declared group identities:

```text
{"op":"GraphPair","left":<graph Intent>,"right":<graph Intent>,
 "count_groups":false}
```

`left` and `right` are complete `Graph` Intents, each with its own nodes,
named edges, filters, existence qualifications, one measure projection, and
optional `measure_having`. Each side is lowered and grouped independently;
the resulting groups are inner-joined on every hidden identity field.
Neither the measure populations nor their raw rows are joined to each other
before aggregation. Only identities present on both sides appear in the
result. With `count_groups:false` (the default), the result contains the
aligned visible dimensions and both measure values. With outer
`count_groups:true`, it counts the aligned groups instead.

The two operands must satisfy all of these shape rules:

1. Each has `op:"Graph"`, exactly one `measures` entry, and
   `group_by_identity` beginning with its `root` node ID.
2. They use the same root node ID and dataset. Their `group_by_identity`
   arrays are identical, and every grouped node ID denotes the same dataset
   on both sides. The complete Model-declared identity keys must match.
3. Their `select` arrays are identical in order; each selected node ID
   denotes the same dataset on both sides. The measure IDs and qualification
   paths may differ between sides.
4. Neither operand uses `count`, `count_value`, `count_having`,
   `count_groups`, `distinct`, `include_empty`, `top_per`,
   `top_by_measure`, `order_by`, or `take`. Put measure thresholds in
   that operand's `measure_having`, not in the outer pair.

The outer object accepts only `op`, `left`, `right`, and optional boolean
`count_groups`. A successful pair does not prove that two similarly named
display values are the same entity: the join uses the aligned identity keys.

`index` and `info` expose knowledge points and references. A successful
`transform` returns `{"accepted":true,"receipt":"<id>","count":N}`; the host
stores each submitted Intent and its generated Query under that grouped receipt.
A failed transform returns indexed structured diagnostics for repair. Neither
response is a database result. In this evaluation there is no data execution
layer: return the receipt and your business-language interpretation of each
planned result, not a fabricated number or SQL.
When an execution layer is connected, present its returned data instead.
