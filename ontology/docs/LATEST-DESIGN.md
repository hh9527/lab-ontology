# 最新值度量

已实现[议题 #53](https://github.com/hh9527/lab-ontology/issues/53)第二部分。
Latest 度量支持投影、聚合限定、Top-N、计算依赖和 GraphPair；`top_per` 用于获取完整原始样本行。

## 业务含义

Latest 从每组符合条件的样本总体中选一行，返回所选字段的原始值，不是最大值、周期平均值或最近非 NULL 值。
总体由数据集作用域、声明连接、约束、筛选、时间窗口及 EXISTS 限定共同确定，Latest 在这些条件之后应用。
`measure_having` 在 Latest 之后应用，因此以下问题有意产生不同答案：

- 最新 CPU 超过 80%：先选最新行，再比较 CPU 与 80。
- CPU 超过 80% 的最新样本：先筛选 CPU，再选行。

时间窗口仍是显式半开区间。没有上界时可选中未来样本。服务不读时钟，也不将“当前”理解为隐式截止时间。

## 模型声明

数值字段注解：

```telora
@edsl::latest_measure("device_cpu_latest", Some("%"))
cpu_usage: Float,

@edsl::latest_measure("device_memory_latest", Some("%"))
mem_usage: Float,
```

同一字段必须具有单位匹配的主数值样本度量。注解声明稳定度量 ID，并从所属数据集的权威 UTC 时间及完整采样粒度派生排序。
调用方不能选择时间字段、排序方向或 NULL 策略，已有度量描述和别名说明所声明含义。

缺少采样数据集、权威 UTC 瞬间字段或非空完整粒度时，准备必须拒绝。
初始能力接受 Int 和 Float 值字段；输出保留源类型及单位，内部归约不能将整数转为浮点。仅日期字段不能作为此能力的权威瞬间。

选择顺序为权威时间降序，其余完整采样粒度字段升序、NULLS FIRST。
时间相同时确定性选择，但不声称某个并列样本更新。完整粒度唯一性仍是模型／源契约；重复完整身份具有冲突值时，不能靠选择较大度量值解决。
源唯一性待办仍须可见。

PG 排序原生 UTC 时间戳或纪元整数，SQLite 排序声明的固定宽度规范 UTC 文本或纪元整数，不增加时区推断、日历分桶或类型转换。

## NULL 与行一致性

最新合格行的 CPU 若为 NULL，Latest CPU 就是 NULL，即使更早行有值。
同一样本节点和总体上的 CPU、内存度量共享一次选行，保证来自同一样本。

权威时间为 NULL 的行不是 Latest 候选。组内无带日期候选时 Latest 返回 NULL，但这些行仍参与普通聚合；添加 Latest 不得改变已有 Avg 或 Count 总体。

无合格样本的主体沿用现有 Graph 总体语义。Latest 不增加外连接、不合成主体行、不返回零，也不扩展 `include_empty`。
已有组无带日期候选，与主体根本不出现在结果中，是不同情况。

## Intent 示例

Intent 不新增 Latest 操作或聚合覆盖。调用方通过已有度量 ID 接口选择声明度量，产品模型发布以下 ID：

```json
{
  "op": "Graph","limit":1000,
  "root": "d",
  "nodes": [
    {"id": "d", "entity": "device"},
    {"id": "k", "entity": "device_kpi"}
  ],
  "edges": [{"relation": "device_kpi_of_device", "from": "k", "to": "d"}],
  "select": [{"node": "d", "dimension": "device_name"}],
  "group_by_identity": ["d"],
  "measures": [
    {"node": "k", "measure": "device_cpu_latest"},
    {"node": "k", "measure": "device_memory_latest"},
    {"node": "k", "measure": "cpu_usage"}
  ],
  "time_windows": [{
    "node": "k",
    "dimension": "device_kpi_ts_raw",
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-04T00:00:00Z"
  }],
  "measure_having": [{
    "node": "k", "measure": "device_cpu_latest", "op": "Gt", "value": 80
  }],
  "top_by_measure": {
    "node": "k", "measure": "device_cpu_latest", "direction": "Desc", "take": 10
  }
}
```

GraphPair 两个操作数可分别在显式窗口选择 Latest 度量，应对齐主体身份而非样本时间戳。
现有配对运算、单位检查、NULL／基线保护和 `comparison_value` 应用于独立选出的值。

## 查询表示

`AggregateFunction::Latest` 是授权／语义标记，不是原生 SQL 聚合名。
`AggregateCall.latest` 是可选封闭规范 `LatestOrder {time: ColumnRef, ties: Array(ColumnRef)}`。
模型转换从数据集解析字段，并重新定位到请求的样本实例。

校验要求 Latest 必须有该规范，普通聚合则不得有。初版禁止 DISTINCT 和聚合局部 FILTER，因为它们会生成另行选择的总体，破坏共享行保证。
仍支持 Intent 行筛选。

排序规范不是任意 SQL 或开放窗口表达式。每个列必须属于参数的样本源、对计划可见，并通过标识符／绑定及派生列校验。
授权要求 `allowed_aggregates` 含 Latest，并在查询原有操作之外允许 Aggregate、Group、Order 和 Partition。
AST 与配置校验器必须检查排序列。

`aggregate_name` 不能输出 `latest(...)`。扁平标量子查询及排名键子查询保留普通聚合契约，初版显式拒绝这些位置的 Latest。
嵌套 EXISTS 聚合 HAVING 支持也暂缓，并有专门诊断。这些限制须明确记录，不能因扩展枚举而意外获得支持。

## 执行计划

分组前使用共享有序归约阶段，保证 SQLite 和 PG 等价。
不能对整个聚合输入使用 `top_per`，否则 Avg、Min、Max、Count 也会只作用于所选行。

1. 生成现有合格连接总体，保留分组、度量、排序和粒度所需列。
2. 在实际分组表达式（含隐藏身份分组）内按模型解析的时间和并列字段编号。同一样本节点的多个 Latest 值共享行号。
3. 对全部合格行分组，普通聚合保留原输入。数值 Latest 归约为 `MAX(CASE WHEN row_number = 1 AND sample_time IS NOT NULL THEN value END)`；仅一行可贡献值，选中 NULL 仍为 NULL。
4. 使用这些归约结果求度量谓词、聚合排序和上限。计算度量通过相同度量引用机制解析声明依赖。

内部 MAX 实现单行提取，不是度量发布的业务聚合；知识必须报告 Latest。

分组决定选择总体。仅按非唯一设备名分组，可能在多个同名设备中选一条样本。
逐设备问题需完整主体身份分组，引擎不能悄悄改分组来修复业务解释。

初版每个分组操作数接受一个 Latest 样本实例及同源普通聚合依赖，保持现有采样粒度证明并拒绝扩增行的连接。
独立采样总体需独立操作数或后续显式组合设计。原始 `top_per`、DISTINCT 及不支持的 `include_empty` 组合继续拒绝，不赋予隐式语义。

## 产品覆盖

声明四个度量：

- `device_kpi` 上的 `device_cpu_latest`、`device_memory_latest`。
- `server_kpi` 上的 `server_cpu_latest`、`server_memory_latest`。

保留已有百分比单位和源总体，发布到原始维度及共享 Latest 模式契约的链接。
不能让原始样本维度本身表示 Latest，也不改变已有 Avg／Min／Max ID。
通用能力证明且采样粒度声明检查后，再扩展 ONU、PON、无线和单板度量。

## 验收

SQLite 与 PG 执行相同场景：

- 完整身份分组保持同名主体分离。
- Latest CPU 和内存来自同一行，包括互补 NULL。
- 保留所选 NULL，不替换为较早非 NULL 值。
- NULL 时间行不能成为 Latest，但仍参与普通聚合。
- 时间并列时两方言使用一致完整粒度决胜规则。
- 半开窗口排除上界，指定具体截止时间时排除未来行。
- Latest 阈值限定不同于选行前的样本筛选。
- Latest Top-N 排名主体，并保持确定性身份决胜。
- Latest 与 Avg／Count 共存，不改变普通输入总体。
- GraphPair 比较两个窗口的最后合格行，支持反转操作数，并返回现有精确比较表达式。
- 整数和浮点结果保留声明类型与单位。
- 缺失时间／粒度、未授权配置、伪造 AST 排序及不支持组合都以专门诊断失败。

现有原始 `top_per` 能力继续用于整行获取。

## 验证

`ontology/tests/latest.telora` 检查准备、授权、伪造 AST 排序、输出类型和计算依赖。
导出查询由 `ontology/tests/latest-runtime.mjs` 执行，覆盖 EpochMillis、负时间、NULL 时钟和值、Avg／Count 不变、计算度量及超出 JavaScript Number 精度的精确 BIGINT。

`icloud_model/tests/latest.telora` 为 `scripts/check-icloud-latest.mjs` 导出真实产品查询：
Latest／Avg 混合、选择前后阈值、Top-N、GraphPair Subtract／Ratio／GrowthRate、半开窗口、未来样本及服务器 CPU／内存。
检查器在 UTC 和 Asia/Shanghai 下执行 PG 原生 timestamptz，并在 SQLite 使用规范 UTC 文本。

导出并运行：

```sh
bin/telora -C ontology eval @test/latest:runtime_queries --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048 > /tmp/latest-core.json
node ontology/tests/latest-runtime.mjs /tmp/latest-core.json /path/to/pglite/dist/index.js
bin/telora -C icloud_model eval @test/latest:runtime_queries --initialization-fuel 100000 --request-fuel 100000 --with-memory-limit 2048 > /tmp/icloud-latest.json
node scripts/check-icloud-latest.mjs /tmp/icloud-latest.json /path/to/pglite/dist/index.js
```
