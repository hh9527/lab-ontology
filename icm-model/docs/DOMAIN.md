# ICM 业务领域

本文是 ICM EnterpriseKnowledge 的公开背景知识包，面向 Resolver（构造查询输入的调用方）。
它只表达业务对象、领域词汇、概念关系、分类、状态、值域、单位、时间语义和统计口径，
并发布可公开引用的 measure / dimension / 稳定对象 ID。**本文件不包含任何物理 schema、
表列、Join 路径、SQL、bindings 或实现细节。** 输入 JSON 的结构化契约见
[`INTENT.md`](INTENT.md)。

## 1. 业务对象

- **租户**：多租户隔离与归属的根对象；设备、站点、告警、KPI 等资源按租户归属。
- **站点**：设备与告警所在的物理/组织位置；每个站点属于一个租户。
- **设备**：分域管理的物理设备。
  - 网络（network）：交换机、路由器、AC、AP、防火墙及其端口/光模块。
  - PON：OLT、ONU。
  - 服务器（server）：机架/昆仑/异构/天工机框/智能小站/机柜服务器及其硬盘/内存/
    处理器/风扇/电源/网卡/端口/光模块。
  - 存储（storage）：华为 SMIS/VSP/HP/分布式/闪存存储设备及其控制器/机箱/硬盘/
    风扇/电源/端口/后备电源。
  - 终端（terminal）：打印机、UPS、负载均衡等接入终端。
  - 协作（collaboration）：视频会议终端等协作设备。
- **子部件**：设备内部可独立管理的部件（见各域列举）。
- **告警**：设备/子部件产生的当前告警事件，含名称、类型、级别、确认与清除状态、
  发生时间、产生告警的资源。
- **KPI**：设备/子部件的时间序列运行指标（CPU/内存/在线率/端口/光功率/温度/流量等）。

## 2. 设备分类（稳定值）

| 域 | 分类维度 | 稳定值（可在 Eq / AnyOf 中使用） |
| --- | --- | --- |
| 网络 | `NetworkDeviceType` | `ne.category.switch`（交换机）、`ne.category.ac`（AC）、`ne.category.router`（路由器）、`ne.category.fatap`（AP）、`ne.category.firewall`（防火墙） |
| PON | `PonDeviceClassification` | `olt`（OLT/光线路终端）、`onu`（ONU/光网络单元）、`gpon`（GPON/分光类） |
| 服务器 | `ServerClassification` | `ne.category.server.rack`（机架）、`ne.category.server.kunlun`（昆仑）、`ne.category.server.heterogeneous`（异构）、`ne.category.server.subrack`（天工机框）、`ne.category.server.edge`（智能小站）、`ne.category.server.enclosure`（机柜） |
| 存储（子类） | `StorageSubClass` | `HuaweiSmisStorageDevice`、`VSPStorageDevice`、`HPEStorageDevice`、`FusionStorageDevice`、`EnterpriseStorage` |
| 终端 | `TerminalClassification` | `ne.category.terminal.*`（开放） |
| 协作 | `CollabClassification` | `COLLABORATION` |

> 分类维度使用**归一化后的稳定值**，调用方筛选时使用稳定值即可：
> - 网络 `NetworkDeviceType`：`LSW`/`AC`/`WAC`/`AR`/`AP` 等别名归一为
>   `ne.category.switch`/`ne.category.ac`/`ne.category.router`/`ne.category.fatap` 等；
> - PON `PonDeviceClassification`：`olt`/`OLT`/`ne.category.olt` 归一为 `olt`，
>   `onu`/`ONU`/`ne.category.onu`/`ne.category.pon.onu` 归一为 `onu`，
>   `spl`/`GPON`/`ne.category.pon.spl` 归一为 `gpon`；
> - 厂商维度（`NetworkDeviceManufacturer` 等）同样归一：`huawei` 覆盖 `Huawei`/
>   `huawei technologies co., ltd`/`2011` 等库内拼写。
> 未列出别名不能保证命中，仍以稳定值为准。

## 3. 状态与值域（Resolver 使用公开业务值）

