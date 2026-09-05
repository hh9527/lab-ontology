# Dog Kennel Resolver Intent

A resolver expresses an analytic question over the dog kennel domain as a single
JSON object (the *intent*) written only in the business vocabulary of
`DOMAIN.md`.  The Host places this object in `dog-eval/input.json` and runs
`bin/dog-make-query check`.  On success the Host writes only the resulting SQL and
bindings to `dog-eval/ok.json`:

```json
{"sql": "SELECT ... WHERE ...", "bindings": [1]}
```

An intent must never contain SQL vocabulary, raw expressions, aliases, table or
column names, or join fragments.  All dynamic values are supplied as data; the
model binds them as parameters.

## Envelope

Every intent is a JSON object with these keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `op` | string | The lowering shape (see below). |
| `measures` | array of string | Measure ids to compute (empty for row-level requests). |
| `dimensions` | array of string | Dimension ids to project / group by. |
| `filters` | array of filter | Attribute restrictions applied to base rows. |
| `ordering` | array of order | Sort targets for the result. |
| `exists` | array of related | Related-record constraints used by `exists`/`absence`. |
| `having` | array of having | Aggregate-result predicates (grouped requests). |
| `limit` | integer or null | Maximum rows returned. |
| `offset` | integer or null | Row offset (requires a stable ordering). |

Arrays that are not used are empty arrays; values that are not used are `null`.

### Filter object

```json
{"dimension": "DogName", "op": "contains", "kind": "text", "value": "abc"}
```

