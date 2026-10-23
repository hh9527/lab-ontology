# QueryAst 与 SQL 生成

`ontology/query` 是与后端无关的封闭查询词汇表，不感知数据集名称、业务维度或授权。
本体转换构造 `QueryAst`，由 `ontology/sqlite` 或 `ontology/postgres` 一次性生成参数化 `Query`。
类型和构造函数签名以 [`query.telora`](../src/query.telora) 为准。

```telora
use ontology::query as qb;
use ontology::sqlite as sqlite;

def one_row_query: Fn() -> qb::Query = fn() {
    let source = qb::source_with_hint(qb::build_context(), "trusted_table", "t");
    let bound = qb::bind(source.0, qb::Val::Int(1));
    let plan: qb::Plan = {
        revision: "example", sources: [source.1], derived: None,
        projection: [qb::expr_item(qb::column(source.1, "trusted_column"))],
        internal_measures: [], joins: [], exists: [], grouping: [], having: [],
        filter: Some(qb::scalar(qb::ScalarFunction::Eq,
            [qb::column(source.1, "trusted_column"), bound.1])),
        ordering: [], limit: None, offset: None, partition: None,
        scalar_comparisons: [], ranked_key_comparisons: [],
    };
    let ast = qb::finish(bound.0, qb::validate_query_plan(qb::QueryPlan::Rows(plan)));
    sqlite::build_query(ast)
};
```

本例展示资源分配及完整的行查询 Plan。完整查询构造参见
[`ontology/tests/postgres.telora`](../tests/postgres.telora) 和本体转换代码。

## 构造边界

`AggregateFunction::Latest` 要求 `AggregateCall.latest` 包含封闭的时间与粒度排序规范；普通聚合要求 `latest:None`。
渲染器在分组前生成共享行号，Latest 仅归约选中的行，同时保留其他聚合的完整总体。
扁平标量子查询、排名键子查询和直接嵌套聚合谓词拒绝 Latest。声明和语义见[最新值度量](LATEST-DESIGN.md)。

`BuildCtx` 不可变。构造函数接收上下文，并同时返回新上下文与已分配资源。
`bind(ctx, Val)` 注册标量并返回携带绑定索引的表达式，标量不会成为 SQL 模板文本。
`source_with_hint(ctx, table, hint)` 根据提示分配唯一源别名。列引用使用该源句柄及可信列符号。
表、列符号由模型提供，按标识符校验，不能作为 SQL 片段接受。SQLite 直接输出已校验名称，PostgreSQL 加引号以保留大小写。

`Plan` 表示封闭关系计划：源或派生源、投影、筛选、连接、相关存在判断、分组、HAVING、排序、分页，以及受支持的受限排名与比较形式。
`QueryPlan` 选择结果形状：`Rows`、`DistinctRows`、`SetRows`、`SetCount`、`GroupCount`、`JoinedGroups` 或 `JoinedGroupCount`。
`finish(ctx, plan)` 将分配上下文与已校验计划封装为 `QueryAst`；未完成的 `Ctx` 或 `Plan` 不跨越渲染器边界。
AST 不能包含原始 SQL、任意函数或字面量片段。

`QueryAst.result_limit` 是可选的已分配正整数绑定，用于最终输出上限。
公共 Intent 转换仅在 `limit` 是正整数时提供它；省略、null 以及 `finish` 均保持缺省，保留 QueryBuilder 行为。
它独立于 `Plan.limit`、分区 `take`、连接分组排名 `take` 及业务配置权限。
两个渲染器均校验其绑定，并仅应用于最终结果 SELECT。若已有最终业务上限，则取较小值且保留原 ORDER BY；PostgreSQL 将 CASE 两侧显式转换为 BIGINT。
嵌套操作数及 Latest／窗口输入阶段不变。

`JoinedGroups` 携带独立的 `left_identity`／`right_identity` 表达式、隐藏键别名，以及按序排列且包含侧别、列和结果别名的 `outputs`。
键投影必须匹配身份表达式并属于操作数分组，不能混入展示分组表达式。模型转换强制要求完整身份和来自已对齐节点的展示属性。

`JoinedGroups.rank` 支持 Subtract、Ratio 和 GrowthRate，显式指定第一侧（第二侧为另一侧）及绑定上限 1..1000。
GrowthRate 将第一侧作为当前值，第二侧作为基线。渲染器排除 NULL 度量、Ratio 的零分母及 GrowthRate 的非正基线，将操作数转为双精度，并用 NULLIF 保护除法。
并列时按完整对齐身份升序、NULLS FIRST 决胜。排名结果追加数值列 `comparison_value` 并按该列排序；不排名时不添加该列。
JoinedGroupCount 拒绝排名。模型转换校验数值类型、单位和配置授权，详见 [GraphPair](GRAPH-PAIR.md)。

模型类型和粒度校验属于本体转换层。query 模块还校验源可见性、表达式形状和封闭操作符使用等结构不变量。
直接调用 AST 的调用方负责可信符号背后的物理模式。此职责划分不允许渲染器重新解释合法 AST。

## 生成边界

SQLite、PostgreSQL 和 UQL 提供 `build_query(QueryAst) -> Query`，其中 `Query` 包含
`sql: String` 与 `bindings: Array(Val)`。同一绑定句柄在 SQLite 中变为 `?n`，在 PostgreSQL 和 UQL 中变为 `$n`。
`bindings[n-1]` 提供句柄 `n` 的值；重复引用复用该句柄。渲染器负责标识符引用及自身语法、函数，不反向解析 SQL，也不将数据值转义后拼入模板。

```telora
use ontology::sqlite as sqlite;
use ontology::postgres as postgres;
use ontology::uql as uql;

let sqlite_query = sqlite::build_query(ast);
# PostgreSQL 服务选择 postgres::build_query。
# UQL 服务选择 uql::build_query。
```

服务构造转换函数时选择一个后端，请求不能混用方言。语义一致性和 PostgreSQL 准入状态见[方言契约](DIALECT-CONTRACT.md)，
UQL 执行契约与验证范围见 [UQL](UQL.md)。SQL 和绑定是中间执行产物，不是面向用户的业务答案。
服务协议见[使用说明](../../USAGE.md)。
