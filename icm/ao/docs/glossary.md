# iMasterCloud 业务词汇表（Glossary）

> 面向 iMasterCloud 运维领域 NL→SQL / 本体理解的统一词汇口径。
> 来源：`icloud/umodel/` 本体（UModel YAML）+ `icloud/queries/user_query_cases_ref/`（40 条参考 SQL）+ `icloud/queries/*.md`（用例集与模板）。
> 配套表结构见 [../schema/schema.sql](../schema/schema.sql)。
>
> ⚠️ **权威精度**：本表是合并转述（如枚举可能归一化书写）。需要**逐字段/逐枚举/逐映射的原始精度**时，请以程序化无损转存文档为准：
> [entity-sets-full.md](entity-sets-full.md)（27 实体集字段）、[entity-set-links-full.md](entity-set-links-full.md)（71 关系）、[event-source-full.md](event-source-full.md)（告警/视图字段）、[metric-sets.md](metric-sets.md)（17 指标集）、[data-links.md](data-links.md)（28 数据关联）。

---

## 1. 业务域（Domain）

| 域 | 中文 | 范围 |
|---|---|---|
| imaster.network | 网络 | 交换机、路由器、防火墙、AC、AP 及机框/板卡/端口/光模块/物理链路 |
| imaster.storage | 存储 | 华为SMIS/VSP/HP/分布式/闪存存储设备、FC交换机及控制器/硬盘/风扇/电源/端口/备电 |
| imaster.server | 服务器 | 机架/昆仑/异构/天工机框/智能小站/机柜服务器及 CPU/内存/硬盘/网卡/电源/风扇/端口/光模块 |
| imaster.pon | PON | OLT/ONU 光接入设备 |
| imaster.terminal | 终端 | 打印机、UPS、负载均衡等接入终端 |
| imaster.collaboration | 协作 | 视频会议终端等协作设备 |
| imaster.governance | 治理 | 当前告警事件集、租户/站点/设备索引三个跨域视图 |

---

## 2. 实体类型词汇（Entity Types）

### 2.1 设备（含物理表、classification 取值、同义词）

| 中文 | 同义词 | 物理表 | classification / subClassName 取值 |
|---|---|---|---|
| 网络交换机 | LSW | EntNetworkElement | ne.category.switch / LSW |
| 网络路由器 | 路由器 | EntNetworkElement | ne.category.router / AR |
| AC | WAC | EntNetworkElement | ne.category.ac / AC / WAC |
| 防火墙 | — | EntNetworkElement | ne.category.firewall |
| AP | 无线接入点 | EntNetworkElement | ne.category.fatap / AP |
| 光线路终端 | OLT | EntPonElement | olt |
| 光网络单元 | ONU | EntPonElement | onu |
| 机架服务器 | — | PhysicalServer | ne.category.server.rack |
| 昆仑服务器 | — | PhysicalServer | ne.category.server.kunlun |
| 异构服务器 | — | PhysicalServer | ne.category.server.heterogeneous |
| 天工机框服务器 | — | PhysicalServer | ne.category.server.subrack |
| 智能小站 | — | PhysicalServer | ne.category.server.edge |
| 机柜 | — | PhysicalServer | ne.category.server.enclosure |
| 华为SMIS存储设备 | 华为存储 | HuaweiStorageDevice | HuaweiSmisStorageDevice |
| VSP存储设备 | — | HuaweiStorageDevice | VSPStorageDevice |
| HP存储设备 | HPE | HuaweiStorageDevice | HPEStorageDevice |
| 分布式存储设备 | — | HuaweiStorageDevice | FusionStorageDevice |
| 闪存存储设备 | 企业存储 | HuaweiStorageDevice | EnterpriseStorage |
| 终端设备 | 打印机/UPS/负载均衡 | EntTerminalElement | ne.category.terminal.* |
| 协作终端 | 视频会议终端 | EntCollaborationElement | COLLABORATION |
| FC交换机 | 光纤通道交换机 | StorageFcSwitch [inferred] | — |

### 2.2 跨域对象

| 中文 | 物理表 | 主键 |
|---|---|---|
| 站点 | X_SITE_VIEW | SITE_ID |
| 租户 | X_TENANT_VIEW | TENANT_ID |
| 当前告警 | T_CURRENT_ALARM | CSN |
| 物理链路 | EnterprisePhysicalLink | id |

### 2.3 子部件