> 状态/枚举类维度通过公开**业务值**筛选（如通信状态用 `"在线"`/`"离线"`、存储运行/
> 健康用 `"正常"`）。模型在确定性编译阶段把公开业务值映射到源字段的存储表示，并把
> 真实存储值作为参数化绑定写入 SQL；**Resolver 不感知也不选择存储表示**，不要尝试传
> 存储码或数字短码。未知业务值、非文本输入与非 `Eq` 算子会被确定性拒绝。
> 告警级别/确认/清除等整数字段直接接受数值（见下表），其业务标签仅供说明。

| 维度 | 类型 / 算子 | 公开业务值（Resolver 输入） | 业务含义 |
| --- | --- | --- | --- |
| 各域设备通信状态 `*CommuState` | text（只支持 `Eq`） | `"在线"` / `"离线"` | 通信在线 / 离线 |
| `StorageRunningStatus` | text（只支持 `Eq`） | `"正常"` | 运行正常（其余存储值未完整映射，能力收窄，不公开） |
| `StorageHealthStatus` | text（只支持 `Eq`） | `"正常"` | 健康正常（同上） |
| 子部件状态 `ServerPsuStatus`/`ServerDiskStatus`/`ServerFanStatus`/`StorageBackupPowerStatus`/`StorageFanStatus`/`StoragePsuStatus` | text（开放） | 库内业务文本，如 `"正常"`/`"异常"` | 开放文本；输入值须等于存储文本 |
| `AlarmSeverity` | int（支持范围比较） | `1` / `2` / `3` / `4` | 紧急 / 重要 / 次要 / 提示 |
| `AlarmAcked` | int | `0` / `1` | 未确认 / 已确认 |
| `AlarmCleared` | int | `0` / `1` | 未清除 / 已清除 |

- 通信/运行/健康为**业务值枚举**：由模型声明“业务值 → 存储值”的编译映射，未知业务值
  确定性拒绝；不会把业务文本原样绑定到编码列，也不要求 Resolver 知道存储表示。
- 存储运行/健康状态只公开 `"正常"` 这一业务值（源模型未提供其它状态值的完整公开
  映射）；需要其它状态过滤时应澄清或按能力边界处理。
- 开放文本维度（含子部件状态）的筛选值须等于库内存储文本；不存在编码转换。
- 网络设备分类归一（`LSW`/`AC`/`WAC`/`AR`/`AP` → `ne.category.*`）与厂商拼写归一见
  §2；这些维度筛选时使用**归一后的稳定值**。
- 链路/接口口径不在本模型范围内。

## 4. 业务关系与归属

- 设备属于某租户；设备位于某站点（站点属于租户）。
- 设备产生告警，告警关联产生它的设备/资源。
- 设备包含子部件；子部件属于某设备。
- 设备/子部件有对应的时间序列 KPI。
- 网络、PON、服务器、存储、终端五类设备都具有“设备—站点—租户”的归属链。
- **模型声明的受控两跳相关存在**：
  - 正向：KPI 采样与设备子部件实体通过其**唯一 owner 设备**关联告警（路线：
    事实/子部件 → owner 设备 → 告警）；
  - 反向：告警作为 base 经其 owner 设备关联子部件（路线：告警 → owner 设备 →
    子部件，逐设备域显式声明），使告警统计可用子部件属性做相关存在过滤。
  相关存在性编译使用 owner 上的 grain-safe join + correlated EXISTS，**不放大** base
  粒度，也不发 fan-out join。路线缺失、歧义/非唯一 owner、方向不匹配、目标维度不属于
  路径终点等一律确定性拒绝（见 `INTENT.md` §4.5/§7）。
- **告警与治理对象的组合边界**：告警表的资源引用（MEDN）可指向多个设备域的主键，把
  “告警”对象直接按站点/租户治理维度分组/筛选需要把每条告警映射到唯一设备域。模型
  只在请求带**明确的单一设备域锚点**（v1 支持网络设备域，例如同时使用
  `NetworkDevice*` 维度/过滤）时允许告警对象使用 `SiteName`/`SiteId`/
  `TenantName`/`TenantId` 等治理维度；没有锚点或锚点横跨多域的请求确定性拒绝，要求先
  用设备侧路径（设备指标/维度 + `exists(alarm)`）或澄清设备域（见 §4.1 对象域纪律）。
  告警自身的 `AlarmTenant` 等告警侧文本维度不受此限制。

### 4.1 统一设备统计与对象域纪律

