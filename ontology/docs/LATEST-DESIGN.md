# Latest measures

Implemented for [issue #53](https://github.com/hh9527/lab-ontology/issues/53),
part 2. Latest measures support projection, aggregate qualification, Top-N,
computed dependencies and GraphPair. `top_per` retrieves whole raw sample rows.

## Business meaning

Latest selects one row from a group's eligible sample population, then returns
the selected field's original value. It is not the maximum value, a period
average, or the latest non-NULL value.

The eligible population is established by dataset scope, declared joins,
constraints, filters, time windows and EXISTS qualification. Latest applies
after these conditions. `measure_having` applies after Latest, so the following
questions intentionally have different answers:

- Latest CPU exceeds 80%: select the latest row, then compare its CPU to 80.
- Latest sample whose CPU exceeds 80%: filter CPU first, then select a row.

Time windows remain explicit, half-open intervals. Without an upper bound,
future-dated samples can be selected. The service does not read a clock or
interpret the word "current" as an implicit cutoff.

## Model declaration

Numeric field annotation:

```telora
@edsl::latest_measure("device_cpu_latest", Some("%"))
cpu_usage: Float,

@edsl::latest_measure("device_memory_latest", Some("%"))
mem_usage: Float,
```

The annotation requires a primary numeric sample measure on the same field, with a
matching unit. It declares a stable measure ID and derives ordering from
the enclosing dataset's authoritative UTC time and complete sampling grain.
The caller does not choose a time field, ordering direction or NULL policy.
Existing measure descriptions and aliases describe the declared meaning.

Preparation must reject declarations without a sampling dataset, an authoritative
UTC instant field or a nonempty complete grain. The initial capability accepts
Int and Float value fields. Output preserves the source value type and unit;
the internal reduction must not convert an integer value to floating point.
Date-only fields do not define the authoritative instant for this capability.

Selection order is authoritative time descending, followed by all remaining
sampling-grain fields ascending, NULLS FIRST. Equal times therefore produce a
deterministic choice, without claiming that one tied sample is fresher.
Uniqueness of the complete grain remains a Model/source contract; a repeated
complete identity containing conflicting values cannot be resolved by choosing
the larger metric value. Source uniqueness TODOs remain visible.

PostgreSQL orders the native UTC timestamp or epoch integer. SQLite orders the
declared fixed-width normalized UTC text or epoch integer. No timezone
inference, calendar bucketing or type conversion is introduced.

## NULL and row coherence

If the latest eligible row has a NULL CPU, its Latest CPU is NULL even when an
older row has a CPU value. CPU and memory measures over the same sample node and
population share one row selection, so their values describe the same sample.

A row with a NULL authoritative time is not a Latest candidate. If a group has
no dated candidates, Latest returns NULL. Such rows remain available to ordinary
aggregates: adding Latest must not change an existing Avg or Count population.

An owner with no eligible samples follows the existing Graph population
semantics. Latest does not add outer joins, synthesize owner rows, return zero
or extend `include_empty`. An existing group with no dated candidate differs
from an owner absent from the result.

## Intent examples

The Intent vocabulary does not gain a Latest operation or aggregate override.
Callers select a declared measure through the existing measure ID interface.
The product model publishes these measure IDs:

```json
{
  "op": "Graph",
  "root": "d",
  "nodes": [
    {"id": "d", "entity": "device"},
    {"id": "k", "entity": "device_kpi"}
  ],
  "edges": [{"relation": "device_kpi_of_device", "from": "k", "to": "d"}],
  "select": [{"node": "d", "dimension": "device_name"}],
  "group_by_identity": ["d"],
  "measures": [
    {"node": "k", "measure": "device_cpu_latest"},
    {"node": "k", "measure": "device_memory_latest"},
    {"node": "k", "measure": "cpu_usage"}
  ],
  "time_windows": [{
    "node": "k",
    "dimension": "device_kpi_ts_raw",
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-04T00:00:00Z"
  }],
  "measure_having": [{
    "node": "k", "measure": "device_cpu_latest", "op": "Gt", "value": 80
  }],
  "top_by_measure": {
    "node": "k", "measure": "device_cpu_latest", "direction": "Desc", "take": 10
  }
}
```

GraphPair operands can each select a Latest measure over an explicit window.
Align the owner identity, not the sample timestamp. Existing pair arithmetic,
unit checks, NULL/baseline guards and `comparison_value` then apply to the
independently selected values.

## Query representation

`AggregateFunction::Latest` is an authorization/semantic marker, not the name
of a native SQL aggregate. `AggregateCall.latest` is an optional closed
`LatestOrder {time: ColumnRef, ties: Array(ColumnRef)}` specification. Model
lowering resolves these fields from the dataset and retargets
them to the request's sample instance.

Validation requires this specification exactly for Latest and rejects it for
ordinary aggregates. Latest initially forbids DISTINCT and aggregate-local
FILTER: these would create a separately selected population and undermine the
shared-row guarantee. Intent row filters remain supported.

The ordering specification is not arbitrary SQL or an open window expression.
Every column must belong to the argument's sample source, be visible to the
plan, pass identifier/binding checks and satisfy derived-column validation.
Authorization requires Latest in `allowed_aggregates` and Aggregate, Group,
Order and Partition capabilities in addition to the operations already used
by the query. The AST and profile validators must inspect ordering columns.

`aggregate_name` must not emit `latest(...)`. Flat scalar subqueries and ranked
key subqueries retain their current ordinary-aggregate contracts; Latest in
those contexts is explicitly rejected in the first implementation. Nested
EXISTS aggregate-having support is also deferred with a specific diagnostic.
These restrictions must be documented rather than accidentally inherited from
the extended enum.

## Execution plan

Use a shared ordered-reduction stage before grouping, with equivalent SQLite
and PostgreSQL execution. Do not apply `top_per` to the whole aggregate input:
doing so would make Avg, Min, Max and Count operate on only the selected row.

The stages are:

1. Materialize the existing eligible joined population, retaining the columns
   needed by grouping, measures, ordering and grain.
2. Add a row number within the actual grouping expressions, including hidden
   identity grouping, ordered by the model-resolved time and tie fields.
   Multiple Latest values from one sample node share this row number.
3. Group all eligible rows. An ordinary aggregate keeps its original input.
   A numeric Latest is reduced as
   `MAX(CASE WHEN row_number = 1 AND sample_time IS NOT NULL THEN value END)`.
   Only one row can contribute, and a selected NULL remains NULL.
4. Evaluate measure predicates, aggregate ordering and limits using these
   reductions. Computed measures resolve their declared dependencies through
   the same measure-reference mechanism.

The internal MAX is an implementation of single-row extraction, not the
measure's published business aggregation. Knowledge must report Latest.

Grouping defines the selection population. Grouping only by a nonunique device
name can select one sample across multiple devices with that name. Per-device
questions require complete owner identity grouping; the engine must not
silently change the requested grouping to fix a business interpretation.

The first implementation accepts one sample instance for Latest reductions in
each grouped operand and same-source ordinary aggregate dependencies. It keeps
existing sample-grain proofs and rejects row-multiplying joins. Independently
sampled populations require separate operands or a later explicit composition
design. Raw `top_per`, DISTINCT and unsupported `include_empty` combinations
remain rejected rather than acquiring implicit semantics.

## Product coverage

Four measures are declared:

- `device_cpu_latest` and `device_memory_latest` on `device_kpi`.
- `server_cpu_latest` and `server_memory_latest` on `server_kpi`.

They retain the existing percent units and source populations. Publish links
to their raw dimensions and a shared Latest schema contract. Do not make a raw
sample dimension itself mean Latest, or change the existing Avg/Min/Max IDs.
Additional ONU, PON, wireless and board measures can follow after the common
capability is proven and their sampling-grain declarations are checked.

## Acceptance

Execute the same cases in SQLite and PostgreSQL:

- Same-name owners remain separate under complete identity grouping.
- Latest CPU and memory come from the same row, including complementary NULLs.
- Selected NULL is retained; older non-NULL values are not substituted.
- NULL-time rows cannot become Latest but remain in ordinary aggregates.
- Equal times use identical complete-grain tie rules in both dialects.
- Half-open windows exclude their upper boundary; concrete cutoffs exclude
  future rows when requested.
- Latest threshold qualification differs from preselection sample filtering.
- Latest Top-N ranks owners and preserves deterministic identity ties.
- Latest and Avg/Count coexist without changing the ordinary input population.
- GraphPair compares the two windows' last eligible rows, supports reversed
  operands and returns the exact existing comparison expression.
- Integer and floating results preserve their declared types and units.
- Missing temporal/grain declarations, unauthorized profiles, forged AST
  ordering and unsupported query combinations fail with specific diagnostics.

The existing raw `top_per` capability remains available for whole-row retrieval.

## Verification

`ontology/tests/latest.telora` checks preparation, authorization, forged AST
ordering, output types and computed dependencies. Its exported queries execute
in `ontology/tests/latest-runtime.mjs`, covering EpochMillis, negative times,
NULL clocks and values, unchanged Avg/Count, computed measures and exact BIGINT
values beyond JavaScript's Number precision.

`icloud_model/tests/latest.telora` exports real product queries for
`scripts/check-icloud-latest.mjs`: mixed Latest/Avg, pre/post-selection thresholds,
Top-N, GraphPair Subtract/Ratio/GrowthRate, half-open windows, future samples and
server CPU/memory. The checker executes native PostgreSQL timestamptz columns
under UTC and Asia/Shanghai, and normalized UTC text in SQLite.

Run after exporting queries:

```sh
bin/telora -C ontology eval @test/latest:runtime_queries --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048 > /tmp/latest-core.json
node ontology/tests/latest-runtime.mjs /tmp/latest-core.json /path/to/pglite/dist/index.js
bin/telora -C icloud_model eval @test/latest:runtime_queries --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048 > /tmp/icloud-latest.json
node scripts/check-icloud-latest.mjs /tmp/icloud-latest.json /path/to/pglite/dist/index.js
```
