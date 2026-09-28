# Evaluator-only rubric

Do not place this file in an agent's isolated directory. A valid result
preserves the question's business meaning; a transform success alone is not
enough. Credit useful knowledge discovery and structured feedback, and mark
down fabricated stable IDs, physical-wire guesses, handwritten SQL, or claims
of database results. The Agent should submit an Intent and explain its meaning
in business terms; the adapter persists the Intent and Query and returns only
a receipt. Inspect the host record when evaluating the actual query. A
reasonable, explicit interpretation is acceptable even if another reading
exists. Require clarification only for an unresolved material choice without
a responsible default; do not grade against corpus SQL as a hidden answer.

| Question | Expected decision | Critical checks |
| --- | --- | --- |
| 01 | Lower if the current graph composition admits this site/device/alarm count; otherwise report a precise limitation | Traverse Alarm-to-Device and Device-to-Site, not the separate Alarm-to-Site reference. Group by complete Site identity; Alarm count stays distinct under the Device-to-Site OR relation; `count_having > 5` and outer site-group count. |
| 02 | Lower with a latest-whole-sample path if discoverable; otherwise report a limitation | Two values and timestamp come from one most recent KPI row per complete Device identity, not independent maxima. Same-name devices do not merge. |
| 03 | Lower only with a declared Max over the proper PON-port samples and a declared offline classification | Window is `[2025-03-01T12:00:00Z, 2025-03-31T12:00:00Z)`; caller-supplied now, not SQL `now()`; no Avg substitution. A Model gap is an acceptable finding. |
| 04 | Reject any silent replacement of fan identities by server names, Server health by PSU health, or `warning` by another status | Original IC Q0184 SQL counted distinct server names and used health wire -1 (`error`), although the question requests fans with warning servers. The Model, not target SQL, defines the answer. |
| 05 | Honor the explicit A/Z inclusion rule | The user expressly includes A when the selected device is at Z. The Agent may describe this as an additional endpoint inclusion rather than literal directed downstream, but must not silently omit it or present unlowered handwritten SQL as a validated result. |
| 06 | Count distinct non-null referenced tenant IDs, including orphans, while naming the population accurately | The user's inclusion rule is explicit. Existing Tenant entities exclude orphan IDs, so an entity join is wrong; referring to an orphan ID as an existing Tenant entity is also inaccurate. Do not require clarification merely to rename an already specified population. |
| 07 | Include zero-device sites under the ordinary meaning of fewer than five | A 1-4-only inner join omits a valid zero case; `include_empty` supports 0-4. If the Agent chooses a narrower interpretation, it must make that assumption explicit rather than quietly claiming to answer the question. A site satisfying both OR branches should not double-count its device. |
| 08 | Count distinct Site identities unless the user asks about distinct names | "How many sites" denotes sites, not display labels. Same-name Site identities can differ; source Q0014's `COUNT(DISTINCT SITE_NAME)` is not proof that the user wants name cardinality. Ask only if the business context actually makes the count subject uncertain. |
| 09 | State the chosen time scope and peak meaning or ask a focused business question | The host supplies request time, not the Agent. A rolling month, calendar month, or 30 days and the Alarm-versus-KPI window may differ; a reasonable interpretation can proceed if clearly explained. Do not silently invent a window or substitute Avg for raw-sample Max. |

Question provenance: `imaster-cloud/telora/tools/corpus_batch/results/baseline-s6/shapes.json`
and `icloud_model/docs/PRESSURE_FAMILIES.md`. The corpus target SQL is a probe,
not an authoritative semantic contract.
