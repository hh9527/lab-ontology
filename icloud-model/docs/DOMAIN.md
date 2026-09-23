# iCloud model challenge

This crate is an acceptance fixture derived from actual declarations in
`imaster-cloud/telora/src/modeling/icloud`. It is not a production iCloud model
and must not be presented as a complete interpretation of that domain.

| Source fact | Current representation | Acceptance requirement |
| --- | --- | --- |
| Network device identity includes resource ID and tenant ID | Entity dataset grain `(id, tenant_id)`; the KPI ownership relation maps both fields | Grouped KPI observations retain both keys as hidden GROUP BY dimensions so namesake devices remain distinct while only requested labels and metrics are projected. |
| Device creation time is local-facing but stored as epoch milliseconds | `create_time` is Int mapped to `createTime`, marked Local/LocalEpochMillis and discoverable through `time_domain`; `device_create_ms` accepts numeric range predicates | An external time context must resolve a wall time and applicable zone into half-open integer bounds; the Model does not guess timezone or treat this field as a UTC-text dataset clock. |
| Network device and current alarm are linked by device id = MEDN **and** tenant id = TENANTID | Named composite relation; event grain `csn`; `min_matches` groups by both keys | Treat this as a named subject-to-event data link, not just an entity relation; the alarm's physical column is `TENANTID`, never `TENANT_ID`. |
| Server fan can qualify a server's alarm events without owning them | Alarm→Server uses `(MEDN,TENANTID)=(id,tenantId)`; Server grain includes `(id,tenant_id)`; Fan→Server retains a potentially non-unique `parentResId=oriResId` FanOut relation and Fan/Server each declare tenant ownership | `observe_event_component` uses correlated fan EXISTS with tenant alignment, keeping event identity and rejecting unrelated component roles; for grouped counts the Server name is visible but both Server identity keys remain in GROUP BY. Q0392/Q0396 fixtures use the physical `OCCURUTC` column with externally supplied bounds. |
| Tenants with more than five uncleared alarms | Alarm `CLEARED` maps business `uncleared` to integer wire 0, and `alarm_tenant_id` identifies groups through `TENANTID` | `count_groups` filters events, groups by tenant identity with an alarm-count HAVING threshold, then counts groups; it does not count alarm rows or group by tenant display name. |
| `occur_utc` is the alarm's authoritative UTC time field; `arrive_utc` is a distinct UTC arrival clock; `occur_time` is local | Event grain and UTC/Local field encoding are declared; `utc_window` validates canonical UTC seconds and lowers on `occur_utc`, while `utc_field_window` explicitly targets a declared secondary UTC field such as `arrive_utc` | Support richer instant encodings without accepting local values as UTC. |
| Physical link has A and Z device endpoints | `directed_peer_hub_relation_fields` binds the directed peer roles to the two described A/Z Safe relations | Query preserves A/Z positions and correlates each endpoint through the full `(id,tenant_id)` device identity. |
| Link/site qualification must preserve link identity | A/Z Link→Device named Safe relations match both device ID and tenant ID; Device→Site is FanOut with two OR keys, then Site→Tenant and Link→Tenant align | `qualify_link_site` counts/lists links by a three-hop correlated EXISTS; matching both ends or multiple sites does not multiply the outer link. The peer hub now reuses the same A/Z identity relations. IC's original entity links mention only device ID, so production data still needs validation of the tenant-alignment assumption. |
| Site-qualified device-link rows | A/Z Safe identity keys and Device→Site→Tenant with Device/Link tenant ownership | `list_link_device_site` exposes each qualifying `(Device,Link)` association; two ends may yield two rows, but site multiplicity and self-loops cannot duplicate an association. |
| Power supplies qualify server alarms | PSU→Server `parentResId=oriResId` is FanOut; PSU and Server independently belong to Tenant | The existing component observation route keeps Alarm.CSN as event grain and groups by full server identity. PSU `unknown` is physical healthStatus -2, distinct from `warning`=1. |
| Network device communication state has canonical `offline` backed by both `"1"` and `"offline"` | `@canonical_values` on the device field | Filtering binds both wires, and projection/grouping returns the same business id; unexpected stored wires return NULL pending source-data validation. |
| Network physical-link status maps integer wires 2 and 3 to `fault` | `@canonical_values` on an integer field | Filtering by `fault` binds both integers without changing the business-value contract. |
| KPI metric sets have a sampling grain, aggregate meaning and unit | KPI carrier declares `(res_id, tenant_id, ts)` grain, UTC `ts`, `cpu_usage` Avg/% and `port_count` Sum; `port_count_peak` explicitly summarizes the same raw column with Max without changing the Sum metric. Discovery marks declared metrics versus sample summaries; metadata is checked against lowerable measures. | Enforce actual timestamp semantics and permissible grouping across grains; the carrier is not yet a full MetricSet contract or an ONU-specific model. |
| Event-count qualification can precede a separate KPI observation | `current_alarm` maps textual `SEVERITY = "1"` to `critical`; its named Safe owner relation and `min_matches` correlate complete resource+tenant keys. `cpu_peak` explicitly applies Max to the original Avg CPU samples. | Q0444-shaped fixture qualifies by at least three critical alarms and observes the KPI in a separate UTC window without multiplying samples; server-specific fields remain unmodeled. |
| Matching sample count can be bounded above, including zero | `qualify_sample_count` uses the named sample-to-owner relation, raw predicate and explicit UTC window; minimum and maximum are independently declared | Q0062-shaped `0..4` and `1..4` have distinct results. Which one the business question means cannot be inferred from a reference SQL that implicitly removes zero-count owners. |
| Raw KPI samples can be ranked separately for each owner | `sample_top` uses the named Safe sample-to-device relation and device `(id,tenant_id)` grain as hidden partition keys; metric `(res_id,tenant_id,ts)` grain breaks ranking ties | Q0036-shaped Top 3 does not partition by a repeated display name or expose keys. |
| Interface sample Top-N can be qualified by device, site and tenant without multiplying samples | Interface KPI -> port -> device use named Safe relations; device -> site is FanOut OR, and site -> tenant is Safe. `sample_top.scope` validates all three named links and scopes site/tenant filters to one correlated two-hop EXISTS | Duplicate matching sites do not occupy extra ranking slots; site and tenant matches on different sites do not qualify the interface. The interface metric remains Avg while Top-N ranks raw packet-rate samples. |
| Site lookup admits either `projectId` or `refParentSubnet` as the site key | Named `RelationKey.Or` connects network device to governance site as FanOut, since two keys can identify two sites | Ordinary frame-device-site navigation cannot claim a unique site; a site predicate must explicitly select a grain-preserving qualification or a declared fan-out view. |
| Frame belongs to a device; device KPI samples belong to a device through `(resId, tenantId)` | Frame→Device binds `(refParentNE,tenantId)=(id,tenant_id)` so its Safe path covers Device's declared composite grain; KPI rows have their own composite ownership relation | KPI aggregation by device is lowerable; frame-owned KPI semantics and cross-grain grouping remain unproven. The frame tenant equality is a pressure-model contract not published by IC's original single-column entity link. |
| A frame's normal running state maps wires 3, 11, 13, 15, 16 | Canonical `frame_oper_state` on the physical frame; `frame_belongs_to_device` is named | The frame may qualify a device's KPI observation through correlated EXISTS without multiplying sample rows. |
| Showing a device KPI beside each matching frame does not transfer ownership of the metric | Frame declares entity grain `(id, tenant_id)`; explicit child context references its named Safe owner relation and selected child dimensions | Row observations repeat once per matching frame, while grouped observations retain hidden frame and device keys so same-name frames remain distinct. A foreign-tenant frame with the same parent ID cannot borrow another tenant's Device. Ordinary KPI-to-frame dimension navigation still rejects absent allocation semantics. |
| Storage device may reference two different sites by `parentResId OR projectId` | Named `FanOut` relation, normal-status canonical wire `"1"`, subclass dimension, and `COUNT(name)` measure | Q0047-Q0049 group by declared site key and name, HAVING count below five, returning name only; ordinary row projection must not assume one site per device. |

