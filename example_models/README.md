# Example model service

`example_models` packages the dog, spider, and world models in one Telora
service collection. Each model keeps its own knowledge and lowering rules:

| Model | Index | Detail | Query |
| --- | --- | --- | --- |
| Dog | `dog/index` | `dog/info` | `dog/transform` |
| Spider | `spider/index` | `spider/info` | `spider/transform` |
| World | `world/index` | `world/info` | `world/transform` |

`<model>/transform` receives `{ "intents": [<Intent>, ...] }` with one to five
independent Intents. It returns indexed diagnostics for every item; `queries`
contains the ordered Queries only when all Intents are accepted. Request `ctx`
and a single `intent` key are not supported.
`<model>/index` accepts `{ "offset": 0, "limit": 50 }` (or `{}`) for the
paginated knowledge index. `<model>/info` accepts `{ "topic": "..." }` or
`{ "target": ... }` for one knowledge point. The ic model has the same three
routes under `ic/` in its own `icloud_model` entry.
All domains use the same [service and agent guide](../USAGE.md) with their
domain name and the separate Intent contract supplied by the host.
