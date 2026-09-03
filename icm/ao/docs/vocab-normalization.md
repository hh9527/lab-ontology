# 词汇归一化规则表（Normalization Rules）

> 三级映射：**中文表述 → 目标字段 → 物理列/枚举值**，供 NL→SQL 解析器、词法归一化、别名扩展使用。
> 覆盖：实体、分类值、属性、状态、告警、指标、跨域对象、查询操作词。

---

## 1. 实体类型（中文 → 物理表 → 分类值）

| 中文 | 物理表 | 分类字段 | 规范值 | 别名/库内变体 |
|---|---|---|---|---|
| 网络交换机 | EntNetworkElement | classification | ne.category.switch | LSW |
| 网络路由器 | EntNetworkElement | classification | ne.category.router | 路由器、AR |
| AC | EntNetworkElement | classification | ne.category.ac | WAC |
| 防火墙 | EntNetworkElement | classification | ne.category.firewall | — |
| AP | EntNetworkElement | classification | ne.category.fatap | 无线接入点、AP |
| 光线路终端 | EntPonElement | classification | olt | OLT |
| 光网络单元 | EntPonElement | classification | onu | ONU |
| 机架服务器 | PhysicalServer | classification | ne.category.server.rack | — |
| 昆仑服务器 | PhysicalServer | classification | ne.category.server.kunlun | — |
| 异构服务器 | PhysicalServer | classification | ne.category.server.heterogeneous | — |
| 天工机框服务器 | PhysicalServer | classification | ne.category.server.subrack | — |
| 智能小站 | PhysicalServer | classification | ne.category.server.edge | — |
| 机柜 | PhysicalServer | classification | ne.category.server.enclosure | — |
| 华为SMIS存储设备 | HuaweiStorageDevice | subClassName | HuaweiSmisStorageDevice | 华为存储 |
| VSP存储设备 | HuaweiStorageDevice | subClassName | VSPStorageDevice | — |
| HP存储设备 | HuaweiStorageDevice | subClassName | HPEStorageDevice | HPE |
| 分布式存储设备 | HuaweiStorageDevice | subClassName | FusionStorageDevice | — |
| 闪存存储设备 | HuaweiStorageDevice | subClassName | EnterpriseStorage | 企业存储 |
| 终端设备 | EntTerminalElement | classification | ne.category.terminal.* | 打印机/UPS/负载均衡 |
| 协作终端 | EntCollaborationElement | classification | COLLABORATION | 视频会议终端 |
| FC交换机 | StorageFcSwitch [inferred] | — | — | 光纤通道交换机 |

---

## 2. 跨域对象

| 中文 | 物理表 | 主键列 | 规范值示例 |
|---|---|---|---|
| 站点 | X_SITE_VIEW | SITE_ID | 北京总部(site-01)、上海分部(site-02) |
| 租户 | X_TENANT_VIEW | TENANT_ID | 运营商A(tenant-01)、企业客户B(tenant-02) |
| 当前告警 | T_CURRENT_ALARM | CSN | — |
| 物理链路 | EnterprisePhysicalLink | id | link-001 |
| 设备索引 | X_DEVICE_INDEX [inferred] | id | — |

---

## 3. 子部件（中文 → 物理表）

| 域 | 中文 | 物理表 | 挂载键 |
|---|---|---|---|
| 网络 | 机框 | EntNetworkFrame | parentResId→设备id |
| 网络 | 单板/板卡 | EntNetworkSlot | refParentNe→设备id |
| 网络 | 端口 | EntNetworkPort | refParentNe→设备id |
| 网络 | 光模块 | EntNetworkOpticalModule | neResId→设备id |
| 服务器 | 硬盘 | PhysicalServerDisk | parentResId→设备oriResId |
| 服务器 | 内存条 | PhysicalServerMemory | parentResId→设备oriResId |
| 服务器 | 处理器 | PhysicalServerProcessor | parentResId→设备oriResId |
| 服务器 | 风扇 | PhysicalServerFan | parentResId→设备oriResId |
| 服务器 | 电源 | PhysicalServerPSU | parentResId→设备oriResId |
| 服务器 | 网卡 | PhysicalServerNIC | parentResId→设备oriResId |
| 服务器 | 端口 | PhysicalServerPort | parentResId→设备oriResId |
| 服务器 | 光模块 | PhysicalServerOpticalModule | neResId→设备oriResId |
| 存储 | 机箱/机框 | SYS_Chassis | parentResId→设备id |
| 存储 | 控制器 | SYS_Controller | parentResId→设备id |
| 存储 | 硬盘 | SYS_Disk | parentResId→设备id |
| 存储 | 风扇 | SYS_Fan | parentResId→设备id |
| 存储 | 电源 | SYS_PSU | parentResId→设备id |
| 存储 | 端口 | SYS_Port | parentResId→设备id |
| 存储 | 后备电源/备电 | SYS_BackupPower | parentResId→设备id |

