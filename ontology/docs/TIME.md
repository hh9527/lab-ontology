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

The transform service receives a request envelope with an `intent` and an
optional `ctx`. The caller supplies the request clock explicitly:

```json
{
  "intent": {
    "op": "graph", "root": "dog",
    "nodes": [{"id": "dog", "entity": "dog"}], "edges": [],
    "select": [{"node": "dog", "dimension": "created_at"}],
    "time_windows": [{
      "node": "dog", "dimension": "created_at",
      "start": {"kind": "rfc3339", "value": "2025-01-01T00:00:00Z"},
      "end": {"kind": "now"}
    }]
  },
  "ctx": {"now": {"kind": "rfc3339", "value": "2025-01-02T08:15:00Z"}}
}
```

An intent may use `{"kind":"now"}` for either time-window boundary. The
request context is validated as an absolute instant, not a local wall time
or calendar date. Its encoding must match the target field; a request clock
in UTC text cannot silently become epoch milliseconds. One request context
is reused throughout lowering, including `exists` subgraphs and both operands
of `graph_pair`. When `now` is referenced but absent, lowering fails. Neither
the service nor the context-free factories read a system or database clock.

`{"kind":"now","as":"rfc3339"}` and `{"kind":"now","as":"utc_second"}`
explicitly convert between the two validated UTC-second text spellings,
preserving the instant and binding the converted value. This is not a timezone
conversion; epoch milliseconds cannot use this text-spelling conversion.

Telora's transform-service initialization context is long-lived; the clock
comes from each request envelope. Named timezones, calendar arithmetic,
normalization across encodings, and column-side calendar calculations remain
outside this initial contract.
