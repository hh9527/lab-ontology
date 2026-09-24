# QueryBuilder

`PeerCorr.exchange` distinguishes symmetric two-endpoint existence from a
fixed-origin/fixed-peer route. Existing `peer_corr` and `peer_corr_distinct`
constructors set it to `True`; `peer_corr_roles(..., distinct_keys, exchange)`
allows a declared directed route to set it to `False`, rendering only the
first validated endpoint branch. Both endpoint columns and participant
identities remain structurally validated.

本文档是 `ontology/query` 模块的使用指南与公共契约。QueryBuilder 接收结构化、
后端无关的 `Plan`，验证其结构和能力范围，并确定性地生成参数化 SQLite `Query`。

```telora
import "ontology/query" as qb;
```

crate 内部可使用 `import "@src/query" as qb;`。外部依赖者只使用 manifest 中的
crate 名，不依赖 `@src` 私有路径。

## 公共类型

### 值与 Query

```telora
import "std/value" { ScalarValue as Val };

type Query = struct {
    sql: String,
    bindings: Array(Val),
};
```

`Val` 是标准 `ScalarValue` 的公开别名，也是动态绑定值的唯一载体；包含 null、string、
integer、number 和 boolean。`Query.sql` 只含合法标识符、算子和 `?`；动态值
只进入 `bindings`，并与占位符按出现顺序一一对应。

### 表达式与聚合

```telora
type ColumnRef = struct { source: String, column: String };

type ScalarFunction = enum {
    Substr, Instr, If, Add, Sub, Lower, Length,
    JsonExtract, JsonType, JsonValid,
    Eq, Ne, Lt, Le, Gt, Ge, And, Or, Not,
};
type ScalarCall = struct { function: ScalarFunction, args: Array(Expr) };

type Expr = enum {
    Column(ColumnRef),
    Bind(Val),
    Scalar(ScalarCall),
};

type AggregateFunction = enum { Count, Sum, Avg, Min, Max };
type AggregateCall = struct {
    function: AggregateFunction,
    arg: Expr,
    distinct: Bool,
    filter: Option(Expr),
    alias: String,
};
type ComputedOp = enum { Add, Sub };
type ComputedAggregate = struct {
    op: ComputedOp,
    left: String,
    right: String,
    alias: String,
};
type SelectItem = enum { Expr(Expr), Aggregate(AggregateCall), Computed(ComputedAggregate) };
```

表达式 AST 是封闭的：`ScalarFunction` 是唯一函数词表，不存在 raw SQL fragment、
开放函数名/operator 或 identifier 逃逸通道。所有动态值仍通过 `Bind(Val)` 进入
`?` 占位符，bindings 顺序确定。

`AggregateCall.filter` 是聚合自身的行级 predicate（SQLite
`FILTER (WHERE ...)`）；它只收窄该聚合的输入行，绝不会与全局 WHERE 合并成一个
AND。`Computed(ComputedAggregate)` 是受限的计算聚合：对已声明 aggregate 的
alias 做 `Add`/`Sub` 算术组合。

> **公共破坏性契约**：`SelectItem` 新增 `Computed` variant，以及 `ComputedOp`、
> `ComputedAggregate` 与 `aggregate_filtered`/`computed_aggregate`/`computed_item`
> 构造器均为公共契约的一部分。下游对 `SelectItem` 做穷尽 match 时必须处理
> `Computed`，否则会因 non-exhaustive match 无法编译。

> **公共破坏性契约（新一轮）**：`JoinCondition` 从单一等值 struct 变为封闭的
> `Eq`/`And`/`Or` 树；`Join.condition` 使用该树类型。`Plan` 新增 `exists` 与
> `having` 字段，`Operator` 新增 `Exists`/`Having`，`ScalarFunction` 新增
> `Lower`/`Length`。构建 Plan/Join 的下游应使用 `qb.join`/`qb.join_on`、
> `qb.exists`、`qb.having` 等构造器，并为记录字面量补上新字段；对 `Operator` 或
> `ScalarFunction` 做穷尽 match 的下游必须处理新 variant。

> **公共破坏性契约（嵌套聚合轮）**：`Having.measure` 改为 `HavingMeasure`
> （`Ref`/`Call`）；`Exists` 新增 `grouping` 与 `having` 字段。新增构造器
> `qb.having_call`、`qb.exists_grouped` 与转换 `qb.count_groups`。新建 Exists 的
> 下游应继续使用 `qb.exists`/`qb.exists_grouped`，不要直接写 Exists 记录字面量；
> 对 `Having.measure` 做穷尽 match 的下游必须处理 `Call`。

> **公共破坏性契约（派生 UNION ALL 轮）**：`Plan` 新增 `derived` 字段
> （`Option(DerivedSource)`）；新增 `UnionColumn`/`UnionBranch`/`DerivedSource`
> 类型与 `qb.union_column`/`qb.union_branch`/`qb.derived_source` 构造器。所有 Plan
> 记录字面量必须补 `derived: None`（使用派生源时置 `Some(qb.derived_source(...))`
> 并把 `sources` 留空）；对 Plan 做穷尽构造的下游必须处理新字段。

> **公共破坏性契约（paired-endpoint 轮）**：`Exists` 新增 `peer` 字段
> （`Option(PeerCorr)`），新增 `PeerBranch`/`PeerCorr` 类型与
> `qb.peer_branch`/`qb.peer_corr`/`qb.exists_peer` 构造器。新建 Exists 的下游应继续
> 使用 `qb.exists`/`qb.exists_grouped`/`qb.exists_union`/`qb.exists_peer`，不要直接
> 写 Exists 记录字面量；对 `Exists` 做穷尽字段访问的下游要处理 `peer`。

> **公共破坏性契约（anti-existence 与 distinct 轮）**：`Exists` 新增 `negated: Bool`
> 字段，新增 `qb.exists_not` 构造器（把任一 correlated body 的 `negated` 置为 `True`，
> 渲染为 `NOT EXISTS (...)`）。新建 Exists 的下游应继续使用
> `qb.exists`/`qb.exists_grouped`/`qb.exists_union`/`qb.exists_peer`/`qb.exists_not`，
> 不要直接写 Exists 记录字面量。QueryBuilder 另新增 `qb.transform_sqlite_distinct`：
> 把无分组、无聚合、纯表达式投影的行级 Plan 渲染为 `SELECT DISTINCT ...`
> （SQLite 要求 DISTINCT 的 ORDER BY 项出现在结果集中，故排序目标必须是已投影
> 表达式）。两者都不改变标准算子的语义，也不向 Plan 增加新字段。

> **公共破坏性契约（internal ordering aggregate 轮）**：`OrderKey` 新增
> `Aggregate(AggregateCall)` variant（内部/未投影的排序聚合：分组 Plan 按该聚合
> 值排序并取 Top N，但不投影它）。对 `OrderKey` 做穷尽 match 的下游必须处理
> `Aggregate`；`Aggregate` 排序 key 只允许出现在**已分组** Plan 中（v1 不接受于
> partition order_by），其 AggregateCall 的 function/arg/filter 继续受
> operator/aggregate/scalar profile 收窄。

> **公共破坏性契约（two-hop link 轮）**：`Exists` 新增 `link: Option(ExistsLink)`
> 字段与 `ExistsLink` 类型，新增 `qb.exists_two_hop` 构造器：把整个 A→B→C 条件
> 保持在一个 correlated EXISTS 内（B 与 C 在子查询内互相 JOIN）。新建 Exists 的
> 下游应继续使用 `qb.exists`/`qb.exists_grouped`/`qb.exists_union`/`qb.exists_peer`/
> `qb.exists_two_hop`/`qb.exists_not`，不要直接写 Exists 记录字面量。`link` 模式与
> alternatives/grouping/having/peer 互斥；`link.pairs` 每边分别属于 `Exists.source`
> 与 `link.source` 的 alias。

> **公共破坏性契约（Plan-level scalar aggregate comparison 轮）**：`Plan` 新增
> `scalar_comparisons: Array(ScalarAggregateComparison)` 字段；新增
> `ScalarAggregateComparison` 类型（`outer: ColumnRef` + 封闭比较 op +
> 扁平 `inner: ScalarSubquery`）、`qb.scalar_subquery_spec` 与
> `qb.scalar_aggregate_comparison(outer, op, inner)` 构造器（构造器返回比较项，
> 绝不返回 `Expr`）。`Expr` 保持恰好 `Column/Bind/Scalar` 三个 variant，
> 不参与标量聚合比较。每个谓词只在 WHERE 中作为额外的括号化谓词渲染为
> `<outer.column> <op> <(SELECT <agg>(...) FROM ...)>`（op 仅限
> `Eq/Ne/Lt/Le/Gt/Ge`，NULL 语义由 SQLite 原生保证）；bindings 按
> 确定性的谓词顺序收集，随后是该谓词内层 join/filter 表达式顺序。所有 Plan
> 记录字面量必须补 `scalar_comparisons: []`（无比较时为空数组）。内层聚合的
> operator/join/aggregate/scalar/distinct 能力由 profile **递归**收窄。

标量语义（与 SQLite 行为一致）：

| 函数 | 参数 | 语义 |
| --- | --- | --- |
| `Substr` | 2 或 3 | `substr(value, start[, length])`；start 为 1-based |
| `Instr` | 2 | `instr(haystack, needle)`：needle 首次出现的 1-based 位置，缺失为 `0` |
| `If` | 3 | `CASE WHEN cond THEN then ELSE else END`；cond 非零为真，NULL 走 ELSE |
| `Add` / `Sub` | 2 | 整数算术，渲染为 `(a + b)` / `(a - b)` |
| `Lower` | 1 | `lower(value)`：大小写归一；默认 SQLite build 只折叠 ASCII A-Z |
| `Length` | 1 | `length(value)`：文本按字符计数的长度 |
| `JsonExtract` | 2 | `json_extract(document, path)`；path 必须是字符串 Bind |
| `JsonType` | 2 | `json_type(document, path)`；path 必须是字符串 Bind |
| `JsonValid` | 1 | `json_valid(document)` |
| `Eq/Ne/Lt/Le/Gt/Ge` | 2 | 比较运算 |
| `And` / `Or` | 2 | 逻辑运算 |
| `Not` | 1 | 逻辑非 |

`If`、`Instr`、`Add`、`Sub` 属于 profile 的 `allowed_scalars`，并经过 arity
校验（`If` 恰为 3，`Instr`/`Add`/`Sub` 恰为 2）。computed expression 可以稳定
用于 projection、grouping 和 ordering。

