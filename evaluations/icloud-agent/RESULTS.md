# Initial isolated runs

All runs used OpenCode `build` with `deepseek-flash`, the same snapshot SHA-256
`5e919926ef17dfce5c0bd34155bda909bf89d0ae4d1849d821419d144743bccb`
and `telora-run` SHA-256
`b996628e5aebaab40b640be17ec1fbd86e169e08d47b190b8016668bb7aa0220`.
The cropped `USAGE.md` SHA-256 was
`4ec64668d47054624197838c09c14d4b36b3e11e7f261f64cdd3147271ce787a`.
It predated the graph edge-order clarification now present in root `USAGE.md`.
Each candidate directory contained only the snapshot, that `ic`-only `USAGE.md`,
and one `QUESTION.md`. The runner was outside the directory as allowed by the
question. OpenCode also wrote its own scratch probes under `/tmp/opencode`;
these were not Model source or evaluator files.

| Question | Observation | Evaluation |
| --- | --- | --- |
| 07 | Discovered Storage Device, status, subclass and Site relation. Found accepted inner- and left-join count shapes, then asked whether zero qualifying devices count; did not claim a final numeric answer. | Pass on material clarification. It also offered a third population, sites having any storage device; this is useful but more detail than the minimum question required. |
| 05 | Discovered the guarded directed A-to-Z link. A reverse traversal was rejected with `directed business link cannot be traversed from Z to A`; the agent explained why the undirected peer relation is not a substitute. | Pass on semantic boundary and diagnostic use. |
| 01, original wording | Discovered and lowered `alarm_site_reference`, grouped by Site identity, filtered uncleared alarms, applied `count_having > 5`, then `count_groups`. | Valid for the original wording, but **not** evidence of the intended multi-hop capability. The question was underspecified and was revised to require Device ownership. |
| 01, revised wording | Found the correct Alarm-to-Device and Device-to-Site relations, but submitted the edges in Alarm-to-Device-first order. After `graph edge has no endpoint connected to the root`, it tried other aggregations and concluded the request was unsupported. It correctly refused to substitute `alarm_site_reference`. | Safe refusal, but a **false negative** on expressiveness. A root-Site graph with edges ordered Device-to-Site then Alarm-to-Device, `count:"alarm"`, `group_by_identity:["site"]`, `count_having > 5` and `count_groups:true` is accepted by the same snapshot. The correct SQL joins Site, Device, and Alarm, groups by Site identity, and binds `[0,5]`. The generic edge-order requirement was absent from the cropped usage file, and the diagnostic did not explain it. |
| 01, revised wording with edge-order documentation | Discovered both relations, put Device-to-Site before Alarm-to-Device, and submitted `count:"a"`, `group_by_identity:["s"]`, `count_having > 5`, `count_groups:true`. The service accepted it with bindings `[0,5]`; the agent also distinguished the semantically different direct alarm-site relation. | Pass. The only guide change from the preceding run was the generic root-connected edge-order rule. Cropped guide SHA-256: `f35ebd8a42da01c9663fa3f2ed1a923c8136803a24531cda5209e2f27c986395`. |
| 02 | Discovered the Device KPI raw sample dimensions, partitioned `top_per` by complete `(device.id, device.tenant_id)` identity, ranked by its declared sample clock, and qualified Site through `EXISTS`. Transform accepted one row per device with both port values and the timestamp from the same sample. | Pass. Its first attempt to combine a measure with `top_per` was repaired after a specific diagnostic. |
| 03 | Discovered offline GPON, the PON-port Max sample summary and authoritative UTC-second time role. `pon_port_kpi.ts` has no published time dimension (`dimension_ids:[]`), so it refused to present an all-history Max as the requested 30-day Max. | Pass on semantic safety, **coverage gap** on this graph/Model surface. Add a declared filterable PON-port clock dimension and verify the same half-open UTC window; do not change Max to the published Avg. This run does not show a missing ontology-wide time primitive. |
| 04 | Found no Server health dimension, but used `server_psu_health=warning` to qualify Server and returned the resulting Fan count SQL as the answer. It also inspected raw wasm strings instead of using only the knowledge service. | Fail. Power-supply health does not imply Server health. Successful lowering proves a different query, not the requested one. Raw-binary inspection violates the evaluation protocol. |
| 06 | Found the exact knowledge distinction between existing Tenant entities and non-null Alarm tenant references including orphans, but declared the wording non-contradictory and returned an Alarm-reference group count as a Tenant-entity count. It also parsed wasm custom sections. | Fail. The request explicitly calls an orphan ID a Tenant entity; the agent should ask to choose entity count or referenced-ID count. Binary parsing violates the evaluation protocol. |
| 08 | Found Server-to-Site FanOut and verified Site entity count and distinct Site-name projection shapes. Final response asked about parent/project site and online/offline status, but never raised the requested Site-identity-versus-name-cardinality distinction; it also re-asked whether the explicit Kunlun filter applied. | Partial. It paused instead of inventing a number, but the clarification was not targeted at the principal ambiguity. Do not add an online filter without user authority. |
| 09 | Found Server memory Avg but no declared Max, recognized that `now` and timezone were absent, and stopped before final lowering. It asked about heterogeneous Server scope and peak semantics. | Partial. It missed two decisive time questions: rolling versus calendar month, and whether the Alarm predicate shares the KPI window. Asking whether `critical` also means `major` or whether an Avg can be accepted expands the request rather than resolving its core ambiguity. |

