# 基于源声明的样本统计

本文描述产品模型 icloud-source-v19，记录模型作者决策和源限制；Agent 通过 ic/info 发现这些声明。

## 选择统计含义

产品声明 device_cpu_latest、device_memory_latest、server_cpu_latest、server_memory_latest，返回最新合格样本行的原始百分比值，保留选中 NULL。
同一样本节点的 CPU／内存共享选行。Latest 既不是最近非 NULL，也不是 Avg／Max。
通过 measures 选择、measure_having 限定、top_by_measure 排名，或通过按主体身份对齐的 GraphPair 比较窗口。
显式行筛选和窗口先于选行，NULL 时间行不能提供 Latest，不引入隐式当前时间或额外有效性筛选。
见 Schema/syntax/graph/latest 知识点及[最新值度量](../../ontology/docs/LATEST-DESIGN.md)。

每个度量 ID 固定一种含义，平均不是可覆盖默认值，其他含义应选另一个声明 ID，未声明 ID 被拒绝。
引擎无法将 Intent 与从未提供的自然语言需求比较。转换成功证明模型合法性，不证明 Agent 选中了用户所需统计量。

发布当前 IC 快照后运行在线率回归：

```sh
bin/telora -C icloud_model test online_rate --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048
node scripts/check-icloud-online-rate.mjs bin/icloud_model.snapshot.wasm
node scripts/check-icloud-cpu.mjs bin/icloud_model.snapshot.wasm
node scripts/check-icloud-kpi-measures.mjs bin/icloud_model.snapshot.wasm
```

| 总体 | 原始维度 | 平均值 | 最大样本 | 最小样本 |
| --- | --- | --- | --- | --- |
| 设备 CPU | `device_cpu_sample` | `cpu_usage` | `cpu_peak` | `device_cpu_sample_min` |
| 设备内存 | `device_memory_sample` | `memory_usage` | `memory_peak` | `device_memory_sample_min` |
| 设备在线率 | `device_kpi__onlineRate` | `device_online_rate_avg` | `device_online_rate_max` | `device_online_rate_min` |
| 网络在线率表 | `source_NetworkDeviceOnlineKPI__onlineRate` | `network_online_rate_avg` | `network_online_rate_max` | `network_online_rate_min` |
| PON 设备在线率 | `source_PonDeviceKPI__onlineRate` | `pon_online_rate_avg` | `pon_online_rate_max` | `pon_online_rate_min` |
| PON 在线率表 | `source_PonDeviceOnlineKPI__onlineRate` | `pon_online_table_rate_avg` | `pon_online_table_rate_max` | `pon_online_table_rate_min` |
| 服务器 CPU | `server_cpu_sample` | `server_cpu_usage` | `server_cpu_peak` | `server_cpu_sample_min` |
| 服务器内存 | `server_memory_sample` | `server_memory_usage` | `server_memory_sample_max` | `server_memory_sample_min` |
| 存储／FC CPU | `source_StorageDeviceKPI__cpuusage` | `storage_cpu_usage` | `storage_cpu_sample_max` | `storage_cpu_sample_min` |
| 存储／FC 内存 | `source_StorageDeviceKPI__memoryusage` | `storage_memory_usage` | `storage_memory_usage_max` | `storage_memory_usage_min` |
| 磁盘利用率 | `source_StorageHardDriveKPI__utility` | `storage_disk_usage` | `storage_disk_usage_max` | `storage_disk_usage_min` |
| 磁盘平均读 I/O 大小 | `source_StorageHardDriveKPI__avgreadiosize` | `storage_disk_read_io_size` | `storage_disk_read_io_size_max` | `storage_disk_read_io_size_min` |
| 磁盘平均写 I/O 大小 | `source_StorageHardDriveKPI__avgwriteiosize` | `storage_disk_write_io_size` | `storage_disk_write_io_size_max` | `storage_disk_write_io_size_min` |
| PON CPU | `source_PonDeviceKPI__cpuUsage` | `pon_cpu_usage` | `pon_cpu_sample_max` | `pon_cpu_sample_min` |
| 设备端口利用率 | `device_kpi__ifUtilizationRate` | `device_port_usage_avg` | `device_port_usage_max` | `device_port_usage_min` |
| 接口入向带宽 | `interface_kpi__ifInBandRate` | `interface_in_band_usage_avg` | `interface_in_band_usage_max` | `interface_in_band_usage_min` |
| 接口出向带宽 | `interface_kpi__ifOutBandRate` | `interface_out_band_usage_avg` | `interface_out_band_usage_max` | `interface_out_band_usage_min` |
| ONU 接收带宽 | `onu_receive_usage_sample` | `onu_receive_usage` | `onu_receive_usage_max` | `onu_receive_usage_min` |
| PON 端口接收带宽 | `pon_port_receive_sample` | `pon_port_receive_usage` | `pon_port_receive_sample_max` | `pon_port_receive_sample_min` |