`op` is one of `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `contains`, `not_contains`,
`starts_with`, `ends_with`.  `kind` is `text`, `int`, or `number` and must agree
with the referenced dimension's capability.  `value` is the literal data value.

### Order object

```json
{"target": "Dimension", "id": "DogName", "direction": "Asc"}
```

`target` is `Measure` or `Dimension`; `direction` is `Asc` or `Desc`.  A grouped
(aggregate) request may order by any selected measure or grouped dimension.  A
row-level request may order by any authorized dimension reachable from its base.

### Related object (for `exists` / `absence`)

```json
{"target": "Treatment", "min_matches": 2, "filters": []}
```

`target` is the related entity id; `min_matches` is a positive integer or null;
`filters` is an array of filter objects that only reference dimensions of the
related entity.

### Having object

```json
{"measure": "DogCount", "op": "ge", "kind": "int", "value": 2}
```

`op` is one of `eq`, `ne`, `gt`, `ge`, `lt`, `le`; `measure` must be selected in
`measures`.

## Shapes (`op`)

### `list`

Row-level projection of dimensions.  `measures` must be empty and `dimensions`
non-empty.  Result columns are exactly the selected dimensions in the declared
order: no base column is prepended and no code dimension is replaced by a
descriptive one.  `dimensions` may keep a grain-safe base dimension first (its
entity determines the base grain for cross-entity safety); an optional
`output_order` array lists every selected dimension exactly once and controls the
final column order independently (fed to the foundation's explicit
reorder-projection capability).  `output_order` must be a permutation of the
selected dimensions; omissions, duplicates, extras, or unselected items are
rejected.  Supports filters, ordering, `limit`, and `offset`.

Selection rules:
- select exactly the requested columns — never a nearby descriptive field or an
  extra identity column;
- when only dimension rows are requested and an aggregate would only rank them,
  use `top` (hidden ordering), never visible `aggregate`;
- use `ranked` only when returning outer detail rows whose categorical attribute is
  compared with the hidden top/bottom group key — never to return the ranked group
  itself (that is `top`).

Example: list every dog's name, age, and weight, filtering to abandoned dogs.

```json
{
  "op": "list",
  "measures": [],
  "dimensions": ["DogName", "DogAge", "DogWeight"],
  "filters": [{"dimension": "AbandonedFlag", "op": "eq", "kind": "int", "value": 1}],
  "ordering": [],
  "exists": [],
  "having": [],
  "limit": null,
  "offset": null
}
```

### `distinct`

Like `list` but returns only distinct rows.  `measures` must be empty; ordering
targets must be projected dimensions.

### `count`

Scalar aggregate summary over one entity: `measures` has exactly one measure and
`dimensions` is empty.  Any measure may be summarized this way, including count,
min, max, average, and sum (e.g. `AvgTreatmentCost`, `MinDogAge`, `MaxChargeAmount`).
Row `filters` and `exists`/`absence` restrictions are retained and narrow the
aggregated population; they are never dropped or turned into unaggregated rows.

Example: average treatment cost among all treatments.

```json
{
  "op": "count",
  "measures": ["AvgTreatmentCost"],
  "dimensions": [],
  "filters": [],
  "ordering": [],
  "exists": [],
  "having": [],
  "limit": null,
  "offset": null
}
```

### `aggregate`

Grouped aggregate with the measure **visible** in the result.  `measures` has at
least one measure and `dimensions` lists the grouping dimensions.  Supports
filters, ordering by selected measures / grouped dimensions, `having`, `limit`,
and `offset`.  When only grouping dimensions should be returned and a measure is
used purely to rank the groups, use `top` instead so the ranking measure is never
added to the result shape.

Example: owners with their dog counts, ordered by count, top 1.

```json
{
  "op": "aggregate",
  "measures": ["DogCount"],
  "dimensions": ["OwnerId", "OwnerFirstName", "OwnerLastName"],
  "filters": [],
  "ordering": [{"target": "Measure", "id": "DogCount", "direction": "Desc"}],
  "exists": [],
  "having": [],
  "limit": 1,
  "offset": null
}
```

### `top`

Grouped top-N whose ordering aggregate is **not returned** (hidden aggregate
ordering).  `measures` must be empty; `dimensions` are the grouping dimensions to
return; each ordering entry names a measure id (as `target: "Measure"`) plus a
direction, and `limit` gives the number of leading groups.  Used for questions such
as "owner who owns the most dogs" or "breed with the most dogs", returning only the
group's columns and never adding the ranking measure.  The ranking measure may
live on the group entity itself, on a directly related entity, or on a population
reached through a unique declared route of at most two relations (the route joins
are materialized in deterministic dependency order and never widen the group rows).

```json
{
  "op": "top",
  "measures": [],
  "dimensions": ["OwnerId", "OwnerFirstName", "OwnerLastName"],
  "filters": [],
  "ordering": [{"target": "Measure", "id": "DogCount", "direction": "Desc"}],
  "exists": [],
  "having": [],
  "limit": 1,
  "offset": null
}
```

### `exists`

Keeps only base rows (or the scalar count) having at least one matching related
record; each entry in `exists` becomes a related existence constraint.  A
`min_matches` of `n` keeps rows with at least `n` matching related records.  Used
for questions such as "professionals who have performed at least two treatments" or
"count of dogs that have received a treatment".

```json
{
  "op": "exists",
  "measures": [],
  "dimensions": ["ProfessionalId", "ProfessionalRole", "ProfessionalFirstName"],
  "filters": [],
  "ordering": [],
  "exists": [{"target": "Treatment", "min_matches": 2, "filters": []}],
  "having": [],
  "limit": null,
  "offset": null
}
```

### `absence`

Keeps only base rows (or the scalar count) having **no** matching related record.
Used for questions such as "count of owners with no dogs", "count of professionals
who performed no treatment", or "count of dogs that have not been treated".

```json
{
  "op": "absence",
  "measures": ["OwnerCount"],
  "dimensions": [],
  "filters": [],
  "ordering": [],
  "exists": [{"target": "Dog", "min_matches": null, "filters": []}],
  "having": [],
  "limit": null,
  "offset": null
}
```

### `set`

Combine exactly two compatible projections with a closed set operator.  `kind` is
`union`, `intersect`, or `except` (deduplicating).  `branches` has exactly two
objects; each branch is an explicit, closed shape with the same selected dimension
count/order (result column order is the requested branch order).  Supported
`shape` values:

- `row` — projected rows with row filters only (no related-existence constraints);
- `exists` — projected rows kept only when related records exist (with optional
  `min_matches`);
- `absence` — projected rows kept only when no related record exists.

Each branch carries `measures`/`dimensions`/`filters` and, for the `exists` and
`absence` shapes, `exists`/`having`.  Branches never carry local `ordering`,
`limit`, or `offset`, and unknown branch keys or shapes are rejected — they are
never silently dropped.

```json
{
  "op": "set",
  "kind": "union",
  "branches": [
    {
      "shape": "exists",
      "measures": [],
      "dimensions": ["ProfessionalFirstName"],
      "filters": [],
      "ordering": [],
      "exists": [{"target": "Treatment", "min_matches": 2, "filters": []}],
      "having": []
    },
    {
      "shape": "row",
      "measures": [],
      "dimensions": ["OwnerFirstName"],
      "filters": [],
      "ordering": [],
      "limit": null,
      "offset": null
    }
  ]
}
```

### `compare`

Row-level list whose base rows are kept only when a base attribute satisfies a
comparison against a scalar aggregate (count/min/max/avg/sum of a measure over its
population).  `comparisons` is an array of:

```json
{"attribute": "DogAge", "op": "gt", "measure": "AvgDogAge", "scope": []}
```

`attribute` is a numeric base-entity dimension, `op` is one of `eq`, `ne`, `gt`,
`ge`, `lt`, `le`, `measure` is an aggregate measure (count/min/max/avg/sum), and
`scope` (optional) is an array of filters that narrow the aggregate population to
that measure's entity.  The outer projection is independent: only the requested
list dimensions are returned.  This shape is numeric attribute-versus-scalar-
aggregate comparison only.  An outer-detail filter by an aggregate-ranked
categorical group (e.g. "rows whose group is the top-ranked group") is the separate
`ranked` shape below, not `compare`.

### `ranked`

Row-level detail request whose base rows are kept by comparing a categorical
attribute with the hidden top/bottom grouped key (the first group after ordering
groups by an aggregate).  The ranking measure never appears in the result and the
outer projection stays exactly as requested.  `ranked` is an array of:

```json
{
  "attribute": "DogBreedCode",
  "op": "eq",
  "group": "DogBreedCode",
  "measure": "DogCount",
  "direction": "Desc",
  "scope": []
}
```

`attribute` is an authorized pure-column dimension that belongs either to the
outer detail base entity or to a parent entity safely reachable from it (while the
requested detail `dimensions` determine the outer grain);
`group` is an authorized pure-column dimension of the inner population entity;
`measure` is a simple aggregate measure on that same inner population grain;
`direction` is `Asc` or `Desc`; `scope` (optional) narrows the inner population.
The rendered predicate is
`<outer> <op> (SELECT <group key> FROM <population> [WHERE <scope>] GROUP BY <group
key> ORDER BY <measure> <ASC|DESC> LIMIT 1)`.

When the outer attribute belongs to a safely reachable parent entity, the outer
plan carries the grain-safe parent join for the comparison column while the
detail projection stays exactly the requested dimensions (no extra columns).

`ranked` honors `output_order` exactly like `list`: keep `dimensions` in the
base-first order required for subject/grain resolution and put the user's column
order in `output_order` (every selected dimension exactly once).  The hidden
comparison attribute, grouping key, and ranking measure are never part of
`output_order`.  The rule applies equally to ascending and descending ranked
comparisons.

```json
{
  "op": "ranked",
  "measures": [],
  "dimensions": ["DogName"],
  "filters": [],
  "ordering": [],
  "exists": [],
  "having": [],
  "ranked": [
    {
      "attribute": "DogBreedCode",
      "op": "eq",
      "group": "DogBreedCode",
      "measure": "DogCount",
      "direction": "Desc",
      "scope": []
    }
  ],
  "limit": null,
  "offset": null
}
```

```json
{
  "op": "compare",
  "measures": [],
  "dimensions": ["DogName"],
  "filters": [],
  "ordering": [],
  "exists": [],
  "having": [],
  "comparisons": [
    {"attribute": "DogAge", "op": "gt", "measure": "AvgDogAge", "scope": []}
  ],
  "limit": null,
  "offset": null
}
```

## Resolver selection guidance (exact result shape)

The model keeps the result shape exactly as requested.  Follow these rules when
constructing intents:

1. **Hidden aggregate ranking.**  A measure used only to rank groups for a
   Top/Bottom selection is operational and hidden.  Do not put it in `measures` and
   do not expect it in the result — unless the question explicitly asks to display
   that count/total/average/minimum/maximum.  Use `top` for hidden group ranking
   (group rows only) and `aggregate` only when the measure itself is requested
   output.
2. **Exact projection.**  Select exactly the attributes the question names.  Never
   add the base entity's identity or name just because it determines the query
   grain or supplies a join path.
3. **Explicit output order.**  Keep `dimensions` in the base-first order needed for
   deterministic subject resolution, and put the user's stated column order in
   `output_order` (every selected dimension exactly once).  The result follows
   `output_order`.
4. **Code versus description.**  If the question names a stored code/id attribute
   (`DogBreedCode`), output the code; if it names the descriptive label
   (`BreedName`), output the description.  Never enrich a requested code into a
   description, and never replace a requested description with its code.
5. **Ambiguity.**  When ordinary wording is semantically ambiguous, prefer the
   literal declared domain concept.  Do not widen the projection by adding both
   alternatives; a diagnostic is better than extra columns.

Compact synthetic examples:

- *Hidden aggregate ranking* — "the owner who owns the most dogs" returns only the
  owner columns:
  ```json
  {"op":"top","measures":[],"dimensions":["OwnerId","OwnerFirstName","OwnerLastName"],
   "filters":[],"ordering":[{"target":"Measure","id":"DogCount","direction":"Desc"}],
   "exists":[],"having":[],"limit":1,"offset":null}
  ```
- *Cross-entity output order* — dog rows listed owner-name first:
  ```json
  {"op":"list","measures":[],"dimensions":["DogName","OwnerFirstName"],
   "filters":[],"ordering":[],"exists":[],"having":[],
   "output_order":["OwnerFirstName","DogName"],"limit":null,"offset":null}
  ```
- *Exact projection without base identity* — dog name with breed description:
  ```json
  {"op":"list","measures":[],"dimensions":["DogName","BreedName"],
   "filters":[],"ordering":[],"exists":[],"having":[],"limit":null,"offset":null}
  ```
- *Code versus description* — requesting the stored code keeps the code:
  ```json
  {"op":"list","measures":[],"dimensions":["DogName","DogBreedCode"],
   "filters":[],"ordering":[],"exists":[],"having":[],"limit":null,"offset":null}
  ```

## Failure behavior

An unknown measure/dimension/entity id, an operator or value kind the referenced
dimension does not support, an inconsistent shape (e.g., measures with `distinct`,
an empty row-level request, an `aggregate` without a visible measure, a `top` that
carries visible measures, a grouped `having` that references an unselected
measure, or an `output_order` that is not a permutation of the selected
dimensions), a `set` intent without exactly two compatible branches, a `set` branch
with an unknown `shape` or unknown keys, a `set` branch carrying local
ordering/limit/offset, a `compare` whose attribute or measure is unavailable for
the requested base entity, a `ranked` comparison whose attribute/group/measure are
unknown, unauthorized, mis-owned, or type-incompatible, and any other unsupported
combination fails atomically
with a deterministic diagnostic; no partial SQL or bindings are produced.  The
model never silently lowers an unknown or unsupported request to a nearby measure,
projection, or unrestricted query, and never drops an unsupported branch key or
shape.
