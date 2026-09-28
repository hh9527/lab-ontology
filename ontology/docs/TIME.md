# Time inputs and physical encodings

Time dimensions have a declared logical input type and a physical column
encoding. A physical `String` or `Int` does not grant permission to compare a
time dimension with an ordinary text or integer value. The ontology uses the
Model's time role to type-check each intent value before binding it to SQL.
Relation keys likewise reject comparisons between a declared time field and a
plain field, or between different time encodings.

| Logical input | Declared encoding | Physical binding | Accepted spelling |
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
  "start": 1727308800000,
  "end": 1727395200000
}]
```

The window is `[start, end)`. Both endpoints are interpreted according to the
declared time dimension, and SQL compares the original column with two allocated
bindings (`>= start AND < end`). No database `now()` or column-side time
transformation is used.

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
      "start": "2025-01-01T00:00:00Z",
      "end": "now"
    }]
  },
  "ctx": {"now": 1735805700000, "tz": 480}
}
```

`ctx.now` is a Unix epoch millisecond integer. `ctx.tz` is an optional fixed
offset in minutes east of UTC, constrained to +/-840. It is validated now and
reserved for future local calendar calculations; UTC instant conversion does
not use it. Named zones and daylight saving are not yet supported. An intent
uses `"now"` in a time-window endpoint or time-dimension filter to refer to
that request clock. The Model's time role
determines whether it binds as epoch milliseconds, normalized RFC3339 UTC
seconds, or canonical UTC-second text. A date or local-wall-clock field does
not currently accept `now`. One request context is reused throughout lowering,
including `exists` subgraphs and both operands of `graph_pair`. When `now` is
referenced but absent, lowering fails. Neither the service nor the
context-free factories read a system or database clock.

For a whole-second text column, comparisons round the millisecond request
clock to preserve the comparison over second-aligned values: `>=` and `<` use
the ceiling whole second, while `>` and `<=` use the floor whole second.
Equality against a fractional second is rejected. Epoch-millisecond columns
bind the original integer without rounding.

Filter, `any_of`, and measure-threshold values can omit `kind`: the declared
dimension input types or measure output type select the logical input. If a
JSON value remains ambiguous under the Model declaration, lowering fails.
An explicit `kind` remains accepted on those inputs as a disambiguator.

Telora's transform-service initialization context is long-lived; the clock
comes from each request envelope. Calendar arithmetic, named timezones, and
column-side calendar calculations remain outside this contract.
