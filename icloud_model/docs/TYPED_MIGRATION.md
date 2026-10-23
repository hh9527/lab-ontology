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
| StorageDevice | `storage_device` | `HuaweiStorageDevice` | 第八批已验证 |
| Frame | `frame` | `I_EnterpriseFrame` | 第九批已验证 |
| NetworkSlot | `network_slot` | `I_EnterpriseSlot` | 第九批已验证 |
| PonDevice | `pon_device` | `I_EntPonElement` | 第十批已验证 |
| PonOnuRole | `pon_onu_role` | `I_EntPonElement` | 第十批已验证 |
| PonOltRole | `pon_olt_role` | `I_EntPonElement` | 第十批已验证 |
| OnuKpi | `onu_kpi` | `PonDeviceOnuKPI` | 第十一批已验证 |
| PonPortKpi | `pon_port_kpi` | `PonDevicePonPortKPI` | 第十二批已验证 |
| ApRadioSsidKpi | `ap_radio_ssid_kpi` | `NetworkApRadioSsidKPI` | 第十三批已验证 |
| DeviceKpi | `device_kpi` | `NetworkDeviceKPI` | 第十四批已验证 |
| CurrentAlarm | `current_alarm` | `T_CURRENT_ALARM` | 第十五批已验证 |
| PhysicalLink | `physical_link` | `EnterprisePhysicalLink` | 第十六批已验证 |
| SourceEntCollaborationElement | `source_EntCollaborationElement` | `I_EntCollaborationElement` | 第十七批已验证 |
| SourceEntTerminalElement | `source_EntTerminalElement` | `EntTerminalElement` | 第十八批已验证 |
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

## 第八批 StorageDevice 与字段计数

完整迁移 28 个物理字段、26 个公开维度、两个计数和四个跨批关系。
StorageId、TenantId、SiteId 约束对应身份角色，两个站点 OR 关系保留方向、基数和所有备选字段。
七个闭合域保留全部业务 ID 与源编码，Fraction、Megabytes、ReportedCapacity 分开表示尺度和已知／未确认单位。
Fraction 不额外验证源范围，MB 不推断二进制倍率，未确认容量单位不隐式转为 MB。
createTime 保持现有 UTC 毫秒假定，不把该假定提升为已确认的生产事实。
源文件 HuaweiStorageDevice.logical.yaml 哈希与 source_catalog.json 一致，非空契约继续沿用基线。

新增 t::field_count／with_field_counts，保留 COUNT(name) 对 NULL 的行为，不将其替换成记录计数或 DISTINCT。
同名、NULL 名称和空字符串夹具分别得到四条记录、三个非 NULL 名称、两个不同名称。
字段计数不要求字段有实体身份；擦除后重新检查 Row、Dataset、source、字段类型、可空性和公开名称。
十个正反契约与六个实际 SQLite 语义场景通过，同时回归 relation model 的 102 个 Graph 请求和六组 SQL 对照。

引用与 Appellation 字段角色当前仅被知识发现读取，本阶段不增加准备或验收这些元数据的成本。
发现服务根模块挂载 source_audit 会在初始化计算开发报告并读取知识索引，已将挂载移除。
开发审计仍可通过 @src/source_audit 显式加载；仅用 --only-types 检查该入口，没有执行知识报告。
累计 269 组 SQLite 新旧查询及空表对照通过，独立初始化通过，SQL schema 按准备字段标量类型创建，保留小数容量边界。

移除服务根审计挂载后，九个 IC transform 契约在相同 100000 fuel 下全部通过。当前完成 11/50 个载体。

## 第九批 Frame 与 NetworkSlot

