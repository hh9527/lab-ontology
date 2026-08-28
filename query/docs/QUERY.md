# QueryBuilder

本文档是 `query` crate 的使用指南与公共契约。QueryBuilder 接收结构化、
后端无关的 `Plan`，验证其结构和能力范围，并确定性地生成参数化 SQLite `Query`。

```telora
import "query/lib" as qb;
```

crate 内部可使用 `import "@src/lib" as qb;`。外部依赖者只使用 manifest 中的
crate 名，不依赖 `@src` 私有路径。

## 公共类型

### 值与 Query

```telora
@json.untagged
type Val = enum {
    'String(String),
    'Int(Int),
    'Float(Float),
    'Bool(Bool),
};

type Query = struct {
    sql: String,
    bindings: Array(Val),
};
```

`Val` 是动态绑定值的唯一载体。`Query.sql` 只含合法标识符、算子和 `?`；动态值
只进入 `bindings`，并与占位符按出现顺序一一对应。

### 表达式与聚合

```telora
type ColumnRef = struct { source: String, column: String };

type ScalarFunction = enum {
    'Substr, 'Instr, 'If, 'Add, 'Sub,
    'Eq, 'Ne, 'Lt, 'Le, 'Gt, 'Ge, 'And, 'Or, 'Not,
};
type ScalarCall = struct { function: ScalarFunction, args: Array(Expr) };
type Expr = enum {
    'Column(ColumnRef),
    'Bind(Val),
    'Scalar(ScalarCall),
};

type AggregateFunction = enum { 'Count, 'Sum, 'Avg, 'Min, 'Max };
type AggregateCall = struct {
    function: AggregateFunction,
    arg: Expr,
    distinct: Bool,
    filter: Option(Expr),
    alias: String,
};
type ComputedOp = enum { 'Add, 'Sub };
type ComputedAggregate = struct {
    op: ComputedOp,
    left: String,
    right: String,
    alias: String,
};
type SelectItem = enum { 'Expr(Expr), 'Aggregate(AggregateCall), 'Computed(ComputedAggregate) };
```

表达式 AST 是封闭的：`ScalarFunction` 是唯一函数词表，不存在 raw SQL fragment、
开放函数名/operator 或 identifier 逃逸通道。所有动态值仍通过 `'Bind(Val)` 进入
`?` 占位符，bindings 顺序确定。

`AggregateCall.filter` 是聚合自身的行级 predicate（SQLite
`FILTER (WHERE ...)`）；它只收窄该聚合的输入行，绝不会与全局 WHERE 合并成一个
AND。`'Computed(ComputedAggregate)` 是受限的计算聚合：对已声明 aggregate 的
alias 做 `'Add`/`'Sub` 算术组合。

> **公共破坏性契约**：`SelectItem` 新增 `'Computed` variant，以及 `ComputedOp`、
> `ComputedAggregate` 与 `aggregate_filtered`/`computed_aggregate`/`computed_item`
> 构造器均为公共契约的一部分。下游对 `SelectItem` 做穷尽 match 时必须处理
> `'Computed`，否则会因 non-exhaustive match 无法编译。

标量语义（与 SQLite 行为一致）：

| 函数 | 参数 | 语义 |
| --- | --- | --- |
| `'Substr` | 2 或 3 | `substr(value, start[, length])`；start 为 1-based |
| `'Instr` | 2 | `instr(haystack, needle)`：needle 首次出现的 1-based 位置，缺失为 `0` |
| `'If` | 3 | `CASE WHEN cond THEN then ELSE else END`；cond 非零为真，NULL 走 ELSE |
| `'Add` / `'Sub` | 2 | 整数算术，渲染为 `(a + b)` / `(a - b)` |
| `'Eq/'Ne/'Lt/'Le/'Gt/'Ge` | 2 | 比较运算 |
| `'And` / `'Or` | 2 | 逻辑运算 |
| `'Not` | 1 | 逻辑非 |

`'If`、`'Instr`、`'Add`、`'Sub` 属于 profile 的 `allowed_scalars`，并经过 arity
校验（`'If` 恰为 3，`'Instr`/`'Add`/`'Sub` 恰为 2）。computed expression 可以稳定
用于 projection、grouping 和 ordering。

### Plan

