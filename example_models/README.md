# Example model service

`example_models` packages the dog, spider, and world models in one Telora
service collection. Each model keeps its own knowledge and lowering rules:

| Model | Knowledge | Query |
| --- | --- | --- |
| Dog | `dog/info` | `dog/transform` |
| Spider | `spider/info` | `spider/transform` |
| World | `world/info` | `world/transform` |

`<model>/transform` receives `{ "intents": [<Intent>, ...] }` with one to five
independent Intents. It returns indexed diagnostics for every item; `queries`
contains the ordered Queries only when all Intents are accepted. Request `ctx`
and a single `intent` key are not supported.
`<model>/info` accepts `{ "key": {"kind":"Schema","owner":"","id":"index"} }`
to return the complete flat catalog, or another exact key for one knowledge
point. The ic model has the same two
routes under `ic/` in its own `icloud_model` entry.
All domains use the same [service and agent guide](../USAGE.md) with their
domain name and the separate Intent contract supplied by the host.
