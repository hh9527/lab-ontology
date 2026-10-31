# 合成 SQLite 数据

`scripts/generate-icloud-data.mjs` 使用 Node.js 22.13 及以上和内置 node:sqlite 创建可查询 SQLite 数据库。
数据生成和 SQLite 写入均由 JS 完成，结构直接读取 `icloud_model/data/generation-contract.json`，无需编译或执行 Telora。
无需 Python、DuckDB、安装包或外部 imaster-cloud 检出。

从 lab-ontology 根目录运行：

```sh
mise x -- node scripts/generate-icloud-data.mjs \
  --output bin/icloud-data \
  --anchor-utc 2026-10-03T12:00:00Z
```

输出目录包含：

- icloud.sqlite：全部 48 张物理表、822 列及连接索引。
- model.json：用于构建和验证数据的准备模型。
- manifest.json：选项、源／模型／数据库哈希、行数、时间窗口、载体覆盖、关系覆盖及基数检查。

工具将 `icloud_model/data/source_catalog.json` 中的物理名称和字段覆盖，与静态生成契约中的标量类型、时间编码、粒度、规范枚举编码、作用域及关系结合。
生成契约记录目录哈希，目录变化时拒绝旧契约。模型的语义约束变化时，应同步更新 JSON 契约，并运行实际模型 SQL 验收；数据生成本身只读取 JSON。
目录记录 imaster-cloud 原始元数据；生成值是合成示例，不建立业务事实。

## 选项与场景

默认种子 20260926，每物理表 12 个基础行，32 天小时 KPI 样本，以当前 UTC 分钟为排他窗口终点。
同时指定 anchor-utc 和种子可复现相同数据库内容。验证使用选定锚点，因此历史锚点也合法。

resources N 设置基础总体，最少 6；days N 设置 KPI 窗口；interval-minutes N 设置采样间隔，如 5 表示五分钟。
ONU KPI 遵循限定 ONU 身份，故序列少于基础表。超过一千万 KPI 行的请求被拒绝。

资源覆盖租户、站点、网络设备及组件、服务器及组件、存储、FC 交换机、PON 层级、终端、协作设备和物理连接。
17 张 KPI 表均有日变化，通用指标序列呈上升、下降或平稳趋势；在线率含中断。服务器与存储专用指标采用高／中／低档位，覆盖阈值两侧。
告警覆盖窗口内每一个 UTC 日期（含首尾部分日期）、六类资源、四种严重度、已确认／未确认、已清除／未清除状态。
`--alarms-per-resource-per-day N` 设置每日告警基础数量系数，默认 2；实际数量还受工作日、周末和周期性高发日影响。
此系数作用于整个基础总体，不表示每一类资源的每个实例每天都产生 N 条告警。
可空机框备注有 NULL 示例，其他字段用确定性占位值或声明枚举编码；不模拟完整物理容量和设备特定 KPI 适用性。

DateTimeUtc 存为固定三位毫秒的 YYYY-MM-DDTHH:MM:SS.SSSZ，Date 为 YYYY-MM-DD，EpochMillis 为 SQLite 整数。
本地整数与 UTC 字段使用相同合成时钟，这是夹具假设。零表示不存在的告警确认／清除时间。

声明数据集粒度成为唯一索引。仅源 KPI 表使用合成 resId,tenantId,ts 粒度，无 tenantId 时省略，不把源 resId 标记视为跨时间全局唯一。
无声明身份的表不虚构唯一约束。StorageHardDriveKPI 使用合成磁盘归属，因为模型无归属关系。

多态引用逐行选择资源类别，一行不必匹配每条替代资源关系。
清单报告每条声明关系的匹配行对、不同匹配行和观察上界，报告基数例外，不安装通用外键或断言每源行匹配每条替代关系。
默认数据覆盖全部 50 个载体、126 条准备关系，无上界例外。
用途是模式、筛选、连接、聚合、时间窗口和比较查询测试，不是生产容量规划。

## 发布与验证

输出目录必须不存在。生成在同级临时目录完成，检查 SQLite 完整性、实际行数、全部载体作用域、时间编码及枚举编码后，通过目录重命名发布。
唯一粒度索引在发布前发现重复身份；失败构建清除临时输出，保留已有输出。

