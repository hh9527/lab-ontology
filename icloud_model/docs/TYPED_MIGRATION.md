# IC 独立声明迁移

迁移覆盖既有全部 50 个载体及其 transform 能力，按批验证后提交；清单记录声明迁移，不代表服务已切换。
目前独立入口为 `src/typed.telora`，MainService 继续读取既有 `src/model.telora`。
新入口不导入旧模型，不解析旧注解；仅验收测试同时加载新旧载荷作对照。

## 首批范围与依据

Tenant 与 EntNetworkElement 源文件哈希已核对，与 `data/source_catalog.json` 一致。
完整迁移两表 26 个物理字段、25 个公开维度、两个计数，以及批内两个具名关系。
设备身份只有 id；租户编号使用另一名义类型，不添加租户到设备主键。
设备分类保留半开放域和全部已知编码，通信状态保留闭合域，原始 IP 文本与可空 IPv4 视图分别发布。

本批保持旧 transform 的字段可空声明。源目录部分字段允许 NULL，既有 Row 对这些字段采用非空契约；
此次迁移不顺带改变这些契约，也不将它们描述为已验证的生产非空事实。
Tenant 访问时间和设备创建时间保持 Local 毫秒语义与现有单位假定，不做时区或单位换算。
描述、别名、本地化和知识发现契约留待后续，当前不构建知识图。

## 迁移清单