迁移两个载体的 24 个物理字段、22 个维度、slot_count 及五条关系；累计 13/50 个载体。
Frame 的九个可空字段保持可空，没有已声明 grain，不补建主键。
FrameDn 仅为 Frame 与 Slot 共用的来源引用类型，不声明 DN 唯一性；NULL 引用不参与匹配。
FrameOperState 的 normal/error 保留多源编码，另有三个独立编码；四个闭合域全部保留原有成员与次序。
SlotId、DeviceId、TenantId 与 FrameDn 区分不同引用，isDaughterCard 保持 Bool，计数保持记录语义。

九个 transform 契约、独立初始化以及累计 302 组实际 SQLite 新旧查询及空表对照通过。
SQL 用例覆盖全部新增维度、状态 Eq/Ne、NULL、布尔真/假、槽位计数和五条关系。
对照模块同时准备新旧模型和累计请求，将其初始化 fuel 上限改为 200000；独立生产声明初始化仍在 100000 内通过。
不执行知识发现、知识地图构建、知识测试或源审计报告，MainService 尚未切换。

## PON 迁移前置：固有行范围

ONU/OLT 是同一物理来源的不同固有范围，不得只迁移字段而丢掉分类筛选。
独立声明新增 `t::with_scope(declaration, [t::scope_equal(dataset, field, value)])`，保留既有范围与域解析语义。
字段和值共享类型参数，擦除后重新校验来源与字段见证；范围字段仍须有过滤维度（可不可投影），对应算子受 profile 限制。
此项为 transform 迁移前置，载体完成进度仍为 13/50；不触发知识发现或知识地图构建。

本项验证：10 个行范围正反例、9 个实际 SQLite 场景、既有 relation model 102 个 Graph 请求与 6 组 SQL 对照，以及 IC 独立初始化通过。PostgreSQL 仅核对参数。

## 第十批 PON 设备与同源 ONU/OLT 角色

三个载体共享 I_EntPonElement 的 22 个物理列，分别保留 22 个字段声明，共 68 个维度（其中两个内部分类维度不可公开访问）。
PonId 统一设备身份与父设备引用，区别于 TenantId、SiteId；五个闭合域保留全部成员与源编码。
ManufactureDate 使用 DateUtc，createTime 保持 LocalEpochMillis 及源时钟单位待确认的既有假定，不新增单位或时区换算。
ONU/OLT 的固有分类范围使用 with_scope 声明，沿用原域映射，文本 onu 本身不代替源编码 ne.category.pon.onu。
批内四条关系包括不带角色范围的源自关联、具备双端范围的 ONU→OLT、租户引用与两路 OR 站点引用。

SQL 场景覆盖父 ID 指向非 OLT、SPL 不混入 ONU、原始分类名碰撞、公开 ID 条件不能绕过范围、日期过滤、离线多编码与 IPv4。
同表角色只建表和装载一次，合并列并校验同列存储类型一致；不为每个角色复制数据。
两个内部分类维度单独验证拒绝公开访问，不加入公开维度投影用例。
本批不增加知识发现、知识地图构建或知识测试，MainService 尚未切换。

源 EntPonElement.logical.yaml 的 SHA256 与目录一致。累计 382 组实际 SQLite 新旧请求及空表对照通过，独立初始化通过；PostgreSQL 仅核对参数。

本批累计完成 16/50 个载体。九项 transform 契约通过；新增两个内部分类投影拒绝用例在修正错误文本断言后定向复验通过，共 11 项。

## 第十一批 ONU KPI

迁移 30 个字段、31 个维度（含 UTC 小时／日／月分桶）、33 个 Mean/Min/Max 统计度量和三条关系。
采样 grain 保留 res_id、tenant_id、ts，UTC Rfc3339Utc 时钟显式声明；res_id 使用 PonId。
Percent、Dbm、DegreesCelsius、BitsPerSecond 区分不同可计算量，四个样本统计模板分别绑定到对应字段。
保留既有 %、dBm、degC、bit/s 单位，不隐式换算；dBm 保持原值统计，不转为线性功率。
有效次数只是独立来源字段，不作为默认权重或有效性筛选；未新增 Sum。