---

## 4. 属性归一（中文 → 字段，标注多口径）

| 中文 | 目标字段 | 表 | 备注 |
|---|---|---|---|
| 名称 | name | 各表 | — |
| 别名 | alias | EntNetworkElement | SNMPSIM_xxx |
| 型号 | productName / productmodel / model | 网络/服务器 / 存储 / 终端 | **四口径** |
| 设备分类 | classification / subClassName | 各表 | 存储用 subClassName |
| IP地址 | ipAddress | 各设备表 | 支持包含 |
| 序列号 | sn | 各表 | 协作=主键 |
| 厂商 | manufacturer | 各表 | 需 LOWER 归一 |
| 设备版本 | version | EntNetworkElement | V200R001C00 |
| 软件版本 | neOsVersion | 网络/PON | — |
| 补丁版本 | nePatchVersion | EntNetworkElement | — |
| 热补丁版本 | hotPatchVersion | HuaweiStorageDevice | — |
| 固件版本 | version / firmwareVersion | PhysicalServer | 双口径，易混淆 |
| BIOS版本 | biosVersion | PhysicalServer | — |
| 通信状态 | commuState | 各设备表 | 0/1 |
| 运行状态 | runningStatus | HuaweiStorageDevice | '1' |
| 健康状态 | healthStatus | HuaweiStorageDevice | '1' |
| MAC地址 | mac | 网络/服务器/终端 | xx:xx:xx:xx:xx:xx |
| 位置/资产位置 | location | 各设备表 | Beijing-A1-Rack01 |
| 资产编号 | assetNumber | PhysicalServer | AN-000001 |
| 服务时长 | serviceDuration | PhysicalServer | 秒 |
| 租户ID | tenantId | 各表 | FK→TENANT_ID |
| 站点ID | refParentSubnet / siteId | 各表 | 终端/协作/FC用 siteId |
| 项目ID | projectId | 网络/PON/服务器/存储 | 站点关联第二口径 |
| 所属OLT资源ID | parentOltResId | EntPonElement | ONU 字段 |
| 接入设备ID | accessDeviceId | EntTerminalElement | — |
| 容量利用率 | usedCapacityRate | HuaweiStorageDevice | % |
| 裸容量 | totalCapacity | HuaweiStorageDevice | — |
| 语言 | language | EntNetworkElement | zh |

---

## 5. 状态/枚举归一

| 中文 | 字段 | 规范值 → 含义 |
|---|---|---|
| 在线 / 离线 | commuState | 0 → 在线；1 → 离线 |
| 紧急/重要/次要/提示 | SEVERITY | 1 → 紧急；2 → 重要；3 → 次要；4 → 提示 |
| 未确认/已确认 | ACKED | 0 → 未确认；1 → 已确认 |
| 未清除/已清除 | CLEARED | 0 → 未清除；1 → 已清除 |
| 双向/单向 | direction | bidirectional → 双向；unidirectional → 单向 |

---

## 6. 告警归一

| 中文 | 字段 | 备注 |
|---|---|---|
| 告警流水号 | CSN | 主键 |
| 资源ID | MEDN | 关联设备主键 |
| 告警名称 | ALARMNAME | 光模块收发异常/CPU使用率过高/内存使用率过高/端口流量超限/单板掉线/硬盘故障/电源故障/设备离线/Heartbeat |
| 告警类型 | ALARMTYPE | tag 字段 |
| 告警级别 | SEVERITY | 数值 1-4 |
| 确认状态 | ACKED | 数值 0/1 |
| 清除状态 | CLEARED | 数值 0/1 |
| 资源名称 | RESNAME | — |
| 告警源 | SOURCE | — |
| 可能原因 | PROBABLECAUSE | — |
| 所属租户 | TENANT | imastercloud24 |
| 告警发生时间 | ALARMTIME | 排序字段 |
| 站点扩展字段 | STREXT13 | 站点归属 |

---

## 7. 指标归一（中文 → 字段 → 表）

