# Knowledge discovery

`knowledge::knowledge_service_factory(payload, domain)` binds a
prepared Model and domain name and returns a pure
`Fn(Value) -> Value` request handler. `knowledge::serve_value` is the
equivalent unbound entry. No database connection or SQL backend is required.
The response can be serialized with `std::json::stringify`.

An entry `MainService` mounts a `TransformService` slot for `<domain>/info`.
Telora's collection routes by method and passes only `input` to the selected
slot. Use `knowledge::knowledge_info_method_factory(payload)` in its
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
index topic contains five discovery routes: datasets, relations, terminology,
data types and query contracts. Index and Directory detail.entries enumerate
`{key,type,label}` children; relation entries additionally carry from/to Dataset
keys. Large directories split deterministically into binary branches with at most
12 entries per leaf. Each list is complete, with no cursor or silent truncation.
Entry keys naming a Directory lead to children; other entries name members.
Dataset links lead to their member directory; values are discovered from dimensions.
No visible node depends on having a business relationship to be discoverable.
Directory detail.total counts leaf entries in that subtree, not synthetic
directory nodes. Index total is its five top-level routes; its `detail.revision`
is the Prepared Model revision used by snapshot publication checks. Terminology total
counts expression-to-target associations, not distinct words or concepts.
Counts cover only visible knowledge. There is no extra done/next/has_more flag.

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
Node types include `Index`, `Directory`, `DataType`, `Terminology`, `Schema`, `Dataset`, `Field`, `Dimension`,
`Measure`, `Value`, `Relation`, `BusinessLink`, `TimeRole`, and `Metric`.
The response type determines `detail`: Index and Directory have `entries`; DataType
has its logical type `id` and a description of its value domain and restrictions.
Logical capabilities do not grant field authorization. Dataset has `id`,
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

Dataset detail also has `references: [{id,fields}]` (alternative complete
unique addresses) and `field_roles: [{field,roles}]`. Field detail has `roles`
and `reference_ids`. Roles are Appellation, Reference, Classification and
Metric; they do not grant query access. Reference membership derives from
type-level declarations, and formal metrics derive Metric. Hidden fields and
incomplete visible references are excluded. Dataset links lead to the shared
`syntax/model/field_roles` contract. See [FIELD-ROLES.md](FIELD-ROLES.md).

For repeated typed lookups, `knowledge_lookup_factory(payload)` prepares one
catalog and returns `Fn(KnowledgeTarget) -> DocResult`, with the same documents
and visibility as `by_target(payload, target)`. The service factories already
prepare their catalog once. This avoids rebuilding the full index per lookup.

The formal domain concepts are the knowledge nodes discovered through the directory tree.
The terminology route is supplemental language assistance, not a second concept
system. Its bounded tree has Directory branches with entries `{key,type,label}`
and Terminology leaves with entries `{term,description,key}`. Empty entries is a complete empty list;
leaves have no child directories. Entries derive from
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
another domain's method fail with a structured diagnostic. Model-declared
dimension visibility is checked when generating the index and resolving keys.
Identity authentication and access control belong to the host.
The request envelope and info input are decoded from declared records;
shape diagnostics include the offending JSON path and an `info` key for the
corresponding contract (`syntax/knowledge/request` or `syntax/knowledge/info`).

## Generic HTML map

The exporter starts at `index` and follows directory entries (including relation
endpoints), terminology targets, and semantic link keys through the info
endpoint. It requires no domain-specific IDs or key parsing. The renderer
consumes the resulting node array, escapes text and URL-encodes link keys,
and rejects duplicate keys or dangling references:

```sh
node ontology/tools/knowledge-export.mjs http://127.0.0.1:8080/foo/info > /tmp/foo-knowledge.json
node ontology/tools/knowledge-html.mjs /tmp/foo-knowledge.json > /tmp/foo-knowledge.html
```

This replaces the former full flat `index` response. Consumers must follow
`detail.entries` as well as semantic `links`; consumers that only followed links
must migrate with the new snapshot. There is no legacy full-list endpoint.
Directory keys name nodes in the current model, not revision-bound cursors.
If a model is refreshed, restart discovery at index rather than retaining a
directory position; revision/digest negotiation is a separate concern.

The static HTML is a view of the same visible knowledge map, not a separate
Model. Access to the artifact is controlled by the host.

## Field nullability

Field detail publishes `nullable`, derived from `Option(T)`. Reference
uniqueness applies to complete non-NULL tuples; any missing member makes the
reference unavailable. This does not imply a total query grain or primary key.

Field detail also publishes an optional explicit `logical_type` (Text or
Ipv4); null means no explicit logical_type annotation, not proof of Text
semantics. Time semantics continue to be described by TimeRole documents.
Annotated fields link to the shared logical-types contract. Dimension ops
describe field capabilities, while input_kinds/input_docs describe accepted
logical values; neither is inferred from a SQL column name.

DataType links also discover supported operation contracts: comparisons, text
matching, IPv4 subnet membership, and TimeWindow for temporal types. Operations
reuse Schema nodes; no new request method or key parsing convention is needed.
These type-level links do not grant a field any capability: inspect its declared
ops, filterable flag and time role. TimeWindow centralizes inclusive start,
exclusive end, an optional unbounded end and the absence of an implicit clock.
