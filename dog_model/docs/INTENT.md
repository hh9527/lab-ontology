# Dog model query interface

The dog model is served as `dog/index`, `dog/info`, and `dog/transform` by
[`example_models`](../../example_models/README.md). Its domain vocabulary is
declared in [DOMAIN.md](DOMAIN.md); the current service envelope and shared
`graph` / `graph_pair` / `graph_union` Intent contract are in
[USAGE.md](../../USAGE.md). This file does not define a separate dog-specific
Intent syntax.

Discover stable dataset, dimension, measure, value, and relation IDs through
`dog/index` and `dog/info` before constructing a graph. A node's `entity` is
the dataset ID, and an edge's `relation` is a named Model relation ID; neither
is a physical SQL name. For example, the Model declares `Dog` as a dataset,
while a particular graph node may name that dataset instance `dog`. Related
breeds, owners, treatments, and professionals must be reached through their
declared named relations. The Model and lowering determine which traversals
preserve the requested grain and which one-to-many qualifications need
correlated `exists`.

Submit one to five independent Intents as `{"intents":[...]}`. Successful
batch lowering returns ordered parameterized Queries; any rejected item has
an indexed diagnostic and prevents release of partial Queries. Relative time
must be resolved by the caller before submission. SQL and bindings are for
the authorized execution layer, not a business answer by themselves.