- **统一设备统计**指对具备站点归属的上述五类设备（网络/PON/服务器/存储/终端）做联合
  计数（`DeviceCount`）。协作设备（视频会议终端等）没有站点归属，不属于任何站点，
  因此被排除在统一设备统计之外；租户归属不能替代站点归属。`DeviceCount` 只统计设备
  对象，不引入告警、KPI 或子部件条件，也不会把某一单域设备计数当作跨域设备数。
- 统一设备源只发布**稳定归属标识**维度（`DeviceTenantId`/`DeviceSiteId`），可用于
  跨域计数、按租户/站点标识筛选/分组，以及对稳定标识的排序和分组内 Top N。它**不
  携带**站点/租户的展示名称（`SiteName`/`TenantName`）、告警关系、KPI 关系或子部件
  关系。
- **对象域纪律（必须遵守）**：当用户使用上位概念“设备”而未指明具体设备域时，调用方
  **不得为了得到成功查询而静默把对象域缩窄成某一个设备子域**，也不得把统一设备统计
  悄悄替换成单域计数或忽略附加条件。下列形状**不是**单条可表达的查询；必须先与用户
  澄清对象域（网络 / PON / 服务器 / 存储 / 终端 / 协作），澄清后使用相应单域指标，
  或改用语义匹配的跨域指标：
  1. 需要对统一设备按站点/租户的**展示名称**（`SiteName`/`TenantName`）筛选、分组或
     排序；
  2. 需要“统一设备 + 告警相关条件”的计数或 Top N（如“存在某告警的设备数”）；
  3. 需要统一设备与 KPI、子部件等其他对象同请求组合。
  澄清到单一域后，可用该域的计数指标与站点/租户名称维度、`exists(alarm)`、KPI 等
  组合（如 `NetworkDeviceCount` + `SiteName`/`TenantName` + `exists`）。若问题的真实
  意图是“告警关联的受影响设备/资源**去重**数”（跨域、告警锚定），使用
  `AlarmDeviceRefCount` 的 `Distinct` 口径；它与五域统一对象计数是不同口径，不可互换。
- 若“设备”的对象域本身不明确（例如是否包含无站点归属的协作设备、是否指全部六域、
  还是仅指具备站点归属的五域），`DeviceCount` 不能替用户定义一个未声明的对象域；
  先澄清对象域与口径，再选择 `DeviceCount`（五域、仅计数）或分域计数（如
  `NetworkDeviceCount` + `CollabDeviceCount` 分别表达）。协作设备数量使用
  `CollabDeviceCount`。
- 上述不可表达组合若未经澄清直接提交，模型会**确定性拒绝**并给出可归因诊断：不发布
  部分结果，不退回单域，也不忽略告警/名称条件（见 `INTENT.md` §8）。

## 5. 指标（Measure）业务含义与统计口径

- **计数类**：结果无量纲，表示对象或事件个数。
- **KPI 类**：结果是有量纲的聚合值，表示相应业务量在选定统计周期/分组内的聚合值；
  KPI 的时间筛选通过其所属 KPI 实体的时间维度完成，统计区间采用 `[start, end)`
  半开区间（见 §7）。
- **去重口径**：`AlarmDeviceRefCount` 使用 `Distinct` 输入表示“去重后的受影响
  设备/资源数”，使用 `All` 输入表示“告警关联的引用行数”。其它计数指标默认
  `All`；`Distinct` 只在指标列自身有意义时才被接受。
- **比例/跨事实粒度比较不是公开能力**：模型不发布跨对象或跨事实粒度的比例、比率或
  比较类指标（如“告警占比”“每设备平均告警数”“两个域之间比较”），也不会通过隐式
  Join、任意聚合或“分别计算后拼接”制造可执行但语义不成立的结果。此类请求没有对应
  measure，会确定性失败（未知指标/粒度不兼容），需要按对象域分步计算或澄清。

指标目录（`id` 为公开标识）：