```telora
type Source = struct { alias: String, table: String };
type JoinKind = enum { 'Inner, 'Left };
type JoinCondition = struct { left: ColumnRef, right: ColumnRef };
type Join = struct { kind: JoinKind, source: Source, condition: JoinCondition };
type Ordering = enum { 'Asc, 'Desc };
type AggregateRef = struct { alias: String };
type OrderKey = enum { 'Expr(Expr), 'AggregateRef(AggregateRef) };
type OrderBy = struct { key: OrderKey, direction: Ordering };

type Plan = struct {
    revision: String,
    sources: Array(Source),
    projection: Array(SelectItem),
    filter: Option(Expr),
    joins: Array(Join),
    grouping: Array(Expr),
    ordering: Array(OrderBy),
    limit: Option(Int),
    offset: Option(Int),
    partition: Option(PartitionedTopN),
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

`partition` 是受限的分组内 Top N 阶段（见下文“分组内 Top N”）。

### 能力 Profile

```telora
type Operator = enum {
    'Source, 'Project, 'Column, 'Bind, 'Scalar, 'Aggregate,
    'Filter, 'Join, 'Group, 'Order, 'Limit, 'Offset, 'Partition,
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
| `transform_sqlite` | `Fn(Plan) -> Query` | 合法 Plan 确定性转换为 SQLite Query |
| `is_sql_identifier` | `Fn(String) -> Bool` | 检查 `^[A-Za-z_][A-Za-z0-9_]*$` |

常用纯构造函数：

| 函数 | 签名 |
| --- | --- |
| `column` | `Fn(String, String) -> Expr` |
| `column_ref` | `Fn(String, String) -> ColumnRef` |
| `bind_val` / `bind_string` / `bind_int` / `bind_float` / `bind_bool` | `Fn(...) -> Expr` |
| `scalar` | `Fn(ScalarFunction, Array(Expr)) -> Expr` |
| `substr` | `Fn(Array(Expr)) -> Expr` |
| `instr` | `Fn(Expr, Expr) -> Expr` |
| `scalar_if` | `Fn(Expr, Expr, Expr) -> Expr` |
| `add` / `sub` | `Fn(Expr, Expr) -> Expr` |
| `expr_item` | `Fn(Expr) -> SelectItem` |
| `aggregate` | `Fn(AggregateFunction, Expr, Bool, String) -> SelectItem` |
| `aggregate_filtered` | `Fn(AggregateFunction, Expr, Bool, Option(Expr), String) -> SelectItem` |
| `computed_aggregate` | `Fn(ComputedOp, String, String, String) -> ComputedAggregate` |
| `computed_item` | `Fn(ComputedOp, String, String, String) -> SelectItem` |
| `source` | `Fn(String, String) -> Source` |
| `join` | `Fn(JoinKind, Source, ColumnRef, ColumnRef) -> Join` |
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
        qb.aggregate('Count, qb.column("o", "id"), 'False, "order_count"),
    ],
    filter: 'Some(qb.scalar(
        'Gt,
        [qb.column("o", "amount"), qb.bind_float(100.0)],
    )),
    joins: [],
    grouping: [qb.column("o", "customer_id")],
    ordering: [
        qb.desc_aggregate("order_count"),
        qb.asc(qb.column("o", "customer_id")),
    ],
    limit: 'Some(5),
    offset: 'None,
    partition: 'None,
};

