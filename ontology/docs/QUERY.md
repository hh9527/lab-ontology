# QueryAst and SQL materialization

`ontology/query` is the backend-neutral, closed query vocabulary. It does not
know dataset names, business dimensions, or authorization. Ontology lowering
constructs a `QueryAst`; `ontology/sqlite` or `ontology/postgres` materializes
it once as a parameterized `Query`. The authoritative type and constructor
signatures are in [`query.telora`](../src/query.telora).

```telora
use ontology::query as qb;
use ontology::sqlite as sqlite;

def one_row_query: Fn() -> qb::Query = fn() {
    let source = qb::source_with_hint(qb::build_context(), "trusted_table", "t");
    let bound = qb::bind(source.0, qb::Val::Int(1));
    let plan: qb::Plan = {
        revision: "example", sources: [source.1], derived: None,
        projection: [qb::expr_item(qb::column(source.1, "trusted_column"))],
        internal_measures: [], joins: [], exists: [], grouping: [], having: [],
        filter: Some(qb::scalar(qb::ScalarFunction::Eq,
            [qb::column(source.1, "trusted_column"), bound.1])),
        ordering: [], limit: None, offset: None, partition: None,
        scalar_comparisons: [], ranked_key_comparisons: [],
    };
    let ast = qb::finish(bound.0, qb::validate_query_plan(qb::QueryPlan::Rows(plan)));
    sqlite::build_query(ast)
};
```

The example illustrates resource allocation and a complete row Plan. See
[`ontology/tests/postgres.telora`](../tests/postgres.telora) and the ontology
lowering code for complete query constructions.

## Construction boundary

`BuildCtx` is immutable. Builders take it as input and return a new context
alongside the allocated resource. `bind(ctx, Val)` registers a scalar and
returns an expression carrying its binding index; the scalar never becomes
SQL template text. `source_with_hint(ctx, table, hint)` allocates a unique
source alias from the hint. Column references use that source handle and a
trusted column symbol. The model supplies table and column symbols; they are
validated as identifiers, never accepted as SQL fragments. SQLite emits the
validated names directly, while PostgreSQL quotes them to preserve case.

`Plan` represents a closed relational plan: sources or a derived source,
projection, filters, joins, correlated existence, grouping, HAVING, ordering,
paging, and the supported restricted ranking/comparison forms. `QueryPlan`
chooses a result shape: `Rows`, `DistinctRows`, `SetRows`, `SetCount`,
`GroupCount`, `JoinedGroups`, or `JoinedGroupCount`. `finish(ctx, plan)` seals
the allocation context and validated plan into one `QueryAst`; neither
unfinished `Ctx` nor `Plan` crosses the renderer boundary. The AST cannot
contain raw SQL, arbitrary functions, or literal fragments.

Model-backed type and grain checks belong to ontology lowering. The query
module also validates structural invariants such as source visibility,
expression shape, and closed operator use. A bare AST caller is responsible
for the physical schema behind trusted symbols. This split must not be read
as permission for a renderer to reinterpret a valid AST.

## Materialization boundary

Both renderers expose `build_query(QueryAst) -> Query`, where `Query` has
`sql: String` and `bindings: Array(Val)`. The same allocated binding handle
becomes `?n` in SQLite and `$n` in PostgreSQL. `bindings[n-1]` supplies the
value for handle `n`; repeated references reuse that handle. A renderer
handles identifier quoting and its own syntax/functions without reverse
parsing an SQL string or escaping data values into the template.

```telora
use ontology::sqlite as sqlite;
use ontology::postgres as postgres;

let sqlite_query = sqlite::build_query(ast);
# In a PostgreSQL-backed service, select postgres::build_query instead.
```

The service picks one backend when it constructs its lowering function; a
request cannot mix dialects. See [DIALECT-CONTRACT.md](DIALECT-CONTRACT.md)
for semantic parity and PostgreSQL admission status. SQL and bindings are
intermediate execution artifacts, not user-facing business answers. The
service protocol is documented in [USAGE.md](../../USAGE.md).