| id | 业务含义 | 单位/口径 |
| --- | --- | --- |
| `DeviceCount` | 五域（网络/PON/服务器/存储/终端）统一设备对象数；只统计具备站点归属的设备对象，不携带告警/KPI/子部件条件（见 §4.1） | 个 |
| `NetworkDeviceCount` | 网络设备对象数 | 个 |
| `PonDeviceCount` | PON 设备（OLT/ONU）对象数 | 个 |
| `ServerDeviceCount` | 服务器对象数 | 个 |
| `StorageDeviceCount` | 存储设备对象数 | 个 |
| `TerminalDeviceCount` | 终端设备对象数 | 个 |
| `CollabDeviceCount` | 协作设备对象数 | 个 |
| `AlarmCount` | 当前告警事件条数 | 条 |
| `AlarmDeviceRefCount` | 告警关联的受影响设备/资源引用计数；`Distinct`=按资源标识去重后的跨域对象数（告警锚定的“有此类告警的设备/资源去重数量”），`All`=告警关联的引用行数。该口径与五域 `DeviceCount` 的对象域不同（含协作等告警资源），不可互换 | 个/行 |
| `SiteCount` | 站点数 | 个 |
| `TenantCount` | 租户数 | 个 |
| `StorageControllerCount`/`StorageChassisCount`/`StorageBackupPowerCount`/`StorageDiskCount`/`StorageFanCount`/`StoragePortCount`/`StoragePsuCount` | 存储设备对应子部件数（控制器/机箱/备电/硬盘/风扇/端口/电源） | 个 |
| `ServerPsuCount`/`ServerOpticalCount`/`ServerDiskCount`/`ServerFanCount`/`ServerMemoryCount`/`ServerProcessorCount`/`ServerNicCount`/`ServerPortCount` | 服务器对应子部件数（电源/光模块/硬盘/风扇/内存条/处理器/网卡/端口） | 个 |
| `NetPortCount`/`NetOpticalCount` | 网络设备对应子部件数（端口/光模块） | 个 |
| `NetworkCpuUsageAvg` / `NetworkCpuUsageMax` | 网络设备 CPU 使用率平均 / 最大 | % |
| `NetworkMemUsageAvg` / `NetworkMemUsageMax` | 网络设备内存使用率平均 / 最大 | % |
| `NetworkIfUtilizationAvg` | 网络设备端口利用率平均 | % |
| `NetworkPortCountSum` / `NetworkPortUsedCountSum` | 网络设备端口总数 / 已用端口数 | 个 |
| `NetworkOnlineRateAvg` / `NetworkOnlineRateMax` | 网络设备在线率平均 / 最大 | — |
| `ApChannelUtilizationAvg` | AP 射频信道利用率平均 | % |
| `ApPacketLossSum` | AP 射频丢包率总和 | — |
| `ApRssiAvg` | AP 射频信号接收强度平均 | dBm |
| `ApUserCountSum` | AP 射频在线用户数总和 | 个 |
| `ServerCpuUsageAvg` / `ServerCpuUsageMax` | 服务器 CPU 使用率平均 / 最大 | % |
| `ServerMemUsageAvg` / `ServerMemUsageMax` | 服务器内存使用率平均 / 最大 | % |
| `ServerDiskUsageAvg` | 服务器硬盘使用率平均 | % |
| `PonCpuUsageAvg` | OLT CPU 使用率平均 | % |
| `PonMemUsageAvg` / `PonMemUsageMax` | OLT 内存使用率平均 / 最大 | % |
| `OnuMemUsageAvg` / `OnuMemUsageMax` | ONU 内存使用率平均 / 最大 | % |
| `OnuOnlineRateAvg` | ONU 在线率平均 | — |
| `OnuOpticalPowerAvg` | ONU 光功率平均 | — |
| `OnuOpticsTemperatureAvg` / `OnuOpticsTemperatureMax` | ONU 光模块温度平均 / 最大 | — |
| `PonPortIfOutBandRateAvg` | PON 端口光发送带宽利用率平均 | — |
| `PonPortInTrafficAvg` / `PonPortOutTrafficAvg` | PON 端口入/出流量速率平均 | bps |
| `PonPortOpticalPowerAvg` | PON 端口光功率平均 | — |
| `StorageCpuUsageAvg` / `StorageMemUsageAvg` | 存储设备 CPU/内存使用率平均 | — |
| `StorageIopsAvg` | 存储设备每秒 IO 次数平均 | 次/秒 |
| `StorageThroughputAvg` | 存储设备吞吐量平均 | — |

## 6. 维度（Dimension）业务含义

维度用于选择/筛选/分组/排序。每个维度属于某个业务对象（设备域、子部件、告警、
KPI 采样、治理视图或统一设备）。

