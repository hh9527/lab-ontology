# Time inputs and physical encodings

Time dimensions have a declared logical input type and a physical column
encoding. A physical `String` or `Int` does not grant permission to compare a
time dimension with an ordinary text or integer value. The ontology checks
each Intent value against the Model's time role before binding it to SQL.
Relation keys likewise reject incompatible time and plain fields.

| Logical input | Declared encoding | Physical binding | Accepted spelling |
| --- | --- | --- | --- |
| `Date` | `DateText` | String | Valid `YYYY-MM-DD` |
| `Rfc3339` | `Rfc3339Text` | String | UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `Utc1` | `CanonicalUtcSecondText` | String | UTC `YYYY-MM-DD HH:MM:SS` |
| `LocalDateTime` | `LocalText` | String | Local `YYYY-MM-DD HH:MM:SS` |
| `EpochMillis` | `EpochMillis` | Int | Unix epoch milliseconds |

`Utc1` replaces the misleading `UtcSecond` name in logical types and typed
input variants. It accepts text, not an integer. Its `@edsl::doc(text)`
description is automatically exposed in Dimension `detail.input_docs`,
including the example `"2026-09-20 16:00:00"`. Physical encoding names and
the accepted timestamp spelling remain unchanged.

The RFC3339 input currently accepts only normalized UTC seconds: offsets and
fractions must be resolved before submitting the Intent. Fixed-width UTC text
preserves chronological ordering under raw-column string comparison.
`EpochMillis` is an absolute instant measured from `1970-01-01T00:00:00Z`;
its encoding does not depend on a timezone. A UTC/local business description
does not change its integer representation. A shifted wall-clock integer
would require a separately specified encoding. Local wall-clock text is
distinct from an instant. Resolving an instant or a
relative period into local wall-clock boundaries may require a timezone and
ambiguity policy; this interface does not infer either.

Graph Intents accept `time_windows` at the root and within `exists`:

Each temporal DataType knowledge node links to the shared TimeWindow operation
contract. Follow the returned opaque key to read the interval and boundary rules.
Type support does not grant field authorization: the dimension must have a time
role and authorize Ge, plus Lt when an upper bound is present. This is unrelated
to a dimension's `half_open` business vocabulary contract.

```json
"time_windows": [{
  "node": "sample", "dimension": "sample_time",
  "start": 1727308800000,
  "end": 1727395200000
}]
```

The window is `[start, end)`. Both endpoints must be concrete values in the
dimension's declared logical type. SQL compares the original column to
allocated bindings (`>= start AND < end`), without database `now()` or
column-side time transformation. Reversed or invalid endpoints fail before
Query materialization.

The upper bound may be `null` or omitted:

```json
"time_windows": [{
  "node": "sample", "dimension": "sample_time",
  "start": 1727308800000,
  "end": null
}]
```

This means `[start, None)`: the Query has only `>= start`. It does **not** mean
`[start, now)`; future-dated rows can match. Use an explicit concrete end when
the business request requires an exact upper instant or replayable cutoff.

The Agent resolves references such as "now", "three days ago", and calendar
periods before submitting the Intent. Its reference time and timezone may
come from the application client or its own environment. It should explain
the resulting concrete dates and timezone to the user. The transform request
contains only `intents` (an array of one to five); `ctx`, `"now"`, `{"delta_ms":...}`, and
`{"calendar":...}` are rejected. The ontology does not read a clock or infer
a timezone. The absolute Intent is replayable and has the same lowering at a
later time.

Filter, `any_of`, and measure-threshold values can omit `kind`: the declared
dimension input types or measure output type select the logical input. If a
JSON value remains ambiguous under the Model declaration, lowering fails.
Do not supply a `kind` field in the external Intent protocol.