- 趋势投影原始样本和时间戳，不聚合。
- 存储／FC 和 PON CPU 作用于合格存储样本，Avg 为算术平均，Min／Max 为样本极值；忽略 NULL，全 NULL 无值。不按时间或有效计数加权，不推断有效性筛选或重缩放。StorageDeviceKPI 声明 CPU 单位 percent（%）；PON CPU 单位仍假定，TODO(#47) 待确认。存储与 FC 共享 KPI 表，但使用独立声明关系及总体。
- StorageDeviceKPI 内存及 StorageHardDriveKPI 利用率声明百分比；读写 I/O 大小为 kilobyte（KB），TODO(#58) 转换前确认字节乘数，不执行单位转换。对已平均 I/O 样本再算术平均，不是全局逐操作平均；极值也描述存储平均值，不是单次 I/O。不以有效计数作权重或有效性谓词。磁盘主体身份及关系未定，磁盘 KPI 直接按资源标识和时间窗口查询。
- 协作设备没有声明 CPU 样本源，不支持此类 CPU 问题，缺失不等于零。
- 共享存储 CPU 有两类主体：storage_device 经 source_HuaweiStorageDeviceAssociationStorageDeviceKPI，source_FCSwitchDevice 经 source_FCSwitchDevice_StorageDeviceKPI，均从主体指向 source_StorageDeviceKPI。GraphPair 周期比较应根定、分组并对齐主体身份，再度量各窗口 KPI。FC 显式实体粒度为 source_id。KPI 粒度含时间，适合样本点配对；不相交窗口无法匹配相同时间戳，会被拒绝。
- 在线率平均保留报告数值比例，平均合格非 NULL 存储行，不按时间或 onlineRateEffcnt 加权，全 NULL 无平均。源描述未确立百分比单位或公式；四表是不同总体，不能互换，不增加 Sum。
- 四源都发布样本 Min／Max。有序数值样本使统计含义明确；已有用例验证示例，不是准入白名单，无明确禁止理由时按模型语义支持。
- Min／Max 忽略 NULL，全 NULL 无值；不是周期平均的极值，不证明连续可用或 SLA，也不覆盖缺失观测。不从 onlineRateEffcnt 推断有效性；率求和仍无声明可加业务含义。
- 源在线率载体声明普通 Avg／Min／Max，不引入采样唯一性或度量数据集粒度。分组按已有主体身份及关系基数，不在原关系之外虚构租户相等；产品 device 和 PON 身份为 id。
- 平均为合格存储样本算术均值，不是时间加权；最大／最小针对样本，不针对周期平均。
- 聚合忽略 NULL，空或全 NULL 总体的 Avg／Min／Max 无值，不是零；不新增源采集频率或有效性声明。
- 平均阈值不同于最大阈值。对 >= t，最大值达标表示至少一个合格非 NULL 样本达到 t，此等价不能套用所有操作符。
- 计数达标观测应筛选原始维度、计样本节点并用 count_having。这计存储行，不是不同设备、经过时长或源 *Effcnt 计数器。
- 保留请求主体身份及窗口。top_by_measure 排声明统计量；原始升序 take=1 不是逐主体 Min，且可能选 NULL。共享聚合／排序契约仍可通过 info 发现。
- 百分比／仪表样本未声明可加，不增加 Sum，也无 `{measure,aggregate}` 覆盖语法。

## 术语与源不确定性

四类在线率总体将 Avg 声明为主样本度量、Min／Max 为摘要。
PonDeviceKPI 显式 unitName:percent，故摘要用 %，90% 阈值用原始 90。
NetworkDeviceKPI 无单位，两个在线率表声明 ratio／one，PON 在线率表另有百分比显示格式。
这三类暂用 0～100 的 % 比例，与生成 SQLite 数据一致，90% 用 90，不缩放。
TODO：与生产数据确认假定比例；生成数据和显示单位不能独立证明生产存储比例。

设备端口占用、接口带宽利用率、ONU 带宽和 PON 端口带宽是不同量。“端口利用率”故意映射多个声明概念。
术语辅助解释，不授权自动替换。Related 链接连接设备／接口／PON 候选，不创建查询关系；仅已有规范 ID 是查询词汇。

NetworkDeviceKPI.logical.yaml 将 ifUtilizationRate 描述为“设备上所有在线端口的百分比”，但无分子／分母、数值比例或单位。
模型保留不确定性，不从同级计数器推导 used/total 或 online/total，不缩放，也不猜 % 单位。
新统计仅作用于源报告数值。公式问题需更多领域证据或澄清，不能虚构公式。

CPU／内存百分比遵循源元数据和已有度量；接口带宽利用率单位仍未指定，ONU／PON 接收统计保留原单位。

## 无线、ONU、PON 端口、接口和单板样本

七个 KPI 数据集的 40 个样本字段暴露 104 个度量，基础 ID 为算术平均。
接口新增项使用 Avg，与已有包速率／错误度量一致；其余六数据集还用 _max、_min 表示原始样本极值。
`scripts/tests/fixtures/icloud-kpi-measures.mjs` 的可执行预期列出每个数据集、物理列、基础 ID 和单位。
度量发布中文别名及原始维度链接。

ONU 光功率用 dBm、温度 degC、利用率 %、数据率 bit/s；PON 端口功率／温度／数据率相同。
接口包速率 packets/s，AP 以太网和射频数据率 kbit/s，射频干扰 dBm，单板 CPU／内存 %、温度 degC。
SSID 字节样本用 byte，Avg／Min／Max 总结报告观测，不是所选周期累计流量，不声明 Sum。

TODO(#51)：接口数据率描述写 bytes/s，显示元数据 rate=8，而 unitName 为 bits_per_second。
模型暂按存储 byte/s，不转换，待确认原单位。PON 端口带宽 unitName=one 但显示 %，保留原值并暂假 %，收发统计均带 TODO。
射频 RSSI 无显式单位，保持未指定。

AP、射频、单板 KPI 暂以租户／资源／UTC 样本时间为粒度，TODO(#51) 验证生产唯一性。
源仅标 resId 为主键，未确立采样唯一性。已有主体关系保留原发布关系，不推断租户连接。
粒度声明不证明生产唯一性或采集节奏。

四个在线率表在数据集和度量文档中描述各自总体。当前告警表包含行中报告的所有清除状态；alarm_open_count 显式计 CLEARED=0。
没有清除条件的“当前告警”不隐含此过滤计数。

规范成员名称按名义 Type 限定。PonClass 和 PonOltClass 各自以原编码发布 olt，同名不合并类型。
PhysicalLinkType 为源编码 1、7、8、9、99 发布 lldp、csp、server_internal、fiber_search、manual。

## 回归

17 个 KPI 时间戳载体均声明 UTC 小时／日／月分桶，ID 为 `<dataset>_utc_hour`、`_utc_day`、`_utc_month`，ONU 用精简 `onu_utc_*`。
选择分桶及声明度量，筛选原始样本时间维度，需要时间趋势时按桶排序。
桶输出仍为 DatetimeUtc，表示桶起点，不是标签或时长。知识将每个桶链接到共享操作契约，声明桶不会补造源载体缺失度量。

tests/sample_meanings.telora 检查真实产品模型：显式 Avg／Max／Min SQL 与绑定、主体分组、峰值 HAVING／排名、原始趋势、达标样本计数、
拒绝未定义 Sum 和聚合覆盖、替代知识链接及歧义术语。历史合成夹具有意保持不变。
