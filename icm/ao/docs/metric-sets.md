# Metric Set 完整定义（17 个指标集）

> 从 `umodel/metric_set/*.yaml` 逐集转存：labels 维度键、指标字段（中文名/聚合/单位）、时间字段。

## imaster.network.metric.ap（AP KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| online_rate | 在线率 | avg |  |

**time_field**：`ts`

## imaster.network.metric.ap_radio（AP射频KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| user_count | 在线用户数 | sum |  |
| channel_utilization | 信道利用率 | avg | % |

**time_field**：`ts`

## imaster.network.metric.ap_radio_ssid（AP射频SSID KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| user_count | 在线用户数 | sum |  |
| channel_utilization | 信道利用率 | avg | % |

**time_field**：`ts`

## imaster.network.metric.board（网络单板KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| cpu_usage | CPU使用率 | avg | % |
| mem_usage | 内存使用率 | avg | % |

**time_field**：`ts`

## imaster.network.metric.cell_link_quality（蜂窝链路质量KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| rsrp | 参考信号接收功率 | avg | dBm |
| sinr | 信干噪比 | avg | dB |

**time_field**：`ts`

## imaster.network.metric.cell_link_traffic（蜂窝链路流量KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| in_traffic_rate | 入方向流量速率 | avg | bps |
| out_traffic_rate | 出方向流量速率 | avg | bps |

**time_field**：`ts`

## imaster.network.metric.device（网络设备KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID), classification(设备分类)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| cpu_usage | CPU使用率 | avg | % |
| mem_usage | 内存使用率 | avg | % |
| online_rate | 在线率 | avg |  |
| if_utilization_rate | 端口利用率 | avg |  |
| port_count | 端口总数 | sum |  |
| port_used_count | 已使用端口数 | sum |  |

**time_field**：`ts`

## imaster.network.metric.interface（网络接口KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| in_traffic_rate | 入方向流量速率 | avg | bps |
| out_traffic_rate | 出方向流量速率 | avg | bps |
| in_utilization | 入方向利用率 | avg | % |
| out_utilization | 出方向利用率 | avg | % |
| in_error_rate | 入方向误码率 | avg |  |
| out_error_rate | 出方向误码率 | avg |  |

**time_field**：`ts`

## imaster.network.metric.online（网络设备在线率KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| online_rate | 在线率 | avg |  |

**time_field**：`ts`

## imaster.pon.metric.device（PON设备KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| cpu_usage | CPU使用率 | avg | % |
| mem_usage | 内存使用率 | avg | % |

**time_field**：`ts`

## imaster.pon.metric.ethernet_port（PON以太网端口KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| in_traffic_rate | 入方向流量速率 | avg |  |
| out_traffic_rate | 出方向流量速率 | avg |  |

**time_field**：`ts`

## imaster.pon.metric.online（PON设备在线率KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| online_rate | 在线率 | avg |  |

**time_field**：`ts`

## imaster.pon.metric.onu（ONU KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| online_rate | 在线率 | avg |  |
| optical_power | 光功率 | avg |  |

**time_field**：`ts`

## imaster.pon.metric.pon_port（PON端口KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| in_traffic_rate | 入方向流量速率 | avg |  |
| out_traffic_rate | 出方向流量速率 | avg |  |
| optical_power | 光功率 | avg |  |

**time_field**：`ts`

## imaster.server.metric.device（服务器KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| cpu_usage | CPU使用率 | avg | % |
| mem_usage | 内存使用率 | avg | % |
| disk_usage | 硬盘使用率 | avg | % |

**time_field**：`ts`

## imaster.storage.metric.device（存储设备KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| cpu_usage | CPU使用率 | avg |  |
| mem_usage | 内存使用率 | avg |  |
| iops | 每秒IO次数 | avg |  |
| throughput | 吞吐量 | avg |  |

**time_field**：`ts`

## imaster.storage.metric.hard_drive（存储硬盘KPI）

**labels 维度键**：res_id(资源ID), tenant_id(租户ID)

| 指标字段 | 中文 | 聚合 | 单位 |
|---|---|---|---|
| disk_usage | 硬盘使用率 | avg |  |
| temperature | 温度 | avg |  |
| iops | 每秒IO次数 | avg |  |

**time_field**：`ts`