比较算子的两个操作数都可以是 `Column` 引用（同一查询主体/同一表上的两个属性之间
比较），此时 lowering 只产生两个验证过的列引用（如 `fs.color = fs.shade`），
不产生动态 binding；只有当某侧是 `Bind` 时才产生参数化 `?` 与 binding。

Ontology eDSL 以 `FieldFilterRequest` / `lower_field_filtered` 公开这一 shape（见
`ONTOLOGY.md` 的“同主体 field-to-field 谓词”）。作为普通 Expr，它继续受 `PlanProfile`
收窄：比较 scalar（`Eq`/`Ne`/…）必须出现在 `allowed_scalars`，`Column` 与 `Scalar`
operator 必须被允许；profile 只保留部分能力时，调用方只能引用该属性在 profile 下
实际保留的比较能力。

SQLite JSON1 v1 词汇（`JsonExtract`/`JsonType`/`JsonValid`）同样属于
`allowed_scalars` 并消耗 `Scalar` operator。`JsonExtract`/`JsonType` 的第二个参数
（JSON path）在结构校验中必须确认为字符串 `Bind`：列、计算表达式、Int/Float Bind
或缺失参数均原子失败；path 经 `?` 进入 bindings，绝不插入 SQL 文本。arity 固定
（Extract/Type 为 2，Valid 为 1）。

### Plan

```telora
type Source = struct { alias: String, table: String };
type JoinKind = enum { Inner, Left };
type ColumnEq = struct { left: ColumnRef, right: ColumnRef };
type JoinCondition = enum {
    Eq(ColumnEq),
    And(Array(JoinCondition)),
    Or(Array(JoinCondition)),
};
type Join = struct { kind: JoinKind, source: Source, condition: JoinCondition };
type Ordering = enum { Asc, Desc };
type AggregateRef = struct { alias: String };
type OrderKey = enum { Expr(Expr), AggregateRef(AggregateRef), Aggregate(AggregateCall) };
type OrderBy = struct { key: OrderKey, direction: Ordering };

# Correlated EXISTS (semi-join) filter; `grouping`/`having` make it a
# correlated aggregate EXISTS.  See "存在性过滤 (EXISTS)" and "嵌套聚合".
# `peer`（`Option(PeerCorr)`）是 paired-endpoint 模式：见 "配对的 peer EXISTS"。
type PeerBranch = struct {
    origin: ColumnEq,
    peer: ColumnEq,
};

# 同一 hub 行上的配对：两个内层 participant source 与两组端点交换分支。
# `distinct_keys`（同实体时 True）加入封闭身份证明 `origin.key <> peer.key`，
# 防止同一 participant 行同时占据 hub 两端（self-loop）。
type PeerCorr = struct {
    origin: Source,
    peer: Source,
    branch_a: PeerBranch,
    branch_b: PeerBranch,
    origin_filter: Option(Expr),
    peer_filter: Option(Expr),
    distinct_keys: Bool,
    exchange: Bool,  # False: only branch_a participates in the predicate
};

type Exists = struct {
    source: Source,
    pairs: Array(ColumnEq),
    alternatives: Option(Array(Array(ColumnEq))),
    filter: Option(Expr),
    grouping: Array(Expr),
    having: Array(Having),
    peer: Option(PeerCorr),
    negated: Bool,
    link: Option(ExistsLink),
};

# Bounded correlated two-hop link body: B (`Exists.source`) is joined to C
# (`source`) inside the same subquery; see "反存在过滤 / 两跳 link 存在".
type ExistsLink = struct {
    source: Source,
    pairs: Array(ColumnEq),
    filter: Option(Expr),
};

# Aggregate-result predicate; see "HAVING" and "嵌套聚合".
type HavingOp = enum { Eq, Ne, Lt, Le, Gt, Ge };
type HavingMeasure = enum {
    Ref(AggregateRef),
    Call(AggregateCall),
};
type Having = struct {
    op: HavingOp,
    measure: HavingMeasure,
    threshold: Val,
};

# Derived UNION ALL source; see "派生 UNION ALL 关系（derived source）".
type UnionColumn = struct { name: String, expr: Expr };
type UnionBranch = struct {
    source: Source,
    outputs: Array(UnionColumn),
    filter: Option(Expr),
};
type DerivedSource = struct {
    alias: String,
    branches: Array(UnionBranch),
};

# Closed set operations between two validated Plans.
type SetOpKind = enum { Intersect, Except, Union };

type Plan = struct {
    revision: String,
    sources: Array(Source),
    derived: Option(DerivedSource),
    projection: Array(SelectItem),
    filter: Option(Expr),
    exists: Array(Exists),
    joins: Array(Join),
    grouping: Array(Expr),
    having: Array(Having),
    ordering: Array(OrderBy),
    limit: Option(Int),
    offset: Option(Int),
    partition: Option(PartitionedTopN),
    scalar_comparisons: Array(ScalarAggregateComparison),
    ranked_key_comparisons: Array(RankedKeyComparison),
};

type SetPlan = struct { kind: SetOpKind, left: Plan, right: Plan };
type QueryPlan = enum {
    Rows(Plan), DistinctRows(Plan), SetRows(SetPlan), SetCount(SetPlan),
    GroupCount(Plan),
};

type PartitionedTopN = struct {
    partition_by: Array(Expr),
    order_by: Array(OrderBy),
    take: Int,
};
```

`revision` 是随 Plan 保留的不透明版本。`AggregateRef` 必须引用 projection 中聚合
项的 alias；转换时渲染完整聚合表达式，而不是把 alias 当作列名。

`limit` 和 `offset` 都是查询语义的一部分：`limit` 截断结果行数，`offset` 跳过前
若干行；二者都不等于“已覆盖全量”。有限结果不能作为已遍历全部数据的证明，上层
必须显式分页。

`exists` 是保持 base grain 的相关存在性过滤（见下文“存在性过滤 (EXISTS)”）。
`having` 是聚合结果谓词（见下文“HAVING”），其阈值永远作为 `?` 绑定。
`partition` 是受限的分组内 Top N 阶段（见下文“分组内 Top N”）。
`QueryPlan` 进一步规定顶层结果形状：普通行、去重行、集合结果、集合计数或分组计数。
`validate_query_plan` 在任何 SQL 物化前校验该形状；SQLite 的
`transform_sqlite_query_plan` 消费同一封闭 AST。分组计数的内层 Plan
须先由 ontology 按 `PlanProfile` 验证，然后才能构造成顶层结果形状。

### 能力 Profile

```telora
type Operator = enum {
    Source, Project, Column, Bind, Scalar, Aggregate,
    Filter, Exists, Join, Group, Having, Order,
    Limit, Offset, Partition,
};

type PlanProfile = struct {
    allowed_operators: Array(Operator),
    allowed_join_kinds: Array(JoinKind),
    allowed_aggregates: Array(AggregateFunction),
    allowed_scalars: Array(ScalarFunction),
    allow_distinct: Bool,
};
```

Profile 声明应用接受的标准能力子集，不改变算子本身的语义。

## 公共函数

| 函数 | 签名 | 语义 |
| --- | --- | --- |
| `operators` | `Fn(Plan) -> Array(Operator)` | 按规范顺序返回 Plan 使用的去重算子集合 |
| `profile_accepts` | `Fn(Plan, PlanProfile) -> Bool` | 不产生失败的纯能力检查 |
| `structure_ok` | `Fn(Plan) -> Bool` | 不产生失败的纯结构检查 |
| `validate_structure` | `Fn(Plan) -> Plan` | 结构非法时 `fail!`，成功时返回原 Plan |
| `validate` | `Fn(Plan, PlanProfile) -> Plan` | 结构或能力非法时 `fail!`，成功时返回原 Plan |
| `validate_distinct_plan` | `Fn(Plan) -> Plan` | 验证行级去重的投影、排序与组合约束，不生成 SQL |
| `validate_set_operands` | `Fn(SetOpKind, Plan, Plan) -> Tuple([Plan, Plan])` | 验证集合两侧的结构与投影形状，不生成 SQL |
| `validate_query_plan` | `Fn(QueryPlan) -> QueryPlan` | 验证顶层封闭结果形状，不生成 SQL |
| `transform_sqlite_query_plan` | `Fn(QueryPlan) -> Query` | 校验并将顶层查询 AST 物化为 SQLite Query |
| `transform_sqlite` | `Fn(Plan) -> Query` | 合法 Plan 确定性转换为 SQLite Query |
| `transform_sqlite_distinct` | `Fn(Plan) -> Query` | 行级（无分组/无聚合/纯表达式投影）Plan 渲染为 `SELECT DISTINCT ...`（distinct 行） |
| `transform_sqlite_set` | `Fn(SetOpKind, Plan, Plan) -> Query` | 两个可嵌入 Plan 的封闭集合运算（INTERSECT/EXCEPT/distinct UNION） |
| `transform_sqlite_set_count` | `Fn(SetOpKind, Plan, Plan) -> Query` | `SELECT count(1) FROM (<set>) AS __q_set`（外层计数，单列） |
| `set_ok` | `Fn(SetOpKind, Plan, Plan) -> Bool` | 纯可行性：结构合法、可嵌入、投影非空且同 arity、位置类别兼容 |
| `count_groups` | `Fn(Plan, PlanProfile) -> Query` | 结构/profile 校验内层后，统计通过 HAVING 的组数（嵌套聚合形状 1） |
| `is_sql_identifier` | `Fn(String) -> Bool` | 检查 `^[A-Za-z_][A-Za-z0-9_]*$` |

常用纯构造函数：