| 中文 | 字段 | 表（同词多表需按实体定） |
|---|---|---|
| CPU使用率 | cpuUsage | NetworkDeviceKPI / PonDeviceKPI / ServerDeviceKPI / StorageDeviceKPI / NetworkBoardKPI |
| 内存使用率 | memUsage | 同上 |
| 在线率 | onlineRate | NetworkDeviceKPI / NetworkDeviceOnlineKPI / NetworkApKPI / PonDeviceOnuKPI / PonDeviceOnlineKPI |
| 端口利用率 | ifUtilizationRate | NetworkDeviceKPI |
| 端口总数 | portCount | NetworkDeviceKPI |
| 已使用端口数 | portUsedCount | NetworkDeviceKPI |
| 在线用户数 | userCount | NetworkApRadioKPI / NetworkApRadioSsidKPI |
| 信道利用率 | channelUtilization | NetworkApRadioKPI / NetworkApRadioSsidKPI |
| 信号接收强度 | rssi | NetworkApRadioKPI |
| 丢包率 | packetLossRate | NetworkApRadioKPI |
| 参考信号接收功率 | rsrp | NetworkCellLinkQualityKPI |
| 信干噪比 | sinr | NetworkCellLinkQualityKPI |
| 入/出方向流量速率 | inTrafficRate / outTrafficRate | NetworkInterfaceKPI / NetworkCellLinkTrafficKPI / PonDevicePonPortKPI / PonDeviceEthernetPortKPI |
| 入/出方向利用率 | inUtilization / outUtilization | NetworkInterfaceKPI |
| 入/出方向误码率 | inErrorRate / outErrorRate | NetworkInterfaceKPI |
| 光功率 | opticalPower | PonDeviceOnuKPI / PonDevicePonPortKPI |
| 光端口发送带宽利用率 | ifOutBandRate | PonDevicePonPortKPI |
| 光模块温度 | onuhwOpticsTemperature | PonDeviceOnuKPI |
| 硬盘使用率 | diskUsage | ServerDeviceKPI / StorageHardDriveKPI |
| 硬盘温度 | temperature | StorageHardDriveKPI |
| 每秒IO次数 | iops | StorageDeviceKPI / StorageHardDriveKPI |
| 吞吐量 | throughput | StorageDeviceKPI |

---

## 8. 查询操作词归一

| 类别 | 中文词表 → 语义 |
|---|---|
| 时间算子 | 近7天/最近7天→`-7 days`；最近30天→`-30 days`；近一个月→`-1 month`；昨天→`-1 day`；今天→`0` |
| 聚合算子 | 平均值→AVG；最大值→MAX；最小值→MIN；总和→SUM |
| 过滤算子 | 为→`=`；包含→`LIKE '%v%'`；不包含→`NOT LIKE '%v%'`；以…开头→`LIKE 'v%'`；以…为后缀→`LIKE '%v'`；不低于→`>=`；大于→`>`；少于/低于→`<` |
| 查询目标 | 数量→COUNT(DISTINCT?)/COUNT(*)；信息→SELECT 字段集；目标属性→SELECT 单列；聚合→AVG/MAX/MIN/SUM；趋势→按 ts 排序；列表→带 ORDER BY；TOP N→窗口函数 rn<=N；告警→JOIN T_CURRENT_ALARM |
| 遍历方向 | 无遍历；所在的（站点/租户）；产生的（告警）；的{子部件}（contains）；在{时间}{kpi}（data_link→metric）；下连（链路） |

---

## 9. 参考取值样例（填槽值）

| 类别 | 样例 |
|---|---|
| 设备型号 | CE12800、OceanStor 5310、RH2288H V3、Model-5 |
| 软件/设备版本 | V200R019C10、V200R001C00、V200R019C00SPC500、V200R001C00SPC700 |
| 固件/BIOS版本 | BMC3.19.00.07、5.11.02 |
| 补丁版本 | V200R001SPH002、V100R001SPH001 |
| IP地址 | 10.4.151.106、10.4.153.218、10.4.169.36、10.5.0.0 |
| MAC地址 | 00:1A:2B:00:00:00、05:1A:2B:00:00:00 |
| 资产位置 | Beijing-A1-Rack01 |
| 资产编号 | AN-000001 |
| 服务时长 | 31536000（秒，=1年） |
| 站点/租户 | 北京总部、上海分部 / 运营商A、企业客户B |
| 设备名称 | core-switch-01、access-switch-02、server-01、stor-01、link-001 |
| 厂商过滤值 | '2011'、'Huawei'、'huawei technologies co., ltd' |
