# Corpus pressure families (first pass)

The 449 questions and 161 textual templates in IC's `baseline-s6/shapes.json`
are a source of semantic probes, not 449 acceptance targets. A family closes
only when its representative intent has a valid Model-backed plan, adjacent
invalid intents fail with a specific diagnosis, and the relevant knowledge is
discoverable from the same prepared Model. Corpus target SQL is evidence of
intent, not an authoritative declaration of metric grain or physical mapping.

| Family | Representative questions | Model/lowering pressure and acceptance |
| --- | --- | --- |
| Two KPI thresholds on one device | Q0088-Q0093 | Two independent KPI aliases joined to a device multiply sample rows. For AVG this happens to leave each average unchanged when both sides are nonempty, but it must not be generalized to SUM, COUNT, or different time/sample filters. Declare each metric's sampling grain and aggregation, evaluate each threshold over its own eligible samples, then intersect qualified device identities. Check that an absent sample on either side excludes the device, and that duplicating one side cannot change a count/sum on the other. Q0091 asks for the number of *qualified devices*, not joined sample pairs. Q0091/Q0092 use `AVG(portCount)`/`AVG(operStatusCount)` while IC's device MetricSet declares both as `Sum`: this discrepancy requires explicit raw-sample aggregation semantics or rejection, never a silent override of the declared metric. |
| Historical qualification, separate observation | Q0105-Q0110 | Count samples above a raw-value threshold in one window, then aggregate or list samples in another window for the *same qualified device*. `qualify_samples` selects owners by sample predicate and count; `observe_qualified` uses a second sample scope and window for the observation. The Q0108 trend probe supplies calendar-month bounds externally (it does not convert a month to 30 days). Both scopes follow the resource+tenant ownership relation; projection order cannot change the observation root. `scripts/check-sample-execution.sh` runs the generated SQL against distinct-tenant SQLite fixture rows. |
| Component filter versus metric ownership | Q0165-Q0173 | A frame/interface/slot predicate can select a parent device; its KPI remains device-owned. `observe_qualified.components` uses a correlated EXISTS: Q0170-shaped Top-N cannot duplicate KPI rows when two frames match. Explicit `observe_qualified.context` instead selects a named child-to-owner relation and child dimensions: a row-level device KPI sample is shown once *per matching child*, intentionally; an aggregate is grouped by hidden child and owner entity grains. Two same-name frames yield two independent 241 aggregates, never a merged 482. This presents a parent metric in a child context, not a child-owned metric or allocation; contextual values are not additive across children. Frame is the current modeled probe; interface/slot carriers and their own Model facts are not claimed complete. |
| Calendar windows and encoded time | Q0044-Q0046, Q0090, Q0105-Q0110, Q0215 | Distinguish calendar month from fixed N-day duration; distinguish source encodings from canonical UTC-second text. Device creation time is declared Local/epoch-ms over Int; `time_domain` exposes the role and externally resolved integer bounds filter the physical column. A local wall time alone is not a valid bound: the external time context must supply timezone-resolved half-open milliseconds. `utc_days_window` still covers canonical UTC text only. Native PostgreSQL timestamps and full calendar arithmetic remain separate gaps. |
| Top raw samples per owner | Q0035-Q0037, Q0401-Q0403 | `sample_top` declares metric dataset, named Safe sample-to-owner relation, owner, selected raw ranking dimension, UTC bounds and per-owner take. It derives hidden partition keys from full owner grain and stable tie-breakers from full metric sample grain, preserving visible projection. Q0036 executes against namesake devices and equal values. The Q0401 interface fixture adds a Safe port->device ancestor and filters site+tenant inside one two-hop correlated EXISTS over the FanOut OR site relation; duplicate matching sites cannot alter per-interface ranking and split-site tenant/name matches are rejected. |
| Event-count qualification before KPI observation | Q0444-Q0446 | Existing `observe_qualified.components` accepts a named Event-to-owner relation, event filter and `min_matches`; it evaluates event count in a correlated grouped EXISTS before aggregating the separate KPI carrier. The acceptance model maps IC's textual alarm severity wire `"1"` to `critical` and declares an explicit Max sample summary alongside the original Avg KPI. SQLite excludes cross-tenant count mixing and major alarms. This proves the model/lowering combination, not a complete server KPI model. |