- 维度值是业务展示值或稳定值，筛选输入必须与维度类型匹配。
- `TenantName`/`SiteName` 是展示用业务名称，可重复或变化；`TenantId`/`SiteId`/
  `DeviceTenantId`/`DeviceSiteId` 是稳定归属标识（`TenantId`/`SiteId` 在治理对象上，
  `DeviceTenantId`/`DeviceSiteId` 在统一设备上表示同一套标识）。名称不是标识，不能
  互相代替；按名称查询用 `*Name` 维度，按标识查询用 `*Id` 维度。
- **位置概念不可隐式替换**：`*Location`（如 `NetworkDeviceLocation`/
  `ServerLocation`/`StorageLocation`/`PonDeviceLocation`）是设备**自身资产位置**
  （文本，如机柜位置）；`SiteName`/`SiteId` 是**所属站点**（治理对象）；
  `TenantName`/`TenantId` 是**所属租户**。三类概念来自不同源属性，源模型没有声明它们
  等价，因此筛选/投影必须使用与问题一致的维度：问“位置/资产位置”用 `*Location`，
  问“站点”用 `SiteName`/`SiteId`，问“租户”用 `TenantName`/`TenantId`。模型不会把设备
  位置静默改写为站点名称或站点标识，也不会反向替换；缺少所需维度时确定性失败并应
  澄清。终端/协作等源模型没有位置属性，其 `*Location` 维度不存在，不可表达（见
  `INTENT.md` §8）。

维度目录（`id` 为公开标识；类型 = 该维度接受的值类型）：

| 归属 | id（按对象分组完整列出本模型公开的维度 id） | 类型 |
| --- | --- | --- |
| 治理 | `TenantName`、`TenantId`、`TenantIndustry`；`SiteName`、`SiteId` | text |
| 统一设备 | `DeviceTenantId`、`DeviceSiteId` | text |
| 告警 | `AlarmName`、`AlarmType`、`AlarmSource`、`AlarmProbableCause`、`AlarmResName`、`AlarmTenant` | text |
| 告警 | `AlarmSeverity`、`AlarmAcked`、`AlarmCleared` | int |
| 告警 | `AlarmTime` | time |
| 网络设备 | `NetworkDeviceId`、`NetworkDeviceName`、`NetworkDeviceType`、`NetworkDeviceAlias`、`NetworkDeviceIp`、`NetworkDeviceMac`、`NetworkDeviceSn`、`NetworkDeviceLocation`、`NetworkDeviceManufacturer`、`NetworkDeviceModel`、`NetworkDeviceVersion`、`NetworkDeviceOsVersion`、`NetworkDevicePatchVersion`、`NetworkDeviceCommuState`、`NetworkDeviceLanguage` | text |
| PON 设备 | `PonDeviceId`、`PonDeviceName`、`PonDeviceClassification`、`PonDeviceIp`、`PonDeviceSn`、`PonDeviceLocation`、`PonDeviceManufacturer`、`PonDeviceOsVersion`、`PonDeviceParentOlt`、`PonDeviceCommuState` | text |
| 服务器 | `ServerDeviceId`、`ServerName`、`ServerClassification`、`ServerIp`、`ServerSn`、`ServerMac`、`ServerLocation`、`ServerManufacturer`、`ServerModel`、`ServerVersion`、`ServerBiosVersion`、`ServerFirmwareVersion`、`ServerBmcHostname`、`ServerAssetNumber`、`ServerCommuState` | text |
| 服务器 | `ServerServiceDuration` | int |
| 存储设备 | `StorageDeviceId`、`StorageName`、`StorageSubClass`、`StorageIp`、`StorageSn`、`StorageLocation`、`StorageManufacturer`、`StorageModel`、`StorageCommuState`、`StorageRunningStatus`、`StorageHealthStatus`、`StorageHotPatchVersion` | text |
| 存储设备 | `StorageUsedCapacityRate`、`StorageTotalCapacity` | float |
| 终端设备 | `TerminalDeviceId`、`TerminalName`、`TerminalClassification`、`TerminalIp`、`TerminalMac`、`TerminalModel`、`TerminalSn`、`TerminalAccessDeviceId`、`TerminalCommuState` | text |
| 协作设备 | `CollabDeviceId`、`CollabName`、`CollabClassification`、`CollabIp`、`CollabCommuState` | text |
| KPI 采样 | `NetworkKpiTime`、`NetOnlineKpiTime`、`ApRadioKpiTime`、`ServerKpiTime`、`PonKpiTime`、`OnuKpiTime`、`PonPortKpiTime`、`StorageKpiTime` | time |
| 存储子部件 | `StorageControllerName`、`StorageChassisName`、`StorageBackupPowerName`、`StorageBackupPowerStatus`、`StorageDiskType`、`StorageFanStatus`、`StoragePortType`、`StoragePsuStatus` | text |
| 服务器子部件 | `ServerPsuName`、`ServerPsuStatus`、`ServerDiskType`、`ServerDiskStatus`、`ServerFanStatus`、`ServerNicMac`、`ServerPortType` | text |
| 网络子部件 | `NetPortType` | text |