| 域 | 子部件（中文） | 物理表 |
|---|---|---|
| 网络 | 机框 | EntNetworkFrame [inferred] |
| 网络 | 单板/板卡 | EntNetworkSlot [inferred] |
| 网络 | 端口 | EntNetworkPort [inferred] |
| 网络 | 光模块 | EntNetworkOpticalModule [inferred] |
| 服务器 | 硬盘 / 内存条 / 处理器 / 风扇 / 电源 / 网卡 / 端口 / 光模块 | PhysicalServerDisk / Memory / Processor / Fan / PSU / NIC / Port / OpticalModule |
| 存储 | 机箱/机框 / 控制器 / 硬盘 / 风扇 / 电源 / 端口 / 后备电源(备电) | SYS_Chassis / SYS_Controller / SYS_Disk / SYS_Fan / SYS_PSU / SYS_Port / SYS_BackupPower |

---

## 3. 关系词汇（Relationships）

| 中文关键词 | 本体 link | 方向 | SQL 关联 |
|---|---|---|---|
| 所在的租户 / 属于 | belongs_to | 设备→租户 | device.tenantId = X_TENANT_VIEW.TENANT_ID |
| 所在的站点 / 位于 | located_at | 设备→站点 | device.refParentSubnet / projectId（存储为 parentResId 或 projectId）= X_SITE_VIEW.SITE_ID |
| 的{子部件} / 包含 | contains | 设备→子部件 | device.id = subpart.parentResId / neResId / refParentNe（服务器用 device.oriResId = subpart.parentResId） |
| 下连 / 连接 | connected_to_a / connected_to_z | 设备↔设备（经链路） | link.aNeResId / link.zNeResId 命中两端设备 id |
| 产生的{告警} | data_link→EventSet | 设备→当前告警 | device.id / resId / sn = T_CURRENT_ALARM.MEDN |
| 在{时间}的{kpi} | data_link→MetricSet | 设备→KPI | device.id = kpi.res_id / parent_id |
| 父级（OLT→ONU） | parent_of | ONU→OLT | EntPonElement.parentOltResId |
| 接入 | accesses | 终端→网络/PON 设备 | EntTerminalElement.accessDeviceId |

> 注意：`下连` 走物理链路表，判断"设备1下连设备2"时 d1 在 a/z 端之一、d2 在另一端（参考 SQL 用 `OR` 双向判断）。

---

## 4. 属性字段词汇（Attributes）

### 4.1 通用设备属性

| 中文 | 字段 | 所在表 | 备注 |
|---|---|---|---|
| 名称 | name | 各设备表 | 支持前缀匹配 |
| 别名 | alias | EntNetworkElement | 仿真别名 SNMPSIM_xxx |
| 型号 | productName / productmodel / model | 网络/服务器=productName，存储=productmodel，终端=model | **字段名四口径** |
| 设备分类 | classification / subClassName | 设备表 | 网络用 classification，存储用 subClassName |
| IP地址 | ipAddress | 各设备表 | 支持包含匹配 |
| 序列号 | sn | 各设备表 | 协作用作主键 |
| 厂商 | manufacturer | 各设备表 | 需 LOWER() 归一后匹配 |
| 通信状态 | commuState | 各设备表 | 0=在线/1=离线 |
| 位置 | location | 各设备表 | 资产位置，如 Beijing-A1-Rack01 |
| MAC地址 | mac | 网络/服务器/终端 | |
| 租户ID | tenantId | 各设备表 | FK→X_TENANT_VIEW |
| 站点ID | refParentSubnet / siteId | 各设备表 | 终端/协作/FC交换机用 siteId |
| 项目ID | projectId | 网络/PON/服务器/存储 | 站点关联第二口径 |

### 4.2 版本类字段（口径最多，易混淆）

| 中文 | 字段 | 表 | 样例 |
|---|---|---|---|
| 设备版本 | version | EntNetworkElement | V200R001C00 |
| 软件版本 | neOsVersion | 网络/PON | V200R019C10、V200R019C00SPC500 |
| 补丁版本 | nePatchVersion | EntNetworkElement | V200R001SPH002 |
| 热补丁版本 | hotPatchVersion | HuaweiStorageDevice | V100R001SPH001 |
| 固件/BMC版本 | version | PhysicalServer | BMC3.19.00.07 |
| BIOS版本 | biosVersion | PhysicalServer | 5.11.02 |
| 固件版本 | firmwareVersion | PhysicalServer | — |

### 4.3 专属属性

| 中文 | 字段 | 表 |
|---|---|---|
| 资产编号 | assetNumber | PhysicalServer |
| 服务时长(秒) | serviceDuration | PhysicalServer |
| 原始资源ID | oriResId | PhysicalServer（子部件关联键） |
| 所属OLT资源ID | parentOltResId | EntPonElement |
| 接入设备ID | accessDeviceId | EntTerminalElement |
| 容量利用率(%) | usedCapacityRate | HuaweiStorageDevice |
| 裸容量 | totalCapacity | HuaweiStorageDevice |
| 运行状态 | runningStatus | HuaweiStorageDevice |
| 健康状态 | healthStatus | HuaweiStorageDevice |
| 设备子类 | subClassName | HuaweiStorageDevice |
| 语言 | language | EntNetworkElement |

