# Event Set / Entity Source 全量字段定义（无损转存）

> 由 `umodel/event_set/*.yaml` 与 `umodel/entity_source/*.yaml` 程序化生成。

## imaster.governance.source.device_index（设备索引）· kind=entity_source

- constructor: `{'mode': 'external_sync'}`
- storages: `[{'name': 'external', 'type': 'external'}]`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| name | string | 名称 |  |
| ip | string | IP地址 |  |
| mac | string | MAC地址 |  |
| category | string | 设备分类 |  |
| class_name | string | 实体类名 |  |

## imaster.governance.source.site_view（站点视图）· kind=entity_source

- constructor: `{'mode': 'external_sync'}`
- storages: `[{'name': 'external', 'type': 'external'}]`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| site_id | string | 站点ID |  |
| site_name | string | 站点名称 |  |
| tenant_id | string | 租户ID |  |

## imaster.governance.source.tenant_view（租户视图）· kind=entity_source

- constructor: `{'mode': 'external_sync'}`
- storages: `[{'name': 'external', 'type': 'external'}]`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| tenant_id | string | 租户ID |  |
| tenant_name | string | 租户名称 |  |

## imaster.governance.event.current_alarm（当前告警）· kind=event_set

- entity_fields: `{'entity_id': 'res_id', 'domain': 'imaster', 'entity_type': '__entity_type__'}`
- time_field: `alarm_time`
- tag_fields: `['severity', 'cleared', 'alarm_type']`

| 字段 | 类型 | 描述 | 枚举(value_mapping) |
|---|---|---|---|
| csn | integer | 告警流水号 |  |
| cleared | integer | 清除状态 | `0`=未清除/Uncleared；`1`=已清除/Cleared |
| alarm_name | string | 告警名称 |  |
| severity | string | 告警级别 | `1`=紧急/Critical；`2`=重要/Major；`3`=次要/Minor；`4`=提示/Warning |
| alarm_type | string | 告警类型 |  |
| res_id | string | 资源ID |  |
| res_name | string | 资源名称 |  |
| source | string | 告警源 |  |
| probable_cause | string | 可能原因 |  |
| tenant_id | string | 租户ID |  |
| strext13 | string | 站点扩展字段 |  |