真实 SQLite 场景验证全部统计、跨租户同刻样本、NULL、负 dBm、NULL 时钟、UTC 窗口／分桶，以及来源设备与 ONU 角色不同的筛选范围。
双跳 ONU 样本→ONU 角色→OLT 验证角色范围在组合关系中仍生效，不将 SPL 或 OLT 本身的样本混为 ONU 样本。
旧关系的 M:N 上界保持不变，不因 nominal Entity 身份而擅自收紧基数。
不执行知识发现、知识图构建或知识测试，MainService 尚未切换。

契约测试与累计 SQL fixture 拆分：`typed_inventory` 只准备契约，`typed_inventory_runtime:runtime_fixture` 由 SQL 检查脚本按需调用。
测试覆盖未减少；契约检查不再初始化全部查询，用 100000 fuel 验证，累计 SQL 对照仍用 200000。
关系对照使用显式 Association 行；按相关 ONU 角色资格统计使用 EXISTS，另有负例保持 M:N 度量放大保护。

本批累计完成 17/50 个载体。源文件 SHA256 与 catalog 一致；12 项 transform 契约在 100000 fuel 内通过，独立初始化通过，累计 453 组实际 SQLite 新旧请求及空表检查通过。PostgreSQL 仅核对参数。

## 第十二批 PON 端口 KPI

迁移 16 个字段、15 个维度（含 UTC 小时／日／月分桶）、18 个 Mean/Min/Max 统计和两条关系。
保留来源 res_id、tenant_id、ts 采样 grain；来源粒度和全局 ID 范围仍有生产验证假定，不因类型化声明而确认其有效性。
设备引用必须由 parent_id→PonId 建立，res_id 是不同名义类型的来源端口 ID，不代替设备身份；portName 不加入未经确认的 grain。

将 ONU 与 PON 端口共有的 Dbm、DegreesCelsius、BitsPerSecond 及统计模板放到 pon_quantities，复用不依赖具体 Dataset。
ONU 的 Percent 保留原语义；PON 端口使用 ReportedPercent 保留 #51 中 one 与百分比显示冲突的待确认假定，不默认互换或缩放。
有效次数不作为权重，dBm 保持原值 Mean/Min/Max；没有新增 Sum、隐式线性功率转换或未知单位换算。

SQL fixture 覆盖 resId 恰好与设备 ID 相同但 parentId 不匹配、不同端口属于同设备、跨租户、非 OLT 的 PON 父设备、NULL 与 NULL 时钟。
全部端口统计、UTC 窗口／分桶、两条关系和原 ONU 统计一起验证，不把关联擅自限为 OLT，也不改为 resId 关联。
当前只准备 transform，MainService 尚未切换，不构建知识地图或运行知识测试。

累计完成 18/50 个载体。源 SHA256 与 catalog 一致；12 项 transform 契约（100000 fuel）、独立初始化及累计 491 组实际 SQLite 对照与空表检查通过。PostgreSQL 仅核对参数。

## 第十三批 AP Radio SSID KPI

迁移 12 个物理字段、13 个维度（含三个 UTC 分桶）、8 个统计和两条设备关系。
SsidId、DeviceId、TenantId 区分来源 SSID、父设备和租户；保持 res_id／tenant_id／ts 复合采样 grain 与 UTC 时钟。
连接终端字段使用 Count，显式声明既有样本 Sum 与 Mean；Sum 是原始连接数样本之和，不是跨时刻去重用户数或期末快照。
接收与发送字节使用 ByteCount(Int) 和复用的 Mean/Min/Max 模板，不因为类型可加就新增字节 Sum，不推导增量、速率或复位修正。
有效次数保持独立字段，不成为默认权重或样本有效性筛选。

