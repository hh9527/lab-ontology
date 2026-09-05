# Query-core feedback: ranked grouped-key scalar comparison

The current `ScalarSubquery` can return only one aggregate value. It cannot represent the distinct
closed shape where an outer attribute is compared with the grouping key of the first group after
ordering groups by an aggregate. Add that capability without opening arbitrary subqueries.

## Contract

- Introduce a separate typed specification for a scalar grouped-key subquery; do not overload or
  weaken the existing scalar-aggregate specification.
- The inner query has exactly one projected/grouped key expression, one closed aggregate ordering
  expression, a required direction, and `LIMIT 1`. It may have declared joins and an optional row
  filter, but no arbitrary projection, HAVING, offset, partition, set operation, nested scalar
  subquery, or raw SQL.
- A Plan-level comparison keeps an outer `ColumnRef` when it satisfies a closed comparison operator
  against that scalar key. Validate outer/key type compatibility and alias ownership.
- Render the shape as a parenthesized scalar select of the group key with deterministic clause and
  binding order. Preserve the outer projection exactly.
- Include every actually used operator in profile checks and recursively validate the inner source,
  joins, filter, grouping key, ordering aggregate, and aggregate-local filter.
- Keep existing scalar aggregate comparisons source-compatible and behaviorally unchanged.

## Acceptance

- Add exact SQL/binding tests for ascending and descending aggregate rank, inner joins and filters,
  and an outer projection unrelated to the hidden grouped-key machinery.
- Add rejection tests for missing grouping, multiple keys, non-aggregate ordering, absent limit-one
  semantics, incompatible key types, alias leakage, unsupported profile operators, nested scalar or
  set shapes, and invalid identifiers.
- Cover repeated lowering, native NULL comparison behavior, and unchanged existing scalar aggregate
  comparisons.
- Document the new closed AST and validation/rendering rules in `QUERY.md`, then run both authorized
  query checks.