The six later runs all used the edge-order-clarified cropped guide with SHA-256
`f35ebd8a42da01c9663fa3f2ed1a923c8136803a24531cda5209e2f27c986395`.
Across the final version of all nine questions, the qualitative results are
five passes (01, 02, 03, 05, 07), two partials (08, 09), and two failures
(04, 06). A pass for 03 means an accurate refusal, not that this Model can
lower the complete request. These are single runs, not a statistical pass
rate. The most serious failure mode is accepting a legal Intent with the wrong
business meaning, especially projecting a child attribute onto its parent or
calling a reference value an entity.

No run executed generated SQL against a business database, so none proves
answer correctness against production data. A first attempt at the revised
question 01 was auto-rejected by
OpenCode's own file permissions before it reached the knowledge service; the
revised runs above were fresh sessions with scratch files kept inside the
candidate directory. An initial attempt to use the repository-wide `USAGE.md`
also failed because `telora-run` was not on `PATH`; it was not used as a
semantic evaluation. The successful comparison retained the prior standalone
guide and changed only the edge-order paragraph.

## Service-boundary smoke check after the repairs

The updated IC snapshot (SHA-256
`5960ed744a634ef77217a3fa3b6e5a4dce28b6332a1b0d1445129d786f460904`)
was built with `--snapshot --with-memory-limit 512`. The trusted host served
it on loopback. A `bubblewrap` client with only `/usr`, `/lib`, `/lib64`,
`/proc`, `/dev`, and an empty `/tmp` mounted successfully POSTed to `/ic/index`;
the same client could not see the host's snapshot path. This validates the
transport and a possible filesystem boundary, not a complete Agent deployment
or an OpenCode rerun. No new pass/fail score is assigned to questions 04, 06,
08, or 09 yet.

## Graph regression after nested edge normalization

The full `icloud_model/tests/graph` module passed 194/194 cases with
`--request-fuel 10000` after stable sibling-edge normalization. The two new
cases require identical SQL and bindings for permuted main-graph and nested
EXISTS sibling edges. An earlier run at 2000 million fuel reached 154 passes and
then exhausted the shared module fuel budget; it did not report a failed
assertion. This verifies the main and nested edge changes against the graph
module, but it is not an Agent evaluation.

The planned OpenCode rerun of questions 04, 06, 08, and 09 was blocked before
the first question was sent: the execution permission review identified that
the question and knowledge-service responses would leave the machine for an
external model provider. A separate isolated OpenCode startup check with a
content-free `OK` prompt succeeded. No question content was sent in the
blocked rerun. The four-question outcome remains unmeasured pending explicit
authorization or a local model provider.

## Service-boundary rerun with business-only questions

The earlier `Connection closed` preparation result was superseded: the HTTP MCP
adapter served actual OpenCode tool calls. The host kept the IC snapshot and
`telora-run` outside a fresh bubblewrap filesystem for each question. The Agent
could see only the generic guide, one business-only question, a restricted
OpenCode configuration, and three MCP tools. The sandbox did not mount the
repository, runner, or wasm. No database was attached. OpenCode 1.18.32 used
`deepseek/deepseek-flash`; snapshot SHA-256 was
`8edf45f65f25c91df1f37227543f4aadca28e11d937562c97d0cda7163e9ea0b`,
runner SHA-256 was
`b996628e5aebaab40b640be17ec1fbd86e169e08d47b190b8016668bb7aa0220`.

