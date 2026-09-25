# Knowledge discovery

`knowledge::serve_value(payload, subject, domain, request)` is the pure
request/response boundary for a host-provided knowledge service. The host
binds a prepared Model, authorized subject, and domain name; no database
connection or SQL backend is required. The returned `std::value::Value` can
be serialized with `std::json::stringify`.

Requests have exactly `method` and `input`:

```json
{"method":"index.foo","input":{"offset":0,"limit":50}}
{"method":"doc.foo","input":{"topic":"Order status"}}
{"method":"doc.foo","input":{"target":{"kind":"dimension","owner":"order","id":"order_status"}}}
```

`foo` is the domain bound by the host, not a hard-coded Model name. The
index is ordered by Model declarations, contains every visible knowledge
point under at least its stable ID, and returns `entries` plus `next_offset`
(null at the end). Offset defaults to 0; limit defaults to 50 and must be
between 1 and 100. Offsets refer to the same prepared Model revision and
subject; a host should keep both stable across page requests.

`topic` compares Unicode codepoints exactly against declared IDs, labels,
aliases, and localized labels: no trimming, case folding, language guessing,
or fuzzy search. A document lookup returns `NotFound`, `Found(point)`, or
`Candidates(entries)` when the topic is ambiguous. Each candidate carries
its kind, owning dataset, stable ID, display label, and optional locale.
Follow a candidate or any point reference via `input.target`. Target kinds
are `dataset`, `field`, `dimension`, `measure`, `value`, `relation`,
`business_link`, `time_role`, and `metric`. The `owner` is empty for datasets;
for canonical values it is their dimension ID, otherwise their dataset ID.
Unknown and invisible targets both return `NotFound`.

Responses use Telora's `codec::encode` representation: `{"Index":{...}}`
or `{"Document":{"Found":{...}}}`, `{"Document":{"Candidates":[...]}}`,
and `{"Document":"NotFound"}`. A point carries typed details and references
marked `Member`, `Traversable`, or `Related`. `Related` is documentation-only;
it cannot establish a query edge. A relation's named endpoints, kind, and
shape, a dataset's grain, and a time role's semantics, encoding, and
authoritativeness come from the same prepared Model used for query lowering.
`@doc` only changes explanatory text; it cannot grant visibility or create a
query relation. Field points are limited to fields declared as grain, time
roles, visible dimensions, measures, or metrics: a private physical column
alone does not become a knowledge point.

Requests with unknown keys, conflicting topic/target, wrong types, invalid
pagination, or another domain's method fail with a structured diagnostic.
Authorization is checked when generating the map, including direct target
lookups; the host must not share an authorized response with another subject.
