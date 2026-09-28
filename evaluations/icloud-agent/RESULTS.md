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