### 4.4 链路属性

| 中文 | 字段 | 取值 |
|---|---|---|
| 链路方向 | direction | bidirectional=双向 / unidirectional=单向 |
| 链路类型 | linkType | 光纤等 |
| A端设备ID | aNeResId | FK→设备.id |
| Z端设备ID | zNeResId | FK→设备.id |
| A/Z端端口DN | aPortDn / zPortDn | 端口全称 |

### 4.5 告警属性

| 中文 | 字段 |
|---|---|
| 告警流水号 | CSN（主键） |
| 资源ID | MEDN（FK→设备主键） |
| 告警名称 | ALARMNAME |
| 告警类型 | ALARMTYPE |
| 告警级别 | SEVERITY（1/2/3/4） |
| 确认状态 | ACKED（0/1） |
| 清除状态 | CLEARED（0/1） |
| 资源名称 | RESNAME |
| 告警源 | SOURCE |
| 可能原因 | PROBABLECAUSE |
| 所属租户 | TENANT |
| 告警发生时间 | ALARMTIME |
| 站点扩展字段 | STREXT13 |

---

## 5. 枚举值域（Value Domains）

| 字段 | 取值 | 含义 |
|---|---|---|
| commuState | 0 / 1 | 在线 / 离线 |
| SEVERITY | 1 / 2 / 3 / 4 | 紧急 / 重要 / 次要 / 提示 |
| ACKED | 0 / 1 | 未确认 / 已确认 |
| CLEARED | 0 / 1 | 未清除 / 已清除 |
| direction | bidirectional / unidirectional | 双向 / 单向 |
| classification(网络) | ne.category.switch / .ac / .router / .firewall / .fatap / .unknown | 交换机 / AC / 路由器 / 防火墙 / AP / 其他 |
| classification(PON) | olt / onu | OLT / ONU |
| classification(服务器) | ne.category.server.rack / .kunlun / .heterogeneous / .subrack / .edge / .enclosure | 机架 / 昆仑 / 异构 / 天工机框 / 智能小站 / 机柜 |
| subClassName(存储) | HuaweiSmisStorageDevice / VSPStorageDevice / HPEStorageDevice / FusionStorageDevice / EnterpriseStorage | 华为SMIS / VSP / HP / 分布式 / 闪存 |
| classification(协作) | COLLABORATION | 协作终端 |

**参考取值样例**：设备型号 CE12800、OceanStor 5310、RH2288H V3、Model-5；IP 10.4.x.x；MAC 00:1A:2B:00:00:00；站点 北京总部/上海分部；租户 运营商A/企业客户B。

---

## 6. 指标词汇（KPIs）

| 中文 | 指标字段 | 物理表 | 聚合 | 单位 |
|---|---|---|---|---|
| CPU使用率 | cpuUsage | NetworkDeviceKPI / PonDeviceKPI / ServerDeviceKPI / StorageDeviceKPI / NetworkBoardKPI | avg | % |
| 内存使用率 | memUsage | 同上 | avg | % |
| 在线率 | onlineRate | NetworkDeviceKPI / NetworkDeviceOnlineKPI / NetworkApKPI / PonDeviceOnuKPI / PonDeviceOnlineKPI | avg | — |
| 端口利用率 | ifUtilizationRate | NetworkDeviceKPI | avg | % |
| 端口总数 | portCount | NetworkDeviceKPI | sum | — |
| 已使用端口数 | portUsedCount | NetworkDeviceKPI | sum | — |
| 在线用户数 | userCount | NetworkApRadioKPI / NetworkApRadioSsidKPI | sum | — |
| 信道利用率 | channelUtilization | NetworkApRadioKPI / NetworkApRadioSsidKPI | avg | % |
| 信号接收强度 | rssi | NetworkApRadioKPI | — | dBm |
| 丢包率 | packetLossRate | NetworkApRadioKPI | sum | — |
| 参考信号接收功率 | rsrp | NetworkCellLinkQualityKPI | avg | dBm |
| 信干噪比 | sinr | NetworkCellLinkQualityKPI | avg | dB |
| 入/出方向流量速率 | inTrafficRate / outTrafficRate | NetworkInterfaceKPI / NetworkCellLinkTrafficKPI / PonDevicePonPortKPI / PonDeviceEthernetPortKPI | avg | bps |
| 入/出方向利用率 | inUtilization / outUtilization | NetworkInterfaceKPI | avg | % |
| 入/出方向误码率 | inErrorRate / outErrorRate | NetworkInterfaceKPI | avg | — |
| 光功率 | opticalPower | PonDeviceOnuKPI / PonDevicePonPortKPI | avg | — |
| 光端口发送带宽利用率 | ifOutBandRate | PonDevicePonPortKPI | — | — |
| 光模块温度 | onuhwOpticsTemperature | PonDeviceOnuKPI | max | — |
| 硬盘使用率 | diskUsage | ServerDeviceKPI / StorageHardDriveKPI | avg | % |
| 硬盘温度 | temperature | StorageHardDriveKPI | avg | — |
| 每秒IO次数 | iops | StorageDeviceKPI / StorageHardDriveKPI | avg | — |
| 吞吐量 | throughput | StorageDeviceKPI | avg | — |

