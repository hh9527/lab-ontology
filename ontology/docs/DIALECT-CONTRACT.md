# 共享 QueryAst 与 SQL 方言

`ontology/intent` 生成包含不可变分配上下文及 `QueryPlan` 的已校验 `QueryAst`。
`ontology/sqlite`、`ontology/postgres` 和 `ontology/uql` 提供 `build_query(QueryAst) -> Query`。
当前示例和 IC 服务使用 SQLite 渲染器。PostgreSQL 渲染器已经存在，但尚未证明与整个公共 AST 的执行等价性；准入需要下面的检查，不能仅凭 SQL 看似合理。
UQL 渲染器及验证范围见 [UQL](UQL.md)。

`ontology/postgres` 提供表达式、Rows／DistinctRows、GroupCount 和集合候选渲染器，涵盖投影、限定作用域的源、JOIN ON、分组聚合、HAVING、分页、派生 UNION ALL 源及相关 EXISTS，
包括受限关联与成对端点主体、标量聚合比较、排名键比较和初始分区 Top-N。
其 `QueryAst` 入口与 SQLite 分派相同的已校验结果形状。每一渲染阶段接收并返回不可变上下文，其中保存已分配绑定句柄并分配无冲突内部别名。
该入口尚未通过 PostgreSQL 方言准入：模型集合输出类型在本体转换时校验，但完整跨方言执行语义仍未证明。
查询 AST 校验集合投影的*形状*，不校验模型输出类型。本体转换在发出集合 AST 前按位置检查准备好的模型输出类型；直接使用 AST 的调用方负责物理模式。
SQLite 可执行某些 PostgreSQL 拒绝的混合类型集合，因此模型派生集合不得带着不匹配的输出类型进入任一渲染器。

### 最新值度量契约

两种方言均通过共享的分组前窗口及单行归约实现 Latest。选中值保留物理数值类型及 NULL，时间并列时按完整样本粒度决胜，并显式规定 NULL 排序。
在声明编码契约下，原生 PG timestamptz 与规范化 SQLite UTC 文本按相同瞬间排序；EpochMillis 和精确 BIGINT 也已测试。
Latest 执行检查不证明其他 AST 形式的完整方言等价性，详见[最新值度量](LATEST-DESIGN.md)。

### 集合投影类型契约

本体为每个模型派生集合操作数按位置推导*输出*类型，在构造 `SetPlan` 前拒绝不一致类型。
形状（`Expr`、`Aggregate`、`Computed`）不是类型。查询 AST 是封闭结构词汇表，不读取模型元数据或物理模式。

- 普通维度使用声明的物理标量类型；闭合枚举的物理文本表示不是其 Telora 枚举类型。
- 计算维度声明输出类型；输入字段类型和筛选输入种类无法证明构造器的结果类型。
- 聚合输出类型取决于聚合种类（如 Count 与 Avg）；计算度量取决于带类型的操作数。必须按实际 SELECT 顺序检查模型派生投影，包含派生输出，不能只检查绑定字面量。

SQLite 与 PostgreSQL 消费相同的结构校验 AST。不能用 PG 强制转换让模型投影类型不一致的查询得以执行：转换会改变集合相等性与业务语义，即使两边都能运行。
分区 Top-N 现在对 SELECT、窗口子句和 GROUP BY 中相同的结构化分组表达式复用原编号占位符。
这是显式 AST 表达式引用，不是 SQL 文本重写。执行检查覆盖列分组、聚合排名和参数化分组键，完整跨方言查询等价性仍待验证。

## 共同契约

- 查询形状（`Rows`、`DistinctRows`、`SetRows`、`SetCount`、`GroupCount`、`JoinedGroups`、`JoinedGroupCount`）及已校验 `Plan` 的含义不随方言改变。方言不能悄悄近似 AST 节点、重解释身份键、改变绑定顺序或使用依赖会话的日期时间语义。
- `BuildCtx` 在构造 AST 时为每个动态标量分配稳定索引。同一句柄在 SQLite 中为 `?n`，在 PostgreSQL 和 UQL 中为 `$n`；重复引用复用索引。即使 SQL 表达式顺序与分配顺序不同，`Query.bindings[n-1]` 仍是句柄 `n` 的标量。
- 源、列和别名按标识符检查，不能接受任意 SQL。PostgreSQL 必须保留声明的大小写，包括大小写混合的物理列名；未加引号的 PG 标识符会折叠为小写。须针对真实表测试。
- 新共享 AST 操作只有在所有支持的方言均能以等价结果和失败模式执行后，才向本体转换开放。

## PostgreSQL 准入执行矩阵

| AST 类别 | `query.telora` 中的 SQLite 行为 | 跨方言检查 |
| --- | --- | --- |
| 绑定／列／源 | `?n`，按需引用标识符 | 保留分配的 `$n` 句柄和物理标识符身份，包括嵌套作用域绑定。 |
| 标量文本 | `substr`、`instr`、`lower`、`length` | `instr` 从 1 计数，不存在时为 0；默认 SQLite 的 `lower` 仅折叠 ASCII A-Z，PG 依赖排序规则。使用明确等价的排序规则或实现，测试非 ASCII 与 NULL。 |
| 相对 UTC 日 | `strftime`，绑定 UTC 锚点和整数时长 | 保持相同规范 UTC 秒文本及日期边界，不依赖会话时区或隐式 `now()`。后续日历／纪元操作属于 #11。 |
| UTC 小时／日／月分桶 | 保持类型的桶起点；UTC 文本／日期用日历函数，纪元小时／日用精确整数向下取整 | `UtcTimeBucket({unit,encoding})` 是封闭标量。PG 在 UTC 截断并保留原生 timestamptz／date 类型；SQLite 保留声明的文本编码。八种组合在逻辑类型序列化后执行等价，覆盖分组平均、原始半开窗口、负纪元、NULL、闰日、月年边界、范围限制和三种 PG 会话时区。DateUtc 没有小时桶。 |
| 聚合／HAVING | `FILTER (WHERE ...)`、计算聚合、参数化阈值 | 检查 NULL、空输入、distinct 与 filter 交互、计算输出及绑定顺序。 |
| 关联谓词 | 相关 EXISTS、复合键、私有别名、JOIN ON 谓词 | 检查 INNER／LEFT 连接、零匹配主体、OR 键、私有别名及独立限定粒度。 |
| 分页／排序 | `LIMIT ?`、`LIMIT -1 OFFSET ?`；ASC 的 NULL 在前、DESC 在后 | PG 仅偏移不能用 SQLite 的 `LIMIT -1`。PG 的 ASC 必须渲染 `NULLS FIRST`、DESC 必须渲染 `NULLS LAST`，其默认值相反。比较稳定 Top-N 排名，不承诺隐式顺序。 |
| 派生／集合 | UNION ALL 源、INTERSECT／EXCEPT／去重 UNION、集合计数 | 比较投影类型、重复行、分支内部绑定顺序及 distinct／集合操作对 NULL 的处理。 |
| 分区 Top-N | `row_number()` 与隐藏分组／排序列 | 比较分区粒度、并列决胜规则、输出投影及 NULL 排序。 |

部分项目可能要求先收紧共享语义或修改 SQLite 渲染器，才能准入 PostgreSQL。
在这些检查可执行且通过前，不得宣称 PostgreSQL 渲染器支持整个公共 AST。本文是验收清单，不是 PG 已获支持的证据。
