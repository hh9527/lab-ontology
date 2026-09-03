# 实体关系矩阵（ER Matrix）

> iMasterCloud 对象模型的关系全貌：实体、关系类型、基数、物理关联字段、自然语言关键词。
> 关系类型对应本体 `entity_set_link`（实体关系）与 `data_link`（数据关联）。
> `entity_link_type`：belongs_to=属于、located_at=位于、contains=包含、connected_to_a/z=连接、parent_of=父级、accesses=接入、related_to=关联。

---

## 1. 关系总览

| 源实体 | 关系 | 目标实体 | 基数 | 物理关联字段 | 中文关键词 |
|---|---|---|---|---|---|
| 租户 X_TENANT_VIEW | contains | 站点 X_SITE_VIEW | 1:N | X_SITE_VIEW.TENANT_ID = TENANT_ID | 租户下的站点 |
| 站点 X_SITE_VIEW | —（聚合点） | 各设备 | 1:N | 设备 refParentSubnet/projectId/parentResId = SITE_ID | 站点下的设备 |
| 网络/PON/服务器/存储/终端/协作设备 | belongs_to | 租户 X_TENANT_VIEW | N:1 | device.tenantId = TENANT_ID | 所在的租户 / 属于 |
| 各子部件（网络机框/单板/端口/光模块、服务器硬盘/内存/处理器/风扇/电源/网卡/端口/光模块、存储机箱/控制器/硬盘/风扇/电源/端口/备电） | belongs_to | 租户 X_TENANT_VIEW | N:1 | subpart.tenantId = TENANT_ID | 属于（子部件级） |
| FC交换机 | belongs_to | 租户 X_TENANT_VIEW | N:1 | fc_switch.tenantId = TENANT_ID | 属于 |
| 网络/PON/服务器/存储/终端设备 | located_at | 站点 X_SITE_VIEW | N:1 | device.refParentSubnet/siteId = SITE_ID | 所在的站点 / 位于 |
| 网络设备 | contains | 网络机框/单板/端口/光模块 | 1:N | device.id = frame.parentResId / port.refParentNe / opt.neResId | 的机框/板卡/端口/光模块 |
| 网络机框 | contains | 网络单板 | 1:N | frame.frameDn = slot.frameNativeId | 机框的板卡 |
| 网络端口 | contains | 网络光模块 | 1:N | port.id = opt.ifName（接口口径） | 端口的光模块 |
| 服务器 | contains | 硬盘/内存/处理器/风扇/电源/网卡/端口/光模块 | 1:N | device.oriResId = subpart.parentResId/neResId | 的硬盘/内存条/… |
| 存储设备 | contains | 机箱/控制器/硬盘/风扇/电源/端口/备电 | 1:N | device.id = subpart.parentResId | 的机箱/控制器/… |
| FC交换机 | contains | 存储端口 | 1:N | fc_switch.id = port.parentResId | FC交换机的端口 |
| PON设备(ONU) | parent_of | PON设备(OLT) | N:1 | onu.parentOltResId = olt.id | OLT下的ONU / 所属OLT |
| 终端设备 | accesses | 网络设备 / PON设备 | N:1 | terminal.accessDeviceId = device.id | 终端接入的设备 |
| 设备 | connected_to_a/z | 物理链路 | 1:N | link.aNeResId / link.zNeResId = device.id | 下连的链路 |
| 物理链路 | — | 设备（两端） | N:1×2 | link.aNeResId/zNeResId → 设备 | 设备间的链路 |
| 设备 | related_to(data_link) | 当前告警 | 1:N | device.id/resId/sn = alarm.MEDN | 产生的告警 |
| 租户/站点视图 | related_to(data_link) | 当前告警 | 1:N | view 无独立键，经设备中转 | 租户/站点下的告警 |
| 设备 | related_to(data_link) | 各 KPI 集 | 1:N | device.id = kpi.res_id / parent_id | 在{时间}的{kpi} |
| 网络端口 | related_to(data_link) | 接口 KPI | 1:N | port.id = kpi.res_id | 端口的流量 |
| 网络单板 | related_to(data_link) | 单板 KPI | 1:N | slot.id = kpi.res_id | 板卡的CPU |
| 存储硬盘 | related_to(data_link) | 硬盘 KPI | 1:N | disk.id = kpi.res_id | 硬盘的温度/使用率 |