Canonical filtering, directed endpoints, explicit A/Z selection, composite-key
event count, declared device KPI aggregation and canonical UTC-second windows
pass. This does not close native timestamp/timezone handling, full
EventSet/MetricSet, or runtime data-quality diagnostics for unknown wires.
The source EventSet maps alarm `ARRIVEUTC` separately from `OCCURUTC`. The
pressure model now publishes both roles and allows a half-open arrival-time
window only when the intent names `arrive_utc`; the default `utc_window` keeps
the authoritative occurrence clock. This SQLite fixture models both as
canonical UTC-second text, not as a claim about PostgreSQL timestamp storage.

Plain open-domain dimensions now validate their declared filter input type
against the underlying String/Int/Float field at Model preparation: String
accepts Text, ordinary numeric fields may accept Int/Number thresholds, and
numeric fields cannot advertise text operations. IC's alarm CSN, local epoch-ms and
interface sample values retain their typed inputs; canonical dimensions remain
distinct because an integer physical wire such as PSU health intentionally
accepts a textual business value resolved by its declared canonical mapping.
Closed canonical domains publish exactly the Text business-input kind and Eq;
closed enum domains likewise cannot advertise non-Eq operations. In particular,
PSU health's physical integer wire is not a second agent-facing filter input.

The additional site/frame/KPI carriers are pressure probes, not a transcription
of the full iCloud network graph. `device_kpi_ts_raw` deliberately names a raw
string column; it is independently annotated as a canonical UTC-second source,
but listing it does not by itself constitute a time-window query. The bounded
`utc_window` covers an explicit `[start,end)` on the root dataset, while
`utc_days_window` and the row-level sample Top-N cover Q0043's relative-day
and raw-sample shapes with an externally supplied clock anchor. Similarly,
joining a frame to device KPI does not establish a frame-owned CPU metric:
Q0078/Q0079 require a semantic grain/aggregation decision in the Model, not
just an executable SQL join. Named field pairs resolve to canonical indexes at
preparation time; unknown or mismatched fields fail before querying. Descriptions
and cross-references in `knowledge_index` (including ordinary measure IDs such
as `alarm_count` as well as metric IDs) come from the same Prepared Model,
not from a separately authored agent prompt.
`measure_domain` resolves `alarm_count` to its event source and Count aggregate,
and distinguishes the declared `port_count` Sum from `port_count_peak` Max;
their labels and summaries are Model annotations validated during preparation.
For agent-facing discovery, `knowledge_index_for_subject` checks the subject
and omits dimensions that lowering would reject as unauthorized; privileged
callers retaining the complete payload can still inspect the full model.

