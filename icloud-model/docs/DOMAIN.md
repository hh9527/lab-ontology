# iCloud model challenge

This crate is an acceptance fixture derived from actual declarations in
`imaster-cloud/telora/src/modeling/icloud`. It is not a production iCloud model
and must not be presented as a complete interpretation of that domain.

| Source fact | Current representation | Acceptance requirement |
| --- | --- | --- |
| Network device and current alarm are linked by device id = MEDN **and** tenant id | Composite `relation_key` with alarm as a separate entity | Declare a named subject-to-event data link; distinguish alarm record grain from device grain. Count alarms for a device without amplifying device rows. |
| `occur_utc` is the alarm's authoritative UTC time field; `occur_time` is local | `occur_utc` is only a String column here | A time-window intent must select the declared authoritative time role and preserve instant semantics; a local timestamp must not silently substitute for it. |
| Physical link has A and Z device endpoints | `directed_peer_hub` preserves A as origin and Z as peer | Query keeps the declared A/Z positions without an exchange branch. Named relation identity and role descriptions are still missing. |
| Network device communication state has canonical `offline` backed by both `"1"` and `"offline"` | `@canonical_values` on the device field | Filtering by `offline` binds both wires; unknown business values fail. Canonical projection is still missing. |
| Network physical-link status maps integer wires 2 and 3 to `fault` | `@canonical_values` on an integer field | Filtering by `fault` binds both integers without changing the business-value contract. |
| KPI metric sets have a sampling grain, aggregate meaning and unit | Not declared in this fixture | Bind a named metric set to its device subject and time role; aggregate only at declared grains, with metric unit and aggregation semantics available for discovery. |

The canonical-value and directed-endpoint cases pass; they do not close the
event-set, time-window, named data-link, KPI, or canonical-projection requirements.

Acceptance is two-sided: each row requires a successful intent with a correct
plan **and** a nearby invalid intent rejected at its original Model/intent value.
The same prepared knowledge must expose the subject, role, time, grain, value
and metric references through a progressive discovery interface. Physical
column equality alone is not a substitute for any of these business facts.

Source references: `network/entity_sets/physical_link.telora`,
`governance/event_sets/current_alarm.telora`,
`network/data_links/cross/governance.telora`, and
`network/entity_set_links/intra.telora` in the iCloud modeling tree.