| 函数 | 签名 |
| --- | --- |
| `column` | `Fn(String, String) -> Expr` |
| `column_ref` | `Fn(String, String) -> ColumnRef` |
| `bind_val` / `bind_string` / `bind_int` / `bind_float` / `bind_bool` / `bind_null` | `Fn(...) -> Expr` |
| `scalar` | `Fn(ScalarFunction, Array(Expr)) -> Expr` |
| `substr` | `Fn(Array(Expr)) -> Expr` |
| `instr` | `Fn(Expr, Expr) -> Expr` |
| `scalar_if` | `Fn(Expr, Expr, Expr) -> Expr` |
| `add` / `sub` | `Fn(Expr, Expr) -> Expr` |
| `lower` | `Fn(Expr) -> Expr` |
| `length` | `Fn(Expr) -> Expr` |
| `expr_item` | `Fn(Expr) -> SelectItem` |
| `aggregate` | `Fn(AggregateFunction, Expr, Bool, String) -> SelectItem` |
| `aggregate_filtered` | `Fn(AggregateFunction, Expr, Bool, Option(Expr), String) -> SelectItem` |
| `computed_aggregate` | `Fn(ComputedOp, String, String, String) -> ComputedAggregate` |
| `computed_item` | `Fn(ComputedOp, String, String, String) -> SelectItem` |
| `json_extract` / `json_type` | `Fn(Expr, String) -> Expr` |
| `json_valid` | `Fn(Expr) -> Expr` |
| `source` | `Fn(String, String) -> Source` |
| `column_eq` | `Fn(ColumnRef, ColumnRef) -> ColumnEq` |
| `on_eq` | `Fn(ColumnRef, ColumnRef) -> JoinCondition` |
| `on_and` / `on_or` | `Fn(Array(JoinCondition)) -> JoinCondition` |
| `join` | `Fn(JoinKind, Source, ColumnRef, ColumnRef) -> Join` |
| `join_on` | `Fn(JoinKind, Source, JoinCondition) -> Join` |
| `exists` | `Fn(Source, Array(ColumnEq), Option(Expr)) -> Exists` |
| `exists_grouped` | `Fn(Source, Array(ColumnEq), Option(Expr), Array(Expr), Array(Having)) -> Exists` |
| `exists_union` | `Fn(Source, Array(Array(ColumnEq)), Option(Expr)) -> Exists` |
| `exists_not` | `Fn(Exists) -> Exists` | 同一 correlated body 的 `negated` 形式（渲染 `NOT EXISTS (...)`，anti-existence） |
| `exists_two_hop` | `Fn(Source, Array(ColumnEq), Source, Array(ColumnEq), Option(Expr)) -> Exists` | bounded 两跳 link 存在（A→B→C 在同一 correlated EXISTS 内，B/C 子查询内互 JOIN） |
| `peer_branch` | `Fn(ColumnEq, ColumnEq) -> PeerBranch` |
| `peer_corr` | `Fn(Source, Source, PeerBranch, PeerBranch, Option(Expr), Option(Expr)) -> PeerCorr`（异构，无 key 不等证明） |
| `peer_corr_distinct` | `Fn(Source, Source, PeerBranch, PeerBranch, Option(Expr), Option(Expr), Bool) -> PeerCorr`（同实体加入 `origin.key <> peer.key` 身份证明） |
| `exists_peer` | `Fn(PeerCorr) -> Exists` |
| `having` | `Fn(HavingOp, String, Val) -> Having` |
| `having_call` | `Fn(HavingOp, AggregateFunction, Expr, Bool, Val) -> Having` |
| `union_column` | `Fn(String, Expr) -> UnionColumn` |
| `union_branch` | `Fn(Source, Array(UnionColumn), Option(Expr)) -> UnionBranch` |
| `derived_source` | `Fn(String, Array(UnionBranch)) -> DerivedSource` |
| `asc` / `desc` | `Fn(Expr) -> OrderBy` |
| `asc_aggregate` / `desc_aggregate` | `Fn(String) -> OrderBy` |
| `order_by` | `Fn(OrderKey, Ordering) -> OrderBy` |
| `partitioned_top_n` | `Fn(Array(Expr), Array(OrderBy), Int) -> PartitionedTopN` |
| `max_partition_take` | `Int` | 分区 `take` 的上限 |

## 完整 Plan 示例

下面的 Plan 按客户统计金额大于 100 的订单数，取前 5 名，并用客户 id 打破并列：

```telora
def plan: qb.Plan = {
    revision: "orders-v1",
    sources: [qb.source("o", "orders")],
    projection: [
        qb.expr_item(qb.column("o", "customer_id")),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("o", "id"), False, "order_count"),
    ],
    filter: Some(qb.scalar(
        qb.ScalarFunction.Gt,
        [qb.column("o", "amount"), qb.bind_float(100.0)],
    )),
    joins: [],
    grouping: [qb.column("o", "customer_id")],
    ordering: [
        qb.desc_aggregate("order_count"),
        qb.asc(qb.column("o", "customer_id")),
    ],
    limit: Some(5),
    offset: None,
    exists: [],
    having: [],
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};

def profile: qb.PlanProfile = {
    allowed_operators: [
        qb.Operator.Source, qb.Operator.Project, qb.Operator.Column, qb.Operator.Bind, qb.Operator.Scalar, qb.Operator.Aggregate,
        qb.Operator.Filter, qb.Operator.Group, qb.Operator.Order, qb.Operator.Limit, qb.Operator.Offset, qb.Operator.Partition,
    ],
    allowed_join_kinds: [],
    allowed_aggregates: [qb.AggregateFunction.Count],
    allowed_scalars: [qb.ScalarFunction.Gt],
    allow_distinct: False,
};

let validated: qb.Plan = qb.validate(plan, profile);
let query: qb.Query = qb.transform_sqlite(validated);
```

结果形状：

```sql
SELECT o.customer_id, count(o.id) AS order_count
FROM orders AS o
WHERE o.amount > ?
GROUP BY o.customer_id
ORDER BY count(o.id) DESC, o.customer_id ASC
LIMIT ?
```

bindings 为 `[Float(100.0), Int(5)]`。标识符和用户值在类型及转换路径上分离；
调用方不得 escape 后拼接动态值。

## 首词分组（first whitespace-delimited segment）

按 shell command 的第一个空白分隔片段分组，例如把 `./bin/telora -C query run main`
投影为 `./bin/telora`。目标语义只是“首个空白分隔片段”，不是完整 shell lexer。
用封闭原语 `Instr`（查找）、`If`（条件）与 `Sub`/`Substr`（截取）组合：

```telora
def first_token_expr: Fn(qb.Expr) -> qb.Expr = fn(command) {
    let sep: qb.Expr = qb.bind_string(" ");
    let pos: qb.Expr = qb.instr(command, sep);
    let found: qb.Expr = qb.scalar(qb.ScalarFunction.Gt, [pos, qb.bind_int(0)]);
    let rest: qb.Expr = qb.sub(pos, qb.bind_int(1));
    let segment: qb.Expr = qb.scalar_if(
        found,
        qb.substr([command, qb.bind_int(1), rest]),
        command,
    );
    segment
};

def plan: qb.Plan = {
    revision: "commands-v1",
    sources: [qb.source("c", "commands")],
    projection: [
        qb.expr_item(first_token_expr(qb.column("c", "command"))),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("c", "id"), False, "uses"),
    ],
    filter: None,
    joins: [],
    grouping: [first_token_expr(qb.column("c", "command"))],
    ordering: [qb.desc_aggregate("uses")],
    limit: Some(100),
    offset: None,
    exists: [],
    having: [],
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

生成：

```sql
SELECT CASE WHEN instr(c.command, ?) > ? THEN substr(c.command, ?, (instr(c.command, ?) - ?)) ELSE c.command END, count(c.id) AS uses
FROM commands AS c
GROUP BY CASE WHEN instr(c.command, ?) > ? THEN substr(c.command, ?, (instr(c.command, ?) - ?)) ELSE c.command END
ORDER BY count(c.id) DESC
LIMIT ?
```

行为契约：

- **无分隔符**：`instr = 0`，`> 0` 守卫失败，ELSE 分支返回原值。
- **空字符串**：`instr('', sep) = 0`，ELSE 分支返回空串。
- **NULL 输入**：`instr(NULL, sep)` 为 NULL，`CASE WHEN NULL` 选择 ELSE 分支，
  NULL 原样传播。
- **首字符即分隔符**（如 `" cmd"`）：`instr = 1`，截取长度 `0`，得到空片段；
  上层需要时先 trim 再分组。

分隔符本身是动态绑定值（`?` 占位符），SQL 文本不嵌入任何字面量。同一表达式可
稳定用于 projection、grouping 和 ordering。

## 分页（offset）

`Plan.offset` 提供安全分页，供上层完整遍历分组结果：

- `offset` 必须是非负整数；负值被结构校验拒绝。
- 只要 `offset` 存在（包括 `0`），`ordering` 必须非空；否则结构校验原子拒绝。
  稳定的排序保证分页可确定地重复。
- `offset` 对应新增的 `Offset` operator，必须出现在 profile 的
  `allowed_operators` 中，否则 `profile_accepts` 拒绝。
- `limit` 是查询语义的一部分；有限结果不能作为“已覆盖全量”的证明。

```telora
def page: qb.Plan = {
    revision: "commands-page-2",
    sources: [qb.source("c", "commands")],
    projection: [
        qb.expr_item(first_token_expr(qb.column("c", "command"))),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("c", "id"), False, "uses"),
    ],
    filter: None,
    joins: [],
    grouping: [first_token_expr(qb.column("c", "command"))],
    ordering: [qb.desc_aggregate("uses"), qb.asc(qb.column("c", "command"))],
    limit: Some(100),
    offset: Some(100),
    exists: [],
    having: [],
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

生成：

```sql
SELECT CASE WHEN instr(c.command, ?) > ? THEN substr(c.command, ?, (instr(c.command, ?) - ?)) ELSE c.command END, count(c.id) AS uses
FROM commands AS c
GROUP BY CASE WHEN instr(c.command, ?) > ? THEN substr(c.command, ?, (instr(c.command, ?) - ?)) ELSE c.command END
ORDER BY count(c.id) DESC, c.command ASC
LIMIT ? OFFSET ?
```

没有显式 `limit` 的 `offset` 渲染为 `LIMIT -1 OFFSET ?`（SQLite 中 `-1` 表示不设
行数上限），因此分页不需要任何内联字面量，`offset` 值始终作为 `?` 绑定。

## 分组内 Top N（partitioned top N）

回答“每个角色各自最常失败的 3 个 CommandHead”这类问题。阶段在现有 filter、join、
group 和 aggregate 完成后运行：按 `partition_by` 分组，在每个分区内按稳定
`order_by` 保留前 `take` 行。v1 不在分区内支持 offset、rank 过滤、window frame 或
多个独立 window。

