# Shared QueryPlan and SQL dialects

`ontology/intent` produces a validated `QueryPlan` without materializing SQL.
The materializer is responsible for turning that same plan into a parameterized
`Query`. At present only SQLite has a materializer; PostgreSQL is not yet a
supported dialect. Adding it means passing the execution checks below, not
simply producing syntactically plausible SQL.

`ontology/postgres` has expression, Rows/DistinctRows, GroupCount and set candidate
renderers for projections, scoped sources, JOIN ON, grouped aggregates, HAVING,
paging, derived UNION ALL sources and correlated EXISTS, including bounded
linked and paired-endpoint bodies, scalar aggregate comparisons, ranked-key
comparisons, and initial partitioned Top-N. Its candidate `QueryPlan` entry
dispatches the same five validated result shapes as SQLite. Every rendering stage takes and returns
an immutable context that allocates numbered bindings and collision-free
internal aliases. The entry is not yet an admitted PostgreSQL dialect: Model
set output types are checked at ontology lowering, but full cross-dialect
execution semantics remain unproven.
The query AST validates set projection *shapes*, not Model output types.
Ontology lowering checks the prepared Model output types positionally before
emitting a set AST; a bare AST caller is responsible for its physical schema.
SQLite can execute mixed-type sets that PostgreSQL rejects, so a model-derived
set must never reach either renderer with mismatched output types.

### Set projection type contract to complete

Ontology must derive a positional *output* type for each model-derived set
operand and reject different types before constructing `SetPlan`. Shapes
(`Expr`, `Aggregate`, `Computed`) are not types. The query AST remains a closed
structural vocabulary and does not inspect Model metadata or physical schema.
In particular:

- A plain dimension uses its declared physical scalar type; a closed enum's
  physical text representation is not its Telora enum type.
- A computed dimension declares its output type; its input field type and
  filter input kinds cannot prove the builder's result.
- Aggregate output typing depends on the aggregate (for example Count vs
  Avg), and computed measures depend on their typed operands. Model-derived
  projections must be checked in actual SELECT order, including derived
  outputs rather than just inspecting bound literals.

Both SQLite and PostgreSQL consume the same structurally validated AST. Do
not use PG casts to make mismatched model projections executable: casting
changes set equality and therefore business semantics, even if both run.
Partitioned Top-N now reuses the original numbered placeholders for the same
structural grouping expression across SELECT, window clauses and GROUP BY.
This is an explicit AST-expression reference, not a SQL-text rewrite. Its
execution checks include column grouping, aggregate ranking and a parameterized
grouping key. Full cross-dialect query equivalence is still pending.

## Common contract

- A query shape (`Rows`, `DistinctRows`, `SetRows`, `SetCount`, `GroupCount`)
  and its validated `Plan` have one meaning regardless of dialect. A dialect
  cannot silently approximate an AST node, reinterpret an identity key, change
  the ordering of bindings, or apply session-dependent date/time semantics.
- `BuildCtx` assigns each dynamic scalar a stable index while building the AST.
  SQLite emits `?n` and PostgreSQL emits `$n` for the same handle; repeated
  references reuse its index. `Query.bindings[n-1]` is the scalar for handle
  `n`, even when SQL expression order differs from allocation order.
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
| Relative UTC day | `strftime` with bound UTC anchor and bound integer duration | Keep the same canonical UTC second text and date bounds, not session timezone or implicit `now()`. Further calendar/epoch operations belong to #11. |
| Aggregate/HAVING | `FILTER (WHERE ...)`, computed aggregate, parameterized threshold | Test NULL and empty-input results, distinct/filter interactions, calculated output and binding order. |
| Related predicates | correlated EXISTS, composite keys, private aliases, JOIN ON predicates | Test INNER/LEFT join and zero-match owners, OR keys, private aliases and independent qualification grain. |
| Paging/order | `LIMIT ?`, `LIMIT -1 OFFSET ?`; ASC puts NULL first and DESC puts NULL last | PG offset-only must not use SQLite's `LIMIT -1`. PG must render `NULLS FIRST` for ASC and `NULLS LAST` for DESC (its defaults are opposite). Compare stable Top-N ranking; no implicit order promise. |
| Derived/set | UNION ALL source, INTERSECT/EXCEPT/distinct UNION, set count | Compare projected types and row duplicates, branch-local binding order, and NULL treatment in distinct/set operations. |
| Partitioned Top-N | `row_number()` with hidden grouping/order columns | Compare partition grain, tie breakers, projected output and NULL ordering. |

Some entries may require tightening the shared semantics or changing the SQLite
renderer before PostgreSQL can be admitted. Until these checks are executable
and pass, a PostgreSQL renderer must not be advertised as supporting the entire
public AST. This document is an acceptance inventory, not evidence that PG
support already exists.