### 6.1 版本/固件类维度的语义边界

版本类维度名称相近但语义不同，筛选/投影前必须按下列边界选择；模型按各维度映射到
对应的数据列，不存在一个维度覆盖“全部版本”：

| 维度 id | 语义边界 | 数据样例 |
| --- | --- | --- |
| `NetworkDeviceVersion` | 网络设备的**设备版本**（产品版本） | `V200R001C00` |
| `NetworkDeviceOsVersion` | 网络设备的**软件（OS）版本** | `V200R019C10`、`V200R019C00SPC500` |
| `NetworkDevicePatchVersion` | 网络设备的**补丁版本** | `V200R001SPH002` |
| `PonDeviceOsVersion` | PON 设备（OLT/ONU）的**软件版本** | `V200R019C10` 等 |
| `ServerVersion` | 服务器的**固件/BMC 版本**（`version` 字段） | `BMC3.19.00.07` |
| `ServerBiosVersion` | 服务器的 **BIOS 版本** | `5.11.02` |
| `ServerFirmwareVersion` | 服务器的**固件版本**（`firmwareVersion` 字段，与 `ServerVersion` 并存的另一口径） | 库内固件文本 |
| `StorageHotPatchVersion` | 存储设备的**热补丁版本** | `V100R001SPH001` |
| `ServerBmcHostname` | BMC 主机名（标识，不是版本） | 库内主机名 |

注意：`ServerVersion`（固件/BMC 版本，值形如 `BMC3.19.00.07`）与
`ServerFirmwareVersion`（`firmwareVersion` 字段）在业务上都是“固件版本”的近似表述，
但落在两个不同字段/列，公共契约以两个独立维度发布；检索“固件版本为 BMC3.19.00.07
的服务器”使用 `ServerVersion`，检索 `firmwareVersion` 列请使用 `ServerFirmwareVersion`，
两者不能互换。网络域的“设备版本”与“软件版本”同理（`NetworkDeviceVersion` 与
`NetworkDeviceOsVersion`）。

## 7. 时间含义与统计口径

- KPI 与告警的数据时间使用统一格式的文本时间戳；告警发生时间表示告警产生的时刻。
- **模型支持的表示**：时间筛选/排序只接受**绝对文本时间戳边界**，格式与库内数据一致
  （`YYYY-MM-DD HH:MM:SS`）。KPI 采样时间维度用 `Ge`/`Lt` 表达半开区间
  `[start, end)`（包含起点、不包含终点）；告警时间 `AlarmTime` 额外支持
  `Eq`/`Gt`/`Le`。时间边界是调用方提供的业务值；模型与 SQL 引擎都不会推算“当前
  时间”，也不会把相对时间词换算成边界。
- **相对时间词的换算责任与口径区分**：把“近 7 天/最近 30 天/近一个月/昨天/今天”等
  自然语言时间词换算成绝对边界时，调用方必须区分两种口径。**参考时刻 R 必须显式
  确定**：R 是数据环境的报告参考时刻或调用方通过契约显式提供/澄清的时刻；调用方不得
  仅凭自身当前日期（运行环境时钟）自行选定（例如把“当日零点”当作“现在”）后再换算，
  运行环境的当前日期不是完整、稳定的报告时刻。无法获得稳定 R 时应澄清或经输入契约
  显式携带 R，不得把假设当最终口径：
  - **固定时长窗口**：自报告参考时刻 R 回推固定小时/天数，例如“近 7 天”=
    `[R − 7×24h, R)`；“最近 30 天”=`[R − 30×24h, R)`。
  - **自然日历周期**：按日历边界计算，例如“本月”= 该自然月 `[月初, 下月初)`。
  - “近一个月/最近一个月”**同时存在**固定 30 天窗口与自然月两种合理口径，边界不同；
    输入未指明采用哪一种时，调用方**必须先澄清**，不得自行选定固定天数并把该假设
    当作最终口径。
  - “昨天/今天”也按上述原则处理：须明确是自然日边界（如 `[昨日 00:00:00, 今日
    00:00:00)`）还是自 R 回推 24 小时的固定窗口，未指明时先澄清。