真实 SQL 场景包含跨租户同刻采样、同名不同 SSID、同一 SSID 多次采样、NULL、NULL 时钟，以及 resId 与设备 ID 碰撞但 parentId 不匹配。
同名 Guest 的样本均值独立期望为 78，而不是先按 SSID 求均值再平均；设备引用保持 parentId→DeviceId，不增加 AP 分类过滤。
不执行知识发现、知识地图构建或知识测试，MainService 尚未切换。

通用 quantity::Bytes 使用 Float；本来源为 Int，因此使用独立 ByteCount 保留公开整数类型与精度，不隐式转为 Float。

累计完成 19/50 个载体。源 SHA256 与 catalog 一致；12 项 transform 契约使用双模型初始化预算 150000 通过，独立初始化仍为 100000；累计 518 组实际 SQLite 新旧查询及空表检查通过，PostgreSQL 仅核对参数。

## 第十四批 Device KPI

按当前公开载荷迁移 23 个字段、26 个维度、23 个度量和两条设备关系，保持 res_id／tenant_id／ts 复合 grain。
CPU/内存的 Percent 复用 Mean/Latest/Max/Min 模板，Latest 按 UTC 时钟与剩余完整 grain 排序，共享整行选择并保留最新 NULL。
端口计数使用 Count 显式声明既有样本 Sum，不变为期末总量；普通 device_kpi_sample_count 保持合格样本计数，不做设备去重。
ReportedOnlinePercent 保留来源尺度待确认假定，与独立在线率专表不同总体；ReportedPortUsage 不推导 used/total 或 online/total，也不默认转换为百分比。
有效次数不参与默认加权或有效性过滤，NULL 时钟不进入 Latest 候选，但原始统计不额外排除该行。

SQL 场景覆盖跨租户同刻样本的确定排序、最新 CPU 为 NULL 而内存有值、NULL 时钟的较大值、缺失设备引用，以及筛选后样本计数。
设备关系保持 resId→DeviceId，不误用 parentId；UTC 窗口在选择 Latest 前应用。

来源版本差异：catalog 中 NetworkDeviceKPI 的 SHA256 与语料仓 685581e 版本一致。
当前语料仓在 c7982fd 中新增 nePingRespTime，现有字段未变；本批保留旧公开载荷，不把新源字段混入等价迁移。
后续来源刷新需单独同步该字段及其公开查询能力；不更新一个不包含新字段却声称为当前版本的哈希。
不执行知识发现、知识地图构建或知识测试，MainService 尚未切换。

累计完成 20/50 个既有载体。12 项 transform 契约（双载荷 150000 fuel）、独立初始化（100000）和累计 574 组实际 SQLite 对照及空表检查通过。PostgreSQL 仅核对参数。

## CurrentAlarm 前置能力：业务成员条件计数

新增 filtered_count，将字段计数与名义业务成员绑定，复用已声明值域的来源编码映射和物理列映射。
构造时检查业务类型、成员和 Dataset；擦除泛型后的准备阶段重新检查完整绑定，拒绝未声明或被篡改的条件。
当前仅支持直接列上的已声明成员等值条件，不引入任意 SQL。
条件只作用于对应度量；COUNT(field) 仍排除该字段的 NULL，不把条件提升成整个 Dataset 的默认范围。

7 项正反例、6 个实际 SQLite 条件计数场景、原字段计数的 6 个 SQLite 场景、relation model 的 102 个 Graph 请求与 6 组 SQL 对照，以及 12 项 IC transform 契约通过。
PostgreSQL 仅核对参数。CurrentAlarm 尚未迁移，完成数量仍为 20/50；MainService 尚未切换。
本阶段不准备知识地图、不执行知识发现或知识测试，验收仅依据 transform 能力与对应回归。

## CurrentAlarm 前置能力：显式 Event Dataset

Declaration 显式携带 DatasetKind，declare 默认 Entity，metric 与 event 分别选择 Metric／Event 并绑定 UTC 时钟。
事件不再因具有时钟而被推断成 Metric；event 保留事件 grain、可空发生时间和既有物理列映射，不附加“未清除”等固有范围。
准备阶段重新校验 kind 与时钟的一致性、UTC 字段及非空 grain；拒绝在 Event 上发布 Metric 采样角色。
当前复用 metric 的时钟校验，因此部分错误文本仍沿用 metric 名称，校验要求相同。