---

## 2. 核心关联字段（物理列）

| 关联语义 | 列（源→目标） | 涉及表 |
|---|---|---|
| 设备→租户 | tenantId → TENANT_ID | 全部设备表 / X_TENANT_VIEW |
| 子部件→租户 | tenantId → TENANT_ID | 全部子部件表 / X_TENANT_VIEW |
| 设备→站点 | refParentSubnet → SITE_ID | 网络/PON/服务器/存储 |
| 设备→站点（第二口径） | projectId → SITE_ID | 网络/PON/服务器/存储 |
| 设备→站点（存储特例） | parentResId → SITE_ID | HuaweiStorageDevice |
| 设备→站点（第三口径） | siteId → SITE_ID | 终端/协作/FC交换机 |
| 设备→子部件 | id/oriResId → parentResId / neResId / refParentNe | 各 contains 关系 |
| 设备→告警 | id / resId / sn → MEDN | 设备表 / T_CURRENT_ALARM |
| 设备→KPI | id → res_id / parent_id | 设备表 / KPI 表 |
| ONU→OLT | parentOltResId → id | EntPonElement |
| 终端→接入设备 | accessDeviceId → id | EntTerminalElement / 网络、PON 设备 |
| 设备→链路 | aNeResId / zNeResId → id | EnterprisePhysicalLink / 设备表 |
| 租户→站点 | TENANT_ID → TENANT_ID | X_TENANT_VIEW / X_SITE_VIEW |

---

## 3. 关系矩阵（设备域 × 关联对象）

| 设备域 | 租户 | 站点 | 告警 | KPI | 链路 | 子部件 |
|---|---|---|---|---|---|---|
| 网络 network | ✓ | ✓ | ✓ | ✓(设备/在线/AP射频/接口/单板) | ✓(a/z) | ✓(机框/单板/端口/光模块) |
| PON | ✓ | ✓ | ✓ | ✓(设备/ONU/端口/以太口/在线) | ✓(a/z) | —（parent_of 替代） |
| 服务器 server | ✓ | ✓ | ✓ | ✓(ServerDeviceKPI) | ✓(a/z) | ✓(8 类部件) |
| 存储 storage | ✓ | ✓ | ✓ | ✓(设备/硬盘) | ✓(a/z) | ✓(7 类部件 + FC交换机) |
| 终端 terminal | ✓ | ✓ | ✓ | — | — | —（accesses 网络/PON） |
| 协作 collaboration | ✓ | — | ✓ | — | — | — |

> 备注：终端/协作无 KPI 关联（data_link 中无 metric 关联），告警关联通过各自的 MEDN 口径（终端 resId、协作用 sn）。

---

## 4. 查询路径示例（遍历链）

```
路径1（3跳）：租户 → 站点 → 设备 → 子部件
  运营商A租户下北京总部站点中名称以core开头的网络设备的端口数量

路径2（3跳）：设备 → 子部件 → 所在设备 → KPI
  名称以disk开头的硬盘所在的机架服务器在近7天的CPU使用率平均值

路径3（链路跳转）：设备1 → 链路 → 设备2 → 告警
  别名为SNMPSIM_F0A9DF82014B的交换机下连AP上的告警信息

路径4（告警反向）：设备 → 告警（过滤） → 指标
  有告警级别为紧急告警的网络设备在近7天的CPU使用率平均值
```

## 5. 基数语义与业务约束

- **belongs_to / located_at**：设备归属租户/站点，参考 SQL 以 `JOIN ... ON` 关联；站点/租户视图是"外部同步"实体源（entity_source, external_sync），无独立写入口。
- **contains**：部件表通过父键挂到设备，一个部件只属于一台设备（1:N）。
- **connected_to_a/z**：一条链路恰好两端各接一台设备，链路可被两端设备"下连"查询命中（`aNeResId OR zNeResId`）。
- **parent_of**（PON）：ONU→OLT 层级，同表自关联（`EntPonElement.parentOltResId`）。
- **data_link 的 related_to**：实体与指标/告警之间"有数据可查"的标记，是 `产生的`/`在{时间}{kpi}` 模板合法性的判定依据（见 `query-gen.md`）。
