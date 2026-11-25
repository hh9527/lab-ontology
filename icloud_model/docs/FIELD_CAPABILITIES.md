# 字段能力

业务类型限定可计算的运算范围，字段 Property 在承载场景中进一步授予或约束查询能力。字段声明维护在 `src/typed/`。

可复用的单位类型见 [ontology 量纲类型](../../ontology/docs/QUANTITIES.md)。IC 的业务指标通过 newtype 保留独立身份，字段物理表示保持来源类型；接口八位组速率、PON 端口利用率、磁盘容量与 I/O 大小使用各自的来源类型，不据相似名称建立换算关系。

- `semantic::attribute` 表达概念属性，groups/values/samples 声明具体查询能力
- Reference 通过身份类型表达指代；JOIN 由外置 Relation 授权
- 称谓允许的匹配方式由字段声明，String 不自动授予所有文本操作
- 封闭值域字段直接使用具名 enum；非封闭来源保留原始字段，并在行上声明平行计算分类字段，未识别值显式映射为 Unknown
- enum 排序由类型授权的互异 itag 决定，原始字段与计算字段由查询分别选择
- 指标的均值、极值、最新值、求和与总体分别声明，不能从单位或物理 Float 推断可加性
- 时间类型与物理编码分离，时间窗口和分桶能力由模型显式发布
- `groups::groupable` 独立声明可用于聚合分组的维度；称谓、原始数字和原始分类字段不因可投影而自动获得分组能力，时间桶按桶声明授权

使用以下命令核对编译准备后的事实，避免从源码文本重新推导声明。

```sh
node scripts/export-icloud-audit.mjs "$TMPDIR/ic-source-audit.json"
node scripts/check-icloud-source.mjs "$TMPDIR/ic-source-audit.json"
```