7 项 Event 契约、18 项采样契约（含 Event/Metric 边界）与 12 项 IC transform 契约通过。
CurrentAlarm 尚未迁移，仍为 20/50；条件关系、计算度量及完整模型迁移继续推进。
本阶段不执行知识发现、知识地图构建或知识测试。

本项独立 typed IC 初始化在不含旧模型和服务的临时工作区通过（100000 fuel），不准备知识地图。

## CurrentAlarm 前置能力：类型化来源侧关系条件

relations::guarded 将来源行字段、Eq/Ne 与同类型标量绑定到单条关系；支持名义标量，不接受任意 SQL。
构造与 lowering 重新检查来源 Dataset、字段结构、标量存储及算子，lowering 另外检查实际物理字段；条件沿既有关系 guard 路径下沉，不成为 Dataset 固有范围。
OR 关系仅在各分支共享相同条件时合并；不同条件无法由当前 RelationEntry 的单个 guard 表达，因此显式拒绝，避免误用第一分支条件。

8 个实际 SQLite 场景验证来源总体、标记排除、物理列映射、复合租户键、原始 NULL 引用、正向关联、反向零计数组与 EXISTS；PostgreSQL 仅核对参数。
原始 NULL 引用用于检查 SQL 防御行为，不将 relation model 的非空角色字段改成可空契约。
既有 102 个 Graph 请求和 6 组实际 SQLite 新旧关系查询通过。
CurrentAlarm 尚未迁移，仍为 20/50；不执行知识发现、知识地图构建或知识测试。
本项最终 9 项条件关系契约与 12 项 IC transform 契约通过，包含擦除后字段／算子篡改和共享条件 OR 的正反例。

## CurrentAlarm 前置能力：计数输入的聚合后计算

新增 CountRef(Row)、combine_counts 与 with_computed_counts，引用必须对应同一 Dataset 中已声明的字段计数、记录计数或其他计数组合。
支持 Add/Sub 和声明顺序无关的嵌套依赖；准备时拒绝跨来源、未知依赖、循环、重复发布及 profile 未允许的算术。
引用只允许计数输入，不将普通数值或不同单位度量混入计数组合；当前尚未扩展成任意单位的聚合后计算。
这些类型约束的是输入计数及其算术，不证明人群互斥，也不把结果解释为去重数；重复加上 critical 输入的结果仍须作为加权分数发布，不能宣称为告警事件数。
CountRef 的 Row 参数和运行时 Dataset/source 见证共同保留来源约束，泛型擦除后仍重验。

7 项计算计数契约通过；6 个实际 SQLite 场景验证嵌套 Add/Sub、负差值、整数结果、独立条件计数、NULL 和空总体；原条件计数的 6 个 SQLite 场景通过。
PostgreSQL 仅核对参数。CurrentAlarm 尚未迁移，载体进度仍为 20/50；不执行知识发现、知识地图构建或知识测试。
本项 12 项既有 IC transform 契约通过，MainService 尚未切换。

## CurrentAlarm 前置能力：显式原始身份引用映射

完整告警声明的 MEDN 同时引用 Device 与 Server，来源没有表达可区分两类 ID 的编码；保留原始 String 字段，不把 DeviceId 与 ServerId 合并为一个名义类型。
新增 model::reference_part：只有原始 Int/String 引用能显式采用目标身份的名义类型，物理存储必须相同，不执行解析、转换或身份存在性推断。
默认 identity_part 仍要求同一名义类型；reference_part 不接受 DeviceId→ServerId 之类已有名义 ID 的重新解释。
IdentityPart/Part 保留可选 raw 类型见证，角色准备及擦除后重验来源字段、目标身份、物理存储、可空性和完整身份覆盖。
映射不改变关系方向、基数或租户键；NULL 来源要求 optional 角色，不将孤立引用当作已存在实体。