- 换算得到的绝对边界必须与库内时间戳文本格式一致并保持半开区间；边界值作为参数化
  绑定进入查询，不进入 SQL 文本。

## 8. 稳定对象标识（`exists.target` / 对象归属）

下列稳定对象标识可在存在性过滤的 `target` 字段中使用（对象间是否允许相关由模型
声明决定，不支持的组合会给出确定性诊断）：

`tenant`、`site`、`alarm`、`net_device`、`pon_device`、`server_device`、
`storage_device`、`terminal_device`、`collab_device`。

> 注意：**统一设备源不是存在性过滤的关系端点**。`exists.target` 不接受 `device`；
> “跨域设备 + 告警存在性”的单条统一计数无法表达，必须先澄清对象域（用该域设备计数 +
> `exists(alarm)`）或改用告警锚定的 `AlarmDeviceRefCount`（`Distinct`）口径
> （见 §4.1）。各单域设备（`net_device` 等）与 `alarm` 之间的相关存在性按其声明方向
> 支持。

> **受控两跳子部件目标（告警侧反向相关存在可用）**：下列子部件稳定对象 id 可作为
> `exists.target` 与告警 base 一起使用（告警 → owner 设备 → 子部件路线，见 §4）：
> `net_port`、`net_optical`；`server_psu`、`server_optical`、`server_disk`、
> `server_fan`、`server_memory`、`server_processor`、`server_nic`、`server_port`；
> `storage_controller`、`storage_chassis`、`storage_backup_power`、`storage_disk`、
> `storage_fan`、`storage_port`、`storage_psu`。KPI 采样与子部件作为 base 时仍可用
> `alarm` 作 `exists.target`（正向路线）。未声明路线/方向不匹配/非唯一 owner 会确定性
> 失败。

## 9. 授权主体

`subject` 字段填写授权主体标识。当前模型接受的主体标识为 `analyst` 与 `resolver`；
未授权主体会确定性失败。

## 10. 维度能力边界

- **文本维度**（含设备/告警/子部件/治理/统一设备的文本属性）：支持 `Eq`、`Ne`、
  `Contains`、`NotContains`、`StartsWith`、`EndsWith`；输入类型为 text。
  `Contains`/`StartsWith`/`EndsWith` 大小写不敏感，`Eq`/`Ne`/`NotContains`
  大小写敏感。
- 枚举/状态类文本维度：分类/归一维度使用 §2 的**归一稳定值**（如 `ne.category.switch`、
  `huawei`、`gpon`）；通信/运行/健康状态维度使用 §3 的**公开业务值**（如 `"在线"`/
  `"离线"`/`"正常"`），其存储表示由编译映射完成，Resolver 不感知。
- **封闭枚举状态维度**（通信/运行/健康，见 §3）只支持 `Eq` 与文本业务值；未知业务值、
  非文本输入、`Ne`/`Contains`/范围等算子、以及试图传存储码都会确定性失败。开放文本
  维度仍按 §10 第一条。
- **整数维度**（如 `AlarmSeverity`、`ServerServiceDuration`）：支持 `Eq`、`Ne`、
  `Gt`、`Ge`、`Lt`、`Le`；输入类型为 int。
- **浮点维度**（如 `StorageUsedCapacityRate`、`StorageTotalCapacity`）：支持
  `Eq`、`Ne`、`Gt`、`Ge`、`Lt`、`Le`；输入类型为 number。
- **时间维度**：KPI 采样时间维度支持 `Gt`、`Ge`、`Lt`、`Le`（text）；告警时间
  `AlarmTime` 额外支持 `Eq`。
- 使用维度不支持的算子或输入类型、以及任何未知词汇都会确定性失败，不会返回部分
  结果（见 `INTENT.md` 的失败语义）。