---

## 7. 查询操作词（Operators）

| 类别 | 词表 |
|---|---|
| 时间算子 | 近7天、最近7天、最近30天、近一个月、昨天、今天 |
| 聚合算子 | 平均值(avg)、最大值(max)、最小值(min)、总和(sum) |
| 过滤算子 | 为(=)、包含(contains)、不包含(not contains)、以…开头(starts-with)、以…为后缀(ends-with)、不低于(≥)、大于(>)、少于/低于(<) |
| 查询目标 | 数量(count)、信息(select *)、目标属性、聚合、趋势、列表(带排序)、TOP N、告警 |
| 遍历方向 | 无、所在的、产生的、的{子部件}、在{时间}{kpi}、下连 |

---

## 8. 表 ↔ 本体实体映射

| 物理表 | 本体 entity_set / event_set / entity_source | 中文 |
|---|---|---|
| EntNetworkElement | imaster.network.device | 网络设备 |
| EntPonElement | imaster.pon.device | PON设备 |
| PhysicalServer | imaster.server.device | 服务器 |
| HuaweiStorageDevice | imaster.storage.device | 存储设备 |
| EntTerminalElement | imaster.terminal.device | 终端设备 |
| EntCollaborationElement | imaster.collaboration.device | 协作设备 |
| EnterprisePhysicalLink | imaster.network.physical_link | 物理链路 |
| T_CURRENT_ALARM | imaster.governance.event.current_alarm | 当前告警 |
| X_SITE_VIEW | imaster.governance.source.site_view | 站点视图 |
| X_TENANT_VIEW | imaster.governance.source.tenant_view | 租户视图 |
| X_DEVICE_INDEX [inferred] | imaster.governance.source.device_index | 设备索引 |
| EntNetworkFrame/Slot/Port/OpticalModule [inferred] | imaster.network.* | 网络子部件 |
| PhysicalServer* | imaster.server.* | 服务器子部件 |
| SYS_* | imaster.storage.* | 存储子部件 |
| StorageFcSwitch [inferred] | imaster.storage.fc_switch | FC交换机 |
| NetworkDeviceKPI 等 | imaster.network.metric.* 等 | 各 KPI 集 |

---

## 9. 多口径与易错点（Ambiguity Notes）

1. **主键三套**：网络/服务器/存储/PON 用 `id`；终端用 `resId`；协作用 `sn`。告警 MEDN 的 JOIN 键按设备类型分流。
2. **站点关联三口径**：`refParentSubnet`（网络/PON/服务器）、`projectId`、存储的 `parentResId`；终端/协作/FC交换机用 `siteId`。
3. **子部件挂载四键**：`parentResId`（存储/服务器部件）、`neResId`（光模块）、`refParentNe`（网络端口/单板）、服务器整体用 `oriResId` 关联子部件。
4. **型号字段四口径**：`productName`（网络/服务器）、`productmodel`（存储）、`model`（终端）。5. **版本字段多口径**：`version`（设备版本/服务器BMC版本）、`neOsVersion`（软件版本）、`nePatchVersion`/`hotPatchVersion`（补丁）、`biosVersion`/`firmwareVersion`。
6. **"固件版本"歧义**：服务器固件版本落在 `version` 字段（值如 BMC3.19.00.07），而 `firmwareVersion` 字段另存固件版本，二者并存易混淆。
7. **厂商过滤陷阱**：Huawei 存储库中存在 '2011'/'Huawei'/'huawei technologies co., ltd' 多种写法，必须 `LOWER()` 归一。
8. **KPI 归属键两口径**：设备级用 `res_id`，射频/端口级用 `parent_id`。
9. **指标同词不同表**："内存使用率"在 PonDeviceOnuKPI 指 ONU 内存、在 NetworkBoardKPI 指单板内存，需结合实体类型选表。
10. **分类过滤的双口径**：网络设备用 `classification` 且参考 SQL 常带 `IN ('ne.category.x', '别名')` 双写；存储设备用 `subClassName` 精确单写。