8 个实际 SQLite 场景验证原始文本引用、物理列映射、复合租户键、NULL、孤立引用、反向零计数组与 EXISTS；PostgreSQL 仅核对参数。
原有 20 项 Entity/Dataset 身份契约、102 个 Graph 请求及 6 组实际 SQLite 关系对照通过。
CurrentAlarm 尚未迁移，仍为 20/50；只推进 transform，不执行知识发现、知识地图构建或知识测试。
本项 7 项显式引用正反例（含整数正例）和 12 项 IC transform 契约通过，MainService 尚未切换。

## 第十五批 CurrentAlarm

迁移 46 个物理字段、42 个维度、六个度量、六个闭合业务域及与前 20 个载体之间的十条关系。
Dataset 显式声明 Event、csn grain 和 occur_utc 时钟；current 表名不隐含未清除范围，来源行不默认排除已清除、未知状态或孤立引用。
时钟单位、Local 编码和来源字段非空性延续旧模型契约及待生产确认假定，不借迁移作出新确认。

MEDN 保留原始 String，通过 reference_part 分别引用 Device、Server、Storage、PON 的名义身份；不把它们的 ID 合为一类。
STREXT13 的业务站点关系保留 != "3" guard，原始 source_X_SITE_VIEW_T_CURRENT_ALARM 关系不附加该 guard；来源标记恰与站点 ID 相同时，两种查询总体不同。
所有来源关系保持既有方向、完整键和基数，不擅自加入租户连接键或设备分类范围。

字段计数保留 COUNT(CSN)；未清除、critical、major 分别使用已绑定业务成员的来源编码。
critical_or_major_alarm_count 依赖 critical + major；weighted_severe_alarm_score 再加 critical，只是原声明的加权分数，不解释为告警数或去重数。
当前计数组合 API 约束输入及来源，业务结果名义类型仍待进一步细化；本批保持旧公开计算能力，不声称已经解决任意单位的聚合后计算。
闭合域投影／分组只包含已知编码，Ne 也只在已知编码内计算；未知编码与 NULL 的原始行仍参与不按该域分组的总计。
NULL fixture 用于验证来源异常值的 SQL 行为，不将旧非空字段契约改成可空。

来源 T_CURRENT_ALARM.logical.yaml SHA256 与 catalog 一致。
14 项 IC transform 契约在双载荷 200000 fuel 内通过；独立 typed 初始化在 150000 fuel 内通过。
原双载荷 150000 与独立 100000 预算在新增声明后不足，因此分别提升验证预算，不引入知识初始化或累积查询准备。
单独按需生成告警 fixture，128 组实际 SQLite 新旧请求和空表检查通过，包含所有维度投影、六个域全部成员的 Eq/Ne、六个度量、窗口、文本转义搜索、十条关系与两种站点 EXISTS。
过滤成员及重点总体另有独立期望值；PostgreSQL 只核对参数，未实际执行。
此前其他载体的 SQL 证据保持历史记录，本批未重跑其全部 574 组查询，现有载体契约随 14 项检查一起验证。

累计完成 21/50 个既有载体。MainService 尚未切换，不执行知识发现、知识地图构建或知识测试。

## PhysicalLink 前置能力：业务连接的 hub 条件

新增 relations::guarded_link，将来源 hub 行的 Eq/Ne 条件挂在业务连接上，复用已验证的字段类型、来源与物理存储检查。
条件不写回 A/Z 两条端点关系：普通物理端点仍能查询全部来源行，业务 peer/downstream 各自按条件选择连接。
泛型擦除后重新检查 hub Dataset、字段、算子与字面量；双向遍历的两个方向均在同一原始 hub 行上求条件，不因反向遍历而交换条件字段。

