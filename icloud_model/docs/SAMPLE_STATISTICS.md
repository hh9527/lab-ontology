# Source-backed sample statistics

This describes the product Model (`icloud-source-v19`).
Agents discover these declarations through `ic/info`; this
document records model-author decisions and source limitations.

## Choosing a statistical meaning

The product declares `device_cpu_latest`, `device_memory_latest`,
`server_cpu_latest` and `server_memory_latest`. These return the original
percent value from the latest eligible sampling row, preserving a selected
NULL. CPU/memory on one sample node share the same row. Latest is neither
latest non-NULL nor Avg/Max. Select through `measures`; qualify with
`measure_having`, rank with `top_by_measure`, or compare windows through
GraphPair aligned on owner identity. Explicit row filters and windows apply
before selection, and NULL-time rows cannot supply Latest. No implicit current
time or extra validity filter is introduced. See the linked
`Schema/syntax/graph/latest` knowledge point and
[Latest measures](../../ontology/docs/LATEST-DESIGN.md).

Each measure ID fixes one meaning. An average is not a default that callers can
override. Select another declared ID for another meaning; an undeclared ID is
rejected. The engine cannot compare an Intent to natural-language requirements
that were never supplied to it. Lowering success proves Model legality, not that
the Agent chose the user's intended statistic.

Online-rate regression commands (after publishing the current IC snapshot):

```sh
bin/telora -C icloud_model test online_rate --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048
node scripts/check-icloud-online-rate.mjs bin/icloud_model.snapshot.wasm
node scripts/check-icloud-cpu.mjs bin/icloud_model.snapshot.wasm
node scripts/check-icloud-kpi-measures.mjs bin/icloud_model.snapshot.wasm
```

| Population | Raw dimension | Average | Maximum sample | Minimum sample |
| --- | --- | --- | --- | --- |
| Device CPU | `device_cpu_sample` | `cpu_usage` | `cpu_peak` | `device_cpu_sample_min` |
| Device memory | `device_memory_sample` | `memory_usage` | `memory_peak` | `device_memory_sample_min` |
| Device online rate | `device_kpi__onlineRate` | `device_online_rate_avg` | `device_online_rate_max` | `device_online_rate_min` |
| Network online-rate table | `source_NetworkDeviceOnlineKPI__onlineRate` | `network_online_rate_avg` | `network_online_rate_max` | `network_online_rate_min` |
| PON device online rate | `source_PonDeviceKPI__onlineRate` | `pon_online_rate_avg` | `pon_online_rate_max` | `pon_online_rate_min` |
| PON online-rate table | `source_PonDeviceOnlineKPI__onlineRate` | `pon_online_table_rate_avg` | `pon_online_table_rate_max` | `pon_online_table_rate_min` |
| Server CPU | `server_cpu_sample` | `server_cpu_usage` | `server_cpu_peak` | `server_cpu_sample_min` |
| Server memory | `server_memory_sample` | `server_memory_usage` | `server_memory_sample_max` | `server_memory_sample_min` |
| Storage / FC CPU | `source_StorageDeviceKPI__cpuusage` | `storage_cpu_usage` | `storage_cpu_sample_max` | `storage_cpu_sample_min` |
| Storage / FC memory | `source_StorageDeviceKPI__memoryusage` | `storage_memory_usage` | `storage_memory_usage_max` | `storage_memory_usage_min` |
| Disk utilization | `source_StorageHardDriveKPI__utility` | `storage_disk_usage` | `storage_disk_usage_max` | `storage_disk_usage_min` |
| Disk average read I/O size | `source_StorageHardDriveKPI__avgreadiosize` | `storage_disk_read_io_size` | `storage_disk_read_io_size_max` | `storage_disk_read_io_size_min` |
| Disk average write I/O size | `source_StorageHardDriveKPI__avgwriteiosize` | `storage_disk_write_io_size` | `storage_disk_write_io_size_max` | `storage_disk_write_io_size_min` |
| PON CPU | `source_PonDeviceKPI__cpuUsage` | `pon_cpu_usage` | `pon_cpu_sample_max` | `pon_cpu_sample_min` |
| Device port usage | `device_kpi__ifUtilizationRate` | `device_port_usage_avg` | `device_port_usage_max` | `device_port_usage_min` |
| Interface inbound bandwidth | `interface_kpi__ifInBandRate` | `interface_in_band_usage_avg` | `interface_in_band_usage_max` | `interface_in_band_usage_min` |
| Interface outbound bandwidth | `interface_kpi__ifOutBandRate` | `interface_out_band_usage_avg` | `interface_out_band_usage_max` | `interface_out_band_usage_min` |
| ONU receive bandwidth | `onu_receive_usage_sample` | `onu_receive_usage` | `onu_receive_usage_max` | `onu_receive_usage_min` |
| PON port receive bandwidth | `pon_port_receive_sample` | `pon_port_receive_usage` | `pon_port_receive_sample_max` | `pon_port_receive_sample_min` |

