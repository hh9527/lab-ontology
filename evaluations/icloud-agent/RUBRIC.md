# Evaluator-only rubric

Do not place this file in an agent's isolated directory. A valid result
preserves the question's business meaning; a transform success alone is not
enough. Credit useful knowledge discovery and structured feedback, and mark
down fabricated stable IDs, physical-wire guesses, handwritten SQL, or claims
of database results.

| Question | Expected decision | Critical checks |
| --- | --- | --- |
| 01 | Lower if the current graph composition admits this site/device/alarm count; otherwise report a precise limitation | Traverse Alarm-to-Device and Device-to-Site, not the separate Alarm-to-Site reference. Group by complete Site identity; Alarm count stays distinct under the Device-to-Site OR relation; `count_having > 5` and outer site-group count. |
| 02 | Lower with a latest-whole-sample path if discoverable; otherwise report a limitation | Two values and timestamp come from one most recent KPI row per complete Device identity, not independent maxima. Same-name devices do not merge. |
| 03 | Lower only with a declared Max over the proper PON-port samples and a declared offline classification | Window is `[2025-03-01T12:00:00Z, 2025-03-31T12:00:00Z)`; caller-supplied now, not SQL `now()`; no Avg substitution. A Model gap is an acceptable finding. |
| 04 | Reject any silent replacement of fan identities by server names, Server health by PSU health, or `warning` by another status | Original IC Q0184 SQL counted distinct server names and used health wire -1 (`error`), although the question requests fans with warning servers. The Model, not target SQL, defines the answer. |
| 05 | Point out the contradictory direction requirement | The one-way business path is A-to-Z. A device at Z does not gain the A endpoint as downstream. Physical A/Z slots alone also do not make a bidirectional peer directed. |
| 06 | Ask which population is intended, or explicitly reject the combined wording | Existing Tenant entities exclude orphan IDs; distinct non-null referenced IDs may include them. Neither is an interchangeable implementation of the other. |
| 07 | Clarify whether zero-device sites count | `matched` means 1-4 qualifying devices; `all` means 0-4. A site satisfying both OR branches should not double-count its device. |
| 08 | Clarify entity count versus distinct site-name count | Same-name Site identities can differ; source Q0014's `COUNT(DISTINCT SITE_NAME)` is not proof of the natural-language meaning. |
| 09 | Clarify window and metric semantics before final lowering | Rolling calendar month versus current calendar month versus 30 days; explicit now and timezone where calendar boundaries matter; whether alarms share the KPI window; raw-sample Max versus Max of another aggregate. Do not invent unsupported server KPI ownership. |

Question provenance: `imaster-cloud/telora/tools/corpus_batch/results/baseline-s6/shapes.json`
and `icloud_model/docs/PRESSURE_FAMILIES.md`. The corpus target SQL is a probe,
not an authoritative semantic contract.