5 项业务连接契约与 8 个实际 SQLite 场景通过，覆盖独立端点、双向／单向连接、自环、复合租户身份、NULL／孤立引用和空总体；PostgreSQL 仅核对参数。
NULL fixture 检查原始来源异常值的防御行为，不改变既有非空字段契约。
PhysicalLink 尚未迁移，仍为 21/50；其 native pair 声明仍需补齐，MainService 尚未切换，不执行知识发现、知识地图构建或知识测试。
本项 102 个既有 Graph 请求、6 组实际 SQLite 新旧关系对照及 14 项 IC transform 契约通过。

## PhysicalLink 前置能力：原生维度配对声明

新增 transform::native_pair 与 with_native_pairs，以同一 Row 的两个完整维度绑定声明有序配对，准备时生成既有 NativePairEntry。
两端必须属于同一 Dataset/source，采用相同名义值类型、不同直接物理字段，并支持 Eq；不接受计算表达式、聚合成员或业务编码域。
准备边界重验两端绑定且要求与 Declaration 中登记的绑定完全一致，拒绝缺失／篡改绑定、同字段别名和重复配对 ID。
只保留配对元数据，不推断 A/Z 可交换、连接方向或网络层级，不新增查询权限，不构建知识地图。

10 项原生配对契约、102 个既有 Graph 请求和 6 组实际 SQLite 新旧关系对照通过。
本项是声明准备能力，没有新增 SQL 运算；未增加知识发现／知识测试。
PhysicalLink 尚未迁移，仍为 21/50；MainService 尚未切换。
本项 14 项 IC transform 契约通过。

## 第十六批 PhysicalLink

迁移 26 个物理字段、27 个维度、一个字段计数、三个闭合域、五条关系、两个业务连接与一个原生名称配对。
LinkId 与租户身份分开；A/Z 来源资源字段保留原始文本，通过显式 reference_part 分别引用设备和服务器名义身份，不将两类 ID 合并。
保留 id grain、UTC 创建时间的原毫秒假定和非空字段契约；来源 speed 是文本，虽然说明包含 Mbit/s，本批不解析、换算或新增数值聚合。

A/Z 两条物理端点关系不限定方向。业务 peer 仅选 bidirectional 并可从两端遍历，downstream 仅选 unidirectional 并沿 A→Z；都不推断设备层级。
附着设备／服务器的 OR 关系保持 M:N 上界，不因名义身份而收紧基数；自环与双端同设备只保留既有 OR／distinct 语义。
link_ne_names 配对保留 A/Z 原始字段顺序，不用关联实体名称回填，不把配对解释成可交换方向。
四个 IPv4 视图显式复用严格转换；原始地址文本继续可查，IPv6、前导零、非法值、尾换行和 NULL 不成为 IPv4，NotInSubnet 仍排除这些值。
状态 fault 保留来源编码 2/3；闭合域分组及 Ne 限定已知编码，原始未知状态／方向仍参与总体与普通端点查询。

源 EnterprisePhysicalLink.logical.yaml SHA256 与 catalog 一致。
15 项 IC transform 契约（200000 fuel）、独立 typed 初始化（150000 fuel）以及 91 组实际 SQLite 新旧查询与空表检查通过。
SQL 验证包含全部维度、三域全部成员的 Eq/Ne、五条关系、双向连接的两种根、单向连接、四个 IPv4 视图的子网与补集、窗口、重复链路、自环、孤立端点与原始名称配对；重点语义另有独立期望值。
NULL fixture 验证来源异常值的防御行为，不修改非空契约。PostgreSQL 只核对参数，未实际执行。
SQL fixture 独立按需生成（250000 fuel），没有在契约初始化中预生成累计查询；本批未重跑其余载体全部历史 SQL，已有载体契约一起验证。

累计完成 22/50 个既有载体。MainService 尚未切换，不执行知识发现、知识地图构建或知识测试。


## 第十七批 Collaboration