def profile: qb.PlanProfile = {
    allowed_operators: [
        'Source, 'Project, 'Column, 'Bind, 'Scalar, 'Aggregate,
        'Filter, 'Group, 'Order, 'Limit, 'Offset, 'Partition,
    ],
    allowed_join_kinds: [],
    allowed_aggregates: ['Count],
    allowed_scalars: ['Gt],
    allow_distinct: 'False,
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

bindings 为 `['Float(100.0), 'Int(5)]`。标识符和用户值在类型及转换路径上分离；
调用方不得 escape 后拼接动态值。

## 首词分组（first whitespace-delimited segment）

按 shell command 的第一个空白分隔片段分组，例如把 `./bin/telora -C query run main`
投影为 `./bin/telora`。目标语义只是“首个空白分隔片段”，不是完整 shell lexer。
用封闭原语 `'Instr`（查找）、`'If`（条件）与 `'Sub`/`'Substr`（截取）组合：

```telora
def first_token_expr: Fn(qb.Expr) -> qb.Expr = fn(command) {
    let sep: qb.Expr = qb.bind_string(" ");
    let pos: qb.Expr = qb.instr(command, sep);
    let found: qb.Expr = qb.scalar('Gt, [pos, qb.bind_int(0)]);
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
        qb.aggregate('Count, qb.column("c", "id"), 'False, "uses"),
    ],
    filter: 'None,
    joins: [],
    grouping: [first_token_expr(qb.column("c", "command"))],
    ordering: [qb.desc_aggregate("uses")],
    limit: 'Some(100),
    offset: 'None,
    partition: 'None,
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
- `offset` 对应新增的 `'Offset` operator，必须出现在 profile 的
  `allowed_operators` 中，否则 `profile_accepts` 拒绝。
- `limit` 是查询语义的一部分；有限结果不能作为“已覆盖全量”的证明。

```telora
def page: qb.Plan = {
    revision: "commands-page-2",
    sources: [qb.source("c", "commands")],
    projection: [
        qb.expr_item(first_token_expr(qb.column("c", "command"))),
        qb.aggregate('Count, qb.column("c", "id"), 'False, "uses"),
    ],
    filter: 'None,
    joins: [],
    grouping: [first_token_expr(qb.column("c", "command"))],
    ordering: [qb.desc_aggregate("uses"), qb.asc(qb.column("c", "command"))],
    limit: 'Some(100),
    offset: 'Some(100),
    partition: 'None,
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
        qb.aggregate('Count, qb.column("e", "id"), 'False, "event_count"),
    ],
    filter: 'Some(qb.scalar('Eq, [qb.column("e", "status"), qb.bind_string("failed")])),
    joins: [],
    grouping: [qb.column("e", "role"), qb.column("e", "command_head")],
    ordering: [],
    limit: 'None,
    offset: 'None,
    partition: 'Some(qb.partitioned_top_n(
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
- `'Partition` 必须出现在 profile 的 `allowed_operators` 中。

bindings 严格按 SQL 占位符真实顺序：内层 SQL 文本把 window 表达式放在 SELECT
列表中，因此顺序为 projection、隐藏列、window partition、window ordering、join、
global filter、grouping，最后是外层 `take`。同一个合法 Plan 总是生成逐字节相同的
SQL 与绑定顺序。

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
        qb.aggregate_filtered('Count, qb.column("e", "id"), 'False,
            'Some(qb.scalar('Eq, [qb.column("e", "type"), qb.bind_string("task_started")])),
            "started_count"),
        qb.aggregate_filtered('Count, qb.column("e", "id"), 'False,
            'Some(qb.scalar('Eq, [qb.column("e", "type"), qb.bind_string("task_completed")])),
            "completed_count"),
        qb.computed_item('Sub, "started_count", "completed_count", "outstanding"),
    ],
    filter: 'Some(qb.scalar('Eq, [qb.column("e", "year"), qb.bind_int(2024)])),
    joins: [],
    grouping: [qb.column("e", "role")],
    ordering: [qb.desc_aggregate("outstanding")],
    limit: 'None,
    offset: 'None,
    partition: 'None,
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
- v1 `'Add`/`'Sub` 使用 SQLite 原生数值与 NULL 语义：任一操作数为 NULL 则结果为
  NULL。`count`（含 FILTER）永不返回 NULL，因此计数净额总是定义良好；`sum` 等
  可能为 NULL 的聚合需按此语义理解，lowering 不自动插入 `coalesce`；
- v1 不支持除法、任意条件表达式、聚合内 ordering、新的 distinct filtered
  aggregate 语义或用户提供的 aggregate expression；
- ordering、全局分页与分组内 Top N 可以引用最终 computed aggregate；与分组内
  Top N 组合时按分区内 ordering 稳定排序。

## 验证与转换保证

结构校验覆盖：非空 sources/projection、合法标识符、source alias 引用、标量参数
个数、非负 Plan limit、非负 Plan offset、offset 存在时必须带非空 ordering、排序
聚合引用确实存在并已投影、分组内 Top N 的全部安全约束（partition key 是所选
grouping、ordering target 已选择、稳定 tie-breaker、`take` 在正上限内、不与全局
limit/offset/ordering 组合），以及 filtered/computed aggregate 约束（FILTER
predicate 合法、操作数解析到已声明 aggregate/computed、依赖无环、alias 唯一）。
`validate` 在此基础上检查所有算子、join kind、aggregate、scalar 和 distinct 是否
被 profile 接受。

`transform_sqlite` 使用固定子句顺序：

```text
SELECT ... FROM ... [JOIN ...] [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ?] [OFFSET ?]
```

