# ICM 领域模型（Domain）

> 与 `icm/eval/public/DOMAIN.md` 同源（本镜像供开发参考）。Resolver 使用
> `icm/eval/public/DOMAIN.md`。

## 概览

`icm-model` 基于 Ontology eDSL 声明 ICM 业务知识：6 类设备、站点/租户、当前告警、
KPI 时序事实与设备子部件。能力形式：

- 聚合查询：count/avg/max/min/sum + 分组/过滤/排序/分页/分组内 Top N/HAVING。
- 行级投影（`measures: []`）：目标属性、信息、列表（只投影维度属性）。
- 存在性：`exists`（相关 EXISTS，方向自动推导）+ `min_matches`（≥N 相关行）。
- 分组计数：`group_count: "CountGroups"`（满足 having 的组数）。
- 多值 OR 组：`any_of`（维度等于任一给定值，多组 AND）。
- 过滤词表：`Eq/Ne/Gt/Ge/Lt/Le` 与文本 `Contains/StartsWith/EndsWith/NotContains`。

## 授权

subject 支持 `analyst` / `resolver`。

## 指标

计数指标：`DeviceCount`（五域统一设备行数：网络/PON/服务器/存储/终端，协作无站点键
被排除）、`NetworkDeviceCount`、`PonDeviceCount`、`ServerDeviceCount`、
`StorageDeviceCount`、`TerminalDeviceCount`、`CollabDeviceCount`、`AlarmCount`、
`AlarmDeviceRefCount`（告警资源引用计数，`Distinct`=count(DISTINCT 引用列)）、
`SiteCount`、`TenantCount`，以及各子部件计数（`Storage*Count`/`Server*Count`/
`NetPortCount`/`NetOpticalCount`）。

KPI 指标（按 设备域×指标×聚合）：`Network*`、`Ap*`、`Pon*`/`Onu*`、
`Server*`、`Storage*`。完整 id 清单见 `icm/eval/public/DOMAIN.md`。

## 维度

- 设备属性维度：name/id/type/alias/commuState/ip/mac/model/manufacturer/sn/
  location/版本类/资产/状态/容量等，前缀按设备域（`NetworkDevice*`、`Server*`…）。
- 统一设备治理 id 维度：`DeviceTenantId`、`DeviceSiteId`（稳定 id，可分组/排序）。
- 治理与告警维度：`TenantName`、`TenantIndustry`、`SiteName`、`AlarmName`、
  `AlarmType`、`AlarmSeverity`、`AlarmAcked`、`AlarmCleared`、`AlarmTime`、
  `AlarmTenant`、`AlarmSource`、`AlarmResName`、`AlarmProbableCause`。
- KPI 时间维度：`NetworkKpiTime`、`NetOnlineKpiTime`、`ApRadioKpiTime`、
  `ServerKpiTime`、`PonKpiTime`、`OnuKpiTime`、`PonPortKpiTime`、`StorageKpiTime`。

`NetworkDeviceType` 为归一化计算维度（LSW/AC/WAC/AR/AP 别名→`ne.category.*`）；
`*Manufacturer` 为归一化计算维度（华为写法 `huawei`/`Huawei`/`2011`/
`huawei technologies co., ltd` → `huawei`）。

## 稳定值

- 网络类型：`ne.category.switch/ac/router/fatap/firewall`。
- PON：`olt`/`onu`；服务器：`ne.category.server.*`；存储：`HuaweiSmis/VSP/HPE/
  FusionStorage/EnterpriseStorage`；协作：`COLLABORATION`。
- 厂商规范值：`huawei`（别名 2011 / Huawei / huawei technologies co., ltd，
  大小写不敏感）。
- 状态：`*CommuState` `0/1`；`AlarmSeverity` `1..4`；`AlarmAcked/Cleared` `0/1`。
- 时间窗用半开区间 `[start, end)`：下界 `Ge`、上界 `Lt`。

## 能力边界（确定诊断）

支持：有告警的设备数量/信息（exists target=alarm）、有 ≥N 告警的设备（min_matches）、
次数超过 N 的实体数量（having+group_count）、维度多值任一（any_of）、
受影响设备去重引用数（AlarmDeviceRefCount + Distinct）、
跨治理层级的泛指设备计数/Top 1（DeviceCount + DeviceTenantId/DeviceSiteId，五域联合，
协作无站点键被排除）。

仍不支持（确定诊断）：
跨实体去重计数（每设备的所在站点/租户去重口径）、行级 DISTINCT、相对时间窗（需
物化）、HAVING measure-vs-measure、多跳角色 join 与站点双口径 OR。

详见 `icm/eval/public/DOMAIN.md` §7。
