# UQL backend

`ontology::uql` renders the shared `QueryAst` with
`build_query(QueryAst) -> Query`. It was ported from Semora commit
`0ca8adf585292fd5af6929f27b3422254d8d8421`. It uses the existing ontology
preparation and lowering pipeline, including its initialization optimizations.

Select the renderer when constructing the service handler:

```telora
use ontology::intent as intent;
use ontology::uql as uql;

def lower: Fn(Value) -> Value =
    intent::query_request_method_factory(payload, uql::build_query);
```

`payload` is the model's existing `PreparedPayload`; `Value` is imported from
`std::value`. The backend is selected by the service, and every request uses
that backend. The existing SQLite service entries keep their current renderer.
No Semora dependency is required.

## Rendering contract

- Identifiers use backticks and must pass the shared identifier validation.
- Parameters use `$n`, retaining the original `BuildCtx` binding indices and
  `Query.bindings` order, including repeated references and nested queries.
- All seven `QueryPlan` variants are handled: Rows, DistinctRows, GroupCount,
  SetRows, SetCount, JoinedGroups and JoinedGroupCount. The renderer also
  handles scoped sources, joins, EXISTS, scalar/ranked comparisons, Latest,
  partitioned Top-N and final output limits.
- Filtered aggregates use `CASE` within the aggregate. Ascending order puts
  NULL first; descending order puts NULL last through explicit sort keys.
- ASCII case folding uses `replace` so non-ASCII text retains its case.
- UTC functions require the executor's temporal interpretation to use UTC.
  Hour/day epoch buckets use exact integer floors, including negative epochs;
  month buckets use calendar functions. Inputs outside the supported calendar
  range return NULL.
- `BinaryText` fails explicitly because this UQL contract does not define
  binary text collation. HAVING without GROUP BY is also rejected explicitly.
  IPv4 subnet filters that use binary prefix ranges therefore fail rather
  than change their comparison semantics. Renderer failures pass through the
  existing indexed batch diagnostics.

The execution adapter must support the generated UQL functions, window
functions, parameterized limits and `$n` bindings. Rendering does not establish
equivalence across UQL engines or their underlying data sources.

## Verification

From the repository root, use a release Telora binary:

```sh
TELORA=../telora/target/release/telora
"$TELORA" --with-memory-limit 1024 -C ontology test uql
"$TELORA" --with-memory-limit 1024 -C ontology test uql_intent
python3 scripts/check-uql.py --telora "$TELORA"
```

`uql` covers renderer contracts and rejections. `uql_intent` covers model
lowering, identical bindings across three backends, result columns, limit slots
and indexed batch failures, including unsupported binary collation. The Python
check executes 35 generated queries
against in-memory SQLite, covering the portable SQL subset and epoch hour/day
boundaries. It does not validate an actual UQL engine; UQL calendar/formatting
functions and engine-specific regex behavior still need engine integration
checks.
