# Shared QueryPlan and SQL dialects

`ontology/intent` produces a validated `QueryPlan` without materializing SQL.
The materializer is responsible for turning that same plan into a parameterized
`Query`. At present only SQLite has a materializer; PostgreSQL is not yet a
supported dialect. Adding it means passing the execution checks below, not
simply producing syntactically plausible SQL.

`ontology/postgres` has expression, Rows/DistinctRows and GroupCount candidate
renderers for projections, scoped sources, JOIN ON, grouped aggregates, HAVING,
paging and derived UNION ALL sources. Every rendering stage takes and returns
an immutable context that allocates numbered bindings and collision-free
internal aliases. Unsupported shapes still fail explicitly; there is no
complete `QueryPlan` materializer yet, so PostgreSQL is not an admitted dialect.

## Common contract

- A query shape (`Rows`, `DistinctRows`, `SetRows`, `SetCount`, `GroupCount`)
  and its validated `Plan` have one meaning regardless of dialect. A dialect
  cannot silently approximate an AST node, reinterpret an identity key, change
  the ordering of bindings, or apply session-dependent date/time semantics.
- `Query.bindings` lists dynamic scalars in SQL placeholder order. SQLite uses
  `?`; PostgreSQL must assign `$1`, `$2`, ... to the *same* ordered values,
  including bindings in subqueries, derived sources, JOIN ON, aggregates,
  HAVING and partitioned results. AST field order need not equal SQL order.
- The source, column, and alias identifiers are checked as identifiers rather
  than accepted as arbitrary SQL. PostgreSQL must preserve the declared case
  of identifiers, including mixed-case physical column names; unquoted PG
  identifiers fold to lowercase. Test this against real tables.
- A new shared AST operation is exposed to ontology lowering only after every
  supported dialect can execute it with equivalent results and failure modes.

## Execution matrix for PostgreSQL admission

| AST family | SQLite behavior in `query.telora` | Cross-dialect check |
| --- | --- | --- |
| Bind/column/source | `?`, unquoted identifiers | Number placeholders in final SQL order; quote PG identifiers without changing physical identity. Include nested scope bindings. |
| Scalar text | `substr`, `instr`, `lower`, `length` | `instr` is one-based with zero for absence; `lower` currently folds ASCII A-Z only in default SQLite, while PG depends on collation. Use an explicitly equivalent collation/implementation and test non-ASCII and NULL. |
| Scalar JSON | Typed `JsonExtractText/Int/Number` lowers to SQLite JSON1 `json_extract`; `json_type`, `json_valid` remain | Compare declared scalar result types, JSON null versus SQL NULL, missing paths, boolean/number/string, invalid JSON and path errors. PG JSON operators and casts do not automatically share JSON1 behavior; a wrong-type physical JSON value is a source contract violation, not a cast permission. |
| Relative UTC day | `strftime` with bound UTC anchor and bound integer duration | Keep the same canonical UTC second text and date bounds, not session timezone or implicit `now()`. Further calendar/epoch operations belong to #11. |
| Aggregate/HAVING | `FILTER (WHERE ...)`, computed aggregate, parameterized threshold | Test NULL and empty-input results, distinct/filter interactions, calculated output and binding order. |
| Related predicates | correlated EXISTS, composite keys, private aliases, JOIN ON predicates | Test INNER/LEFT join and zero-match owners, OR keys, private aliases and independent qualification grain. |
| Paging/order | `LIMIT ?`, `LIMIT -1 OFFSET ?`; ASC puts NULL first and DESC puts NULL last | PG offset-only must not use SQLite's `LIMIT -1`. PG must render `NULLS FIRST` for ASC and `NULLS LAST` for DESC (its defaults are opposite). Compare stable Top-N ranking; no implicit order promise. |
| Derived/set | UNION ALL source, INTERSECT/EXCEPT/distinct UNION, set count | Compare projected types and row duplicates, branch-local binding order, and NULL treatment in distinct/set operations. |
| Partitioned Top-N | `row_number()` with hidden grouping/order columns | Compare partition grain, tie breakers, projected output and NULL ordering. |

### JSON path and representation checkpoint

The AST now stores `JsonPath` as typed key, zero-based index and from-end
index segments. Models declare those segments directly; PostgreSQL does not
need to parse SQLite JSON1 strings. SQLite serializes the segments into one
bound JSON1 path at rendering time; PostgreSQL must consume the same segments
without interpolating keys into SQL. Invalid indices and keys which SQLite
cannot represent unambiguously are rejected while building the path.
Actual cross-dialect execution equivalence still requires tests of keys,
indices, reverse indices, missing paths and JSON null.

Use PostgreSQL's original `json` representation for `JsonType` when numeric
lexical form matters: SQLite distinguishes `json_type('1e0', '$') = 'real'`
from `json_type('1', '$') = 'integer'`, whereas `jsonb` normalizes `1e0` to
`1`. Verified on PostgreSQL 16: `json_extract_path` on a nested `json` value
retains `1e0`; `json_extract_path_text` returns SQL NULL for JSON null, and a
numeric array segment selects its element. These observations establish a
possible implementation route, not complete equivalence. In particular,
text extraction, JSON type classification and invalid-document behavior each
need independent execution tests.

The initial PostgreSQL expression renderer uses `VARIADIC text[]` with one
numbered, typed parameter per path segment. PostgreSQL 16 execution confirmed
negative array indices, `1e0` lexical preservation, JSON null, invalid JSON
detection, ASCII-only `translate`, and explicit UTC day subtraction.
Binding-order tests cover nested JSON extraction and repeated references to
one placeholder. These expression-level checks do not establish full-query
equivalence.

Some entries may require tightening the shared semantics or changing the SQLite
renderer before PostgreSQL can be admitted. Until these checks are executable
and pass, a PostgreSQL renderer must not be advertised as supporting the entire
public AST. This document is an acceptance inventory, not evidence that PG
support already exists.
