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
| Site | `site` | `X_SITE_VIEW` | 第二批已验证 |
| Port | `port` | `I_EnterpriseNetworkLTP` | 第三批已验证 |
| InterfaceKpi | `interface_kpi` | `NetworkDeviceInterfaceKPI` | 第四批已验证 |
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

## 第二批 Site

完整迁移七个物理字段、六个公开维度及四个跨批关系，累计三个载体、31 个公开维度和六个关系。
站点身份采用 SiteId，设备的 project_id／ref_parent_subnet 显式绑定两个站点角色。
两个设备定位关系保留 OR 语义，不能转换为同时匹配的复合身份。
站点到租户及租户到站点的两个具名关系均保留原方向和基数。

源文件 X_SITE_VIEW.logical.yaml 哈希与 source_catalog.json 一致。
继续保留基线非空字段契约和 UTC 毫秒假定，不宣称它们已由生产数据确认。
旧 Site 未显式声明 Dataset，仅以 key 标记 site_id；新声明显式提供同一 grain，测试比较有效身份语义。
契约测试仍逐项检查物理字段、全部维度执行能力、结果类型、时间角色、编码和所有批内关系。
SQL 额外验证 online 映射、OR 单路匹配、双路同站点去重、双路不同站点、无匹配及两个租户方向。

包含前批回归的 46 组 SQLite 新旧查询及空表对照全部通过；PostgreSQL 仅比较参数，未实际执行。

## 第三批 Port

迁移全部 17 个物理字段、15 个公开维度、interface_count 和三个跨批关系。
PortId、DeviceId、TenantId 分开表达身份；带宽使用 BitsPerSecond，避免与字节速率隐式混用。
保留三个闭合值域的全部业务 ID 与物理编码，包括 38 个整数接口类型。
原始地址搜索和可空 IPv4 视图分别发布。
源文件 EnterpriseNetworkLTP.logical.yaml 哈希与 source_catalog.json 一致，字段可空声明仍保持基线契约。

独立初始化随着声明增加超出默认 fuel，隔离验收显式使用与契约测试一致的 100000 初始化 fuel。
隔离工作区仍不含旧 IC 模型和服务源码，不以加载旧载荷的成功冒充独立准备。
SQL 夹具覆盖小数带宽边界、状态映射、大整数接口编码、IPv4 及三个关系的方向和缺失端点。

六个契约测试、隔离初始化、累计 70 组 SQLite 新旧查询及空表对照通过。
SQLite 原渲染将 38 项接口类型映射为深层嵌套 CASE，实际投影触发 parser stack overflow。
现将连续 ELSE IF 展开为同一个 CASE，保留条件顺序、绑定句柄、NULL 与嵌套 THEN 语义。
新增四个直接 SQLite 条件链执行回归；relation model 的 102 个既有 Graph 请求和六组 SQL 对照通过。
验收夹具合并为一次 Telora 初始化，避免按能力组重复准备新旧模型。
累计迁移 4/50 个载体、46 个公开维度、三个计数和九个关系，服务未切换。

## 第四批 InterfaceKpi

完整迁移 30 个物理字段、31 个公开维度、16 个度量及两个跨批关系，累计 5/50 个载体。
样本粒度显式保留 res_id／tenant_id／ts，权威时钟为 Rfc3339Utc。
旧模型还将 res_id 标记为 key；新声明不将它提升为样本唯一身份，契约测试按完整采样 grain 对比。
两个端口关系仍按原有 res_id 对应 PortId，不擅自增加租户等式。

四个样本 Group 复用包速率、利用率、暂定字节速率及错误数的统计契约，公开名称在字段绑定时映射。
使用普通 NumericGroup 保留 interface_out_errors 的既有非采样 Avg，不额外赋予采样角色。
直接物理列的 NumericGroup 降级为普通字段度量，复合表达式仍保存 row_expression。
保留三个 UTC 分桶、原始时间筛选权限、Min／Max 摘要角色与单位，不自动添加 Latest 或 Sum。
暂定 byte/s 与源 bits_per_second 的冲突继续由 #51 跟踪，本阶段不做隐式换算。
源文件 NetworkDeviceInterfaceKPI.logical.yaml 哈希与 source_catalog.json 一致，非空契约继续沿用基线。

七个契约测试和独立初始化通过，SQL 对照累计 121 组及空表检查。
实际覆盖全部投影、全部度量、UTC 日分组、闰日与月界、半开窗口和两个端口方向。
共享直接列降级通过三个普通统计查询及九个 Group 查询回归；没有构建知识图或运行知识测试。
PostgreSQL 仍只核对参数，没有实际执行。服务入口未切换。
