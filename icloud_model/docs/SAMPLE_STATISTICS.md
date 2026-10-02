# Source-backed sample statistics

This describes the current product Model (`icloud-source-v5`), not the historical
pressure fixture. Agents discover these declarations through `ic/info`; this
document records model-author decisions and source limitations.

## Choosing a statistical meaning

Each measure ID fixes one meaning. An average is not a default that callers can
override. Select another declared ID for another meaning; an undeclared ID is
rejected. The engine cannot compare an Intent to natural-language requirements
that were never supplied to it. Lowering success proves Model legality, not that
the Agent chose the user's intended statistic.

Online-rate regression commands (after publishing the current IC snapshot):

```sh
bin/telora -C icloud_model test online_rate --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048
node scripts/check-icloud-online-rate.mjs bin/icloud_model.snapshot.wasm
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
| Device port usage | `device_kpi__ifUtilizationRate` | `device_port_usage_avg` | `device_port_usage_max` | `device_port_usage_min` |
| Interface inbound bandwidth | `interface_kpi__ifInBandRate` | `interface_in_band_usage_avg` | `interface_in_band_usage_max` | `interface_in_band_usage_min` |
| Interface outbound bandwidth | `interface_kpi__ifOutBandRate` | `interface_out_band_usage_avg` | `interface_out_band_usage_max` | `interface_out_band_usage_min` |
| ONU receive bandwidth | `onu_receive_usage_sample` | `onu_receive_usage` | `onu_receive_usage_max` | `onu_receive_usage_min` |
| PON port receive bandwidth | `pon_port_receive_sample` | `pon_port_receive_usage` | `pon_port_receive_sample_max` | `pon_port_receive_sample_min` |

- A trend projects raw samples and sample timestamps, without aggregation.
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
declarations. ONU/PON receive statistics retain their existing metric units;
new interface bandwidth statistics leave the unit unspecified rather than
infer it from the field name. This is a bounded addition for the reported
pressure families, not a policy to add every aggregate to every numeric field.

## Regression

`tests/sample_meanings.telora` exercises the actual product Model: explicit
Avg/Max/Min SQL and bindings, owner grouping, peak HAVING/ranking, raw trends, qualifying
sample counts, rejection of undefined Sum and aggregate overrides, alternative
knowledge links and ambiguous terminology. The historical synthetic fixture
is intentionally unchanged.