Acceptance is two-sided: each row requires a successful intent with a correct
plan **and** a nearby invalid intent rejected at its original Model/intent value.
The same prepared knowledge must expose the subject, role, time, grain, value
and metric references through a progressive discovery interface. Physical
column equality alone is not a substitute for any of these business facts.

Source references: `network/entity_sets/physical_link.telora`,
`governance/event_sets/current_alarm.telora`,
`network/data_links/cross/governance.telora`, and
`network/entity_set_links/intra.telora` in the iCloud modeling tree.

Q0268 and Q0270 operate on native `EnterprisePhysicalLink` attributes:
`zPortName` filters `aPortIp`, and `aNeIp` filters link count, without a Device
JOIN. These are separate from the explicit Device A/Z relation test. The
directed peer route uses `directed_peer_hub_relation_fields` so adding native
columns cannot silently change endpoint field indexes or drop the tenant key.

For Q0047-Q0049, `qualify_group` explicitly names `storage_device_site`: an
inner fan-out join lets each qualifying storage device count toward each
matching site, as in the corpus SQL. Site ID remains in GROUP BY but not in
the visible result; grouping by site name alone would merge distinct sites.
The inner join excludes sites with zero matching devices, as the corpus query
does. This is not a unique site ownership assertion or a general safe route
from storage devices to sites.

Q0043 also pressures sample-grain Top-N: `port_count_sample` is the raw integer
sample dimension on the same physical field as the separately declared
`port_count` Sum metric. An explicit UTC window, Device alias/MAC/WAC filters,
the full resource-plus-tenant ownership key, and stable sample ordering produce
unaggregated top-five rows. The corpus SQL uses `EntNetworkElement`, whereas
the current IC source mapping names that logical source ID but declares
`I_EntNetworkElement` as its SQL relation; the fixture follows the model
mapping. For relative N-day windows, the platform supplies a validated
canonical UTC `as_of` instant and N; SQLite computes the lower bound using a
closed, bound `-N days` modifier, and the same instant is the exclusive upper
bound. The platform owns capturing that clock value; calendar-month windows
and native timestamp storage remain separate requirements. Relative windows
whose lower bound would cross before year 0001 are rejected at lowering time.

Physical-link A/Z endpoints now test simultaneous role projection: `list_roles`
names each declared Safe relation, its target dimension, and a distinct output
alias. The resulting plan joins Device twice with separate aliases and preserves
the two endpoint keys. A target dimension on the wrong relation and duplicate
output aliases, including aliases colliding with a base column, are rejected.
This shape currently accepts base dimensions only; role sorting and aggregates
need separate acceptance cases before being
considered supported. `role_filters` reference a selected role output and
reuse declared dimension operators and canonical values: Z-end device name
Contains can select a link while A-end device name is projected. A filter
dimension on the wrong endpoint is rejected. Role dimensions with canonical
values use the same Model-defined wire-to-business mapping as ordinary
dimension projection.

