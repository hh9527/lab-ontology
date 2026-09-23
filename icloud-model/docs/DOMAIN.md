# iCloud model challenge

This crate is an acceptance fixture derived from actual declarations in
`imaster-cloud/telora/src/modeling/icloud`. It is not a production iCloud model
and must not be presented as a complete interpretation of that domain.

| Source fact | Current representation | Acceptance requirement |
| --- | --- | --- |
| Network device identity includes resource ID and tenant ID | Entity dataset grain `(id, tenant_id)`; the KPI ownership relation maps both fields | Grouped KPI observations retain both keys as hidden GROUP BY dimensions so namesake devices remain distinct while only requested labels and metrics are projected. |
| Device creation time is local-facing but stored as epoch milliseconds | `create_time` is Int mapped to `createTime`, marked Local/LocalEpochMillis and discoverable through `time_domain`; `device_create_ms` accepts numeric range predicates | An external time context must resolve a wall time and applicable zone into half-open integer bounds; the Model does not guess timezone or treat this field as a UTC-text dataset clock. |
| Network device and current alarm are linked by device id = MEDN **and** tenant id | Named composite relation; event grain `csn`; `min_matches` groups by both keys | Treat this as a named subject-to-event data link, not just an entity relation. |
| `occur_utc` is the alarm's authoritative UTC time field; `occur_time` is local | Event grain and UTC/Local field encoding are declared; `utc_window` validates canonical UTC seconds and lowers on `occur_utc` | Support richer instant encodings and time roles without accepting local values as UTC. |
| Physical link has A and Z device endpoints | `directed_peer_hub_fields` and two explicitly selectable, described A/Z relations | Query preserves the declared A/Z positions without an exchange branch. |
| Network device communication state has canonical `offline` backed by both `"1"` and `"offline"` | `@canonical_values` on the device field | Filtering binds both wires, and projection/grouping returns the same business id; unexpected stored wires return NULL pending source-data validation. |
| Network physical-link status maps integer wires 2 and 3 to `fault` | `@canonical_values` on an integer field | Filtering by `fault` binds both integers without changing the business-value contract. |
| KPI metric sets have a sampling grain, aggregate meaning and unit | KPI carrier declares `(res_id, tenant_id, ts)` grain, UTC `ts`, `cpu_usage` Avg/% and `port_count` Sum; `port_count_peak` explicitly summarizes the same raw column with Max without changing the Sum metric. Discovery marks declared metrics versus sample summaries; metadata is checked against lowerable measures. | Enforce actual timestamp semantics and permissible grouping across grains; the carrier is not yet a full MetricSet contract or an ONU-specific model. |
| Event-count qualification can precede a separate KPI observation | `current_alarm` maps textual `SEVERITY = "1"` to `critical`; its named Safe owner relation and `min_matches` correlate complete resource+tenant keys. `cpu_peak` explicitly applies Max to the original Avg CPU samples. | Q0444-shaped fixture qualifies by at least three critical alarms and observes the KPI in a separate UTC window without multiplying samples; server-specific fields remain unmodeled. |
| Matching sample count can be bounded above, including zero | `qualify_sample_count` uses the named sample-to-owner relation, raw predicate and explicit UTC window; minimum and maximum are independently declared | Q0062-shaped `0..4` and `1..4` have distinct results. Which one the business question means cannot be inferred from a reference SQL that implicitly removes zero-count owners. |
| Raw KPI samples can be ranked separately for each owner | `sample_top` uses the named Safe sample-to-device relation and device `(id,tenant_id)` grain as hidden partition keys; metric `(res_id,tenant_id,ts)` grain breaks ranking ties | Q0036-shaped Top 3 does not partition by a repeated display name or expose keys. |
| Interface sample Top-N can be qualified by device, site and tenant without multiplying samples | Interface KPI -> port -> device use named Safe relations; device -> site is FanOut OR, and site -> tenant is Safe. `sample_top.scope` validates all three named links and scopes site/tenant filters to one correlated two-hop EXISTS | Duplicate matching sites do not occupy extra ranking slots; site and tenant matches on different sites do not qualify the interface. The interface metric remains Avg while Top-N ranks raw packet-rate samples. |
| Site lookup admits either `projectId` or `refParentSubnet` as the site key | Named `RelationKey.Or` connects network device to governance site as FanOut, since two keys can identify two sites | Ordinary frame-device-site navigation cannot claim a unique site; a site predicate must explicitly select a grain-preserving qualification or a declared fan-out view. |
| Frame belongs to a device; device KPI samples belong to a device through `(resId, tenantId)` | Frame and KPI rows have separate declared grains with upward safe paths | KPI aggregation by device is lowerable; frame-owned KPI semantics and cross-grain grouping remain unproven. |
| A frame's normal running state maps wires 3, 11, 13, 15, 16 | Canonical `frame_oper_state` on the physical frame; `frame_belongs_to_device` is named | The frame may qualify a device's KPI observation through correlated EXISTS without multiplying sample rows. |
| Showing a device KPI beside each matching frame does not transfer ownership of the metric | Frame declares entity grain `(id, tenant_id)`; explicit child context references its named Safe owner relation and selected child dimensions | Row observations repeat once per matching frame, while grouped observations retain hidden frame and device keys so same-name frames remain distinct. Ordinary KPI-to-frame dimension navigation still rejects absent allocation semantics. |
| Storage device may reference two different sites by `parentResId OR projectId` | Named `FanOut` relation, normal-status canonical wire `"1"`, subclass dimension, and `COUNT(name)` measure | Q0047-Q0049 group by declared site key and name, HAVING count below five, returning name only; ordinary row projection must not assume one site per device. |

Canonical filtering, directed endpoints, explicit A/Z selection, composite-key
event count, declared device KPI aggregation and canonical UTC-second windows
pass. This does not close native timestamp/timezone handling, full
EventSet/MetricSet, or runtime data-quality diagnostics for unknown wires.

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
and cross-references in `knowledge_index` come from the same Prepared Model,
not from a separately authored agent prompt.

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
directed peer route uses `directed_peer_hub_fields` so adding native columns
cannot silently change endpoint field indexes.

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
