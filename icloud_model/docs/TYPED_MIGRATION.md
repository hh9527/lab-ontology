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
| ServerDevice | `server_device` | `PhysicalServer` | 第五批已验证 |
| ServerKpi | `server_kpi` | `ServerDeviceKPI` | 第六批已验证 |
| ServerFan | `server_fan` | `PhysicalServerFan` | 第七批已验证 |
| ServerPsu | `server_psu` | `PhysicalServerPSU` | 第七批已验证 |
| ServerMemory | `server_memory` | `PhysicalServerMemory` | 第七批已验证 |
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

## 首批验收

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

## 第五批 ServerDevice

完整迁移 23 个物理字段、19 个公开维度和四个跨批关系。
ServerId 与 ServerOriginId 使用不同名义类型，主 grain 保持 id，oriResId 不冒充主身份。
保留 13 项服务器分类、七项健康状态和四项连接状态的闭合域及全部物理编码。
原始地址搜索与可空 IPv4 视图分别发布，createTime 显式使用 EpochMillis UTC。
serviceDuration 和 serviceStartTime 保持普通整数，不仅因名称推断时间单位或时区。

两个服务器／租户关系及两个 OR 站点关系保留原有基数和方向，不顺带修正源声明的基数假定。
源文件 PhysicalServer.logical.yaml 哈希与 source_catalog.json 一致，非空字段契约继续沿用基线。
八个契约测试和独立初始化通过；SQL 覆盖全部投影、负数健康状态、连接状态、IPv4、半开时间窗和全部批内关系。
OR 关系夹具覆盖单路匹配、双路同站点去重、双路不同站点和无匹配。

服务器到租户和站点的跨端原始投影显式声明 Association 行粒度，并增加默认根行粒度下拒绝扩行投影的回归。

累计 149 组 SQLite 新旧查询及空表检查通过，当前完成 6/50 个载体。PostgreSQL 仅核对参数，服务入口未切换。

## 第六批 ServerKpi

完整迁移 15 个物理字段、16 个公开维度、八个样本统计及两个主 ID 关联。
CPU 与内存共用 Percent 统计 Group，分别映射 Mean、Latest、Max、Min 公开名称，单位保持 %。
明确使用 res_id／tenant_id／ts 采样粒度和 Rfc3339Utc 权威时钟，三个 UTC 分桶保持原契约。
systemPower 与 peakPower 使用 Watts；averagePower 保持独立来源值类型，不推断未在现有公共契约声明的单位。

两个关联都将样本 resId 对应 ServerId，不能改成 ServerOriginId。
源文件 ServerDeviceKPI.logical.yaml 哈希与 source_catalog.json 一致，既有非空字段契约仍保留。
八个契约测试和独立初始化通过；SQL 夹具覆盖最新 NULL、缺失时钟、复合 grain 并列、窗口及关联原始 ID 不匹配。
CPU 和内存 Latest 共享行选择，NULL 时钟不参与 Latest，但其数值仍参与普通统计。

新增同一时刻 t1／t2 并列 Latest 断言后，累计 177 组 SQLite 新旧查询及空表检查通过。当前完成 7/50 个载体。

## 第七批 ServerFan／ServerPsu／ServerMemory

三个载体完整迁移 40 个物理字段、32 个公开维度、一个风扇计数和 11 个跨批关系。
每个部件拥有独立名义主 ID，风扇、PSU、内存身份不能互换。
三个健康域分别保留既有业务 ID、源整数编码与过滤权限，不把 PSU 的 warning／unknown 合并为其他健康类型。
内存容量使用 Megabytes，保持来源 MB 编码，不自动推断二进制倍率或转成 Bytes。

ServerDevice 添加来源资源角色，使用 ServerOriginId 作为来源资源身份；服务器主 grain 仍是 ServerId。
部件 parentResId 对应该来源角色，后续服务器 KPI 仍对应主身份，两者不根据字符串外观自动等同。
这种角色绑定只表达已有关系键，不额外宣称来源编号在生产数据中的唯一性已经确认。
三个源文件哈希与 source_catalog.json 一致，非空契约与既有关系基数不变。

SQL 夹具专门区分 sv1 和 origin_sv1，保证错误使用主 ID 的部件不参与父服务器关联。
同名不同 ID 的两个风扇仍分别计数；租户关系覆盖缺失端点，部件父关系覆盖双向投影。
内存／服务器／样本必须用 Association 行粒度表达关联行；默认根行粒度下拒绝将服务器 CPU 投影为内存属性。

累计 226 组 SQLite 新旧查询及空表对照通过，独立初始化通过。当前完成 10/50 个载体；PostgreSQL 仅比较参数，服务未切换。

九个 transform 契约测试通过，包含部件行粒度下拒绝服务器样本扩行投影的回归。
