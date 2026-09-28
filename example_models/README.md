# Example model service

`example_models` packages the dog, spider, and world models in one Telora
service collection. Each model keeps its own knowledge and lowering rules:

| Model | Query | Knowledge |
| --- | --- | --- |
| Dog | `dog/transform` | `dog/doc` |
| Spider | `spider/transform` | `spider/doc` |
| World | `world/transform` | `world/doc` |

`<model>/transform` receives `{ "intent": ..., "ctx": ... }`; `ctx` is optional.
`<model>/doc` accepts `{ "topic": "..." }` or `{ "target": ... }` for a
knowledge point, and `{ "offset": 0, "limit": 50 }` (or `{}`) for the
paginated knowledge index. The ic model remains in its own `icloud_model`
entry with `ic/transform`, `ic/info`, and `ic/index`.