| 旧载体 | Dataset | 物理来源 | 独立声明 |
| --- | --- | --- | --- |
| Device | `device` | `I_EntNetworkElement` | 首批已验证 |
| Tenant | `tenant` | `X_TENANT_VIEW` | 首批已验证 |
| Site | `site` | `X_SITE_VIEW` | 待迁移 |
| Port | `port` | `I_EnterpriseNetworkLTP` | 待迁移 |
| InterfaceKpi | `interface_kpi` | `NetworkDeviceInterfaceKPI` | 待迁移 |
| ServerDevice | `server_device` | `PhysicalServer` | 待迁移 |
| ServerKpi | `server_kpi` | `ServerDeviceKPI` | 待迁移 |
| ServerFan | `server_fan` | `PhysicalServerFan` | 待迁移 |
| ServerPsu | `server_psu` | `PhysicalServerPSU` | 待迁移 |
| ServerMemory | `server_memory` | `PhysicalServerMemory` | 待迁移 |
| StorageDevice | `storage_device` | `HuaweiStorageDevice` | 待迁移 |
| Frame | `frame` | `I_EnterpriseFrame` | 待迁移 |
| NetworkSlot | `network_slot` | `I_EnterpriseSlot` | 待迁移 |
| PonDevice | `pon_device` | `I_EntPonElement` | 待迁移 |
| PonOnuRole | `pon_onu_role` | `I_EntPonElement` | 待迁移 |
| PonOltRole | `pon_olt_role` | `I_EntPonElement` | 待迁移 |
| OnuKpi | `onu_kpi` | `PonDeviceOnuKPI` | 待迁移 |
| PonPortKpi | `pon_port_kpi` | `PonDevicePonPortKPI` | 待迁移 |
| ApRadioSsidKpi | `ap_radio_ssid_kpi` | `NetworkApRadioSsidKPI` | 待迁移 |
| DeviceKpi | `device_kpi` | `NetworkDeviceKPI` | 待迁移 |
| CurrentAlarm | `current_alarm` | `T_CURRENT_ALARM` | 待迁移 |
| PhysicalLink | `physical_link` | `EnterprisePhysicalLink` | 待迁移 |
| SourceEntCollaborationElement | `source_EntCollaborationElement` | `I_EntCollaborationElement` | 待迁移 |
| SourceEntTerminalElement | `source_EntTerminalElement` | `EntTerminalElement` | 待迁移 |
| SourceEnterpriseOpticalModule | `source_EnterpriseOpticalModule` | `I_EnterpriseOpticalModule` | 待迁移 |
| SourceFCSwitchDevice | `source_FCSwitchDevice` | `FCSwitchDevice` | 待迁移 |
| SourceNetworkAPKPI | `source_NetworkAPKPI` | `NetworkAPKPI` | 待迁移 |
| SourceNetworkApRadioKPI | `source_NetworkApRadioKPI` | `NetworkApRadioKPI` | 待迁移 |
| SourceNetworkCellLinkQualityKPI | `source_NetworkCellLinkQualityKPI` | `NetworkCellLinkQualityKPI` | 待迁移 |
| SourceNetworkCellLinkTrafficKPI | `source_NetworkCellLinkTrafficKPI` | `NetworkCellLinkTrafficKPI` | 待迁移 |
| SourceNetworkDeviceBoardKPI | `source_NetworkDeviceBoardKPI` | `NetworkDeviceBoardKPI` | 待迁移 |
| SourceNetworkDeviceOnlineKPI | `source_NetworkDeviceOnlineKPI` | `NetworkDeviceOnlineKPI` | 待迁移 |
| SourcePhysicalServerDisk | `source_PhysicalServerDisk` | `PhysicalServerDisk` | 待迁移 |
| SourcePhysicalServerNetworkAdapter | `source_PhysicalServerNetworkAdapter` | `PhysicalServerNetworkAdapter` | 待迁移 |
| SourcePhysicalServerOpticalModule | `source_PhysicalServerOpticalModule` | `PhysicalServerOpticalModule` | 待迁移 |
| SourcePhysicalServerPort | `source_PhysicalServerPort` | `PhysicalServerPort` | 待迁移 |
| SourcePhysicalServerProcessor | `source_PhysicalServerProcessor` | `PhysicalServerProcessor` | 待迁移 |
| SourcePonDeviceEthernetPortKPI | `source_PonDeviceEthernetPortKPI` | `PonDeviceEthernetPortKPI` | 待迁移 |
| SourcePonDeviceKPI | `source_PonDeviceKPI` | `PonDeviceKPI` | 待迁移 |
| SourcePonDeviceOnlineKPI | `source_PonDeviceOnlineKPI` | `PonDeviceOnlineKPI` | 待迁移 |
| SourceSYS_BackupPower | `source_SYS_BackupPower` | `SYS_BackupPower` | 待迁移 |
| SourceSYS_Chassis | `source_SYS_Chassis` | `SYS_Chassis` | 待迁移 |
| SourceSYS_Controller | `source_SYS_Controller` | `SYS_Controller` | 待迁移 |
| SourceSYS_Fan | `source_SYS_Fan` | `SYS_Fan` | 待迁移 |
| SourceSYS_PowerSupply | `source_SYS_PowerSupply` | `SYS_PowerSupply` | 待迁移 |
| SourceSYS_StorageDisk | `source_SYS_StorageDisk` | `SYS_StorageDisk` | 待迁移 |
| SourceSYS_StoragePort | `source_SYS_StoragePort` | `SYS_StoragePort` | 待迁移 |
| SourceStorageDeviceKPI | `source_StorageDeviceKPI` | `StorageDeviceKPI` | 待迁移 |
| SourceStorageHardDriveKPI | `source_StorageHardDriveKPI` | `StorageHardDriveKPI` | 待迁移 |
| SourceT_DEVICE_ALL | `source_T_DEVICE_ALL` | `T_DEVICE_ALL` | 待迁移 |

## 当前验收

`python3 scripts/check-typed-icloud-initialization.py` 在没有旧模型和服务源码的隔离工作区初始化 typed 入口，验证独立准备不依赖旧注解。

`typed_inventory` 检查字段、grain、时间角色、全部维度执行能力、域编码、度量及批内关系与基线一致。
`python3 scripts/check-typed-icloud-inventory.py` 实际执行 35 组新旧 SQLite 查询及空表对照，覆盖全部维度投影、计数、分类筛选与分组、通信状态、IPv4 和两个租户关系。
每个请求同时比较公开结果列类型与可空性，并核对 SQLite／PostgreSQL 参数；未实际执行 PostgreSQL。

后续每批加入独立声明并扩充对照范围。全部载体、关系和当前查询能力完成，且初始化与批量 transform 验收通过后，再切换 MainService。