```sh
mise x -- node scripts/tests/icloud-data.test.mjs
mise x -- node scripts/check-icloud-data.mjs bin/icloud-data
mise x -- node scripts/check-icloud-discovery-pair.mjs bin/icloud-data
```

首条命令测试可复现性、完整字段／载体／关系覆盖、窗口、趋势、唯一粒度、无效值检测和失败发布。
第二条需要 bin/icloud_model.snapshot.wasm，执行快照生成的全部 17 个 KPI 窗口、ONU／OLT 作用域、五类资源 CPU 平均及 CPU GrowthRate Top-5 的 SQLite 查询；第二参数可指定快照路径。

发现／配对检查验证时间身份拒绝、合法重叠样本配对、共享存储／FC 主体发现和周期比较，以及仅目录词汇枚举。
91 个设备 KPI 成员可用 15 次目录调用枚举 ID，无需逐成员读取。

StorageDeviceKPI 对每个存储设备和 FC 交换机都有完整序列，故序列数为基础数量两倍。
发布验证全部五类有 CPU 能力资源均有序列，且告警关联资源在告警 UTC 当日有样本。
协作设备告警单独报告为无声明 CPU 源。告警发生时间在生成窗口内选择，包括历史锚点。

## 参考数据包的生成场景

本工具参考 `icloud-corpus/pack/tables.py` 的服务器、存储和磁盘档位，以及
`pack/alarms.py` 的快照时间约束。参考包使用独立表结构和场景规模；本工具仍以本仓准备模型与源目录为结构契约。
生成规则版本记录在 manifest 的 `generation.revision`，当前为 3，`profile` 为 `daily-business-demo`。
这些档位是合成场景，不扩展模型能力，也不声明与参考包逐行一致。

- 服务器 CPU／内存按百分比生成，systemPower／averagePower／peakPower 使用功率数值档位，peakPower 始终大于 averagePower
- 存储与 FC 的 CPU／内存覆盖高／中／低负载；磁盘 utility 使用百分比，avgreadiosize／avgwriteiosize 使用独立正数档位，保留模型声明单位
- 有效样本计数 Effcnt 为 1；在线率的日内中断按经过时间计算，改变采样间隔后仍覆盖每日前四小时
- 告警到达、确认、清除及末次发生时间保持在锚点之前，未确认／未清除时间仍使用零
- KPI 建立 `(resId,ts)`，有 parentId 的表另建 `(parentId,ts)`，并执行 ANALYZE
- 小时指标按 UTC+08 的合成业务时钟表现昼夜和周末差异，叠加资源相位差、高中低档位、缓慢趋势、小幅噪声及少量短时异常；UTC 时间存储不变
- 流量、时延、丢包、温度、信号强度和端口数使用不同场景；已用端口及运行端口不超过总端口数
- 告警包含四种严重度，历史告警以已清除为主，最近两天保留更多未清除告警；`generation.alarmDays` 记录逐日数量

更丰富的演示数据示例：

```sh
node scripts/generate-icloud-data.mjs \
  --output bin/icloud-data-rich --resources 36 --days 60 \
  --interval-minutes 60 --alarms-per-resource-per-day 2
```

`--storage-gap-hours N` 可为存储台账下标 2、11 的已有设备构造近期缺样，默认 0 表示完整序列。
N 为非负整数且小于整个 KPI 窗口小时数。FC 序列保持完整；受影响存储仍有历史样本，告警发生日仍有 CPU 样本。
缺样设备和各自排他终点列在 `generation.seriesGaps`，适用于验证“近期无采样”的反向存在查询。
例如：

```sh
node scripts/generate-icloud-data.mjs \
  --output bin/icloud-data-gaps --anchor-utc 2026-10-03T12:00:00Z \
  --storage-gap-hours 5
```

发布前额外检查服务器功率大小关系、存储百分比及磁盘非负值、告警时间顺序及锚点上界。
检查结果分别记录为 `invalidMetricScenarios` 和 `invalidAlarmTimes`，非空即停止发布。
固定种子与锚点保证同一生成规则版本可复现；规则版本变化会改变数据哈希。
