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
| Component filter versus metric ownership | Q0165-Q0173 | A frame/interface/slot predicate can select a parent device; its KPI remains device-owned. Q0168/Q0170 require sample Top-N after an existential child filter without multiplying samples by multiple matching children. Q0171-Q0173 also project the selected component name: selecting multiple matching children may intentionally repeat a device trend per component, which needs an explicit result-grain contract. Q0165/Q0166 group the same device KPI by child identity; this must not imply a child-owned CPU/memory metric or silently allocate it. Reject when the intended allocation/result grain is undeclared. |
| Calendar windows and encoded time | Q0044-Q0046, Q0090, Q0105-Q0110 | Distinguish calendar month from fixed N-day duration; distinguish the source's actual timestamp encoding from canonical UTC-second text. The existing `utc_days_window` covers only the latter plus externally supplied `as_of`. Positive/negative tests must cross month/year boundaries and reject unsupported storage encodings rather than pretending native timestamps are canonical text. |

Prioritize the independent KPI qualification family first: it tests whether
the Model and lowering preserve aggregation grain despite an apparently
executable target SQL. Follow it with two-window qualification and child-filter
scoping; time encoding and calendar months are separate value-semantics work.
Q0078/Q0079 remain a domain decision (copy, allocate, or reject device KPI at
frame grain); their existing negative acceptance should stay in force.

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
explicitly declared Max measure in the Model; the current IC port_count
declaration is Sum and cannot silently stand in for Max. A grouped observation
must also retain the full owner identity as a hidden grouping key: grouping by
device name alone can merge distinct namesake devices across tenants. The
current row-level trend probe does not prove that grouped-observation contract.
Explicit bounds for both windows can be resolved
from an externally supplied clock; the EDSL never silently treats a calendar
month as a fixed number of days.
