# iCloud model challenge

This crate is an acceptance fixture derived from actual declarations in
`imaster-cloud/telora/src/modeling/icloud`. It is not a production iCloud model
and must not be presented as a complete interpretation of that domain.

| Source fact | Current representation | Acceptance requirement |
| --- | --- | --- |
| Network device identity includes resource ID and tenant ID | Entity dataset grain `(id, tenant_id)`; the KPI ownership relation maps both fields | Grouped KPI observations retain both keys as hidden GROUP BY dimensions so namesake devices remain distinct while only requested labels and metrics are projected. |
| Network device and current alarm are linked by device id = MEDN **and** tenant id | Named composite relation; event grain `csn`; `min_matches` groups by both keys | Treat this as a named subject-to-event data link, not just an entity relation. |
| `occur_utc` is the alarm's authoritative UTC time field; `occur_time` is local | Event grain and UTC/Local field encoding are declared; `utc_window` validates canonical UTC seconds and lowers on `occur_utc` | Support richer instant encodings and time roles without accepting local values as UTC. |
| Physical link has A and Z device endpoints | `directed_peer_hub_fields` and two explicitly selectable, described A/Z relations | Query preserves the declared A/Z positions without an exchange branch. |
| Network device communication state has canonical `offline` backed by both `"1"` and `"offline"` | `@canonical_values` on the device field | Filtering binds both wires, and projection/grouping returns the same business id; unexpected stored wires return NULL pending source-data validation. |
| Network physical-link status maps integer wires 2 and 3 to `fault` | `@canonical_values` on an integer field | Filtering by `fault` binds both integers without changing the business-value contract. |
| KPI metric sets have a sampling grain, aggregate meaning and unit | KPI carrier declares `(res_id, tenant_id, ts)` grain, UTC `ts`, `cpu_usage` Avg/% and `port_count` Sum; metadata is checked against lowerable measures | Enforce actual timestamp semantics and permissible grouping across grains; the carrier is not yet a full MetricSet contract. |
| Site lookup admits either `projectId` or `refParentSubnet` as the site key | Named `RelationKey.Or` connects network device to governance site | A frame-root query reaches its device and site through the alternatives, without treating them as a composite AND. |
| Frame belongs to a device; device KPI samples belong to a device through `(resId, tenantId)` | Frame and KPI rows have separate declared grains with upward safe paths | KPI aggregation by device is lowerable; frame-owned KPI semantics and cross-grain grouping remain unproven. |
| A frame's normal running state maps wires 3, 11, 13, 15, 16 | Canonical `frame_oper_state` on the physical frame; `frame_belongs_to_device` is named | The frame may qualify a device's KPI observation through correlated EXISTS without multiplying sample rows; displaying the frame as a result grain remains a separate contract. |
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
