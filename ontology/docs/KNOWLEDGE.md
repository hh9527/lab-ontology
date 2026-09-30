# Knowledge discovery

`knowledge::knowledge_service_factory(payload, subject, domain)` binds a
prepared Model, authorized subject, and domain name and returns a pure
`Fn(Value) -> Value` request handler. `knowledge::serve_value` is the
equivalent unbound entry. No database connection or SQL backend is required.
The response can be serialized with `std::json::stringify`.

An entry `MainService` can mount separate `TransformService` slots for
`<domain>/info` and `<domain>/index`. Telora's collection routes by method and
passes only `input` to the selected slot. Use
`knowledge::knowledge_info_method_factory(payload, subject)` and
`knowledge::knowledge_index_method_factory(payload, subject)` in the respective
slots' `init`; neither expects an envelope inside `transform`. The deployed
example domains mount `<domain>/index`, `<domain>/info`, and `<domain>/transform`. The ic model
uses its own entry, while dog, spider, and world share `example_models`.
No second copy of any Model is needed.
The model-independent build, service, and agent workflow is in
[USAGE.md](../../USAGE.md).

Requests have exactly `method` and `input`:

```json
{"method":"foo/index","input":{}}
{"method":"foo/info","input":{"key":{"kind":"Dimension","owner":"order","id":"order_status"}}}
```

`foo` is the domain bound by the host, not a hard-coded Model name. The
index is ordered by Model declarations and returns every visible knowledge
point exactly once as `{key,label,aliases,summary}`. It is one complete flat list,
without pagination or a cursor.

`info` looks up a unique key and returns `Found(point)` or `NotFound`. Pass a
key from the index or a point reference's `target` to `input.key` unchanged.
Labels, aliases and localizations are descriptions, not lookup keys.
Target kinds use the declared enum spelling: `Schema`, `Dataset`, `Field`,
`Dimension`, `Measure`, `Value`, `Relation`, `BusinessLink`, `TimeRole`, and
`Metric`. The `owner` is empty for datasets;
for canonical values it is their dimension ID, otherwise their dataset ID.
Unknown and invisible targets both return `NotFound`.

Responses use Telora's `codec::encode` representation: `{"Index":{"entries":[...]}}`
or `{"Document":{"Found":{...}}}` and `{"Document":"NotFound"}`.
A point carries typed details and references
marked `Member`, `Traversable`, or `Related`. `Related` is documentation-only;
it cannot establish a query edge. A relation's named endpoints, kind, and
shape, a dataset's grain, and a time role's semantics, encoding, and
authoritativeness come from the same prepared Model used for query lowering.
`@doc` only changes explanatory text; it cannot grant visibility or create a
query relation. Field points are limited to fields declared as grain, time
roles, visible dimensions, measures, or metrics: a private physical column
alone does not become a knowledge point. A field ID is not automatically a
queryable dimension ID; only a declared dimension can be used for projection
or filtering in a strict query intent. A UTC time role tells the agent which
clock and encoding the Model declares, but does not itself validate arbitrary
timestamp literals or convert local calendar time to UTC (the separate time
semantics contract in issue #11 covers those operations).

Requests with unsupported fields, a missing or malformed key, wrong types, or
another domain's method fail with a structured diagnostic. Authorization is
checked when generating the index and resolving keys; the host must not share
an authorized response with another subject.
The request envelope and both method inputs are decoded from declared records;
shape diagnostics include the offending JSON path and an `info` key for the
corresponding contract (`syntax/knowledge/request`, `syntax/knowledge/index`,
or `syntax/knowledge/info`).
