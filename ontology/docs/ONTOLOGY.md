# Ontology model and lowering

This is the current model-author contract for the `ontology` crate. The
external service protocol and complete JSON Intent syntax are in
[USAGE.md](../../USAGE.md); knowledge lookup is in [KNOWLEDGE.md](KNOWLEDGE.md).
The source of truth for declaration signatures is
[`ontology.telora`](../src/ontology.telora), not an independently maintained
list of decorator parameters here.

## One model, two uses

A domain defines typed datasets, dimensions, measures, values, time roles, and
named relationships in a Telora module, then prepares them once with
`edsl::build_root(revision, entity_types, profile)`. The resulting
`PreparedPayload` is shared by query lowering and knowledge discovery. For a
small complete declaration, see [`relation_model`](../../relation_model/src/model.telora);
for a service mounting the same payload under knowledge and query methods, see
[`example_models`](../../example_models/src/lib.telora).

```telora
use ontology::ontology as edsl;
use ontology::intent as intent;
use ontology::knowledge as knowledge;
use ontology::sqlite as sqlite;
use std::value::{ Value };

# `payload` is the domain's PreparedPayload.
def lower: Fn(Value) -> Value =
    intent::query_request_method_factory(payload, "public", sqlite::build_query);
def info: Fn(Value) -> Value =
    knowledge::knowledge_info_method_factory(payload, "public");
```

The selected SQL backend is supplied when constructing the lowering function.
The request itself does not choose a backend. An entry service passes only its
slot input to each method; the host's JSONL envelope selects the slot. Both
SQLite and PostgreSQL have `build_query(QueryAst)` renderers, while
[DIALECT-CONTRACT.md](DIALECT-CONTRACT.md) records the execution-equivalence
work still needed before declaring full cross-dialect support.

## Model declarations

Attribute business roles and named unique reference sets are described in
[FIELD-ROLES.md](FIELD-ROLES.md). They enrich discovery independently of query
permissions, keys, grain and aggregate rules.

- `@entity_id` and `@entity_source` name a dataset and its trusted physical
  source. `@dataset` can declare its kind and full identity grain; `@key()` is
  also used by models without an explicit dataset grain.
- `@dimension`, `@measure`, and related annotations publish queryable
  capabilities. A physical field is not automatically a visible or filterable
  dimension. The declared operators and input kinds constrain Intent values.
- Canonical values map source encodings to stable business IDs. Labels and
  aliases aid discovery; a Query Intent still uses stable IDs.
  `@half_open()` adds an explicit Unknown branch retaining unrecognized strings;
  see [HALF-OPEN.md](HALF-OPEN.md) for tagged inputs, result columns and grouping.
- Named relation declarations include endpoint types, join keys, and a
  `RelationCardinality {from,to}`. Each endpoint specifies how many records on
  that side match one record on the other side: `One` (1..1), `Optional` (0..1),
  `Many0` (0..N), or `Many1` (1..N). For Device -> Site, `{from: Many0, to: One}`
  means each device has exactly one site and each site has zero or more devices.
  Cardinality is a trusted Model contract, independent of the Eq/And/Or key.
  A forward traversal reads `to`; a reverse traversal reads `from`. `One` and
  `Optional` preserve grain, including on an Or key; both Many variants may
  multiply rows. Preparation checks fields, scalar/time types and guards, but
  does not re-prove cardinality from identity keys or inspect runtime data.
  The lower bound documents required participation; it does not rewrite joins
  or suppress filters. Inner joins still select matching records, while the
  existing `include_empty` mode determines left-join behavior.
  Entity identities remain necessary for identity grouping, entity counts and
  set-result alignment. Business-link endpoint identity comparisons still
  require complete participant keys. A business link can mark endpoint roles
  as directed or undirected; a physical A/Z storage position alone does not
  imply business direction.
- `@knowledge_doc`, `@term`, descriptions, labels, localized text, and references enrich the
  knowledge map without granting query access or creating traversal edges.
  Only a declared relation or business link authorizes graph traversal.
- Time roles declare logical type and physical encoding. The caller supplies
  concrete time boundaries; see [TIME.md](TIME.md).

`build_root` validates declarations and produces the prepared vocabulary used
by both `info` (starting at key `index`) and `transform`. Dimension visibility
is declared by the model; caller authentication belongs to the host. Model annotations determine
which business meanings are legal; neither an Intent nor a renderer may add
undeclared semantics.

## Lowering boundary

The public service accepts one to five independent `Graph`, `GraphPair`, or
`GraphUnion` Intents under `{"intents":[...]}`. It processes each item in its
own diagnostic scope. The batch is accepted only when all items lower; on any
item failure, `queries` is null and every item has an indexed status. Multiple
Intents are separate plans, not a SQL union. `GraphUnion` is one Intent that
produces one deduplicated result set under its own stricter shape rules.

Internally, `query_intent_ast_factory(payload)` returns a function
from one Intent to a validated `QueryAst`. The direct
`query_intent_lower_factory(payload, to_query)` adds one backend
renderer. `query_request_method_factory(payload, to_query)` is the
batch-aware service boundary used by the example and icloud entries. These
factories are distinct: the direct factories do not parse the service request
object, while the method factory does.

Graph nodes name instances of datasets. Edges name declared relations and
connect those instances. `exists` qualifies an outer population without
multiplying its rows. Graph projections, aggregates, grouping, ordering, and
time windows are admitted only when their Model-backed grain and capabilities
can be proved. Failure is a structured diagnostic, never a license to choose
an arbitrary join or silently change the requested population. Accepted
lowering proves that the submitted Intent is legal under the Model; it does
not prove the Agent interpreted the user's natural-language question correctly.

The Intent parser and lowering implementation are in
[`intent.telora`](../src/intent.telora); model-backed graph validation is in
[`ontology.telora`](../src/ontology.telora). Keep examples of the external
Intent shape in [USAGE.md](../../USAGE.md), so this document does not create a
second JSON protocol.
