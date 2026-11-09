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
`--tenants N` 独立设置租户数量（3 至 resources），不再限制为 10；省略时为 resources 的三分之一，至少 3。
租户按约 20%／30%／50% 分组，分别承载约 60%／30%／10% 的基础资源。
应同时提供足够资源支撑长尾：例如 `--resources 150 --tenants 30` 可使每组中的每个租户都有资源。
前 30 个租户采用企业、学校、医疗机构等名称，混合江州市、江南及不带地名三种形式，行业字段与名称一致。
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
生成规则版本记录在 manifest 的 `generation.revision`，当前为 11，`profile` 为 `daily-business-demo`。
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

## 告警的资产派生规则

`generation.alarmProfile` 为 `asset-derived-conditional-events/v2`。
先生成资产，再统一派生告警的 MEDN、MENAME、TENANTID、STREXT13、MANUFACTURER、PRODUCTNAME、MECATEGORY、METYPE。
MECATEGORY 表示大类：网络、服务器、华为存储、PON 分别使用源目录示例 NetworkElement、PhysicalServer、HuaweiStorageDevice、EntPonElement。
FC 和协作设备使用合成约定 FCSwitchDevice、CollaborationElement；这两项不是经过源系统确认的编码。
网络次级分类从资产规范分类映射为 Switch、Router、Firewall 等演示名称；其他资源保留已有资产 classification 编码。
这些映射不新增封闭枚举，也不限制真实源数据库的合法编码。

MOI 是定位信息，不是资源 ID。链路和端口告警使用所属设备实际端口的 `Port ID=n`，整机告警为空；没有组件清单的资产只生成整机告警。
打印机、UPS、协作终端不生成 CPU／内存告警；UPS 可生成供电异常。
场景目录按资源类型覆盖网络管理、服务器系统、存储容量与性能、FC Fabric、PON、会议质量等多种告警。
无源分光器只生成光路类告警。目录中的名称是合成场景，不冒充厂商正式告警定义；固定种子抽样决定实际出现的种类。
CPU／内存告警的抽样权重参考同源 KPI 业务负载，离线告警权重在既有离线窗口内增加。
这是条件抽样，并不保证每条告警对应某个指标阈值越限，也不构造完整的故障因果仿真。
严重度继续按 1／1.8／3.2／4 的近似比例生成。

发布时 `invalidAlarmProfiles` 检查资源存在、派生字段一致、定位端口属于该设备；非空即拒绝发布。

## ONU 光功率

`generation.ponOpticsProfile` 为 `hierarchical-path-loss/v1`。
ONU KPI 的三个光功率字段按实际 resId、parentId 分层生成，固定 seed 保证稳定复现。
OLT 层模拟覆盖区域的稳定光路损耗差异，ONU 层叠加独立的光路损耗和发射功率差异。
接收功率使用“对端发射功率减光路损耗”，分别表达 ONU 下行接收与 OLT 上行接收；ONU 发射功率不随光路损耗平移。
时间变化采用缓慢漂移、小幅抖动以及少量 ONU 的短时衰减，不套用 CPU 昼夜负载曲线。
这些参数用于演示群体和个体差异，不代表特定设备制式的光预算或告警阈值。
