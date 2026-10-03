# Half-open value domains

A half-open domain has a declared set of known business concepts and an
unrecognized branch retaining the original string. Each known concept may
have several explicitly declared physical wires. This corresponds to an enum
with known variants and `Unknown(String)`; a business concept called Other is
still a known variant.

```telora
@edsl::dimension("device_class", True, True,
    [edsl::FilterOp::Eq, edsl::FilterOp::Ne], [edsl::FilterInputKind::Text])
@edsl::canonical_values([
    {id: "LoadBalancer", label: "Load balancer", wires: [
        edsl::FilterInput::Text("lb"),
        edsl::FilterInput::Text("ne.category.lb")
    ]},
    {id: "Other", label: "Other device", wires: [edsl::FilterInput::Text("other")]}
])
@edsl::half_open()
classification: String,
```

This declaration currently requires a plain String dimension with nonempty
`canonical_values`. Known IDs are distinct and their physical wire sets are
disjoint. Wires are exact, case-sensitive values; there is no implicit prefix,
spelling or label normalization. An undeclared wire equal to a known business
ID is still Unknown. An empty stored string is also Unknown unless the model
changes its storage contract; NULL is missing, not an unknown string.

The model decides whether a domain is half-open. Preparation and query
generation never sample stored data to infer this decision.

## Inputs

An Agent resolves natural language through discovery to a listed business ID.
Known inputs retain the ordinary JSON string form. Unknown inputs must carry
an explicit tag; an unlisted untagged string fails instead of guessing.

| Intent `value` | Meaning |
| --- | --- |
| `"LoadBalancer"` | Known concept, matching `lb` or `ne.category.lb` |
| `{"unknown":"future-device"}` | One exact unrecognized physical wire |
| `{"unknowns":true}` | Every non-NULL wire outside all known concepts |

Eq and Ne are supported. Ne is the complement over non-NULL values, including
both known and unknown branches. Thus Ne LoadBalancer includes unknowns;
Ne Unknowns selects all known wires. A tagged Unknown naming a known physical
wire is rejected. Unknown objects must contain exactly one tag.

`any_of` accepts the same inputs, including mixed known and unknown values.
Typed model predicates use `FilterInput::Unknown(raw)` and
`FilterInput::Unknowns`. All physical values are bound parameters.

## Results

SQL has scalar result columns, so a half-open selection produces two columns:

| `<node>_<dimension>` | `<node>_<dimension>__kind` | Interpretation |
| --- | --- | --- |
| `LoadBalancer` | `Known` | A normalized known business ID |
| `LoadBalancer` | `Unknown` | The unrecognized original wire with this spelling |
| `future-device` | `Unknown` | Another original unrecognized wire |
| NULL | NULL | Missing value |

Both columns participate in grouping and row DISTINCT. Known aliases collapse
to one concept; unknowns group by original wire. Selecting a half-open domain
does not add a closed-domain guard, so unknown and missing rows remain present.
Consumers must retain the kind column to interpret the value correctly.
GraphPair retains each selected side's kind column as display payload.
Alignment compares explicitly aligned complete identities using NULL-safe
equality; display value and kind never become identity keys.

`count_value` counts distinct known IDs plus distinct unknown raw strings.
NULL contributes to neither count. The two counts are internal aggregate
dependencies; the public result remains one count column. This requires Add
in the query profile. Half-open projection/filtering additionally requires
Not, IsNotNull, And and Or alongside the existing canonical capabilities.

A closed `canonical_order` cannot rank arbitrary unknown strings. Preparation
rejects combining it with `half_open`; consequently business ordering and
Top-N ranking by this dimension are unavailable until an unknown-ordering
policy is explicitly modeled. Ordering by another projected dimension works.

Discovery exposes `half_open`, known `values`, and `value_contract` on dimension
documents. The shared filter syntax documents the tagged inputs. Closed
canonical domains retain their existing behavior.