迁移协作设备来源的 14 个字段、15 个维度、两个闭合域及租户／告警两条关系，累计 23/50。
协作设备采用独立名义身份；告警原始 res_id 通过 reference_part 显式引用该身份，不改写为其他设备 ID。
告警关系仍只按资源 ID 连接，不额外加入租户键或未清除条件，基数保持 Optional→Many0；租户关系保持 Many0→Optional。
来源没有 CPU 样本或公开度量，不因缺失数据生成零值指标；Graph 行计数仍按 source_id grain 查询。
UTC 创建时间的毫秒解释和字段非空性延续既有假定，NULL fixture 仅验证来源异常值的 SQL 防御行为。
原始 IP 文本与严格 IPv4 视图分别保留；闭合域分组和 Ne 仅覆盖已知编码，不排除原始总体中的未知行。
源 EntCollaborationElement.logical.yaml SHA256 与 catalog 一致。

16 项 IC transform 契约（200000 fuel）以及 33 组实际 SQLite 新旧查询和空表检查通过。
查询包含全部维度、两域全部成员 Eq/Ne、UTC 窗口、文本转义、IPv4 子网与补集、租户及告警关联、EXISTS 防重复计数和按协作设备分组的告警／未清除计数；重点语义另有独立期望值。
PostgreSQL 只核对参数，未实际执行；本批没有重跑其他载体全部历史 SQL。
SQL fixture 按需独立生成，不在契约初始化中准备累计 SQL。MainService 尚未切换，不执行知识发现、知识地图构建或知识测试。

本批独立 typed 初始化在 200000 fuel 内通过；原 150000 预算实际耗尽后调整验证预算，隔离工作区不含旧模型或服务，也没有知识初始化。


## 第十八批 Terminal

迁移终端来源的 24 个字段、25 个维度、五个闭合域及设备／PON／站点／租户四条关系。
终端身份使用独立 TerminalId；接入资源 ID 保留原始 String，分别通过 reference_part 引用设备和 PON 的名义身份，不把二者合为同一类型，也不收紧原有 Many0→Many0 上界。
站点保留 siteId 或 projectId 两个键的 OR 关系及 Many0→Optional 声明，不推断两者总是相同，不添加租户键；租户关系保持 Many0→Optional。
业务域包含 55 个已知成员，其中 status 的 -1 是来源明确声明的已知 Unknown 编码，不是任意未知值的兜底成员。
未声明业务域的 unauthorized、isBlocked 保留原始整数及既有数值比较能力，不擅自收紧为 Bool；vlanId 也不增加范围约束。
原始 IPv4／IPv6 文本仍可搜索，严格 IPv4 视图单独发布；blockTime 的 UTC 毫秒单位继续待生产确认，非空性沿用旧契约。
源 EntTerminalElement.logical.yaml SHA256 与 catalog 一致。

16 项 IC transform 契约（200000 fuel）与独立 typed 初始化（200000 fuel）通过。
SQL fixture 独立按需生成，不在契约初始化阶段准备累计查询；不执行知识发现、知识地图构建或知识测试，MainService 尚未切换。

173 组实际 SQLite 新旧查询对照及空表检查通过，覆盖全部维度、55 个域成员 Eq/Ne、五域／租户分组、三种原始整数的全部比较、时间窗口、文本转义、IPv4 子网与补集以及四类关系和 EXISTS 计数。
站点 fixture 包含两个键相同、分别命中不同目标、只命中 project 和孤立键；保留来源 OR 语义，不将其描述为已验证的生产单目标约束。
NULL fixture 验证异常值 SQL 行为，不改变非空契约；PostgreSQL 只核对参数，未实际执行。
本批独立 SQL fixture 实际耗尽 250000 fuel 后调至 400000 并通过，不影响模型初始化预算，没有增加知识准备。
累计完成 24/50；此前载体 SQL 证据保留为历史记录，本批未重跑其全部查询。