```telora
def per_role: qb.Plan = {
    revision: "per-role-failures-v1",
    sources: [qb.source("e", "events")],
    projection: [
        qb.expr_item(qb.column("e", "role")),
        qb.expr_item(qb.column("e", "command_head")),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("e", "id"), False, "event_count"),
    ],
    filter: Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("e", "status"), qb.bind_string("failed")])),
    joins: [],
    grouping: [qb.column("e", "role"), qb.column("e", "command_head")],
    ordering: [],
    limit: None,
    offset: None,
    exists: [],
    having: [],
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
    partition: Some(qb.partitioned_top_n(
        [qb.column("e", "role")],
        [qb.desc_aggregate("event_count"), qb.asc(qb.column("e", "command_head"))],
        3,
    )),
};
```

lowering 在内部使用单个 `row_number() over (partition by ...)` 子查询，公共 AST
不开放任意 window function、frame、raw SQL 或标识符逃逸：

```sql
SELECT __q_0, __q_1, event_count
FROM (
  SELECT e.role AS __q_0, e.command_head AS __q_1, count(e.id) AS event_count,
         row_number() OVER (PARTITION BY e.role ORDER BY count(e.id) DESC, e.command_head ASC) AS __q_rn
  FROM events AS e
  WHERE e.status = ?
  GROUP BY e.role, e.command_head
) AS __partitioned
WHERE __q_rn <= ?
ORDER BY __q_0 ASC, event_count DESC, __q_1 ASC
```

`take` 通过 `?` 绑定进入 SQL；每个分区不足 N 行时保留全部（`__q_rn <= ?` 只做上界
过滤）。外层 `ORDER BY` 先按 partition key（ASC）再按分区内 ordering，保证结果行
序确定可重复。

约束（结构校验原子拒绝）：

- `partition_by` 非空，且每个 key 都是当前计划已选择的 grouping expression；
- `order_by` 非空，且每个 target 都是已选择的 grouping expression 或已投影的
  aggregate alias；
- 稳定性 tie-breaker：`order_by` 必须覆盖所有非 partition grouping expression
  （无法证明稳定时拒绝）；
- `take` 是 `(0, max_partition_take]` 内的正整数（`max_partition_take == 1000`）；
- v1 不与全局 `limit`、`offset` 或全局 `ordering` 组合（原子拒绝）；
- `Partition` 必须出现在 profile 的 `allowed_operators` 中。

bindings 严格按 SQL 占位符真实顺序：内层 SQL 文本把 window 表达式放在 SELECT
列表中，因此顺序为 projection、隐藏列、window partition、window ordering、join、
global filter、grouping，最后是外层 `take`。同一个合法 Plan 总是生成逐字节相同的
SQL 与绑定顺序。

## 内部（未投影）排序聚合

`OrderKey Aggregate(AggregateCall)` 让一个**已分组** Plan 按未投影的聚合值排序并
取 Top N：内部聚合与输出 projection 是分开的约束，聚合不会成为返回列。典型形状
是“按每组记录数选出最大组，只返回组名”：

```telora
let internal: qb.AggregateCall = {
    function: qb.AggregateFunction.Count,
    arg: qb.column("o", "id"),
    distinct: False,
    filter: None,
    alias: "__internal",
};
let plan: qb.Plan = {
    revision: "largest-group-v1",
    sources: [qb.source("o", "orders")],
    projection: [qb.expr_item(qb.column("o", "region"))],
    filter: None,
    exists: [],
    joins: [],
    grouping: [qb.column("o", "region")],
    having: [],
    ordering: [qb.order_by(qb.OrderKey.Aggregate(internal), qb.Ordering.Desc)],
    limit: Some(1),
    offset: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
    partition: None,
};
```

```sql
SELECT o.region FROM orders AS o GROUP BY o.region ORDER BY count(o.id) DESC LIMIT ?
```

- `Aggregate` 排序 key 只在分组 Plan 中合法（结构校验拒绝在未分组 Plan 中使用）；
  它渲染该 AggregateCall 的完整聚合表达式（含 FILTER）。
- operator/aggregate/scalar/distinct 仍递归受 profile 收窄：`Aggregate` 排序消耗
  `Aggregate` operator、其 function 需在 `allowed_aggregates`、arg/filter 的 scalar
  需在 `allowed_scalars`、`distinct=True` 需 `allow_distinct`。
- v1 的 `partition` order_by 不接受 `Aggregate`；内部排序聚合用于全局 `limit`
  Top N 形状。

**跨关系隐藏聚合（related aggregate）**：聚合 arg 也可以是已 join 的关联源的列
（外层按主体维度分组、INNER JOIN 关联源），机制完全一致——Query 层不区分聚合来自
主体源还是 join 源，只要结构合法并分组即可；隐藏 `Aggregate` 用于 ORDER BY 或
HAVING `Call`，不进入 projection、不产生额外 binding。Ontology eDSL 以
`lower_internal_related` / `InternalOrderRequest` / `InternalHavingRequest` 公开该
shape（见 `ONTOLOGY.md` 的“跨关系隐藏聚合”）。

## 条件聚合与计算聚合（filtered & computed aggregates）

回答“每个角色各自 StartedCount、CompletedCount 与净额 Outstanding”这类问题。
全局 filter 先限定整个事实集；每个聚合的 `filter` 只限定该聚合的输入行，二者
绝不合并成一个全局 AND。

```telora
def per_role_net: qb.Plan = {
    revision: "per-role-net-v1",
    sources: [qb.source("e", "events")],
    projection: [
        qb.expr_item(qb.column("e", "role")),
        qb.aggregate_filtered(qb.AggregateFunction.Count, qb.column("e", "id"), False,
            Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("e", "type"), qb.bind_string("task_started")])),
            "started_count"),
        qb.aggregate_filtered(qb.AggregateFunction.Count, qb.column("e", "id"), False,
            Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("e", "type"), qb.bind_string("task_completed")])),
            "completed_count"),
        qb.computed_item(qb.ComputedOp.Sub, "started_count", "completed_count", "outstanding"),
    ],
    filter: Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("e", "year"), qb.bind_int(2024)])),
    joins: [],
    grouping: [qb.column("e", "role")],
    ordering: [qb.desc_aggregate("outstanding")],
    limit: None,
    offset: None,
    exists: [],
    having: [],
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

lowering：

```sql
SELECT e.role,
       count(e.id) FILTER (WHERE e.type = ?) AS started_count,
       count(e.id) FILTER (WHERE e.type = ?) AS completed_count,
       (count(e.id) FILTER (WHERE e.type = ?) - count(e.id) FILTER (WHERE e.type = ?)) AS outstanding
