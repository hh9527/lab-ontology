# Corpus pressure families (first pass)

The relation-first graph Intent now supports `constraints` between already
introduced named nodes, both at the outer graph and inside correlated EXISTS.
Unlike `edges`, these do not introduce joins: lowering resolves the complete
declared relation key into a closed predicate. The alarm/server/fan pressure
case uses the Safe alarm-to-server composite identity and a fan-to-server
FanOut match, then constrains the fan and server to the same Tenant node inside
EXISTS. Wrong relation roles, disconnected nodes, and constraints that would
turn `include_empty` into a nonempty population are rejected. The IC physical
keys, including component tenant ownership, remain pressure-model contracts
until verified against production mapping and identity scope. The physical
link's two A/Z relations also declare an undirected business peer connection;
either endpoint can be the querying device without making A/Z directional.
An EXISTS beginning with this business link may now constrain its named peer
and tenant nodes with the same Model-backed key rules. Its implicit physical
link hub remains inaccessible as a named constraint endpoint.
Correlated EXISTS constraints can also reference an already named outer graph
node besides their anchor: the alarm/server/fan probe connects an inner Fan to
an outer Tenant without introducing another tenant instance. The same scope
works for a peer reached through a business link. Inner edges and filters still
introduce or address only their own nodes; a mismatched relation role fails.

The reconnected relation-first `icloud-model/tests/graph.telora` checks two
independent Device KPI qualifications with correlated aggregate EXISTS,
separate explicit UTC windows and the complete `(id, tenant_id)` identity.
It also selects a Model-declared Avg over a *different* observation window.
The generic graph Intent now accepts `measures:[{node,measure}]` and proves
that other joins cannot multiply the measure's sample rows; fan-out must be
moved into a correlated EXISTS. Identity grouping remains explicit, so
same-name devices cannot be merged by accident. These cases replace reliance
on the legacy `qualify_metrics` API described later in this historical log;
they do not establish production KPI grain or clock encoding.

`icloud-model/tests/knowledge.telora` also checks the 19-entity Prepared Model
as one navigable catalog. The current `doc.ic`/`index.ic` TransformService
works under the default request budget but reconstructs the catalog per
request (roughly 359 million Wasm fuel for one indexed request on this model).
Capturing the full catalog in both service slots exceeded the runtime's
single growth-operation limit; a compact shared or lazily derived knowledge
representation is a separate ontology scaling pressure, not an excuse to
weaken visibility or graph-closure checks.

The 449 questions and 161 textual templates in IC's `baseline-s6/shapes.json`
are a source of semantic probes, not 449 acceptance targets. A family closes
only when its representative intent has a valid Model-backed plan, adjacent
invalid intents fail with a specific diagnosis, and the relevant knowledge is
discoverable from the same prepared Model. Corpus target SQL is evidence of
intent, not an authoritative declaration of metric grain or physical mapping.
Preparation rejects a Safe relation unless its target key covers every field
of the target's declared dataset grain; without such a declaration, the target's
marked key field is the identity contract. A key field within a composite
dataset grain is not a substitute for the remaining grain fields.

IC's physical-link A/Z device and tenant relations also probe authored key
stability. `model_field(Owner.type, Scalar.type, "name")` verifies the field and
type before `typed_relation_pair` fixes source/target orientation and equal
scalar types. `named_typed_relation_key` verifies the annotated owner and
resolves field names to the prepared index-based relation tree. Inserting a
same-typed field before a key cannot silently redirect the join as numeric
field indexes could. The existing `FieldEq` remains a preparation-validated
name-based form; typed references add construction-time owner/scalar witnesses.

The PON ONU/OLT roles carry a fixed canonical classification scope without
publishing their role discriminator as a user-filterable dimension. Both
classification dimensions are unauthorized for subject discovery and intent
filters, while the dataset discovery index still describes each fixed scope.
Model preparation checks their canonical values and allowed operators before
any query is lowered; SQL and SQLite execution still constrain both roles.

