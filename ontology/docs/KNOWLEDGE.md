# Knowledge discovery

`knowledge::knowledge_service_factory(payload, subject, domain)` binds a
prepared Model, authorized subject, and domain name and returns a pure
`Fn(Value) -> Value` request handler. `knowledge::serve_value` is the
equivalent unbound entry. No database connection or SQL backend is required.
The response can be serialized with `std::json::stringify`.

An entry `MainService` mounts a `TransformService` slot for `<domain>/info`.
Telora's collection routes by method and passes only `input` to the selected
slot. Use `knowledge::knowledge_info_method_factory(payload, subject)` in its
`init`; it does not expect an envelope inside `transform`. The deployed
example domains mount `<domain>/info` and `<domain>/transform`. The ic model
uses its own entry, while dog, spider, and world share `example_models`.
No second copy of any Model is needed.
The model-independent build, service, and agent workflow is in
[USAGE.md](../../USAGE.md).

Requests have exactly `method` and `input`:

```json
{"method":"foo/info","input":{"key":"index"}}
{"method":"foo/info","input":{"key":"<returned key>"}}
```

`foo` is the domain bound by the host, not a hard-coded Model name. The
index topic is ordered by Model declarations and contains every visible knowledge
node exactly once as `{key,type,description}` in its `detail.entries` field. It is
one complete flat list, without pagination or a cursor.

`info` looks up a unique key and returns `Found(node)` or `NotFound`. Pass a
key from the index or a node's `links[].key` to `input.key` unchanged.
Labels, aliases and localizations are descriptions, not lookup keys.
Keys are opaque path-like strings: their internal encoding is not a parsing
contract. Do not construct keys from names, IDs or response types. Unknown
and invisible keys both return `NotFound`.

Responses use Telora's `codec::encode` representation:
`{"Document":{"Found":{...}}}` or `{"Document":"NotFound"}`. The Found
node has exactly `{key,type,description,links,detail}`. `description` contains
label, aliases, localized text and summary; `links` contains `{type,key}` pairs.
Node types include `Index`, `Terminology`, `Schema`, `Dataset`, `Field`, `Dimension`,
`Measure`, `Value`, `Relation`, `BusinessLink`, `TimeRole`, and `Metric`.
The response type determines `detail`: Index has `entries`; Dataset has `id`,
grain and time roles; Field has `id` and `dataset`; Value has its canonical `id`
and `dimension`. Other domain nodes preserve their corresponding Model brief;
Metric and TimeRole also identify their owning dataset, and BusinessLink has
`id`, `hub`, `direction`, and `guard`. Business IDs are explicit Model data,
not something consumers should recover by parsing a knowledge key.
References are marked `Member`, `Traversable`, or `Related`. `Related` is documentation-only;
it cannot establish a query edge. A relation's named endpoints, cardinality, and
shape, a dataset's grain, and a time role's semantics, encoding, and
authoritativeness come from the same prepared Model used for query lowering.
`@knowledge_doc(target, text)` only changes explanatory text; it cannot grant visibility or create a
query relation. Field points are limited to fields declared as grain, time
roles, visible dimensions, measures, or metrics: a private physical column
alone does not become a knowledge point. A field ID is not automatically a
queryable dimension ID; only a declared dimension can be used for projection
or filtering in a strict query intent. A UTC time role tells the agent which
clock and encoding the Model declares, but does not itself validate arbitrary
timestamp literals or convert local calendar time to UTC (the separate time
semantics contract in issue #11 covers those operations).

Dimension detail includes `input_kinds` and `input_docs` (entries with `kind`
and `text`). Input documentation comes from `@doc(text)` on the corresponding
`FilterInputKind` variant. `Utc1` documents the accepted UTC text format and a
copyable example once; every dimension using it exposes that same description.
The annotation supplies explanatory text and does not change input validation.

The formal domain concepts are the knowledge nodes listed in `Index`.
`Terminology` (key `"terminology"`) is supplemental language assistance, not a
second concept system. It has `detail.entries` of `{term,description,key}`. Entries derive from
existing alias/localization properties and optional entity-level
`@term(term, description, target)` annotations. A term can associate with
multiple nodes; this is discovery information, not an assertion of synonymy.
Explicit annotations describe a point owned by the declaring entity and take
precedence over an automatically derived alias for the same term and target.
Hidden targets and their terms are excluded. Terminology links never create a
query relationship or change an Intent's legality. The agent interprets these
associations; no automatic substitution occurs. Intent accepts only the
Model-defined canonical business IDs, never aliases or terminology terms.

Requests with unsupported fields, a missing or malformed key, wrong types, or
another domain's method fail with a structured diagnostic. Authorization is
checked when generating the index and resolving keys; the host must not share
an authorized response with another subject.
The request envelope and info input are decoded from declared records;
shape diagnostics include the offending JSON path and an `info` key for the
corresponding contract (`syntax/knowledge/request` or `syntax/knowledge/info`).

## Generic HTML map

The exporter starts at `index` and follows opaque link keys through the info
endpoint. It requires no domain-specific IDs or key parsing. The renderer
consumes the resulting node array, escapes text and URL-encodes link keys,
and rejects duplicate keys or dangling references:

```sh
node ontology/tools/knowledge-export.mjs http://127.0.0.1:8080/foo/info > /tmp/foo-knowledge.json
node ontology/tools/knowledge-html.mjs /tmp/foo-knowledge.json > /tmp/foo-knowledge.html
```

The static HTML is a view of the same authorized knowledge map, not a separate
Model. Its file must be shared only with subjects allowed to see that map.