Q0111/Q0120 qualify an interface by its own UTC `ifOutErrors` samples while
constraining its parent device, site, and tenant. `interface_count` counts the
declared interface identity `Port.id`; `interface_out_errors` is Avg, while
`interface_out_errors_sample` filters individual integer samples before Avg.
The Port-to-Device Safe relation joins both `refParentNE=id` and
`tenantId=tenant_id`, covering the Device's declared composite grain; the
Device-to-Site OR FanOut and Site-to-Tenant chain form one correlated EXISTS. Thus multiple
matching sites never multiply interfaces or KPI rows. The KPI qualification
uses a separate correlated grouped EXISTS, and a missing sample group does not
pass HAVING. The SQLite fixture verifies these distinctions, a site with the
right name in the wrong tenant, two interfaces sharing a display name, and a
blue-tenant interface whose parent ID matches a red-tenant device. IC's
original Port-to-Device link publishes only `refParentNE=id`, so the additional
tenant equality is an explicit pressure-model contract requiring production
mapping confirmation, not a property already proved by IC's declaration.
IC declares `Port.id` as its primary key and maps KPI `resId` to it; this
acceptance does not invent a tenant key on the separate KPI-to-Port relation.

Q0091/Q0092 expose an aggregation ambiguity in corpus SQL. IC's total, used,
and running port counts retain their declared Sum aggregation. Distinct
`*_sample_avg` summaries on the same raw KPI columns are explicit Avg
knowledge points with the same units; `metric_domain` identifies them as
sample summaries. Two independent related KPI Avg predicates qualify a device
over externally supplied three-day UTC bounds, and `device_count` counts its
identity once. The fixture includes router/firewall canonical class wires,
same resource IDs in different tenants, and absent values on one side.

Q0123-Q0131 combine site qualification and named current-alarm existence for
device output or counts. The `alarm_name` dimension reads IC's `ALARMNAME`
string without inventing a closed enum: the intent explicitly supplies a
typed, nonempty OR group of accepted names. `site_scope` names the declared
Device-to-Site FanOut OR and Site-to-Tenant Safe relations; site and tenant
filters apply to the same site row. A separate event EXISTS correlates both
resource and tenant. Two matching site rows and several matching alarms must
still count one device, and a same-ID alarm from another tenant cannot qualify
it. The Q0129 SQLite fixture exercises these distinctions.

Q0147-Q0149 require visible site/device pairs. `list_relation` starts from
Site and explicitly names the reverse `device_located_at_site` FanOut OR;
ordinary `list` still rejects that traversal. Site `SITE_TYPE` carries the
model wires `onlineSite` and `offlineSite`, exposed as canonical online/offline
filters. `rows` preserves each site/device identity pair; `distinct` is a
separate visible-value-set request corresponding to the corpus SQL. A device
matching a single site by both keys produces one pair, while a device related
to two sites produces two, even when site or device names repeat.

Q0138 counts tenants owning at least one online site. A reverse use of the
declared Site-to-Tenant Safe relation qualifies each Tenant with a correlated
Site EXISTS; neither two sites in one tenant nor duplicate site names change
the count of tenant identities. The fixture also excludes offline-only and
site-less tenants. The same route can project Tenant fields after filtering
sites by name, type, or other Model-declared site dimensions.

Q0190 selects fans of qualifying physical servers. IC publishes the
ServerFan-to-ServerDevice contains key on `parent_res_id=ori_res_id`, without
declaring `ori_res_id` unique; it also publishes separate Fan/Server/Site
tenant ownership. The pressure model retains the non-unique relationship as
FanOut and uses one three-hop correlated EXISTS for parent, site OR, and
tenant, with both Fan and Server tenant IDs checked against that Site tenant.
The outer fan `id` is the row/count identity: duplicate matching parents or
sites cannot replicate a fan, and equal fan names do not merge identities.
IC has not connected the PhysicalServer production SQL mapping; the SQLite
tables here are acceptance fixtures based on the corpus, not a production
mapping claim. Q0184's prose warning state maps to IC wire 1, while its SQL
uses -1 (IC `error`) and counts distinct server names rather than fans;
neither discrepancy is silently adopted as fan-count semantics.
