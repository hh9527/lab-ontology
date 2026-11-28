# UQL 后端

`ontology::uql` 通过 `build_query(QueryAst) -> Query` 渲染共享 `QueryAst`。
实现移植自 Semora 提交 `bf30a9b` 的 UQL 方言契约，复用现有本体准备和转换流程，包括初始化优化。

在构造服务处理函数时选择渲染器：

```telora
use ontology::intent as intent;
use ontology::uql as uql;

def lower: Fn(Value) -> Value =
    intent::query_request_method_factory(payload, uql::build_query);
```

`payload` 是模型已有的 `PreparedPayload`；`Value` 从 `std::value` 导入。
后端由服务选择，所有请求使用同一后端。现有 SQLite 服务入口保留当前渲染器，无需依赖 Semora。

## 渲染契约

- 标识符使用反引号，必须通过共享标识符校验
- 参数使用纯位置 `?` 占位符，`Query.bindings` 为出现顺序展开数组：每个 `?` 按其在 SQL 文本中的位置追加其句柄的值，重复引用重复追加值，未出现在 SQL 中的句柄不进入数组
- 时间函数重述子表达式时每次重述独立渲染，同句柄产生多个 `?` 并多次展开
- 处理全部七种 `QueryPlan`：Rows、DistinctRows、GroupCount、SetRows、SetCount、JoinedGroups、JoinedGroupCount；也处理限定作用域的源、连接、EXISTS、标量／排名比较、Latest、分区 Top-N 和最终结果选择
- 筛选聚合在聚合内部使用 `CASE`，谓词先于聚合参数渲染，占位符按文本顺序展开
- 排序使用 `ASC NULLS FIRST`／`DESC NULLS LAST` 表达升序 NULL 在前、降序 NULL 在后
- 大小写折叠直接使用 `lower()`（引擎 `lower` 只折叠 A-Z）
- `UtcDaysAgo` 将日期与时间两半各自 `timestamp_format` 后用 `concat` 连接，`concat` 从任一参数传播 NULL
- UTC 时间桶仅支持时／日／月三个单位与三种编码：`DateTimeUtc` 的时桶用 `time_floor`，日／月桶用 `date_trunc`；`Date` 桶直接取 `date_trunc` 的日期结果；`EpochMillis` 桶在日历范围守卫 `CASE` 内按出现顺序重述值，纪元锚点为 `TIMESTAMP '1970-01-01 00:00:00'`，月桶用整日 `timestampadd` 加月截断 `timestampdiff`
- 联结组对齐使用固定语义别名 `__q_left`／`__q_right` 与 NULL 安全等值算子 `<=>`；计数包装、分区 Top-N、结果选择分别使用 `__q_count`、`__q_partitioned`（含 `__q_pk_<i>`／`__q_ok_<j>`／`__q_rn`）、`__q_result`
- 排名键比较渲染为直接标量子查询，键在 SELECT 与 GROUP BY 中各自重述
- 无 GROUP BY 的 HAVING 原生渲染；带 OFFSET 无 LIMIT 且无结果选择时显式拒绝，结果选择存在时升级为单层 `LIMIT <字面量> OFFSET ?`
- 结果选择（`ResultSelection`）在查询外包装 `SELECT <列> FROM (…) AS __q_result ORDER BY … LIMIT <take 字面量>`，take 经 `public_take` 限定在 1..500

## 拒绝场景

- 此 UQL 契约未定义二进制文本排序规则，`BinaryText` 显式失败；使用二进制前缀范围的 IPv4 子网筛选因此失败，而非改变比较语义
- 时间桶单位 `Year`／`Quarter`／`Week`、`ZonedTimeBucket`、`EpochMillisToUtc`、符号参数（`Expr::Parameter`）均显式失败
- 渲染失败通过现有带索引的批量诊断返回

执行适配器必须支持所生成的 UQL 函数、窗口函数和位置绑定。
能完成渲染并不证明不同 UQL 引擎或底层数据源的执行等价性。

## 验证

从仓库根目录使用 release 版 Telora：

```sh
TELORA=../telora/target/release/telora
"$TELORA" --with-memory-limit 1024 -C ontology test uql
"$TELORA" --with-memory-limit 1024 -C ontology test uql_intent
python3 scripts/check-uql.py --telora "$TELORA"
```

`uql` 覆盖渲染契约、拒绝场景与出现顺序展开断言。`uql_intent` 覆盖模型转换、后端绑定语义、结果列、结果上界（`max_rows`）和带索引的批量失败，包括不支持的二进制排序规则。
Python 检查在内存 SQLite 中执行 47 条生成查询，覆盖可移植 SQL 子集及纪元时／日／月边界。
它不验证真实 UQL 引擎；日历／格式化函数和引擎专有正则行为仍需引擎集成检查。