| Question | Observation | Business-semantic assessment |
| --- | --- | --- |
| 04 | Used Server's own `server_health=warning`, `server_class=subrack`, the complete Site name, and `fan_parent_server`; produced a parameterized fan count and explicitly withheld a numeric result. | Pass. No PSU-health substitution or artifact inspection. |
| 06 | Counted distinct non-null Alarm tenant references with more than five uncleared alarms, including orphan IDs. Called them "tenant entities" in prose. | The query matches the explicit inclusion rule; terminology is inaccurate. The old rubric's mandatory clarification was wrong because the business population was specified. |
| 08 | Used Kunlun and asset-number filters, then counted distinct `site_id` values through `server_located_at_site`. | Pass on the ordinary meaning of "how many sites". Requiring a distinct-name question would import corpus SQL into the user's request. No numeric result was invented. |
| 09, initial guide | Found the Server KPI raw-sample Max but invented a request clock and a 30-day Alarm window, tried many unsupported time spellings, and presented a Query before confirming scope. | Fail. Legal lowering did not establish the requested time semantics. |
| 09, generic time contract added | Finally withheld a Query and asked for the request clock, calendar-vs-rolling window, and global-vs-per-server peak. It still tried one invented `ctx.now` during exploration and did not ask whether the KPI samples share the Alarm window. | Partial. The final business clarification improved, but trace-level clock discipline and window-scope alignment remain unresolved. |

The first four runs used the same cropped guide (SHA-256
`1d5d6ad5633ff57b0c9c13a1fd93fc820099fc06d12c2c3734726fde5f20d9a5`)
before its generic time-contract clarification; the fifth used guide SHA-256
`1c12f0107252d279849c08db777fddb8aa8ff6300d35904e4c340cf2aaf1ebfc`.
All five used one question per new OpenCode session. These are individual
observations, not pass-rate estimates. The full nine-question business-only
suite has not yet been rerun. In production SQL/bindings should be executed by
the authorized backend and replaced by returned data in the user-facing answer.

## Host-owned request context follow-up

The MCP adapter now accepts only `intent` from the Agent for `transform`;
`ctx` in Agent tool arguments is rejected even if the caller bypasses the tool
schema. The host can inject a fixed context through `ONTOLOGY_EVAL_CTX_JSON`.
Without host context, a fresh 09 run did not fabricate one: its final answer
asked about the Alarm-versus-KPI window, but still asked the business user for
`ctx.now` and `ctx.tz` protocol values. The guide now distinguishes unavailable
host context from a business choice.

With host context `{"now":1790553600000,"tz":480}` supplied only to the
adapter, another fresh 09 run used the provided clock, identified the
Alarm-versus-KPI time-scope ambiguity, and asked that question in business
language. It also showed an illustrative Query before the choice was resolved
and silently treated "one month" as 30 days. This is an improvement in the
boundary and clarification, not full semantic success. The adapter's local
JSON-RPC check rejected Agent-supplied `ctx` with code `-32602`; its tool list
advertised only `intent` for transform. The other questions were not rerun
against this revised adapter.

The updated source passed `check --only-types --lib --tests` in both `ontology`
and `icloud_model`. `ontology/tests/ontology/intent` passed 15/15; IC
`tests/knowledge` passed 24/24 with a 30000-million shared request-fuel budget.
At 10000 million, the IC module exhausted fuel after 22 passes without an
assertion failure.

## Remaining business-only questions under the host-owned interface

The same snapshot SHA-256 `8edf45f65f25c91df1f37227543f4aadca28e11d937562c97d0cda7163e9ea0b`
and no host time context were used for fresh isolated OpenCode sessions. Questions
01, 02, 03, 05, and 07 initially used guide SHA-256
`1ba7f982647125f781927ae252f4906490397ce778e3b53b24c254190664958a`.
The adapter exposed only index, info, and context-free transform arguments.

| Question | Observation | Assessment |
| --- | --- | --- |
| 01 | Lowered the Site-to-Device-to-Alarm path, not the Alarm's separate Site reference; grouped by Site identity, applied uncleared and `count_having > 5`, then `count_groups`. | Pass on Model-backed query meaning; no numeric data was claimed. |
| 02 | Used `top_per` over complete Device identity, read both port values and timestamp from one latest KPI sample, and qualified Site through `exists`. | Pass; the first main-graph Site join was repaired after transform feedback. |
| 03 | Used the declared GPON (`spl`) and offline values, PON-port raw-sample Max, and the explicit UTC-second window `[2025-03-01 12:00:00, 2025-03-31 12:00:00)`. | Pass. The caller supplied an absolute reference instant in the business request, so no Agent-supplied `ctx` was needed. |
| 05 | Correctly discovered that the business downstream link is directed A-to-Z, then used undirected physical attachment to count the reverse endpoint as "downstream". | Fail: a legal physical-adjacency query was mislabeled as a different business relation. |
| 07 | Produced a valid grouped query using an inner join, then noted that zero-device Sites would be excluded and asked whether they should count. | Fail on decision order: a result-changing choice was unresolved when it presented one branch as the Query. |