FROM events AS e
WHERE e.year = ?
GROUP BY e.role
ORDER BY (count(e.id) FILTER (WHERE e.type = ?) - count(e.id) FILTER (WHERE e.type = ?)) DESC
```

bindings 严格按占位符出现顺序：两个 FILTER 的 `?`、全局 WHERE、计算聚合的两个
操作数、ordering 中计算聚合的两个操作数。

约束（结构校验原子拒绝）：

- filtered aggregate 的 predicate 复用封闭 Expr/profile/arity/identifier/binding
  边界；全局 filter 与聚合自身 filter 不会合并。聚合自身 predicate 消耗
  `Filter` operator 与 predicate 所用 scalar：只允许 Eq 但禁止 Filter 的 profile
  会拒绝 filtered aggregate。
- computed aggregate 的所有操作数 alias 必须解析到同一计划中已声明的
  aggregate/computed；未知 alias 原子失败。Query 只保证 alias、依赖顺序与 SQL
  结构正确；业务 grain 与 relation-path 兼容性属于 Ontology 的职责，Query
  Plan 不携带业务 grain/relation-path 元数据，也不断言二者；
- 依赖图必须无环；循环依赖原子失败；
- aggregate 与 computed alias 必须互不相同，引用确定无歧义；
- computed aggregate 消耗 `Scalar` operator，并把 `ComputedOp.Add/Sub` 映射到
  `ScalarFunction.Add/Sub`：缺 Add、缺 Sub 或缺 Scalar 的 profile 都会拒绝；
- v1 `Add`/`Sub` 使用 SQLite 原生数值与 NULL 语义：任一操作数为 NULL 则结果为
  NULL。`count`（含 FILTER）永不返回 NULL，因此计数净额总是定义良好；`sum` 等
  可能为 NULL 的聚合需按此语义理解，lowering 不自动插入 `coalesce`；
- v1 不支持除法、任意条件表达式、聚合内 ordering、新的 distinct filtered
  aggregate 语义或用户提供的 aggregate expression；
- ordering、全局分页与分组内 Top N 可以引用最终 computed aggregate；与分组内
  Top N 组合时按分区内 ordering 稳定排序。

## SQLite JSON v1

从 `payload_json` 风格列提取字段，并用于 projection、filter、grouping 与
ordering。JSON path 始终是字符串 `Bind`，进入 `?`/bindings，绝不进入 SQL 文本。

```telora
def attempts: qb.Plan = {
    revision: "attempt-json-v1",
    sources: [qb.source("e", "events")],
    projection: [
        qb.expr_item(qb.column("e", "id")),
        qb.expr_item(qb.json_extract(qb.column("e", "payload"), "$.attempt_id")),
        qb.expr_item(qb.json_extract(qb.column("e", "payload"), "$.status")),
        qb.expr_item(qb.json_type(qb.column("e", "payload"), "$.amount")),
        qb.expr_item(qb.json_valid(qb.column("e", "payload"))),
    ],
    filter: Some(qb.scalar(qb.ScalarFunction.Eq, [
        qb.json_extract(qb.column("e", "payload"), "$.status"),
        qb.bind_string("ok"),
    ])),
    joins: [],
    grouping: [qb.json_extract(qb.column("e", "payload"), "$.attempt_id")],
    ordering: [qb.asc(qb.json_extract(qb.column("e", "payload"), "$.attempt_id"))],
    limit: None,
    offset: None,
    exists: [],
    having: [],
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

lowering：

```sql
SELECT e.id, json_extract(e.payload, ?), json_extract(e.payload, ?),
       json_type(e.payload, ?), json_valid(e.payload)
FROM events AS e
WHERE json_extract(e.payload, ?) = ?
GROUP BY json_extract(e.payload, ?)
ORDER BY json_extract(e.payload, ?) ASC
```

bindings：`[String("$.attempt_id"), String("$.status"), String("$.amount"),
String("$.status"), String("ok"), String("$.attempt_id"), String("$.attempt_id")]`
——严格按占位符出现顺序。

SQLite JSON1 标量语义（v1 精确采用，schema 保证被读文档是合法 JSON；v1 不在
Query AST 内修复 malformed JSON）：

- `json_extract(doc, path)`：path 缺失或对应 JSON null → SQL NULL；字符串/数值/
  布尔 → 对应 SQL scalar；对象/数组 → JSON text；
- `json_type(doc, path)`：返回 SQLite 类型文本（`null`/`true`/`false`/
  `integer`/`real`/`text`/`array`/`object`）或 path 缺失时 NULL；
- `json_valid(doc)`：合法 JSON 返回 `1`，否则 `0`。

path binding 在 projection、filter、grouping、ordering、computed dimension 与
partition ordering 中保持严格占位符顺序与重复表达式确定性。

## 大小写归一与子串语义（Lower / Length / Instr / Substr）

`Lower`（`lower(value)`）是唯一的大小写归一标量。默认 SQLite build 只折叠
ASCII A-Z；非 ASCII 保持不变。`Instr` 与 `Substr` 是大小写敏感的
（SQLite 默认），`Substr`/`Instr`/`Length` 都按字符而不是字节计算。上层可以用
同一组封闭标量稳定实现四种子串关系：

| 关系 | 大小写敏感 | 表达式 |
| --- | --- | --- |
| contains | 敏感 | `instr(col, ?) > 0` |
| contains | 不敏感 | `instr(lower(col), lower(?)) > 0` |
| starts-with | 不敏感 | `instr(lower(col), lower(?)) = 1` |
| not-contains | 敏感 | `instr(col, ?) = 0` |
| ends-with | 不敏感 | `substr(lower(col), length(lower(col)) - length(lower(?)) + 1) = lower(?)` |

动态值（如 `lower(?)` 内的文本）永远通过 `?` 进入 bindings；SQL 文本不嵌入用户
字面量。`lower(col) = lower(?)` 是参数化比较前统一口径的标准写法。示例：

```telora
let ci_contains: qb.Expr = qb.scalar(qb.ScalarFunction.Gt, [
    qb.instr(qb.lower(qb.column("c", "command")), qb.lower(qb.bind_string("run"))),
    qb.bind_int(0),
]);
```

## HAVING

`Plan.having` 是聚合结果谓词数组（空数组表示没有 HAVING），各条之间为 AND。
每条 `Having {op, measure, threshold}` 表示 `<measure> <op> <threshold>`：

- `measure` 是 `HavingMeasure`：
  - `Ref(AggregateRef)` 命名投影中已声明的 aggregate/computed aggregate alias
    （构造器 `qb.having(op, alias, threshold)`）；
  - `Call(AggregateCall)` 是直接聚合表达式，如 `count(child.id)`，不要求先投影
    （构造器 `qb.having_call(op, function, arg, distinct, threshold)`），用于嵌套
    聚合体（count_groups 内层、correlated aggregate EXISTS）；
- `threshold` 是动态标量，永远成为该条件末尾的 `?` 绑定；
- measure 按声明重新展开完整聚合表达式，因此带 FILTER 的 measure 会在 HAVING 中
  按其占位符顺序重复绑定；
- HAVING 消耗 `Having` operator，`Call` measure 额外消耗其 AggregateCall 的
  operator/aggregate/scalar 用法，并递归进入 profile 检查；
- HAVING 必须出现在 profile 的 `allowed_operators` 中。

```telora
def roles_over_n: qb.Plan = {
    revision: "roles-over-n-v1",
    sources: [qb.source("e", "events")],
    projection: [
        qb.expr_item(qb.column("e", "role")),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("e", "id"), False, "event_count"),
    ],
    filter: None,
    exists: [],
    joins: [],
    grouping: [qb.column("e", "role")],
    having: [qb.having(qb.HavingOp.Gt, "event_count", qb.Val.Int(5))],
    ordering: [qb.desc_aggregate("event_count")],
    limit: None,
    offset: None,
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

```sql
SELECT e.role, count(e.id) AS event_count
FROM events AS e
GROUP BY e.role
HAVING count(e.id) > ?
ORDER BY count(e.id) DESC
```

HAVING 与全局 `limit`/`offset`/`ordering` 以及分组内 Top N 可以组合；与分组内
Top N 组合时，HAVING 进入内层分组查询（在 `GROUP BY` 之后），`take` 绑定仍在外层。
HAVING 引用未投影或未知的 measure、非聚合/计算 alias 都会在结构校验中原子拒绝。

## 嵌套聚合

单层 `SELECT ... GROUP BY ... HAVING ...` 之上的两种通用形状由封闭的嵌套聚合
原语表达，全部复用同一套 Plan/Expr/Aggregate/Having 类型，不引入 raw SQL、
开放函数名或业务专用节点。Profile 递归收窄嵌套体内部使用的 operator、aggregate
与 scalar，任何内层结构/profile/引用错误都原子失败、不发布部分 Query。

### 形状 1：对满足 HAVING 的组计数（`count_groups`）

`qb.count_groups(inner_plan, profile)` 先对 `inner_plan` 做结构校验与 profile
校验，再渲染为

```text
SELECT count(1) FROM (<inner_plan 查询>) AS __q_count
```

`parents/children` fixture：按 parent 分组统计 child，保留 `count(child.id) > ?`
的组，外层返回满足条件的 parent 组数。

```telora
def inner: qb.Plan = {
    revision: "parents-over-n-v1",
    sources: [qb.source("c", "children")],
    projection: [qb.expr_item(qb.column("c", "parent_id"))],
    filter: None,
    exists: [],
    joins: [],
    grouping: [qb.column("c", "parent_id")],
    having: [qb.having_call(qb.HavingOp.Gt, qb.AggregateFunction.Count, qb.column("c", "id"), False, qb.Val.Int(3))],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};

let nested: qb.Query = qb.count_groups(inner, profile);
```

```sql
SELECT count(1) FROM (SELECT c.parent_id FROM children AS c
                      GROUP BY c.parent_id HAVING count(c.id) > ?) AS __q_count
```

同一 inner Plan + profile 两次输出逐字节相同；bindings 严格是内层占位符顺序
（此例为阈值 `3`）。内层 HAVING 引用未知列/别名会被结构校验拒绝；profile 缺少
Aggregate/Group/Having operator 或 `Count` 聚合会拒绝内层，子查询无法绕过 profile。

### 形状 2：相关聚合 EXISTS（`exists_grouped`）

`qb.exists_grouped(source, pairs, filter, grouping, having)` 构造带内层
`GROUP BY` 与 `HAVING` 的相关 EXISTS。匹配 inner source 的行先按 `grouping`
分组，只有 `having` 成立的组让 EXISTS 为真。EXISTS 仍是纯谓词：不产生 JOIN，
外层 COUNT/SUM 保持 base grain。

`subjects/events` fixture：外层保持 subject grain，只保留具有至少 N 条匹配
event 的 subject。

```telora
def subjects_min: qb.Plan = {
    revision: "subjects-min-events-v1",
    sources: [qb.source("s", "subjects")],
    projection: [qb.aggregate(qb.AggregateFunction.Count, qb.column("s", "id"), False, "subject_count")],
    filter: None,
    exists: [qb.exists_grouped(
        qb.source("e", "events"),
        [qb.column_eq(qb.column_ref("s", "id"), qb.column_ref("e", "subject_id"))],
        Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("e", "kind"), qb.bind_string("measuring")])),
        [qb.column("e", "subject_id")],
        [qb.having_call(qb.HavingOp.Ge, qb.AggregateFunction.Count, qb.column("e", "id"), False, qb.Val.Int(3))],
    )],
    joins: [],
    grouping: [],
    having: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

```sql
SELECT count(s.id) AS subject_count
FROM subjects AS s
WHERE EXISTS (SELECT 1 FROM events AS e
              WHERE s.id = e.subject_id AND e.kind = ?
              GROUP BY e.subject_id HAVING count(e.id) >= ?)
```

相关引用规则与普通 EXISTS 相同：`pairs` 的 left 是当前可见 outer alias 列、
right 是 inner alias 列；inner 的 filter/grouping/HAVING 表达式只能引用 outer
主 alias 与 inner alias。inner alias 遮蔽主 alias、空 pairs、未知 inner 列、
未知 outer 引用都被结构校验原子拒绝。EXISTS 内层没有投影 measure，因此其
HAVING 只接受直接 `Call` 聚合表达式（`Ref` 会被拒绝）。profile 递归收窄内层
`Exists`/`Group`/`Having`/`Aggregate` operator、`allowed_aggregates` 与
`allowed_scalars`。

## 派生 UNION ALL 关系（derived source）

把多个同 grain 的物理来源规范为一个逻辑关系，再在外层分组/聚合/分区，由
`Plan.derived: Option(DerivedSource)` 表达：

```telora
type UnionColumn = struct { name: String, expr: Expr };
type UnionBranch = struct { source: Source, outputs: Array(UnionColumn), filter: Option(Expr) };
type DerivedSource = struct { alias: String, branches: Array(UnionBranch) };
```

- `branches` 是有序的非空分支列表，用 `UNION ALL` 合并；每个分支把 `source`
  投影到相同的非空具名 `outputs`（顺序与 `name` 全部分支一致）；
- 合并结果不是终结 Query，而是外层 Plan 的具名 source `alias`：外层可以对派生
  列做 projection、filter、aggregate、grouping、HAVING、ordering 与现有
  PartitionRequest；
- 分支与外层只使用封闭 Plan/Expr/Aggregate/Order 体系；无 raw SQL、开放函数名、
  任意表/列 fragment 或 schema 推断。UNION 去重、递归 CTE 与任意嵌套 SQL 不在
  范围内。

两个同 grain item 表合并后按 owner/group 计数，再用分区 Top 1 对每个 owner 取
item 最多的 group：

```telora
def u: qb.DerivedSource = qb.derived_source("u", [
    qb.union_branch(qb.source("a", "items_a"), [
        qb.union_column("owner_id", qb.column("a", "owner_id")),
        qb.union_column("group_id", qb.column("a", "group_id")),
        qb.union_column("item_id", qb.column("a", "item_id")),
    ], Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("a", "kind"), qb.bind_string("x")]))),
    qb.union_branch(qb.source("b", "items_b"), [
        qb.union_column("owner_id", qb.column("b", "owner_id")),
        qb.union_column("group_id", qb.column("b", "group_id")),
        qb.union_column("item_id", qb.column("b", "item_id")),
    ], None),
]);

def per_owner_top_group: qb.Plan = {
    revision: "per-owner-top-group-v1",
    sources: [],
    derived: Some(u),
    scalar_comparisons: [],
    ranked_key_comparisons: [],
    projection: [
        qb.expr_item(qb.column("u", "owner_id")),
        qb.expr_item(qb.column("u", "group_id")),
        qb.aggregate(qb.AggregateFunction.Count, qb.column("u", "item_id"), False, "item_count"),
    ],
    filter: None,
    exists: [],
    joins: [],
    grouping: [qb.column("u", "owner_id"), qb.column("u", "group_id")],
    having: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: Some(qb.partitioned_top_n(
        [qb.column("u", "owner_id")],
        [qb.desc_aggregate("item_count"), qb.asc(qb.column("u", "group_id"))],
        1,
    )),
};
```

