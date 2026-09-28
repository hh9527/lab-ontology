# Ontology Service Usage

This file covers packaging, starting, and using an ontology-backed query
service. Sections 1-3 apply to any model exposing the same three methods.
Section 4 is this repository's domain inventory; an integrating application
can replace or omit it. Run the build command from the repository root;
the runner can start from any directory where the artifact is accessible.

## 1. Build a snapshot

```sh
bin/telora -C <module> build <module> --snapshot -o <artifact>.wasm
```

`<module>` is a Telora workspace member with a `MainService`; it is not the
domain name used in requests. The build initializes the service and embeds its
ready state in the Wasm artifact. If a module declares external sources, provide
all of them with `--source name=path` at build time. Initialization fuel,
request fuel, and memory limits can be set with the corresponding CLI options
when deployment requires them. Use a compatible `telora-run` version with the
resulting experimental artifact.
The `-C <module>` option selects the crate context when running from the
repository root; invoking `build` from the root without it fails.

## 2. Start the service

```sh
telora-run <artifact>.wasm --serve stdio+jsonl://
```

Keep this process running. Write one JSON request per line to stdin and read
one JSON response per line from stdout. Do not mix other stdout text into this
stream. A runner started without `--serve` reads one complete JSON request and
exits after one response. `telora-run` executes the built artifact without
the source tree, workspace configuration, or compiler; only the artifact and
a compatible runner are needed at deployment.

A method slot is not automatically an HTTP route. Use an HTTP endpoint only
when the service explicitly declares one. `--serve` is the current CLI option;
`--bind` belongs to older Telora documentation.

## 3. Request protocol and agent workflow

Every request has exactly `method` and `input`. The method selects a slot;
only `input` is passed to that slot. The three methods for a domain are:

```json
{"method":"<domain>/index","input":{"offset":0,"limit":50}}
{"method":"<domain>/info","input":{"topic":"<exact topic>"}}
{"method":"<domain>/info","input":{"target":{"kind":"dataset","owner":"","id":"<stable ID>"}}}
```

`index` returns a paginated catalog of visible knowledge points. Follow
`next_offset` until the relevant area is found; do not treat the first page as
the entire Model. `info` resolves a topic by exact Unicode matching or a
target by its kind, owner, and stable ID. A topic may return `Candidates`:
inspect them and request the intended target explicitly. Follow references to
check entity grain, dimensions, measures, business values, time roles, and
named relations. A `Related` link explains knowledge but does not authorize a
query traversal. Labels, translations, aliases, and physical column names are
not substitutes for stable Intent IDs.

Response targets encode their kinds as enum names (for example, `Dataset`);
`info` target input expects the corresponding lowercase spelling (for
example, `dataset`). Convert `BusinessLink` to `business_link` and
`TimeRole` to `time_role`; preserve the returned owner and ID exactly.

Construct Intent using only confirmed stable IDs and the host-provided Intent
contract. Respect named relation direction, entity grain, allowed operations,
and each input's declared logical type. Ask for clarification when the user's
business meaning is materially ambiguous; do not silently choose a different
metric, grain, or relationship.

Submit an Intent with the same outer envelope:

```text
{"method":"<domain>/transform","input":{"intent":<Intent>}}
{"method":"<domain>/transform","input":{"intent":<Intent>,"ctx":{"now":<epoch milliseconds>,"tz":<UTC offset minutes>}}}
```

`ctx` is optional unless the Intent refers to request time; the caller must
supply `now` explicitly and calendar boundaries also need `tz`. The latter is
a fixed offset, not a named timezone or daylight-saving rule. See
[TIME.md](ontology/docs/TIME.md) for time value and window semantics. The host
must also provide the Intent grammar or tool schema: knowledge discovery
describes the Model, not the complete syntax of Intent. The graph contract and
examples are in [ONTOLOGY.md](ontology/docs/ONTOLOGY.md).

In JSONL service mode, responses use the `telora.service/v1` envelope. On
success, `ok.Index` contains `entries` and `next_offset`, `ok.Document` holds
`Found`, `Candidates`, or `NotFound`, and `ok` from `transform` contains `sql`
and `bindings`. A failure has `error: true` and structured `diagnostics`.
Inspect diagnostics and repair the Intent using the relevant knowledge points.
Do not guess a missing relation, change the business meaning to obtain a
successful query, or bypass lowering with handwritten SQL. If the Model cannot
express the user's request, report that limitation. A successful `transform`
returns a parameterized Query
(`sql` and `bindings`), not database results. Pass SQL and bindings together
to an authorized execution layer; never interpolate values into SQL.

## 4. Domains in this repository

| Build module | Domain | Scope |
| --- | --- | --- |
| `example_models` | `dog` | Dog and breed example model |
| `example_models` | `spider` | Student and school example model |
| `example_models` | `world` | Geographic example model |
| `icloud_model` | `ic` | iMaster Cloud modeling-pressure fixture |

For example, one `example_models` snapshot serves the `dog`, `spider`, and
`world` domains; `icloud_model` serves `ic` independently. Every domain
exposes `<domain>/index`, `<domain>/info`, and `<domain>/transform`.
Neither module requires external build sources, and neither collection
declares HTTP routes. Both snapshot builds and `index` requests were checked
with the commands above. The `ic` fixture is not a complete production domain
model. A missing knowledge point or valid lowering path must not be filled in
by guessing.