| Family | Representative questions | Model/lowering pressure and acceptance |
| --- | --- | --- |
| Native unordered endpoint pair | Q0174 | A physical link carries its own A/Z device names, which are not stable Device identities. The Model declares `link_ne_names` over two plain, compatible equality dimensions; lowering resolves only this named pair and keeps `(A=x AND Z=y) OR (A=y AND Z=x)` closed under the link-to-tenant relation. Count link IDs, reject undeclared pairs and unrelated tenant edges; the SQLite fixture exercises both orders, duplicate links, one-sided matches and a different tenant. |
| Endpoint device qualified by site | Q0350-Q0353, Q0374-Q0379 | Link A/Z roles must each match the Device's complete `(id,tenant_id)` identity; Device→Site permits two independently matching OR keys, then Site→Tenant and Link→Tenant must name the same tenant. `qualify_link_site` encloses both A/Z alternatives and Site alternatives in one three-hop EXISTS so a link is returned/counted once even when both ends and multiple sites qualify. Both endpoint relations must cover every field of the current declared Device grain and reference distinct Link role columns; extending the Model grain without extending those keys is rejected. The directed peer hub explicitly binds those A/Z Safe relations and carries the full participant grain into its EXISTS. IC's original entity link only publishes id equality, so the added tenant equality is an explicit pressure-model contract needing production mapping confirmation. |
| Device-link association rows scoped by site | Q0366-Q0368 | `list_link_device_site` returns `(device,link)` rows, not one Link row: two qualifying A/Z devices yield two associations, while a self-loop or a device hitting both site keys produces one association. The A/Z OR JOIN uses both complete Safe relation keys, and site/tenant candidates stay in a correlated EXISTS with the Device and Link ownership keys. Duplicate visible names remain distinct through device and link IDs. Wrong relation roles, missing tenant/participant-grain keys and role-mismatched filters fail with diagnostics. |
| Latest whole sample per owner | Q0354-Q0356 | `latest_sample` selects one complete raw KPI row per declared owner grain, ordering by the carrier's declared UTC clock rather than independently applying MAX to its measures. Its named Safe sample-to-owner relation must cover the owner's complete declared grain; extending that grain without corresponding relation keys is diagnosed. A window is optional: absent bounds explicitly mean all history. Device-to-site FanOut and site-to-tenant constraints use correlated EXISTS, not a row-multiplying JOIN. The Q0354-shaped DeviceKpi fixture returns two raw port-count fields from each namesake device's latest sample; separate AP KPI carriers remain to be modeled. |
| Count event-qualified tenant identities | Q0442-Q0443 | IC maps alarm `tenant_id` to physical `TENANTID`, not `TENANT_ID`; that same field participates in device/alarm composite correlation. The cleared canonical domain maps business `uncleared` to integer wire 0. `count_groups` exposes the existing nested grouped-count plan: filter uncleared events, group by tenant ID, HAVING event count >5, then count surviving groups. A tenant with five qualifying events or six cleared events must not count. |
| Count sites qualified by related device counts | Q0050-Q0052 | `count_related_groups` reuses the named FanOut OR StorageDevice→Site relation and declared Count measure, groups by the complete site identity, applies HAVING to the child population, then counts qualifying site groups in one query. `population:"matched"` uses an INNER related population (1..4 for `<5`, matching the corpus SQL); `population:"all"` roots at Site with a LEFT JOIN, places device predicates in ON, and includes zero-match sites (0..4). The intent must choose explicitly. For Q0050 the SQLite fixture returns 3 versus 4, distinguishing zero, one, four, five and same-name site IDs; a device whose parent and project both point to one site contributes once under one OR JOIN. An unrelated relation, incomplete site grain and unsupported populations are diagnosed. Storage name is non-null per IC metadata, so `COUNT(name)` agrees with resource count for this carrier. |
| Component-qualified event observation | Q0392-Q0397 | Event→Server uses the declared Safe `(MEDN,TENANTID)` ownership relation, now checked against every field of Server's current `(id,tenant_id)` grain before the Event→Server JOIN; possibly non-unique Fan/PSU→Server `parentResId=oriResId` relations stay FanOut, admitted only inside correlated EXISTS with independently aligned component/Server tenant keys. Event.CSN is not duplicated by multiple qualifying components or servers with the same oriResId. For per-server event counts, lowering hides both Server identity keys in GROUP BY while exposing the requested name. Removing the Event tenant key or extending Server grain without updating it is diagnosed. Q0392/Q0396 test fans; Q0395/Q0397 test PSU health `unknown` (integer wire -2, not `warning`) and canonical Huawei manufacturer, with externally supplied UTC bounds. Other component carriers remain separate probes. The alarm time column is `OCCURUTC`, not `OCCUR_UTC`. |
| Two KPI thresholds on one device | Q0088-Q0093 | Two independent KPI aliases joined to a device multiply sample rows. For AVG this happens to leave each average unchanged when both sides are nonempty, but it must not be generalized to SUM, COUNT, or different time/sample filters. Declare each metric's sampling grain and aggregation, evaluate each threshold over its own eligible samples, then intersect qualified device identities. Each qualification must use a named Safe sample-to-owner relation covering the owner's complete declared grain; a missing tenant key, FanOut relation, or owner grain extension without corresponding relation keys is diagnosed. Check that an absent sample on either side excludes the device, and that duplicating one side cannot change a count/sum on the other. Q0091 asks for the number of *qualified devices*, not joined sample pairs. Q0091/Q0092 use `AVG(portCount)`/`AVG(operStatusCount)` while IC's device MetricSet declares both as `Sum`: the model now explicitly names sample Avg summaries alongside unchanged Sum metrics; an intent must select the declared knowledge point, never silently override the published metric. |
| Historical qualification, separate observation | Q0105-Q0110 | Count samples above a raw-value threshold in one window, then aggregate or list samples in another window for the *same qualified device*. `qualify_samples` selects owners by sample predicate and count; `observe_qualified` uses a second sample scope and window for the observation. Both the qualification and observation relations must be Safe and cover the owner's complete declared grain; losing the tenant ownership key in either path is diagnosed. The Q0108 trend probe supplies calendar-month bounds externally (it does not convert a month to 30 days). Both scopes follow the resource+tenant ownership relation; projection order cannot change the observation root. `scripts/check-sample-execution.sh` runs the generated SQL against distinct-tenant SQLite fixture rows. |
| Upper-bounded matching sample count | Q0062-Q0064 | `qualify_sample_count` explicitly declares nonnegative inclusive `min_matches`/`max_matches`, raw sample predicate and UTC window. `NOT EXISTS` with `COUNT > max` includes zero when min is zero; an additional grouped EXISTS enforces a positive minimum. Its KPI→Owner relation must be Safe and cover every field of the Owner's declared grain; removing tenant identity, changing the kind to FanOut or extending the Owner grain without new keys is diagnosed. The SQLite fixture covers 0/1/4/5 matches and same resource ID across tenants. Natural language "fewer than five" includes zero; corpus INNER JOIN excludes it. The agent/domain must select `0..4` or `1..4` explicitly rather than infer that discrepancy from SQL. |
| Component filter versus metric ownership | Q0165-Q0173 | A frame/interface/slot predicate can select a parent device; its KPI remains device-owned. `observe_qualified.components` uses a correlated EXISTS: Q0170-shaped Top-N cannot duplicate KPI rows when two frames match. Explicit `observe_qualified.context` instead selects a named child-to-owner relation and child dimensions: a row-level device KPI sample is shown once *per matching child*, intentionally; an aggregate is grouped by hidden child and owner entity grains. The Frame→Device Safe relation covers Device's declared `(id,tenant_id)` grain; a foreign-tenant frame with the same parent ID cannot qualify or replicate device KPI rows. Two same-name frames yield two independent 241 aggregates, never a merged 482. This presents a parent metric in a child context, not a child-owned metric or allocation; contextual values are not additive across children. The tenant equality on Frame→Device is an explicit pressure-model contract pending IC production confirmation; interface/slot carriers and their own Model facts are not claimed complete. |
| Calendar windows and encoded time | Q0044-Q0046, Q0090, Q0105-Q0110, Q0215 | Distinguish calendar month from fixed N-day duration; distinguish source encodings from canonical UTC-second text. Device creation time is declared Local/epoch-ms over Int; `time_domain` exposes the role and externally resolved integer bounds filter the physical column. A local wall time alone is not a valid bound: the external time context must supply timezone-resolved half-open milliseconds. `utc_days_window` still covers canonical UTC text only. Native PostgreSQL timestamps and full calendar arithmetic remain separate gaps. |
| ONU creation time and separate KPI trend | Q0044 | PON device declares PrimaryKey id, alias, ONU classification and Local/LocalEpochMillis createTime; MetricOnu has a separately sampled UTC ts and raw ifInBandRate with declared Avg/% metric meaning. IC lists both `ONU` and `光猫` for the same wire and stable `onu` value; `canonical_alias` exposes the latter in value-level discovery without admitting it as a filter ID. The source data link names id=resId; the corpus table `PonDeviceOnuKPI` is an acceptance mapping, not an IC product SQL mapping. A `utc_window` over ONU KPI must use the named metric dataset as root even when visible PON name is projected first: the output order cannot change the sample grain. Bind externally resolved integer creation bounds independently from UTC sample bounds and preserve raw rate and chronological order. Wrong local text bounds or treating createTime as UTC fail. The SQLite fixture includes a same-name second ONU at the exclusive creation boundary, a wrong classification, a wrong alias and a sample at the exclusive UTC boundary. |
| Published Boolean slot attribute | NetworkSlot Model | IC publishes `is_daughter_card: Bool` and maps physical `isDaughterCard: Bool`; lo must recognize built-in Bool as a scalar rather than a business enum. Eq/Ne use JSON booleans and Bool binds; wrong input kinds and order/text operators fail. A two-row SQLite fixture checks true and not-true separately. StorageDisk's `virtual_disk: Bool` is an unpublished same-type cross-check, not a declared query field. |
| Bilingual knowledge-point discovery | NetworkSlot Model and Chinese corpus | IC names Slot `Slot`/`单板` and its Boolean field `Subboard`/`是否子卡`. Dataset, dimension, measure and named-relation annotations expose English/Chinese labels and summaries in both full and subject discovery; aliases still cross-reference stable IDs. Empty or duplicate locales and misplaced targets fail during preparation. Intent still names only stable IDs; locale negotiation remains a separate question. |
| Localized canonical business values | PON communication-state mappings | IC maps six textual physical codes to one stable `offline` value and publishes `Offline` / `离线`; `online` likewise publishes `Online` / `在线`. Field-level `localized_canonical_value` exposes both locales under each value ID in full and subject dimension discovery. Subject discovery omits physical codes, while filtering by `offline` binds all six codes; filtering by `离线` fails. The SQLite fixture selects all six offline rows and excludes online. Empty labels/locales, duplicate locales, unknown IDs and wrong-field declarations fail during preparation. |
| Exclude canonical subtype | Q0215 storage-device subtype; PON communication state | IC maps `FCSwitchDevice` to `fc_switch_device`; all nine published storage subtypes remain in the closed canonical domain. An intent filtering `Ne(fc_switch_device)` binds the physical exclusion and also requires a known mapped subtype; raw `FCSwitchDevice` is rejected as an intent value. PON `Ne(offline)` requires AND across all six excluded codes and a known-value guard, excluding all offline rows while retaining online. SQLite verifies NULL and unmapped physical values do not pass `Ne`. Unknown canonical values, unsupported operations and missing Ne/And/Or profile capability fail. |
| Tenant access window and storage counts | Q0215 | IC declares `TENANT_ACCESS_TIME` as epoch-ms LocalTimestamp and StorageDevice→Tenant by tenant ID. The pressure model maps an externally resolved half-open millisecond window, uses a named Safe relation and canonical `Ne(fc_switch_device)`, groups by hidden tenant identity, and displays tenant name plus count of non-null storage IDs without HAVING. SQLite distinguishes two same-name tenants (2 vs 1 devices), tests both time bounds, FC exclusion, and rejects unmapped/NULL subtypes. The domain model supplies the time bounds; SQLite execution is not a PostgreSQL dialect claim. |
| Child-grain KPI summarized at device | Q0328, Q0332, Q0342 | Q0332/Q0342 have bounded/all-history `observe_related` acceptance over AP-radio-SSID samples: IC metadata describes `resId` as SSID ID and `parentId` as AP ID, while the product link explicitly joins `(parent_id,tenant_id)` to Device `(id,tenant_id)`. The pressure Model declares candidate sample grain `(res_id,tenant_id,ts)`, retains IC's published Sum and separately declares a raw-sample Avg; a named Safe relation and hidden full AP grain group pool raw samples. SQLite checks unequal sample counts across SSIDs (pooled 25 versus incorrect equal-SSID mean 20), window/all-history means (25/38), three same-name AP identities (25/70/5) and foreign-tenant exclusion. Missing tenant relation key and unrelated relation fail. The sample grain remains a production contract to validate. Q0328's conditional PON-port Max acceptance is described below. An AP-wide latest whole sample is not implied when several SSIDs share a timestamp. |
| Top raw samples per owner | Q0035-Q0037, Q0401-Q0403 | `sample_top` declares metric dataset, named Safe sample-to-owner relation, owner, selected raw ranking dimension, UTC bounds and per-owner take. The relation must cover every field of the owner's current declared grain; dropping tenant ownership while retaining a Safe label is rejected. It derives hidden partition keys from full owner grain and stable tie-breakers from full metric sample grain, preserving visible projection. Q0036 executes against namesake devices and equal values. The Q0401 interface fixture adds a Safe port->device ancestor whose relation covers Device's complete `(id,tenant_id)` grain, then filters site+tenant inside one two-hop correlated EXISTS over the FanOut OR site relation; a same-id blue-tenant port cannot borrow a red-tenant device's site. Dropping the ancestor tenant key or extending Device grain without extending this relation is diagnosed in both scoped Top-N and independent KPI qualification. Duplicate matching sites cannot alter per-interface ranking and split-site tenant/name matches are rejected. Port.tenantId=Device.tenant_id is a pressure-model contract awaiting production mapping confirmation: IC's original link publishes only `refParentNE=id` and marks Device.id a PrimaryKey. |
| Peer-qualified raw KPI trend | Q0075-Q0077 | `observe_peer_related` combines a named KPI→owner Safe relation with an exchangeable, named A/Z peer hub. The question and SQL ask for raw `(value,ts)` rows ordered by `ts`, **not** daily bucket aggregates; Q0075's SQL filters the neighbor as router although its question says switch, so its SQL is not a business definition. Physical A/Z positions do not impose direction on this bidirectional business connection: `peer_hub_relation_fields` preserves both complete device identities and matches either orientation **on the same link row**. A correlated two-hop EXISTS keeps each eligible sample once despite duplicate links; a self-loop and cross-tenant endpoints cannot qualify it. The pressure fixture includes external half-open UTC bounds, same-name owners, tied timestamps, unrelated endpoints and both orientations; swapped relation names and incomplete owner keys fail. Truly one-way connections must use the separate directed declaration. The production tenant-alignment assumption remains to validate because IC's original entity links publish only device IDs. |
| Event-count qualification before KPI observation | Q0444-Q0446 | Existing `observe_qualified.components` accepts a named Event-to-owner relation, event filter and `min_matches`; it evaluates event count in a correlated grouped EXISTS before aggregating the separate KPI carrier. For an Event carrier, the named Safe relation must cover the owner's complete declared grain: dropping the alarm tenant key is diagnosed before event counting. The acceptance model maps IC's textual alarm severity wire `"1"` to `critical` and declares an explicit Max sample summary alongside the original Avg KPI. SQLite excludes cross-tenant count mixing and major alarms. This proves the model/lowering combination, not a complete server KPI model; non-event Frame ownership remains subject to its separate primary-key-scope contract. |
| Site-scoped event alternatives | Q0123-Q0131 | `exists_via` now accepts a typed, closed `any_of` group on a related event dimension and an optional `site_scope` naming the owner's FanOut OR site relation and Safe site-to-tenant relation. The two independent correlated EXISTS preserve device identity; the site and tenant predicates belong to the same site candidate. The Q0129 fixture checks duplicate matching sites and alarms, split-site tenant/name matches, cross-tenant alarms, and missing event matches. Wrong relation roles, wrong OR dimension role, and empty OR groups fail with diagnostics. |
| Reverse fan-out row projection | Q0147-Q0149 | Site-filtered `(site, device)` output is not an implicit Safe traversal or a site existence test: `list_relation` requires the explicit Device-to-Site FanOut OR relation and site as base. Its `rows` mode preserves declared endpoint identities even for equal names, while `distinct` intentionally returns a set of visible value pairs like the corpus SQL. A pair matching both OR keys appears once; a device at two different sites produces two rows. Invalid relation and third-party dimensions fail before lowering. |
| Tenant qualification by site | Q0138-Q0143 | Tenant is the counted/projected owner, and a named reverse Site-to-Tenant Safe relation supplies the site filter in correlated EXISTS. Two qualifying sites in one tenant must still count one tenant; tenants with no qualifying site are excluded. Site type is a declared canonical wire, not an ad hoc SQL literal. Existing `exists_via` is sufficient; no new shared operator is needed. |
| Server components under a site and tenant | Q0184-Q0192 | Q0190 selects ServerFan identities through possibly non-unique `parentResId=oriResId`, ServerDevice's FanOut OR site alternatives, and Site's Safe tenant relation. Three-hop correlated EXISTS keeps the fan as the outer row and checks the independently declared Fan/Server tenant ownership against the same Site tenant. Named relation and filter roles are mandatory; duplicate parents/sites cannot replicate a fan. The corpus Q0184 text says count fans with warning servers, but its SQL counts distinct server names with health wire -1 (`error` in IC, not `warning`=1), so it cannot define the fan-count semantics. |

