# Time inputs and physical encodings

Time dimensions have a declared logical input kind and a physical column
encoding. A physical `String` or `Int` does not grant permission to compare a
time dimension with an ordinary text or integer intent value. The ontology
checks the kind and the Model's time role before encoding the bound SQL value.
Relation keys likewise reject comparisons between a declared time field and a
plain field, or between different time encodings.

| Input kind | Declared encoding | Physical binding | Accepted spelling |
| --- | --- | --- | --- |
| `date` | `DateText` | String | Valid `YYYY-MM-DD` |
| `rfc3339` | `Rfc3339Text` | String | UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `utc_second` | `CanonicalUtcSecondText` | String | UTC `YYYY-MM-DD HH:MM:SS` |
| `local_datetime` | `LocalText` | String | Local `YYYY-MM-DD HH:MM:SS` |
| `epoch_millis` | `UtcEpochMillis` or `LocalEpochMillis` | Int | Unix epoch milliseconds |

The RFC3339 input currently accepts only normalized UTC seconds: offsets and
fractions must be resolved outside ontology before binding. Fixed-width,
normalized UTC text preserves chronological ordering under raw-column string
comparison. `LocalEpochMillis` retains its historical Model name; its integer
value is still an epoch-millisecond time value, not an ordinary integer. Local
wall-clock text is distinct from an instant and cannot form a time window
without externally resolving its timezone and ambiguous local times.

Graph intents accept `time_windows` both at the root and within `exists`:

```json
"time_windows": [{
  "node": "sample", "dimension": "sample_time",
  "start": {"kind": "epoch_millis", "value": 1727308800000},
  "end": {"kind": "epoch_millis", "value": 1727395200000}
}]
```

An external caller resolves relative/calendar requests to typed boundaries.
The window is `[start, end)`, both endpoints are validated against the same
declared time dimension, and the resulting SQL compares the original column
with two allocated bindings (`>= start AND < end`). No database `now()` or
column-side time transformation is used.

An intent may use `{"ctx":"now"}` for either boundary when a trusted caller
passes a `time::RequestContext` to `query_intent_ast_factory_with_context` or
`query_intent_lower_factory_with_context`. `request_context(now)` validates
that the supplied value is an absolute request clock, not a local wall time
or calendar date. The supplied encoding must match the target field; a request
clock in UTC text cannot silently become epoch milliseconds. One context is
captured outside ontology per request and reused throughout the lowering,
including `exists` subgraphs and both operands of `graph_pair`. Without a
context, `ctx.now` fails; the existing context-free factories never read a
system or database clock.

Telora's transform-service initialization context is long-lived, not a
per-request clock. The current model services still expose context-free
factories; a trusted platform adapter must call the context-aware factory for
each request when it offers `ctx.now`. Named timezones, calendar arithmetic,
normalization across encodings, and column-side calendar calculations remain
outside this initial contract.