生成的 SQL 形状（bindings 恒按分支声明顺序后接外层表达式顺序）：

```sql
SELECT __q_0, __q_1, item_count
FROM (SELECT u.owner_id AS __q_0, u.group_id AS __q_1, count(u.item_id) AS item_count,
             row_number() OVER (PARTITION BY u.owner_id
                                ORDER BY count(u.item_id) DESC, u.group_id ASC) AS __q_rn
      FROM (SELECT a.owner_id AS owner_id, a.group_id AS group_id, a.item_id AS item_id
            FROM items_a AS a WHERE a.kind = ?
            UNION ALL
            SELECT b.owner_id AS owner_id, b.group_id AS group_id, b.item_id AS item_id
            FROM items_b AS b) AS u
      GROUP BY u.owner_id, u.group_id) AS __partitioned
WHERE __q_rn <= ?
ORDER BY __q_0 ASC, item_count DESC, __q_1 ASC
```

结构校验（原子失败）：
- `derived` 出现时 `sources`/`joins`/`exists` 必须为空；
- 空分支、输出列为空、输出列名非法/重复、各分支列数或别名顺序不一致；
- 派生 alias 与分支 source alias 必须隔离（遮蔽被拒绝）；分支内部只能引用自己
  的 source alias；外层只能引用 `alias` 上已投影的输出列（未投影列被拒绝）；
- 分支或外层的表达式继续受 identifier/arity/参数化约束。

profile 递归：`operators`/`profile_accepts` 递归计入每个分支的
source/operator/scalar（通过 `derived_operators` 与 `derived_branches_scalars_ok`），
外层另计自身 operator/aggregate/scalar；因此派生来源不能绕过 source
allow-list、分页或参数化约束。任一分支失败不发布部分 Query；同一结构重复转换
逐字节一致。

## 存在性过滤（EXISTS）

`Plan.exists` 是相关子查询形式的半连接过滤（semi-join）：每条
`Exists {source, pairs, filter, grouping, having}` 渲染为

```text
EXISTS (SELECT 1 FROM <table> AS <alias>
        WHERE <left.col = alias.col> [AND ...] [AND <filter>]
              [GROUP BY ...] [HAVING ...])
```

- `pairs` 非空，且每条 `ColumnEq` 的 `left` 是外层主 alias 的列，`right` 是
  `source.alias` 的列；`source.alias` 不得与外层主 alias 重名；
- 当相关性不是单一等值合取时使用 **union 模式**：`exists_union(source,
  alternatives, filter)` 使 `pairs` 为空，`alternatives` 是有序的封闭析取结构
  （每个 alternative 是一个非空 `ColumnEq` 合取，alternative 之间为 OR），例如双端
  hub 的 `outer.left = alias.key OR outer.right = alias.key`。每个等式严格连接一个
  外层主 alias 列与内层 `source.alias` 列，不接受任意布尔 Expr 或 raw SQL。渲染为
  `EXISTS (SELECT 1 FROM t AS a WHERE (alt1 AND ...) OR (...) [AND filter...])`；
- `filter` 可选，是内层附加行谓词，其列只能引用外层主 alias 与 `source.alias`；
- `grouping`/`having` 非空时是相关聚合 EXISTS（见“嵌套聚合”形状 2）；
- 渲染为纯谓词，不产生 JOIN，因此外层 COUNT/SUM 不会被相关行的 fan-out 放大——
  回答“存在相关告警的设备”一类问题；
- 消耗 `Exists` operator，必须出现在 `allowed_operators` 中。

“外层主 alias”包括 `sources[0]` 与全部 `joins` 引入的 join alias。因此一个相关
EXISTS 的外层列可以引用一个**已 join 的 owner alias**：把唯一、grain-safe 的 owner
`INNER JOIN` 进外层 FROM，再用相关 EXISTS 从该 owner alias 关联目标表，就表达有界
两跳存在（base → owner → target），而目标表只出现在子查询内部、绝不被外层 JOIN。
结构校验保证 EXISTS 的 outer 列必须是可见主 alias（base 或 join alias）、inner 列
必须属于 `source.alias`；`tests/query.telora` 以 owner-join + 相关 EXISTS 的 Plan
覆盖该形状的 SQL、binding 顺序、确定性与非法 outer 引用拒绝。Query 层不引入嵌套
EXISTS、任意子查询或 raw SQL；动态值仍只进入 bindings。

```telora
def devices_with_alerts: qb.Plan = {
    revision: "devices-with-alerts-v1",
    sources: [qb.source("d", "devices")],
    projection: [qb.aggregate(qb.AggregateFunction.Count, qb.column("d", "id"), False, "device_count")],
    filter: None,
    exists: [qb.exists(
        qb.source("a", "alerts"),
        [qb.column_eq(qb.column_ref("d", "id"), qb.column_ref("a", "device_id"))],
        None,
    )],
    joins: [],
    grouping: [],
    having: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

```sql
SELECT count(d.id) AS device_count
FROM devices AS d
WHERE EXISTS (SELECT 1 FROM alerts AS a WHERE d.id = a.device_id)
```

非法引用（空 pairs、inner 列不是本 source、outer 列不是主 alias、内层 filter
引用未知 alias、inner alias 与主 alias 重名）都会在结构校验中原子拒绝。

## 结果集 distinct（SELECT DISTINCT）

`qb.transform_sqlite_distinct(plan)` 把合法的行级 Plan（无 grouping、无 HAVING、
无 partition、投影项全部是 `Expr` 维度表达式）渲染为 `SELECT DISTINCT ...`：
结果行互不重复，覆盖多维度、过滤、排序与 limit/offset 边界。这是结果集去重
语义，不能退化为普通投影或 `count(distinct ...)`。

- 投影决定返回列；过滤/排序/limit 与普通查询一致。
- SQLite 要求 `SELECT DISTINCT` 的每个 `ORDER BY` 项都出现在结果集中，因此
  wrapper 确定性要求每个排序目标都是已投影的表达式（按非投影列排序属于普通
  `transform_sqlite` 的范围）。
- bindings 严格按占位符顺序；同一 Plan 重复转换逐字节一致。
- 聚合/分组/HAVING/分区 Plan 不在该行级 distinct 形状内，确定性失败、不发布
  部分 Query。

```telora
let rows: qb.Query = qb.transform_sqlite_distinct(row_plan);
```

## 反存在过滤（NOT EXISTS）

`qb.exists_not(ex)` 把任一已构造的 correlated `Exists` body 的 `negated` 置为
`True`，渲染为 `NOT EXISTS (...)`。它选择“没有满足条件的关联记录”的主体，
NULL 语义保持 SQL 原生（当无相关行时 `NOT EXISTS` 为真，与 `NULL` 处理无关）；
correlation、source、bindings 与 grain 语义与正向 `EXISTS` 完全相同。

```telora
let no_alerts: qb.Exists = qb.exists_not(qb.exists(
    qb.source("a", "alerts"),
    [qb.column_eq(qb.column_ref("d", "id"), qb.column_ref("a", "device_id"))],
    Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("a", "level"), qb.bind_int(3)])),
));
```

```sql
SELECT d.id FROM devices AS d
WHERE NOT EXISTS (SELECT 1 FROM alerts AS a
                  WHERE d.id = a.device_id AND a.level = ?)
```

`negated` 只是谓词层取反：它不产生外层 JOIN、不放宽相关引用规则，`Exists`
operator 与 profile 语义不变（`NOT EXISTS` 仍属 existence 能力）。

## 有界两跳 link 存在（A → B → C）

`qb.exists_two_hop(hop_source, hop_pairs, link_source, link_pairs, link_filter)`
让一个 base 主体 A 在**同一个 correlated EXISTS** 内表达“存在关联行 B、且 B 又关联
满足条件的 C”：B（`hop_source`）与 C（`link_source`）在子查询内互相 `INNER JOIN`，
A 只通过 `hop_pairs` 相关到 B。B 和 C 绝不出现在外层 projection/grouping/joins，
因此即使 A→B 是一对多（fan-out）关系，外层 A 的 grain 也不会被放大；同一主体有多条
匹配 B/C 时外层仍只计一次。

```text
EXISTS (SELECT 1 FROM <B> AS <b>
        INNER JOIN <C> AS <c> ON <link.pairs (b.col = c.col)>
        WHERE <hop.pairs (a.col = b.col)> [AND link_filter])
```

- `hop.pairs` 每个等式的 `left` 是外层主体 alias 列、`right` 是 B alias 列；
  `link.pairs` 每个等式分别连接 B alias 与 C alias 的列。
- `link.filter` 是可选的 C 侧谓词（复用封闭 Expr），动态值保持参数化。
- 结构校验要求 B/C alias 合法、互异且不遮蔽外层 alias；不与其他 exists 模式组合；
  operator/profile 递归收窄（`Exists` + `Column` + filter 的 scalar）。
- 对同一 link body 使用 `exists_not` 即得 `NOT EXISTS` 的两跳反存在。

## 集合运算（INTERSECT / EXCEPT / distinct UNION）

`transform_sqlite_set(kind, left, right)` 组合两个**完整、已结构校验**的 Plan：
每个可嵌入操作数渲染成**裸 select-statement**，并用集合关键字直接连接
（`INTERSECT`/`EXCEPT`/`UNION`，后者为去重 union，不是内部 UNION ALL）。
SQLite 只接受 compound-select 顶层为裸 select 项：`(SELECT ...) INTERSECT
(SELECT ...)` 这种在顶层为每个操作数加括号的形式会在执行前被 SQLite 拒绝，因此
query-core 从不为顶层操作数加括号：

```text
SELECT <投影...> FROM <表> AS <alias> [WHERE ...] [GROUP BY ...] [HAVING ...]
  INTERSECT/EXCEPT/UNION
