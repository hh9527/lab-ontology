# Time inputs and physical encodings

Time dimensions have a declared logical input type and a physical column
encoding. A physical `String` or `Int` does not grant permission to compare a
time dimension with an ordinary text or integer value. The ontology checks
each Intent value against the Model's time role before binding it to SQL.
Relation keys likewise reject incompatible time and plain fields.

| Logical input | Declared encoding | Physical binding | Accepted spelling |
| --- | --- | --- | --- |
| `DateUtc` | `DateText` | String | Valid `YYYY-MM-DD` |
| `DatetimeUtc` | `Rfc3339Text` | String | UTC `YYYY-MM-DDTHH:MM:SSZ` |
| `LocalDateTime` | `LocalText` | String | Local `YYYY-MM-DD HH:MM:SS` |
| `EpochMillis` | `EpochMillis` | Int | Unix epoch milliseconds |

`DatetimeUtc` replaces the former `Utc1` and `Rfc3339` logical inputs.
The space-separated UTC spelling is no longer accepted. `Rfc3339Text`
names the physical encoding, not a second logical type. Dimension
`detail.input_docs` publishes the normalized format and a concrete example.

The iCloud contract uses three logical types: `DatetimeUtc`, `DateUtc`, and
`EpochMillis`. PostgreSQL columns use `timestamptz` (UTC input/output), `date`,
and `bigint`, respectively. SQLite uses normalized ISO-Z text, date text,
and INTEGER. A PostgreSQL timestamptz stores an instant, not the original
timezone; the host must serialize returned timestamps in UTC.
`DateUtc` is a UTC calendar date with no time of day. Extract dates from
instants in UTC. Date-only source values keep their declared calendar date.

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

Each temporal Ty knowledge node links to the shared TimeWindow operation
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
dimension's declared logical type. For a raw time dimension, SQL compares the original column to
allocated bindings (`>= start AND < end`), without database `now()` or
column-side time transformation. Reversed or invalid endpoints fail before
Query materialization.

## UTC calendar buckets

Declare fixed bucket dimensions on a field with a UTC time role:

```telora
@edsl::time_field(edsl::TimeSemantics::Utc, edsl::TimeEncoding::Rfc3339Text)
@edsl::utc_bucket_dimension("sample_hour", qb::UtcBucketUnit::Hour)
@edsl::utc_bucket_dimension("sample_day", qb::UtcBucketUnit::Day)
@edsl::utc_bucket_dimension("sample_month", qb::UtcBucketUnit::Month)
ts: String,
```

The result is the bucket's UTC start, preserving the source logical type.
DatetimeUtc retains RFC3339 text in SQLite and native timestamptz in PostgreSQL;
clients serialize it as canonical UTC RFC3339. EpochMillis returns integer
milliseconds, and DateUtc retains date text/native date (day/month only). A month is
a calendar month. Local time roles are rejected. Each exact unit/encoding pair
must be authorized as `qb::ScalarFunction::UtcTimeBucket({unit, encoding})`
in the query profile. There is no runtime granularity parameter or implicit
type conversion. NULL remains NULL. Calendar bucketing uses the common range
0001-01-01 through 9999-12-31; epoch inputs outside this range return NULL.
Negative epochs floor to the preceding bucket, including -1 millisecond.
PostgreSQL session timezone does not affect the result.

Select the bucket dimension together with a declared measure to group samples.
Apply the requested half-open window to the raw time dimension so the stored
clock predicate remains available for index use. Filtering a bucket dimension
instead compares the explicitly computed bucket start and can select a different
population. Bucketing does not fill missing periods, alter NULL aggregates,
change the selected measure's meaning, or authorize summing gauges across time.

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
