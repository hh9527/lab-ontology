# Synthetic SQLite data

`scripts/generate-icloud-data.mjs` creates a queryable SQLite database using
Node.js 22.13 or newer and its built-in `node:sqlite` module. It requires the
local `bin/telora` compiler to export the prepared model. No Python, DuckDB,
package installation or external imaster-cloud checkout is required.

Run from the lab-ontology repository root:

```sh
mise x -- node scripts/generate-icloud-data.mjs \
  --output bin/icloud-data \
  --anchor-utc 2026-10-03T12:00:00Z
```

The output directory contains:

- `icloud.sqlite`: all 48 physical tables and 822 columns, with join indexes.
- `model.json`: the prepared model used to build and validate the data.
- `manifest.json`: options, source/model/database hashes, row counts, time
  window, carrier coverage, relation coverage and cardinality checks.

The tool combines physical names and field coverage from
`icloud_model/data/source_catalog.json` with scalar types, time encodings,
grains, canonical enum wires, scopes and relations from `source_audit:report`.
The catalog captures imaster-cloud's original metadata. Generated values are
synthetic examples and do not establish business facts.

## Options and scenarios

The defaults are seed `20260926`, 12 base rows per physical table, 32 days of
hourly KPI samples, and the current UTC minute as the exclusive window end.
Specify `--anchor-utc` together with the seed to reproduce identical database
contents. Validation uses the chosen anchor, so historical anchors are valid.

`--resources N` sets the base population (minimum 6), `--days N` sets the KPI
window, and `--interval-minutes N` sets the sample interval. For example, use
`--interval-minutes 5` for five-minute samples. ONU KPI populations follow the
scoped ONU identities and therefore contain fewer series than base tables.
The tool refuses requests exceeding ten million KPI rows.

The resource population covers tenants, sites, network devices and components,
servers and components, storage, FC switches, PON hierarchies, terminals,
collaboration devices and physical links. Each of the 17 KPI tables has daily
variation; different series have rising, falling and steady profiles. Online
rates include outages. Alarm rows cover six resource families, four severities,
acknowledged/unacknowledged and cleared/uncleared states. Nullable frame remarks
include a NULL example. Other fields use deterministic placeholders or
declared enum wires; detailed physical capacities and device-specific KPI
applicability are not simulated.

DatetimeUtc samples are stored as `YYYY-MM-DDTHH:MM:SSZ`, DateUtc as
`YYYY-MM-DD`, and EpochMillis as SQLite integers. Local integer fields use the
same synthetic clock as UTC fields; this is a fixture assumption. Zero marks
absent alarm acknowledgement/clear times.

Declared dataset grains become unique indexes. Source-only KPI tables use the
synthetic grain `resId, tenantId, ts` (omitting tenantId when absent), rather than
treating the source resId marker as globally unique across time. Tables without
a declared identity receive no invented unique constraint. StorageHardDriveKPI
uses synthetic disk ownership because the model declares no owner relation.

Polymorphic references choose a resource family per row. A row need not match
every alternative resource relation. The manifest reports matching row pairs,
distinct matched rows and observed upper bounds for every declared relation.
It reports cardinality exceptions; it does not install universal foreign keys
or assert that every source row must match every alternative relation. Current
default data covers all 50 carriers and all 126 prepared relations, with no
upper-bound exceptions. It is intended for schema, filter, join, aggregation,
time-window and comparison query testing, rather than production load sizing.

## Publication and verification

The output directory must not exist. Generation builds in a sibling temporary
directory, checks SQLite integrity, actual row counts, all carrier scopes,
time encodings and enum wires, then publishes by directory rename. Unique
grain indexes detect duplicate identities before publication. Failed builds
remove their temporary output. Existing outputs are preserved.

```sh
mise x -- node scripts/tests/icloud-data.test.mjs
mise x -- node scripts/check-icloud-data.mjs bin/icloud-data
```

The first command tests reproducibility, complete field/carrier/relation
coverage, time windows, trends, unique grains, invalid value detection and
failed publication. The second requires `bin/icloud_model.snapshot.wasm` and
executes snapshot-generated SQLite queries for all 17 KPI windows, ONU/OLT
scopes and CPU GrowthRate Top-5. A snapshot path can be passed as its second
argument.