SELECT <投影...> FROM <表> AS <alias> [WHERE ...] [GROUP BY ...] [HAVING ...]
```

- 每个操作数必须可嵌入：无本地 ordering/limit/offset/partition（grouping/HAVING
  保留在操作数内部）；投影非空且 arity 相同；逐位置投影类别兼容（expr/agg/computed
  必须一致）。
- 操作数的公共投影逐字保留：SELECT 列、列序都来自操作数自身，compound 形式不会
  引入任何 helper 列（无 `__q_*` 别名注入）。
- bindings 按从左到右的操作数顺序确定性拼接（含嵌套操作数），动态值绝不进入 SQL。
- `transform_sqlite_set_count(kind, left, right)` 需要把集合结果当作外层计数源时，
  用**合法的 derived-table 形式**把整个可执行 compound select 包一次：
  `SELECT count(1) FROM (<compound select>) AS __q_set`（唯一合法的包层处），外层
  只暴露一个 count 列，不暴露操作数列。
- `set_ok(kind, left, right)` 是纯可行性探针（不失败）。
- 非法形状（空/零列操作数、arity 或位置类别不匹配、不可嵌入操作数）原子失败，不发布
  部分 Query；同一输入的重复 lowering 逐字节一致。
- `tests/query.telora` 对 `INTERSECT`/`EXCEPT`/`UNION` 分别断言精确 SQLite-valid
  字符串（含每操作数 filter 与从左到右 binding 顺序），并断言不存在
  `) INTERSECT (SELECT` / `) UNION (SELECT` / `) EXCEPT (SELECT` 这类被 SQLite
  拒绝的顶层括号形式。

## 排序分组键标量比较（ranked grouped-key scalar comparison）

`ScalarAggregateComparison` 只能返回**一个聚合值**。当 shape 需要把外层属性与
“按聚合排序后的第一个分组的 key”比较时，使用**独立、不重叠**的 typed spec
`RankedKeyComparison`（`Plan.ranked_key_comparisons: Array(RankedKeyComparison)`）：

```telora
type RankedKeySubquery = struct {
    source: Source,
    joins: Array(Join),
    filter: Option(Expr),
    keys: Array(Expr),        # 恰好一个投影/分组 key 表达式（结构校验长度==1）
    order: AggregateCall,     # 唯一封闭聚合排序表达式（可带聚合局部 filter）
    direction: Ordering,      # Asc / Desc
};

type RankedKeyComparison = struct {
    outer: ColumnRef,         # 外层可见 alias 的列
    op: ScalarFunction,       # 封闭比较算子（同 scalar aggregate comparison）
    inner: RankedKeySubquery,
};
```

构造器：`qb.ranked_key_subquery_spec(source, joins, filter, keys, order, direction)`
与 `qb.ranked_key_comparison(outer, op, inner)`。

### 形状与渲染

内层查询恰好投影/分组**一个** key 表达式、按**一个**封闭聚合排序表达式（required
`direction`）对分组排序并取首组 key；渲染为括号化的 scalar select，子句顺序与
绑定顺序确定：

```text
<outer.column> <op> (SELECT <key> FROM <table> AS <alias> [JOIN ...]
                     [WHERE <row filter>]
                     GROUP BY <key>
                     ORDER BY <order-aggregate> <ASC|DESC> LIMIT 1)
```

- 允许内层 joins 与可选 row filter，但**不允许**任意 projection、HAVING、offset、
  partition、set operation、嵌套 scalar subquery 或 raw SQL；`LIMIT 1` 是固定语义；
- 外层比较只保留满足 `<outer> <op> <key>` 的行；外层投影逐字保留（与本机制无关的
  projection/列序不改变）；
- bindings 顺序确定：外层 row filter/exists/既有 scalar comparisons 之后是每个
  ranked comparison（按数组顺序），其子查询内按占位符顺序 = key（SELECT）、
  row filter、key（GROUP BY）、ordering aggregate 表达式；
- NULL 语义保持 SQL 原生（比较与聚合都不注入 `coalesce`）。

### 校验与 profile

- 结构校验要求：source/join 标识符合法；内层 alias 互异且**不泄漏**到外层（key/
  filter/order 只能引用内层 alias；外层 outer `ColumnRef` 必须命名外层可见 alias）；
  `keys` 长度必须为 **1**（缺分组、多 key 拒绝）；order 必须是封闭聚合调用，其
  arg/aggregate-local filter 都是内层 alias 上的合法 Expr；`op` 必须是封闭比较算子；
  非法标识符、alias 泄漏、未知 outer 引用、未知内层列、空/多 key、非比较算子全部被
  `structure_ok`/`validate_structure` 原子拒绝；
- profile **递归收窄**：内层 ordering aggregate 函数必须在 `allowed_aggregates`、
  join kind 必须在 `allowed_join_kinds`、distinct 语义服从 `allow_distinct`、key /
  order arg / aggregate-local filter / row filter 所用 scalar 必须在 `allowed_scalars`；
  算子集合经 `operators` 计入（Source/Column/Aggregate/Group/Order/Filter/Join/
  Bind/Scalar）。
- 既有 `ScalarAggregateComparison`/`ScalarSubquery`/`scalar_comparisons` 保持
  source-compatible 且行为不变。

## 角色化 Join 与结构化 ON 条件

`JoinCondition` 是封闭的 ON 谓词树：`Eq(ColumnEq)` 原子由
`And`/`Or`（非空数组）组合。同一物理目标可以用多个别名作为角色（a/z 端、站点
双口径等）：每个角色是 `plan.sources`/`plan.joins` 中一个独立 alias，ON 谓词在
这些 alias 之间比较列。仍无 raw SQL、开放函数名或 identifier 逃逸。

```telora
def site_dual: qb.Plan = {
    revision: "site-dual-v1",
    sources: [qb.source("m", "movements")],
    projection: [
        qb.expr_item(qb.column("m", "id")),
        qb.expr_item(qb.column("a", "name")),
        qb.expr_item(qb.column("z", "name")),
    ],
    filter: None,
    exists: [],
    joins: [
        # a 端与 z 端是同一张 endpoints 表的两个角色。
        qb.join(qb.JoinKind.Inner, qb.source("a", "endpoints"),
            qb.column_ref("m", "a_id"), qb.column_ref("a", "id")),
        qb.join_on(qb.JoinKind.Inner, qb.source("z", "endpoints"),
            qb.on_or([
                qb.on_eq(qb.column_ref("m", "z_id"), qb.column_ref("z", "id")),
                qb.on_eq(qb.column_ref("a", "parent_id"), qb.column_ref("z", "id")),
            ])),
    ],
    grouping: [],
    having: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
    derived: None,
    scalar_comparisons: [],
    ranked_key_comparisons: [],
};
```

```sql
SELECT m.id, a.name, z.name
FROM movements AS m
INNER JOIN endpoints AS a ON m.a_id = a.id
INNER JOIN endpoints AS z ON (m.z_id = z.id OR a.parent_id = z.id)
```

ON 条件中的每个列引用都必须解析到该 plan 可见的 source/join alias，否则结构校验
原子拒绝。`And`/`Or` 为空同样拒绝。Join 的 `Join` operator 与 `allowed_join_kinds`
继续由 profile 收窄。

## 配对的 peer EXISTS（PeerCorr）

`Exists.peer: Option(PeerCorr)` 是封闭的 paired-endpoint 相关谓词：同一个 hub
base 行的两个互斥端点分别由 **origin** 与 **peer** participant 占据。它用**两个
内层源**的 correlated EXISTS 表达，同一结构内引用 hub、origin participant 与 peer
participant，以及两组被封闭验证的端点交换分支：

```text
EXISTS (SELECT 1 FROM <origin.table> AS <oa>, <peer.table> AS <pa>
        WHERE ((<hub.A> = <oa.key> AND <hub.B> = <pa.key>)
               OR (<hub.B> = <oa.key> AND <hub.A> = <pa.key>))
        [AND origin_filter][AND peer_filter])
```

```telora
let a_origin: qb.ColumnEq = qb.column_eq(qb.column_ref("pr", "left_id"), qb.column_ref("mo", "id"));
let a_peer: qb.ColumnEq = qb.column_eq(qb.column_ref("pr", "right_id"), qb.column_ref("mp", "id"));
let b_origin: qb.ColumnEq = qb.column_eq(qb.column_ref("pr", "right_id"), qb.column_ref("mo", "id"));
let b_peer: qb.ColumnEq = qb.column_eq(qb.column_ref("pr", "left_id"), qb.column_ref("mp", "id"));
let corr: qb.PeerCorr = qb.peer_corr(
    qb.source("mo", "members"),
    qb.source("mp", "members"),
    qb.peer_branch(a_origin, a_peer),
    qb.peer_branch(b_origin, b_peer),
    Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("mo", "id"), qb.bind_int(101)])),
    Some(qb.scalar(qb.ScalarFunction.Eq, [qb.column("mp", "id"), qb.bind_int(202)])),
);
let exists: qb.Exists = qb.exists_peer(corr);
```

- 每个 equality 的 `left` 是一个**已校验**的 hub 角色列（外主 alias），`right` 是该
  participant 内层 alias 的 key 列；两个交换分支共享同一对 hub 角色列并交换 origin/peer
  的 key 列。
- **身份证明在 SQL 结构内**：origin/peer 的 key 绑定属于各自的 `origin_filter`/
  `peer_filter`，只作用于对应内层 alias，因此同一端点值不会被两个异构 participant 表
  同时解释（跨表 key 碰撞不会静默同端配对）。
- 结构校验要求两个角色列互异（拒绝 same-side）、origin/peer 内层 alias 互异且不遮蔽主
  alias、两分支一致、participant filter 只引用自己的内层 alias；自配由 Ontology 在
  prepare/request 层按实体拒绝。
- 该谓词是纯相关 EXISTS：不产生外层 JOIN，hub base grain 不被 fan-out。
- **同实体身份证明**：origin/peer 属于同一实体/表时 `distinct_keys=True`，
  `PeerCorr` 渲染 `origin.key <> peer.key`（封闭结构、经结构校验），单个 participant
  行不能同时占据 hub 两端；异构（不同表）不加入裸 key 不等，相同 key 仍是不同身份。
- 算子按 `Exists`/`Column` 与 filter 的 `Bind`/`Scalar` 计入；profile 需允许对应
  operator/scalar。

## 验证与转换保证

结构校验覆盖：非空 sources/projection、合法标识符、source alias 引用、标量参数
个数、非负 Plan limit、非负 Plan offset、offset 存在时必须带非空 ordering、排序
聚合引用确实存在并已投影、分组内 Top N 的全部安全约束（partition key 是所选
grouping、ordering target 已选择、稳定 tie-breaker、`take` 在正上限内、不与全局
limit/offset/ordering 组合）、filtered/computed aggregate 约束（FILTER
predicate 合法、操作数解析到已声明 aggregate/computed、依赖无环、alias 唯一）、
HAVING 引用解析到已投影 aggregate/computed、EXISTS 的相关引用形状合法（pairs
非空、inner 列属于 exists source、outer 列属于主 alias、inner alias 不遮蔽主
alias、内层 filter 引用可见 alias），以及 Join ON 条件树形状与 alias 引用。
`validate` 在此基础上检查所有算子、join kind、aggregate、scalar 和 distinct 是否
被 profile 接受。

`Plan.projection` 是**保序**的 SELECT 列表：SELECT 列顺序严格等于 projection 数组
顺序，QueryBuilder 不会按类别重排。领域层如需跨 measure/dimension 交错列序，由
ontology eDSL 的 `lower_ordered`（显式 `ProjectionToken` 顺序）在构造 Plan 时控制；
QueryBuilder 只负责保序渲染与结构验证。

`transform_sqlite` 使用固定子句顺序：

```text
SELECT ... FROM ... [JOIN ...] [WHERE <filter> [AND EXISTS (...)] ...]
       [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT ?] [OFFSET ?]
