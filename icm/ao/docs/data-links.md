# Data Link 完整明细（28 条数据关联）

> 从 `umodel/data_link/*.yaml` 逐条转存：src→dest、关联类型、字段映射。

| 关联 | src | dest | data_link_type | fields_mapping |
|---|---|---|---|---|
| imaster.collaboration.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.collaboration.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.governance.source.site_view_related_to_imaster.governance.event.current_alarm | entity_source.imaster.governance.source.site_view | event_set.imaster.governance.event.current_alarm | related_to | site_id→strext13 |
| imaster.governance.source.tenant_view_related_to_imaster.governance.event.current_alarm | entity_source.imaster.governance.source.tenant_view | event_set.imaster.governance.event.current_alarm | related_to | tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.network.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.ap | entity_set.imaster.network.device | metric_set.imaster.network.metric.ap | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.ap_radio | entity_set.imaster.network.device | metric_set.imaster.network.metric.ap_radio | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.ap_radio_ssid | entity_set.imaster.network.device | metric_set.imaster.network.metric.ap_radio_ssid | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.cell_link_quality | entity_set.imaster.network.device | metric_set.imaster.network.metric.cell_link_quality | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.cell_link_traffic | entity_set.imaster.network.device | metric_set.imaster.network.metric.cell_link_traffic | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.device | entity_set.imaster.network.device | metric_set.imaster.network.metric.device | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.device_related_to_imaster.network.metric.online | entity_set.imaster.network.device | metric_set.imaster.network.metric.online | related_to | id→res_id, tenant_id→tenant_id |
| imaster.network.port_related_to_imaster.network.metric.interface | entity_set.imaster.network.port | metric_set.imaster.network.metric.interface | related_to | id→res_id |
| imaster.network.slot_related_to_imaster.network.metric.board | entity_set.imaster.network.slot | metric_set.imaster.network.metric.board | related_to | id→res_id |
| imaster.pon.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.pon.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.pon.device_related_to_imaster.pon.metric.device | entity_set.imaster.pon.device | metric_set.imaster.pon.metric.device | related_to | id→res_id |
| imaster.pon.device_related_to_imaster.pon.metric.ethernet_port | entity_set.imaster.pon.device | metric_set.imaster.pon.metric.ethernet_port | related_to | id→res_id |
| imaster.pon.device_related_to_imaster.pon.metric.online | entity_set.imaster.pon.device | metric_set.imaster.pon.metric.online | related_to | id→res_id |
| imaster.pon.device_related_to_imaster.pon.metric.onu | entity_set.imaster.pon.device | metric_set.imaster.pon.metric.onu | related_to | id→res_id |
| imaster.pon.device_related_to_imaster.pon.metric.pon_port | entity_set.imaster.pon.device | metric_set.imaster.pon.metric.pon_port | related_to | id→res_id |
| imaster.server.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.server.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.server.device_related_to_imaster.server.metric.device | entity_set.imaster.server.device | metric_set.imaster.server.metric.device | related_to | id→res_id |
| imaster.storage.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.storage.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.storage.device_related_to_imaster.storage.metric.device | entity_set.imaster.storage.device | metric_set.imaster.storage.metric.device | related_to | id→res_id |
| imaster.storage.device_related_to_imaster.storage.metric.hard_drive | entity_set.imaster.storage.device | metric_set.imaster.storage.metric.hard_drive | related_to | id→res_id |
| imaster.storage.disk_related_to_imaster.storage.metric.hard_drive | entity_set.imaster.storage.disk | metric_set.imaster.storage.metric.hard_drive | related_to | id→res_id |
| imaster.storage.fc_switch_related_to_imaster.governance.event.current_alarm | entity_set.imaster.storage.fc_switch | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |
| imaster.storage.fc_switch_related_to_imaster.storage.metric.device | entity_set.imaster.storage.fc_switch | metric_set.imaster.storage.metric.device | related_to | id→res_id |
| imaster.terminal.device_related_to_imaster.governance.event.current_alarm | entity_set.imaster.terminal.device | event_set.imaster.governance.event.current_alarm | related_to | id→res_id, tenant_id→tenant_id |