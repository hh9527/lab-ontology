# Spider model query interface

The spider model is served as `spider/index`, `spider/info`, and
`spider/transform` by [`example_models`](../../example_models/README.md).
Its domain vocabulary is described in [DOMAIN.md](DOMAIN.md). The current
service envelope and shared `graph` / `graph_pair` / `graph_union` Intent
contract are in [USAGE.md](../../USAGE.md); there is no spider-specific
parser or legacy `list/count/aggregate` request path.

Use `spider/index` and `spider/info` to find the Model's exact stable IDs,
declared grain, named relations, dimensions, measures, and permitted filters.
A graph names dataset instances in `nodes` and explicitly names authorized
relations in `edges`. It may qualify a root through `exists` without
multiplying that root's rows. Physical tables and columns, labels, and aliases
are not substitutes for stable IDs in an Intent.

`spider/transform` accepts only `{"intents":[...]}` with one to five
independent Intents. It checks every item, returning ordered Queries only
when all items succeed. Dynamic data remains in bindings, not SQL text.
The service does not execute the Queries or merge their results.
