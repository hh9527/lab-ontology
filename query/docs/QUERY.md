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
    'Substr, 'Eq, 'Ne, 'Lt, 'Le, 'Gt, 'Ge, 'And, 'Or, 'Not,
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
    alias: String,
};
type SelectItem = enum { 'Expr(Expr), 'Aggregate(AggregateCall) };
```

`Substr` 接受 2 或 3 个参数。`Eq/Ne/Lt/Le/Gt/Ge/And/Or` 是二元运算，`Not`
是一元运算。所有动态参数都必须是 `'Bind(Val)`。

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
};
```

`revision` 是随 Plan 保留的不透明版本。`AggregateRef` 必须引用 projection 中聚合
项的 alias；转换时渲染完整聚合表达式，而不是把 alias 当作列名。

### 能力 Profile

```telora
type Operator = enum {
    'Source, 'Project, 'Column, 'Bind, 'Scalar, 'Aggregate,
    'Filter, 'Join, 'Group, 'Order, 'Limit,
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
| `expr_item` | `Fn(Expr) -> SelectItem` |
| `aggregate` | `Fn(AggregateFunction, Expr, Bool, String) -> SelectItem` |
| `source` | `Fn(String, String) -> Source` |
| `join` | `Fn(JoinKind, Source, ColumnRef, ColumnRef) -> Join` |
| `asc` / `desc` | `Fn(Expr) -> OrderBy` |
| `asc_aggregate` / `desc_aggregate` | `Fn(String) -> OrderBy` |
| `order_by` | `Fn(OrderKey, Ordering) -> OrderBy` |

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
};

def profile: qb.PlanProfile = {
    allowed_operators: [
        'Source, 'Project, 'Column, 'Bind, 'Scalar, 'Aggregate,
        'Filter, 'Group, 'Order, 'Limit,
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

## 验证与转换保证

结构校验覆盖：非空 sources/projection、合法标识符、source alias 引用、标量参数
个数、非负 Plan limit，以及排序聚合引用确实存在并已投影。`validate` 在此基础上
检查所有算子、join kind、aggregate、scalar 和 distinct 是否被 profile 接受。

`transform_sqlite` 使用固定子句顺序：

```text
SELECT ... FROM ... [JOIN ...] [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ?]
```

bindings 严格遵循 SQL 中 `?` 的出现顺序：projection、join、filter、grouping、
ordering、limit。同一个合法 Plan 总是生成逐字节相同的 SQL 和 binding 顺序。
任何失败都不发布部分 Query。

算子集合的规范顺序为：

```text
Source, Project, Column, Bind, Scalar, Aggregate, Filter, Join, Group, Order, Limit
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

`verify` 覆盖 profile、结构、规范顺序、Top N、确定性、绑定顺序和 JSON codec；
`invalid` 验证未投影聚合排序等非法 Plan 只产生诊断。