- A trend projects raw samples and sample timestamps, without aggregation.
- Storage/FC and PON CPU use eligible stored samples. Avg is the arithmetic
  mean, Min/Max are sample extrema; NULL is ignored and an all-NULL population
  has no value. There is no time weighting, effective-count weighting, inferred
  validity filter or rescaling. StorageDeviceKPI declares the CPU unit as
  percent (%); the PON CPU unit remains assumed, TODO(#47): confirm it against
  source metadata. Storage and FC share the KPI
  table but use their own declared resource relations and populations.
- StorageDeviceKPI memory and StorageHardDriveKPI utilization declare percent
  units. Read/write I/O size declares kilobyte (KB); TODO(#58): confirm the byte
  multiplier before conversion. No unit conversion is performed. An arithmetic
  average of already-averaged I/O size samples is not a global per-operation
  average; extrema likewise describe stored averages, not individual I/O.
  Effective counts are not used as weights or validity predicates. Disk owner
  identity and its relation remain unresolved; disk KPI queries use the dataset's
  resource identifier and time window directly.
- Collaboration devices have no declared CPU sample source. CPU questions for
  this resource family are unsupported; missing CPU is not zero.
- The shared storage CPU measure has two owner populations: `storage_device`
  via `source_HuaweiStorageDeviceAssociationStorageDeviceKPI`, and
  `source_FCSwitchDevice` via `source_FCSwitchDevice_StorageDeviceKPI`.
  Both relations lead from owner to `source_StorageDeviceKPI`. For GraphPair
  period comparisons, root/group/align each owner identity and measure its KPI
  samples in each window. FC explicitly declares entity grain `source_id`.
  The KPI grain includes sample time and is suitable for sample-point pairing;
  disjoint windows cannot pair equal timestamps and are rejected.
- Online-rate averages preserve the reported numeric scale and average eligible
  non-NULL stored rows. They are neither time-weighted nor weighted by
  `onlineRateEffcnt`; all-NULL groups have no average. Source descriptions do not
  establish a percentage unit or formula. The four tables are distinct sample
  populations, not interchangeable sources. No online-rate Sum is added.
- All four sources publish sample Min/Max. Ordered numeric samples give these
  statistics a defined meaning; existing use cases validate examples but are
  not an admission whitelist. Support follows Model semantics unless there is
  an explicit reason to prohibit it.
- Min/Max ignore NULL and return no value for all-NULL populations. They are
  not extrema of period averages and do not prove continuous availability or
  SLA compliance. Missing observations are not covered; no validity filtering
  is inferred from onlineRateEffcnt. A sum of rates still lacks a declared
  additive business meaning.
- Source online-rate carriers declare plain Avg/Min/Max measures without introducing
  new sample uniqueness or metric dataset grains. Existing owner identities and
  declared relation cardinalities govern grouped queries; no tenant equality is
  invented beyond the original relation. Product device and PON identity is `id`.
- Average is the arithmetic mean of eligible stored samples, not a time-weighted
  mean. Maximum/minimum operate on those samples, not on period averages.
- Aggregates ignore NULL. An empty/all-NULL population has no Avg/Min/Max value,
  not zero. No new claim about source collection frequency or validity is made.
- A threshold on the average differs from a threshold on the maximum. For
  `>= t`, maximum qualification means at least one eligible non-NULL sample
  reached `t`; this equivalence does not apply indiscriminately to every operator.
- Count qualifying observations by filtering the raw dimension, counting the
  sample node, and applying `count_having`. This counts stored rows, not distinct
  devices, elapsed duration, or a source `*Effcnt` counter.
- Preserve the requested owner identity and window. `top_by_measure` ranks the
  declared statistic; raw ascending `take=1` is not per-owner Min and may select
  NULL. Shared aggregate/order contracts remain discoverable through `info`.
- Percentage/gauge samples are not declared additive. There is no new Sum
  statistic and no `{measure,aggregate}` override syntax.

## Terminology and source uncertainty

All four online-rate populations declare their Avg as a primary sample measure and
Min/Max as sample summaries. PonDeviceKPI explicitly declares unitName: percent,
so its summaries use % and a 90% threshold uses raw value 90. NetworkDeviceKPI
has no unit declaration; both online-rate tables declare ratio/one and the PON
online-rate table also specifies percent display formatting. These three
populations provisionally use % on a 0-100 scale, matching generated SQLite
data: a 90% threshold uses raw value 90, without rescaling.
TODO: confirm this assumed scale against production data. Generated data and
display units do not independently prove production storage scale.

Device port occupancy, interface bandwidth utilization, ONU bandwidth and
PON-port bandwidth are different quantities. The general Chinese expression
“端口利用率” deliberately maps to multiple declared concepts. Terminology assists
interpretation; it does not authorize automatic substitution. Related links
connect the device/interface/PON candidates without creating query relations.
Existing canonical IDs remain the only query vocabulary.

`NetworkDeviceKPI.logical.yaml` describes `ifUtilizationRate` as “Percentage of
all online ports on a device”, but provides neither a numerator/denominator nor
a numeric scale/unit declaration. The Model preserves that uncertainty: it does
not infer used/total or online/total from sibling counters, rescale the values,
or attach a guessed `%` unit. Its new statistics operate on the source-reported
numeric values only. Formula-based questions require further domain evidence
or clarification, not an invented formula.

CPU/memory percent units follow source metadata and the existing metric
declarations. Interface bandwidth utilization retains its existing unspecified
unit. ONU/PON receive statistics retain their existing metric units.

## Wireless, ONU, PON-port, interface and board samples

Forty sample fields across seven KPI datasets expose 104 measures. The base ID
is the arithmetic mean. Interface additions use Avg, matching the existing
interface packet-rate/error measures. The other six datasets also expose
suffixes `_max` and `_min` for raw sample extrema.
The executable expectations in `scripts/tests/fixtures/icloud-kpi-measures.mjs`
list every dataset, physical column, measure base ID and unit. Measures publish
Chinese aliases and links to the corresponding raw dimensions.

ONU optical powers use dBm, temperatures degC, utilization %, and data rates
bit/s. PON-port power/temperature/data rates use the same units. Interface
packet rates use packets/s. AP Ethernet and radio data rates use kbit/s;
radio interference uses dBm. Board CPU/memory use % and temperature degC.
SSID byte samples use byte: their Avg/Min/Max summarize reported observations,
not cumulative traffic across the selected period. No Sum is declared.

TODO(#51): interface data-rate descriptions say bytes/s and display metadata
specifies rate=8, whereas unitName says bits_per_second. The Model provisionally
uses byte/s for stored values and performs no conversion. Confirm the raw unit.
PON-port bandwidth metadata says unitName=one but displays %; preserve raw values
and provisionally assume %, with a TODO on both receive and transmit statistics.
Radio RSSI has no explicit unit contract; it remains unspecified.

AP, radio and board KPI datasets provisionally use tenant/resource/UTC sample
time as their grain. TODO(#51): validate production uniqueness. The source only
marks resId as a primary key and does not establish sample uniqueness. Existing
owner relations remain the published source relations; no tenant join is inferred.
These grain declarations do not prove production uniqueness or collection cadence.

The four online-rate tables describe distinct observation populations in both
dataset and measure documents. The current-alarm table includes whatever clearance
states its rows report. `alarm_open_count` explicitly counts CLEARED=0; asking for
current alarms without a clearance condition does not imply that filtered count.

Canonical member names are scoped by nominal Type. `PonClass` and `PonOltClass`
each publish `olt` with their original encoding; shared names do not merge Types.
`PhysicalLinkType` publishes `lldp`, `csp`, `server_internal`, `fiber_search` and
`manual` for the corresponding source encodings 1, 7, 8, 9 and 99.

## Regression

All 17 KPI timestamp carriers declare UTC hour/day/month bucket dimensions.
Their IDs are `<dataset>_utc_hour`, `_utc_day`, `_utc_month`; ONU uses the compact
prefix `onu_utc_*`. Select one alongside a declared measure, filter the raw sample
time dimension, and order the bucket dimension when a chronological trend is
required. Bucket outputs remain DatetimeUtc; they represent bucket starts, not
labels or elapsed durations. Knowledge links each bucket to its shared operation
contract. Declaring buckets does not create missing measures for source carriers.

`tests/sample_meanings.telora` exercises the actual product Model: explicit
Avg/Max/Min SQL and bindings, owner grouping, peak HAVING/ranking, raw trends, qualifying
sample counts, rejection of undefined Sum and aggregate overrides, alternative
knowledge links and ambiguous terminology. The historical synthetic fixture
is intentionally unchanged.