Prioritize the independent KPI qualification family first: it tests whether
the Model and lowering preserve aggregation grain despite an apparently
executable target SQL. Follow it with two-window qualification and child-filter
scoping; time encoding and calendar months are separate value-semantics work.
Q0078/Q0079 remain a domain decision (copy, allocate, or reject device KPI at
frame grain); their existing negative acceptance should stay in force.

IC declares `NetworkDevice.id` as a PrimaryKey and the frame->device link on
`refParentNE = id`; frame and device also carry tenant IDs. Therefore the
single-column link is not automatically wrong merely because KPI ownership
uses `(resId,tenantId)`: its safety depends on the declared PrimaryKey scope.
The owner-key question is recorded in issue #9, without fabricating a tenant
equality that is not present in IC's published link.

## First lowering boundary: independent KPI qualifications

The existing `set`/`set_count` accepts two compatible projected plans, while
`lower_core` projects selected aggregate measures alongside grouping dimensions.
Intersecting two `(aggregate, device_id)` projections is not an intersection of
device identities: the aggregates are different values. Nor does `exists_via`
express a grouped, thresholded related sample set. `qualify_metrics` now uses
one correlated aggregate EXISTS per Model-declared KPI condition with its own
explicit UTC window, then returns owner dimensions or counts the owner key.
Identity
must include every declared ownership key (for example resource and tenant),
not merely a display name or a physical `resId` guessed from target SQL.

One rejection test should use two samples on the first side and three on the
second: a joined `COUNT(*)` would report six, whereas independently counting
first-side samples must report two. Another should qualify only when both
conditions hold for the same complete owner key; mixing tenants must fail.
For Q0091/Q0092, the declared `Sum` metric cannot be silently used as `AVG`.
An explicit raw-sample aggregate contract would be needed if that is the
intended business meaning; otherwise lowering must diagnose the mismatch.
The acceptance checks SQL structure, complete composite correlation, binding
order, model-declared Avg versus Sum, and negative relation/measure cases.
`scripts/check-sample-execution.sh` additionally executes the actual lowered
queries over fixture rows: a same-ID different-tenant pair cannot combine
CPU and port qualifications, a qualified device is counted once, and the
observation returns only its five rows in the observation window. Qualification
by a raw-sample predicate before COUNT (Q0105)
is now available through `qualify_samples`/`observe_qualified`, using one
correlated aggregate EXISTS per qualification. A Max observation requires an
explicit sample summary in the Model: `port_count_peak` uses Max over the same
physical `portCount` samples while the declared `port_count` metric remains Sum.
Discovery distinguishes the declared metric from the sample summary; model
preparation rejects missing primary metrics, mismatched units and duplicate IDs.
The fixture executes both summaries after a distinct qualification window,
yielding Sum 241 and Max 93 for the same qualified device. This demonstrates
the Q0105/Q0106 modeling capability, not a completed ONU or server model.
A grouped observation
also retains the full owner identity as a hidden grouping key: grouping by
device name alone can merge distinct namesake devices across tenants. The
device Model now declares `@dataset(Entity, ["id", "tenant_id"], None)`;
`observe_qualified` adds those two fields to GROUP BY whenever a metric
aggregate includes a visible owner dimension, leaving the projection unchanged.
The generated grouped plan is executed over two devices with the same visible
name but different sums, and their rows remain separate. Without declared
entity grain this grouped shape fails rather than guessing identity from JOIN.
Explicit bounds for both windows can be resolved
from an externally supplied clock; the EDSL never silently treats a calendar
month as a fixed number of days.