知识与 DARI 契约共享当前模型载荷，完整验收见 [类型模型](TYPED_MIGRATION.md#验收)。

## 资源角色与统计总体

当前 49 个 Dataset 发布了计数，包括资源／事件清单计数与全部 17 张 KPI 表的采样记录计数。网络光模块、存储磁盘按当前 corpus 来源契约的 id 发布实体计数；机框缺少已证明的 grain，不发布实体计数。计数许可不从 Relation 自动推断，也不为获得计数许可补造 grain。

实体清单的 `record_counts` 依赖已有 grain；KPI 采样计数使用非空时间字段上的 `semantic::count`，统计采样记录而非去重设备数。业务身份说明如何指代实体，grain 说明如何唯一定位一行，Relation 说明连接键及匹配基数；查询计划结合这些事实推导 JOIN 后的 grain。

`server_device_count` 统计服务器清单行；清单以服务器身份为 grain，因此代表服务器台数，可按健康状态或连接状态分组。`onu_count` 统计 ONU 角色清单，OLT 与分光器不属于该总体。`onu_kpi_sample_count` 统计 ONU KPI 采样行，不能解释成 ONU 台数。

ONU 接收光功率按 ONU 分布时，先按 ONU 身份聚合窗口指标，再对每个 ONU 的结果分箱并计数。若采用有界明细做本地分箱，应核对完整性；达到 take 上界不能证明总体完整。按原始采样功率分箱表达采样分布，属于另一统计口径。阈值由查询显式选择，模型不预设通用光功率告警门限。

`ap_ssid_kpi_of_device`、AP 和射频 KPI 的设备关系限制父设备为无线接入点。`pon_port_kpi_of_olt` 指向 OLT 角色；`pon_port_kpi_of_device` 指向一般 PON 网元，不能据此把结果标为 OLT。

AP 关系统一引用 `inventory::ap_subject` 限定端点，由 `device_class == DeviceClass::Ap` 解析来源值；AP 分类的 wire 与别名只维护在分类映射中，关系不另列编码。正向与反向关系复用同一端点。

`DeviceClass::Others` 显式匹配来源类别 `ne.category.unknown`；`DeviceClass::Unknown` 表达未匹配来源类别的兜底。两者是不同成员，原始分类字段与计算分类字段分别可查询。

## KPI 的实体身份

17 张 KPI 表均保留资源与采集时间构成的记录 grain。16 张单一主体 KPI 通过 `semantic::bind` 声明被观测实体的身份；字段可以是该身份本身或 `Reference(Identity)`。`group_by_identity` 按实体跨时刻聚合；资源名称及明确的所属引用通过 `semantic::attribute` 声明身份依赖，不将采样时间、租户快照、分类快照或每次上报值自动视为身份属性。

SSID、AP 射频、PON 以太端口以及存储磁盘 KPI 各有独立身份类型。存储磁盘 KPI 与磁盘清单共享 StorageDisk 身份，通过 id = resId 关联。StorageDeviceKPI 同时覆盖 Storage 与 FcSwitch，保留带目标角色的多态 Reference；查询通过明确的资源关系选择实体总体，不把它绑定为单一资源类型。

## 均值与计数

模型发布的 AVG 对查询范围内的非空上报值等权，每条记录贡献一次；不是按采样间隔加权，也不会自动按 `*Effcnt` 加权。均值指标发布 `statistics` 契约及对应的 `*_observation_count`，后者统计同一字段的非空上报记录数；数据集的 `*_sample_count` 则统计全部采样行，两者在指标有空值时可以不同。

`@samples::valid_count("counter_field")` 将来源定义的有效采集次数关联到指标；目标必须是 `EffectiveCount` 字段。有效采集次数、非空上报记录数和实体数量是三个不同的量。来源仅定义有效采集次数，未定义对应指标如何累积，不能由这个关联推导加权公式。

采样等权：在远端直接按所需分类或实体聚合原始上报值。实体等权：先在远端按实体身份取得每个实体的均值，再对完整的实体结果集求平均。两种口径均保留指标业务类型；截取部分实体会改变统计总体。合并分区均值必须重新查询来源，或具备各分区原始值之和与非空观测计数；不能直接平均分区均值来冒充原始总体均值。

接口入／出带宽利用率、射频信道利用率／重传率／丢包率、AP 上联错误率、设备端口利用率及磁盘利用率使用各自的业务 newtype。接口入／出错误包数及下行 BIP 错误使用受限的上报计数类型；它们不自动获得求和、差分或速率能力。整数上报计数的均值使用对应浮点业务类型，既保留小数，也保留指标身份。有效采集次数只开放明确的计数运算，不继承 Int 的任意代数。

## 端口存量统计

设备 KPI 的总端口数、已用端口数、运行端口数是随时间采样的存量。`port_count_sample_avg`、`used_port_sample_avg`、`running_port_sample_avg` 表达已上报样本的均值，峰值由相应的 Max 指标表达。连续采样不能相加为端口总量；跨设备的同一时点总量需要先明确时点及设备总体。

## 补齐的指标与缺失值

设备 `device_ping_response_avg/min/max` 使用毫秒，原始上报是可空整数，均值保留浮点业务类型。AP `ap_memory_usage_avg/min/max` 使用百分数尺度。链路质量的丢包率、抖动、时延、质量值及链路流量的上行、下行、利用率均发布非空样本的 Mean/Min/Max 与观测计数，不从时间序列自动推导 Sum。

`server_processor_frequency` 按来源整数尺度比较，`-1` 缺失标记和 SQL NULL 返回 None；原始 `source_PhysicalServerProcessor__frequency_raw` 保留编码并支持精确筛选。不声明未经确认的频率换算。

## 当前告警的时间口径

`current_alarm` 的窗口按发生时间筛选，清除状态描述当前保留记录的状态。“窗口内发生、目前未清除”不等于“窗口结束时仍未清除”。历史时点活跃状态需要结合可靠的清除时间及完整记录保留范围；当前状态字段不提供生命周期回放。