没有显式 limit 的 offset 渲染为 `LIMIT -1 OFFSET ?`。bindings 严格遵循 SQL 中
`?` 的出现顺序：projection、join、filter、grouping、ordering、limit、offset。
分组内 Top N 把 window 表达式放在内层 SELECT 列表，因此绑定顺序为 projection、
隐藏列、window partition、window ordering、join、global filter、grouping、`take`
（与外层 `__q_rn <= ?` 对应）。
同一个合法 Plan 总是生成逐字节相同的 SQL 和 binding 顺序。
任何失败都不发布部分 Query。

算子集合的规范顺序为：

```text
Source, Project, Column, Bind, Scalar, Aggregate, Filter, Join, Group, Order, Limit, Offset, Partition
```

## JSON codec 边界

`@json.untagged` 只改变 `Val` 的 JSON 表示，Telora 内部仍使用封闭 variant：

| Telora `Val` | JSON |
| --- | --- |
| `'String("abc")` | `"abc"` |
| `'Int(3)` | `3` |
| `'Float(3.5)` | `3.5` |
| `'Bool(true)` | `true` |

```telora
import "std/codec" as codec;
import "std/result" as result;
import "std/value" { Value };

let encoded: Value = codec.encode(Value, query) |> result.unwrap;
let decoded: qb.Query = codec.decode(qb.Query, encoded) |> result.unwrap;
```

编码后的 Query 形状如下，不含 variant wrapper：

```json
{"bindings": [100.0, 5], "sql": "SELECT ... WHERE o.amount > ? ... LIMIT ?"}
```

解码时，JSON 整数字面量进入 `'Int`，带小数或指数的字面量进入 `'Float`。
JSON 文本不能保留整数值 Float 的身份：`'Float(3.0)` 紧凑编码可能是 `3`，再次
解码成为 `'Int(3)`；需要区分时应在上层输入约定中处理。

## 失败分类

| 来源 | 观察方式 |
| --- | --- |
| Profile 越界 | `validate` 失败，或 `profile_accepts == 'False` |
| Plan 结构非法 | `validate_structure` 失败，或 `structure_ok == 'False` |
| 负 offset / offset 缺 ordering | `validate_structure` 失败，或 `structure_ok == 'False` |
| 标量 arity 非法 | `validate_structure` 失败，或 `structure_ok == 'False` |
| 分组 Top N：key 非 grouping / target 未选择 / 缺 tie-breaker / `take` 越界 / 与全局分页或 ordering 组合 | `validate_structure` 失败，或 `structure_ok == 'False` |
| computed aggregate：未知操作数 / 循环依赖 / alias 冲突 | `validate_structure` 失败，或 `structure_ok == 'False` |
| FILTER predicate 使用 profile 未允许的表达式 | `validate` 失败，或 `profile_accepts == 'False` |
| SQLite 转换失败 | `transform_sqlite` 失败 |

失败通过 Telora Host 的带外诊断表达。QueryBuilder 不返回部分 Query，也不接受
预渲染 SELECT/JOIN/GROUP BY 片段。本实现只具体化 SQLite；不提供子查询、CTE、
多后端插件协议或 `Bytes` binding。join 条件是结构化的单对列等值关系。

## 验证

在资产根目录运行：

```bash
./bin/telora -C query run main
./bin/telora -C query run verify
./bin/telora -C query run invalid --best-effort
./bin/telora -C query check @test/query
./bin/telora -C query query exports @bin/main
```

`verify` 覆盖 profile、结构、规范顺序、Top N、首词分组 lowering、分页
（SQL/bindings/offset 安全约束）、分组内 Top N（row_number 子查询、bindings、
profile、tie-breaker 拒绝）、filtered/computed aggregates（FILTER lowering、计算
聚合 arithmetic、computed 参与 ordering、computed 与分组 Top N 组合、未知操作数与
循环依赖拒绝）、确定性和 JSON codec；`invalid` 验证未投影聚合
排序等非法 Plan 只产生诊断。`tests/query.telora` 覆盖相同契约的逐项断言，包括
`'Instr`/`'If`/`'Add`/`'Sub` arity 拒绝、offset 缺 ordering 拒绝、负 offset 拒绝，
分组 Top N 的成功与拒绝场景，以及 filtered/computed aggregates 的成功场景（互斥
事件类型条件计数、全局 filter 与聚合 filter 并存、computed 参与 ordering、computed
与分组 Top N 组合）与拒绝场景（未知操作数、循环依赖、alias 冲突、profile 拒绝
FILTER predicate）。
