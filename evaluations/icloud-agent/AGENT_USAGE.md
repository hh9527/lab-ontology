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
`ontology_info`. `ontology_transform` takes an `intent`; request context is
supplied by the host, not by this tool's caller.

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
the user's question. If the request or available knowledge leaves a choice that
would change the answer, clarify the business meaning with the user in business
terms. SQL and bindings are intermediate output for an authorized execution
layer, not the basis for clarification or the final user-facing result.

Submit an Intent to `ontology_transform`:

```text
{"intent":<Intent>}
```

The host supplies `ctx.now` as epoch milliseconds when an Intent refers to
request time; calendar boundaries also need `ctx.tz` in UTC offset minutes.
Do not infer either value from the Agent environment or pass a `ctx` field to
the tool. If the host omits required context, report that the service lacks a
reference time; ask a user only for business choices they can meaningfully
make, in ordinary time terms rather than protocol fields. The offset is fixed,
not a named timezone or daylight-saving rule. Knowledge
discovery describes the Model; the generic Intent syntax is below. The Model
and `transform` decide which combinations have valid business meaning.

### Graph Intent syntax

A graph Intent has five required fields, including empty arrays where needed:

```json
{"op":"graph","root":"item",
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
| `filters` | Array of `{"node":"...","dimension":"...","op":"eq","value":...}`; optional `kind` |
| `time_windows` | Array of `{"node":"...","dimension":"...","start":...,"end":...}` |
| `any_of` | Array of `{"node":"...","dimension":"...","values":[...]}`; optional `kind` |
| `exists` | Array of existence objects described below |
| `measure_having` | Array of `{"node":"...","measure":"...","op":"...","value":...}`; optional `kind` |
| `count` | Node instance ID string |
| `count_value` | `{"node":"...","dimension":"..."}`, for distinct non-null value count |
| `count_having` | `{"op":"...","value":<integer>}` |
| `count_groups`, `include_empty`, `distinct` | Boolean |
| `group_by_identity` | Array of node instance ID strings |
| `row_grain` | `"root"` or `"association"` |
| `order_by` | Array of `{"node":"...","dimension":"...","direction":"asc|desc"}` |
| `take` | Integer |
| `top_per` | `{"owner":"<node>","sample":"<node>","rank":"<dimension>","take":<integer>}` |
| `top_by_measure` | `{"node":"...","measure":"...","direction":"asc|desc","take":<integer>}` |

Time-window endpoints are `[start, end)` and accept a value of the dimension's
declared logical type, `"now"`, `{"delta_ms":<integer>}` for elapsed time from
request `now`, or `{"calendar":"day|week|month","offset":<integer>}` for a
boundary relative to the period containing request `now`. Calendar boundaries
require `ctx.tz`; a fixed offset cannot represent daylight-saving rules.

An existence object has required `anchor` (an outer node instance ID),
`nodes` (inner node objects), and `edges` (named edge objects connecting
the anchor to inner nodes). Its edges may be in any order but must form a
tree rooted at `anchor`. It may also contain `constraints`, `filters`,
`time_windows`, `any_of`, `having` (same shape as `measure_having`), and
`negated` (boolean). `exists` qualifies outer entities without multiplying
their rows; use it when a related one-to-many entity must only establish
existence. The request may have multiple graph edges and multiple existence
objects; there is no fixed hop count in the Intent syntax.

Filter operators are `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `contains`,
`not_contains`, `starts_with`, and `ends_with`. The Model restricts which
operators and value types each dimension permits. Omit `kind` when the Model
uniquely determines it from the JSON value; otherwise use `text`, `int`,
`number`, `bool`, `date`, `rfc3339`, `utc_second`, `local_datetime`, or
`epoch_millis` as indicated by the knowledge point. Business-value filters
use the stable value ID, not its physical wire or localized label.

### Independent aggregate pair

Use `graph_pair` when two measure populations must be aggregated separately
and then matched by their complete declared group identities:

```text
{"op":"graph_pair","left":<graph Intent>,"right":<graph Intent>,
 "count_groups":false}
```

`left` and `right` are complete `graph` Intents, each with its own nodes,
named edges, filters, existence qualifications, one measure projection, and
optional `measure_having`. Each side is lowered and grouped independently;
the resulting groups are inner-joined on every hidden identity field.
Neither the measure populations nor their raw rows are joined to each other
before aggregation. Only identities present on both sides appear in the
result. With `count_groups:false` (the default), the result contains the
aligned visible dimensions and both measure values. With outer
`count_groups:true`, it counts the aligned groups instead.

The two operands must satisfy all of these shape rules:

1. Each has `op:"graph"`, exactly one `measures` entry, and
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

Tool responses use the `telora.service/v1` envelope. On
success, `ok.Index` contains `entries` and `next_offset`, `ok.Document` holds
`Found`, `Candidates`, or `NotFound`, and `ok` from `transform` contains `sql`
and `bindings`. A failure has `error: true` and structured `diagnostics`.
Inspect diagnostics and repair the Intent using the relevant knowledge points.
`transform` returns a parameterized Query (`sql` and `bindings`), not database
results. Pass both together to an authorized execution layer; never interpolate
values into SQL. Present the resulting data to the user in an appropriate form.
When no execution layer is available, state that only an intermediate Query was
produced and do not invent results.
