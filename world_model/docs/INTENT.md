# World model query interface

The world model is served as `world/info` and `world/transform` by
[`example_models`](../../example_models/README.md).
Its domain vocabulary is described in [DOMAIN.md](DOMAIN.md). The shared
service envelope and `graph` / `graph_pair` / `graph_union` Intent syntax are
in [USAGE.md](../../USAGE.md); this model does not retain a separate
`list/count/set/compare` request contract.

Use the index topic at `world/info`, then exact keys to discover dataset, dimension, measure,
value, and relation IDs before constructing an Intent. A graph traversal uses
named Model relations between dataset instances, not SQL joins supplied by
the caller. The Model's declared identity and relation grain determine
whether a projection, aggregate, or existence qualification is legal.

`world/transform` accepts `{"intents":[...]}` with one to five independent
Intents. It returns indexed statuses for every item and releases ordered,
parameterized Queries only if all items lower successfully. A multi-Intent
batch does not combine result sets; `graph_union` is the separate single-Intent
form for a supported deduplicated entity set.