```

没有显式 limit 的 offset 渲染为 `LIMIT -1 OFFSET ?`。bindings 严格遵循 SQL 中
`?` 的出现顺序：projection、join、row filter、每个 EXISTS 子查询自己的绑定、
grouping、having、ordering、limit、offset。
分组内 Top N 把 window 表达式放在内层 SELECT 列表，因此绑定顺序为 projection、
隐藏列、window partition、window ordering、join、row/exists filter、grouping、
having、`take`（与外层 `__q_rn <= ?` 对应）。
同一个合法 Plan 总是生成逐字节相同的 SQL 和 binding 顺序。
任何失败都不发布部分 Query。

算子集合的规范顺序为：

```text
Source, Project, Column, Bind, Scalar, Aggregate, Filter, Exists, Join, Group, Having, Order, Limit, Offset, Partition
```

## JSON codec 边界

`Val` 直接使用标准库 `ScalarValue` 的 JSON 表示，Telora 内部仍使用封闭 variant：

| Telora `Val` | JSON |
| --- | --- |
| `String("abc")` | `"abc"` |
| `Int(3)` | `3` |
| `Float(3.5)` | `3.5` |
| `Bool(true)` | `true` |
| `None` | `null` |

```telora
import "std/codec" as codec;
import "std/value" { Value };

let encoded: Value = codec.encode(Value.type, query);
let decoded: qb.Query = codec.decode(qb.Query.type, encoded).unwrap!();
```

编码后的 Query 形状如下，不含 variant wrapper：

```json
{"bindings": [100.0, 5], "sql": "SELECT ... WHERE o.amount > ? ... LIMIT ?"}
```

解码时，JSON 整数字面量进入 `Int`，带小数或指数的字面量进入 `Float`。
JSON 文本不能保留整数值 Float 的身份：`Float(3.0)` 紧凑编码可能是 `3`，再次
解码成为 `Int(3)`；需要区分时应在上层输入约定中处理。

## 失败分类

| 来源 | 观察方式 |
| --- | --- |
| Profile 越界 | `validate` 失败，或 `profile_accepts == False` |
| Plan 结构非法 | `validate_structure` 失败，或 `structure_ok == False` |
| 负 offset / offset 缺 ordering | `validate_structure` 失败，或 `structure_ok == False` |
| 标量 arity 非法（含 Lower/Length 非 1） | `validate_structure` 失败，或 `structure_ok == False` |
| 分组 Top N：key 非 grouping / target 未选择 / 缺 tie-breaker / `take` 越界 / 与全局分页或 ordering 组合 | `validate_structure` 失败，或 `structure_ok == False` |
| computed aggregate：未知操作数 / 循环依赖 / alias 冲突 | `validate_structure` 失败，或 `structure_ok == False` |
| HAVING：`Ref` 非已投影 aggregate/computed、未知 alias；`Call` 的 arg/filter 引用未知 alias | `validate_structure` 失败，或 `structure_ok == False` |
| 相关聚合 EXISTS：pairs 为空 / inner 列非本 source / outer 列非主 alias / inner alias 遮蔽主 alias / 内层 grouping/HAVING 引用未知列 / HAVING 使用 `Ref` measure | `validate_structure` 失败，或 `structure_ok == False` |
| count_groups：内层 HAVING 引用未知列/别名 | `count_groups` 失败（`validate` 前），或 `structure_ok == False` |
| 派生 UNION ALL：derived 与物理 sources/joins/EXISTS 并存、空分支、列数为空/不一致、别名顺序不一致、重复/非法输出别名、派生 alias 遮蔽分支、外层引用未投影列 | `validate_structure` 失败，或 `structure_ok == False` |
| Join ON：条件引用未知 alias、`And`/`Or` 为空 | `validate_structure` 失败，或 `structure_ok == False` |
| JSON：Extract/Type arity 非 2、Valid arity 非 1、path 非字符串 Bind（列/计算表达式/Int/Float Bind/缺失） | `validate_structure` 失败，或 `structure_ok == False` |
| FILTER predicate 使用 profile 未允许的表达式 | `validate` 失败，或 `profile_accepts == False` |
| Profile 缺 JsonExtract / JsonType / JsonValid / Lower / Length | `validate` 失败，或 `profile_accepts == False` |
| Profile 缺 `Exists` / `Having` | `validate` 失败，或 `profile_accepts == False` |
| Profile 递归收窄嵌套体（count_groups 内层、相关聚合 EXISTS 内层、派生 UNION ALL 每个分支）：缺 Aggregate/Group/Having/Exists/Filter operator、缺 `allowed_aggregates` 中函数或缺内层 scalar | `count_groups`/`validate` 失败，或 `profile_accepts == False` |
| SQLite 转换失败 | `transform_sqlite` 失败 |

失败通过 Telora Host 的带外诊断表达。QueryBuilder 不返回部分 Query，也不接受
预渲染 SELECT/JOIN/GROUP BY/HAVING/EXISTS 片段。本实现只具体化 SQLite；不提供
任意子查询、CTE、多后端插件协议或 `Bytes` binding。join 条件是结构化的
列等值/`And`/`Or` 组合；EXISTS 只用于结构化的相关存在性过滤。

## 验证

在资产根目录运行：

```bash
./bin/telora -C ontology check @src/query
./bin/telora -C ontology test query
```

`tests/query.telora` 覆盖 profile、结构、规范顺序、Top N、首词分组 lowering、分页
（SQL/bindings/offset 安全约束）、分组内 Top N（row_number 子查询、bindings、
profile、tie-breaker 拒绝）、filtered/computed aggregates（FILTER lowering、计算
聚合 arithmetic、computed 参与 ordering、computed 与分组 Top N 组合、未知操作数与
循环依赖拒绝）、SQLite JSON1 v1（projection/filter/grouping/ordering 与 partition
ordering 的 path binding 顺序、path 不进入 SQL 文本、profile 覆盖）、P0 新能力
（HAVING lowering/profile、Lower/Length 大小写归一与动态值不内联、EXISTS 半连接
无 JOIN fan-out 与 profile、角色化/复合 ON Join）、嵌套聚合（count_groups 对满足
HAVING 的组计数、相关聚合 EXISTS 的 group/having 与 base-grain 保持）、派生
UNION ALL 关系（多来源合并为具名 source，外层分组/聚合/分区 Top 1 完整 SQL 形状、
参数分支与 HAVING/过滤的固定 binding 顺序与确定性、profile 递归与非法结构拒绝）、
多关系组合的确定性 SQL/bindings 顺序、JSON codec，并验证 JSON path、HAVING
measure、EXISTS 相关引用、空 Join 条件、count_groups 内层未知列、相关聚合 EXISTS
内层未知 grouping、派生 UNION 列集不一致/外层引用未投影列等非法 Plan 只产生诊断。
测试还包含相同契约的逐项断言，包括
`Instr`/`If`/`Add`/`Sub`/`Lower`/`Length` arity 拒绝、offset 缺 ordering
拒绝、负 offset 拒绝、分组 Top N 的成功与拒绝场景、filtered/computed aggregates
的成功与拒绝场景、HAVING 的成功与拒绝（未投影 measure）场景、EXISTS 的成功与各类
非法引用拒绝场景、角色化 Join/复合 ON 的成功与非法 alias 拒绝场景、大小写归一的
contains/starts-with/ends-with/not-contains 确定性 lowering，以及 JSON 的成功场景
与拒绝场景（Extract/Type/Valid 错误 arity、非字符串 path、Profile 缺 scalar）。
paired-endpoint（`PeerCorr`/`exists_peer`）覆盖：两个内层 participant alias 的
correlated EXISTS 与两组端点交换分支 SQL/bindings、无外层 JOIN/fan-out、结构合法、
未知 hub 角色 alias/同端字段/不一致分支/跨 alias participant filter 拒绝、等值 key
跨 alias 合法、同实体 `origin.key <> peer.key` 身份证明与异构不加裸 key 不等、
operator/profile（缺 `Exists` 拒绝）、重复 lowering 逐字节一致与占位符/绑定数一致。
集合运算测试覆盖 `INTERSECT`/`EXCEPT`/`UNION` 的**裸可执行 compound-select** 精确
SQL（每个操作数含自己的 filter、bindings 从左到右拼接）、带 `GROUP BY` 操作数的
SQLite-valid 形状、`set_count` 的 derived-table 单层包裹、投影保持（无 helper 列）、
`set_ok` 拒绝本地 ordering/arity 不匹配等既有负向校验，以及重复 lowering 逐字节
一致。排序分组键标量比较测试覆盖：升/降序聚合 rank 的精确 SQL/bindings（含
`ORDER BY <agg> ASC/DESC LIMIT 1`）、内层 join 与 row filter 的确定性子句/绑定顺序、
外层无关投影逐字保持、profile 递归（缺内层 ordering aggregate 拒绝）、以及缺分组/
多 key/外层 alias 泄漏/内层未知列/非法标识符/未知 outer 引用/非比较算子的结构拒绝，
外加重复 lowering 与原生 NULL（无 `coalesce`）。新增能力都以领域无关 fixture 覆盖，
不写入任何 ICM/企业业务名。