Q0328 now has a separate PON-port acceptance carrier. The published PON data link
contains only `PonDevice.id = MetricPonPort.parent_id`; `PonDevice.id` is marked
PrimaryKey, but the scope of that key across tenants is not independently
verified. Unlike AP-SSID, the product does not publish a tenant equality for
this link, so the pressure fixture states its global-ID assumption rather
than silently add a tenant join. The logical KPI metadata calls `resId`
"Device ID" and marks it `isPK: Y`, while the product metric set calls it
"Resource ID" and also supplies `port_name`; neither source establishes a
unique port identity or sampling grain. The candidate `(res_id,tenant_id,ts)`
grain must be checked against real data. Q0328's `observe_related` selects Max
over all eligible raw port samples per offline GPON within externally resolved
half-open UTC bounds; IC's published `if_in_band_rate` Avg/% remains a separate
knowledge point. The SQLite fixture tests multiple ports and samples, seven
same-name device identities, all six offline codes, online/unknown/non-GPON
exclusion and both window boundaries; an unrelated relation and a relation
missing an extended owner-grain key fail. This validates a conditional model,
not production identity or sample uniqueness.

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
Explicit `port_count_sample_avg`, `used_port_sample_avg`, and
`running_port_sample_avg` now model the alternative sample-mean knowledge
points, preserving the original Sum measures and units. `metric_domain`
exposes each role and aggregation; qualification selects the named Avg rather
than overriding the Sum metric. The two thresholds lower as separate EXISTS
with complete resource-and-tenant correlation, and the count remains over
device identities. Router and firewall class values use IC's source wires.
The fixture tests same-ID devices in different tenants and missing values on
one side of the qualification, with externally supplied three-day UTC bounds.
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

Q0111/Q0120 add a compositional pressure to `qualify_metrics`: a Safe owner
ancestor supplies device filters, a two-hop site/tenant EXISTS supplies
FanOut qualification, and each interface's KPI AVG/HAVING remains in its own
EXISTS. `scope` names all three Model relations and filters by their respective
roles; a mismatched relation or role fails at lowering. Q0120 additionally
separates the raw `ifOutErrors < 58` WHERE predicate from `Avg < 58` HAVING.
The executable fixture includes duplicate eligible sites, a wrong-tenant
site, an interface without samples, and same-name interfaces. A plain site
JOIN would turn one qualified interface into two counted rows; treating the
pre-aggregate predicate as HAVING alone would change the qualifying set.