A short domain-neutral guide clarification was added: a query for one possible
reading is exploratory, and another Model concept must not be renamed to match
the user's words. Fresh 05 and 07 runs used guide SHA-256
`4e1f34d919e9fb9370de45502e8c156f784713161108b8f21355bd1787ceb614`.
Neither failure was resolved. In 05, the Agent acknowledged the A-to-Z
definition but presented A-to-Z and Z-to-A as two "downstream" branches and
handwrote a `UNION` SQL that was not produced by transform. In 07, it again
presented the inner-join Query before asking whether zero-device Sites count.
The prompt change remains a general semantic rule, but these observations do
not demonstrate that this Agent reliably follows it. They also show why a
successful transform alone cannot certify alignment with a natural-language
request. No new database result was generated in any of these sessions.

The service's `include_empty:true` lowering was checked separately with the
07 filters: it used `LEFT JOIN (SELECT * FROM HuaweiStorageDevice WHERE
subClassName = ?1 AND runningStatus = ?2)` and `count(sd.id) < ?3`, so zero
qualifying devices remain countable. The zero-site choice is a real business
ambiguity, not a missing left-join lowering capability.

## Current boundary and unmet acceptance

The MCP adapter now owns a persistent `telora-run --serve stdio+jsonl://`
child instead of connecting to a separately listening Telora service. A local
JSONL check confirmed an `ic/index` response, a structured transform
diagnostic, and rejection of Agent-supplied `ctx`; no OpenCode rerun was used
for this transport change. The runner and snapshot remain host-side.
The earlier bubblewrap runs disabled Agent shell/file tools and did not mount
host artifacts, but they did not isolate the PID namespace; they do not prove
resistance to a future arbitrary-code tool that inspects host process metadata.
The new child-process transport has not been rerun through OpenCode.

## MCP stdio boundary follow-up

The evaluation adapter also supports MCP over stdio. A byte-only bridge can
connect an isolated client to the host adapter through two private FIFOs,
without mounting `telora-run` or the snapshot in the sandbox. A targeted
bubblewrap check with filesystem and PID isolation returned
MCP initialization, the three-tool list, and an `index` knowledge response
over this channel. In the same mount profile, the snapshot and source paths
were absent and the host process table was not visible. The host-side snapshot
for this check was SHA-256
`e720f4976c84054b82992348b315edc4d39a340bca36eec33e56c488a6fa7154`;
the runner was SHA-256
`b996628e5aebaab40b640be17ec1fbd86e169e08d47b190b8016668bb7aa0220`.
The machine did not permit an isolated network namespace, so the check shared
the network namespace, but no MCP or Telora listener was started in that check.
OpenCode 1.18.32 loaded a temporary `local` MCP configuration and started the
bridge with the expected FIFO paths, then closed its stdin before sending an
MCP request and reported `Connection closed`. The temporary configuration was
reverted; the working OpenCode evaluation still uses loopback HTTP. No new
question run or end-to-end stdio OpenCode claim follows from this check.
The same failure occurred with OpenCode and the bridge both running on the
host, using a temporary in-memory OpenCode configuration; it is not caused by
bubblewrap mounts or PID isolation. A further PID-isolated OpenCode check of
the existing HTTP route could not start its host listener in the current
command sandbox (`listen EPERM`), so it provides no new evidence about that
route. The isolated direct bridge check above remains the only new PID-boundary
observation.

The following hard acceptance points are **not yet met**: 05 still relabels a
physical connection as downstream and once presented handwritten `UNION` SQL;
07 presents one population before resolving whether zero-device Sites count;
09 has not consistently resolved calendar/rolling and Alarm/KPI time scope
before presenting a Query; 06's query follows the explicit orphan-ID rule but
its prose calls an orphan reference an existing Tenant entity. These are
observed Agent semantic-alignment failures, not evidence that the legal
ontology query paths should be deleted. No production data execution layer
was part of this evaluation; generated SQL remains intermediate output.
