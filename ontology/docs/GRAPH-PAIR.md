# Explicit aggregate pairs

GraphPair independently aggregates two populations, inner joins their complete
identities, and chooses the source side of each display column.

```text
{"op":"GraphPair","left":<Graph intent>,"right":<Graph intent>,
 "align_by":[{"left":{"node":"previous_device"},"right":{"node":"current_device"}}],
 "select":[{"side":"Left","node":"previous_device","dimension":"device_name"},
           {"side":"Right","node":"current_device","dimension":"device_name"}],
 "rank_by":{"op":"Subtract","minuend":"Right","subtrahend":"Left",
            "direction":"Desc","take":5}}
```

## Alignment and outputs

`align_by` is required and nonempty. Each entry pairs nodes of the same entity;
node IDs may differ. Every node expands to its complete model-declared grain
or key, including composite identities. Nodes cannot repeat on either side.
Each operand's `group_by_identity` must exactly match its aligned nodes in
order, beginning with its root. No partial or additional identity is allowed.

If an aligned identity contains time, alignment pairs individual sample points
or dates. When direct time bounds on the same identity column prove the two
populations disjoint, the request is rejected before SQL is returned. This
includes adjacent half-open windows and supports EpochMillis, DatetimeUtc and
DateUtc boundaries. Bounds through raw dimensions sharing that column are
recognized. Equal, overlapping or unproven-disjoint windows remain valid.
For comparisons between periods, align a resource owner whose identity does
not contain sample time, then aggregate each window's samples through the
declared owner relation. Sample-point pairing can produce many more groups
than owner-level period comparisons.

Outer `select` is required (an empty array is allowed). Every entry specifies
`side:Left|Right`, `node`, and `dimension`. Only aligned nodes may supply
display attributes: the model identity contract requires these attributes
to be determined by the complete identity. Historical versions require their
own modeled identity; sample attributes cannot split an owner identity into
several aggregate groups. Each operand's `select` is empty or omitted;
the outer selection derives its projection. Display columns remain in SQL
GROUP BY where needed but never become alignment keys.

Outputs follow outer `select` order, then the left and right measures.
Aliases are `left_<node>_<dimension or measure>` and
`right_<node>_<dimension or measure>`. Half-open dimensions retain an adjacent
`__kind` column. Duplicate result aliases are rejected. Selecting both sides
exposes changed display values without changing identity matching.

## Populations

Each side is a Graph intent with its own nodes, named edges, filters,
time_windows, existence qualifications, exactly one measure and optional
measure_having. Populations are aggregated independently; their raw rows are
never joined to each other. Only identities present on both sides survive.
Measure IDs and qualification paths may differ. Operand counts, distinct,
include_empty, order_by, take, top_by_measure and top_per are forbidden.

Optional outer boolean `count_groups:true` counts all aligned identities.
Without it the selected display columns and both measures are returned.

## Ranking

Optional `rank_by` uses one of these closed operations:

| `op` | Side parameters | Formula |
|---|---|---|
| `Subtract` | `minuend`, `subtrahend` | minuend - subtrahend |
| `Ratio` | `numerator`, `denominator` | numerator / denominator |
| `GrowthRate` | `current`, `baseline` | (current - baseline) / baseline |

Each parameter is `Left` or `Right` and must reference a different side.
Every operation requires `direction:Asc|Desc` and integer `take` from 1 to
1000. Both measures must be numeric. The same measure ID is compatible;
different IDs must declare matching non-null units.

NULL measures are excluded. Ratio excludes zero denominators but allows
negative denominators. GrowthRate requires a strictly positive baseline;
negative current values remain eligible. A growth rate is a fraction: 0.2
means 20%, not 0.2%. Ranking occurs after aggregation and identity matching.
Ties use every complete alignment identity key ascending, NULLS FIRST.

Both operands are cast to double precision (`REAL` in SQLite,
`DOUBLE PRECISION` in PostgreSQL) before arithmetic. Integer division retains
fractions, but large integers may lose precision. NULLIF also guards division
against optimizer evaluation before filtering. No comparison output column
is added. Ranking cannot combine with `count_groups:true`.

The profile must allow Order, Limit, Scalar and Filter, plus IsNotNull and
the operation's scalar capabilities: Sub for Subtract, Div and Ne for Ratio,
Sub, Div and Gt for GrowthRate.

## Migration

Old implicit GraphPair requests receive migration diagnostics. Add align_by,
move display dimensions from operand select to outer select with explicit
side, and add the operation's side parameters to rank_by. Update consumers
to the side-prefixed output aliases. The outer object accepts only op, left,
right, align_by, select, optional boolean count_groups, and optional rank_by.
