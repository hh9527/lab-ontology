# EnterpriseKnowledge eDSL

本文档是 `ontology` crate 的使用指南与公共契约。企业知识作者可以只依靠本文档，
用 typed property 声明实体、指标、维度、枚举值域和关系，并把有类型查询请求
确定性地降低为 QueryBuilder `Plan`。

```telora
import "@src/edsl" as edsl;
import "query/lib" as qb;
```

外部 crate 通过其 manifest 中的依赖名导入 `query/lib`。`@src/edsl` 是
ontology crate 对领域模型作者提供的源码模块；示例知识位于 `@src/knowledge`。

## 公共请求类型

```telora
type MeasureInput = enum { 'All, 'Distinct };
type DimensionInput = enum { 'None };
type FilterInput = enum { 'Text(String), 'Number(Float), 'Int(Int) };
type FilterOp = enum { 'Eq, 'Ge, 'Le };
type OrderDirection = enum { 'Asc, 'Desc };
type OrderTarget = enum { 'Measure(String), 'Dimension(String) };

type MeasureRequest = struct { id: String, subject: String, input: MeasureInput };
type DimensionRequest = struct { id: String, subject: String, input: DimensionInput };
type FilterRequest = struct { id: String, subject: String, op: FilterOp, input: FilterInput };
type OrderRequest = struct { target: OrderTarget, direction: OrderDirection };

type QueryRequest = struct {
    measures: Array(MeasureRequest),
    dimensions: Array(DimensionRequest),
    filters: Array(FilterRequest),
    ordering: Array(OrderRequest),
    limit: Option(Int),
};
```

`id` 来自知识模型声明的封闭业务词汇。筛选按请求顺序以 `And` 组合；筛选维度
不必同时投影。排序目标必须是本请求已经选择的指标或维度。`limit` 存在时必须
是正整数。

## 知识声明 API

领域作者用具名 struct 表达实体，用 property decorator 就近声明事实：

| provider | 位置 | 语义 |
| --- | --- | --- |
| `column(column)` | 字段 | 字段对应的物理列 |
| `key(value)` | 字段 | 实体 key 标记 |
| `measure(id, aggregate, requires)` | 字段 | 指标、聚合方式和额外必需实体 |
| `dimension(id, authorized, filterable, ops, input_kinds)` | 字段 | 普通维度及其能力 |
| `computed_dimension(id, authorized, filterable, ops, input_kinds, build)` | 字段 | 从字段表达式构造的计算维度 |
| `entity_source(table, alias)` | 类型 | 实体的数据源和别名 |
| `relation(target, kind, from_field, to_field)` | 类型 | 到另一个实体的关系 |
| `enum_value(value, label)` | enum variant | 封闭值域的稳定值和展示标签 |

同一字段的同型 property 按 `Option(previous)` 顺序 fold：字段 property 取最后一项，
relation 追加到关系数组。关系字段索引是编译器规范化后的字段顺序（字段名排序，
从 0 开始），不是源码书写顺序。

### 实体、指标与维度

```telora
def flag_true: Bool = 'True;
def flag_false: Bool = 'False;
def no_types: Array(Type) = [];
def eq_ops: Array(edsl.FilterOp) = ['Eq];
def text_kinds: Array(edsl.FilterInputKind) = ['Text];

@edsl.entity_source("orders", "o")
@edsl.relation(Customer, 'Safe, 1, 0)
type Order = struct {
    @edsl.column("order_id")
    @edsl.key(flag_true)
    @edsl.measure("OrderCount", 'Count, no_types)
    order_id: Int,

    @edsl.column("customer_id")
    customer_id: Int,

    @edsl.column("amount")
    @edsl.measure("OrderAmount", 'Sum, no_types)
    amount: Float,

    @edsl.column("region")
    @edsl.dimension("OrderRegion", flag_true, flag_true, eq_ops, text_kinds)
    region: String,
};
```

指标的 natural grain 是其所在实体。一次请求中的多个指标必须 grain 兼容。
`measure(..., requires)` 可声明指标语义还需要哪些实体；这些实体也必须能从 base
grain 经安全路径到达。

`authorized` 控制维度的查询和投影授权，`filterable` 独立控制筛选能力。未授权
维度仍属于已知词汇，但用于查询、排序或筛选时会报告缺失 capability，而不是
unknown。

计算维度的 `build` 是 `Fn(qb.Expr) -> qb.Expr`：

```telora
def month_builder: Fn(qb.Expr) -> qb.Expr = fn(col) {
    qb.substr([col, qb.bind_int(1), qb.bind_int(7)])
};
```

动态常量保持为 `Bind`，不会成为预渲染 SQL。

### 封闭枚举值域

```telora
type CustomerTier = enum {
    @edsl.enum_value("gold", "Gold customer")
    'Gold,
    @edsl.enum_value("silver", "Silver customer")
    'Silver,
    @edsl.enum_value("bronze", "Bronze customer")
    'Bronze,
};

type Customer = struct {
    @edsl.column("tier")
    @edsl.dimension("CustomerTier", flag_true, flag_true, eq_ops, text_kinds)
    tier: CustomerTier,
};
```

具名、无 payload 的 enum 被普通 `dimension` 用作字段类型时形成封闭值域。
省略 `enum_value` 的 variant 使用 variant 名作为稳定值和标签。`build_root` 将
目录发布到 `DimensionEntry.values`，消费者也可调用
`dimension_domain(payload, id)`。重复稳定值、带 payload variant、未知筛选值、
范围操作或非文本枚举输入都会失败。String、Int、Float 维度保持开放值域。

### 关系与安全路径

`'Safe` 关系不扩张当前 grain；`'FanOut` 会扩张 grain。准备阶段对实体图计算
确定性安全路径：最短边数优先，同长度按关系目录索引序列选择，最大深度为 8。
多个目标按请求顺序合并并复用已有边。只有全 Safe 路径能进入 Plan；fan-out-only、
不可达或被深度截断的目标都使请求失败。

## 准备知识

```telora
def profile: qb.PlanProfile = {
    allowed_operators: [
        'Source, 'Project, 'Column, 'Bind, 'Scalar, 'Aggregate,
        'Filter, 'Join, 'Group, 'Order, 'Limit,
    ],
    allowed_join_kinds: ['Inner, 'Left],
    allowed_aggregates: ['Count, 'Sum, 'Avg, 'Min, 'Max],
    allowed_scalars: ['Substr, 'Eq, 'Ne, 'Lt, 'Le, 'Gt, 'Ge, 'And, 'Or, 'Not],
    allow_distinct: 'True,
};

def authorize: Fn(String) -> Bool = fn(subject) { subject == "analyst" };

def payload: edsl.PreparedPayload = edsl.build_root(
    "enterprise-v1",
    [Order, Customer],
    profile,
    authorize,
);
```

`build_root(revision, entity_types, profile, authorize)` 显式收集所列实体的 property，
建立索引，验证关系图，预计算路径并返回 `PreparedPayload`。payload 含实体、指标、
维度、枚举目录、关系、路径矩阵、profile 和普通 closure。业务 lowering 只消费
payload，不重新扫描 metadata 或执行 BFS。

```telora
type PreparedPayload = struct {
    revision: String,
    entities: Array(EntityEntry),
    measures: Array(MeasureEntry),
    dimensions: Array(DimensionEntry),
    relations: Array(RelationEntry),
    paths: Array(Array(PathResult)),
    profile: qb.PlanProfile,
    authorize: Fn(String) -> Bool,
};
```

## 请求与 Lowering

```telora
let request: edsl.QueryRequest = {
    measures: [{ id: "OrderCount", subject: "analyst", input: 'All }],
    dimensions: [{ id: "CustomerTier", subject: "analyst", input: 'None }],
    filters: [
        { id: "CustomerTier", subject: "analyst", op: 'Eq, input: 'Text("gold") },
    ],
    ordering: [
        { target: 'Measure("OrderCount"), direction: 'Desc },
        { target: 'Dimension("CustomerTier"), direction: 'Asc },
    ],
    limit: 'Some(5),
};

let plan: qb.Plan = edsl.lower(payload, request);
let query: qb.Query = qb.transform_sqlite(plan);
```

`lower` 依次解析并授权请求项，验证 grain，合并指标、维度和筛选所需实体，选择
安全关系路径，构造精确覆盖请求的 Plan，再用 payload 的 profile 校验。指标排序
降低为投影聚合引用，维度排序复用投影/分组表达式。成功结果是稳定 Plan；任一步
失败都通过 Telora `fail!` 产生带外诊断，不发布部分 Plan 或 Query。

QueryBuilder 的 `Val` 使用 untagged JSON codec，因此 Query 编码后的 bindings 是
`["gold", 5]` 这样的原生 JSON 标量，不是 variant wrapper。

## 失败语义与边界

以下情况原子失败：未知 id、授权失败、缺失筛选能力、非法筛选输入、未知枚举值、
非正 limit、未请求的排序目标、grain 冲突、不安全或缺失路径、profile 越界。
诊断由 Host 机制承载；公共 API 不返回 Rejection 或诊断数组。

公共 Request、Plan、Query 和业务词汇均保持精确具名类型，不使用 `Any`、`Dyn` 或
进程内 TypeId 作为交换协议。eDSL 只负责知识到 Plan；`transform_sqlite` 是端到端
演示使用的 QueryBuilder 能力，不属于 eDSL API。

## 验证

在资产根目录运行：

```bash
./bin/telora run main -C ontology
./bin/telora run verify -C ontology
./bin/telora run invalid -C ontology --best-effort
./bin/telora check @test/ontology -C ontology
./bin/telora query exports @bin/main -C ontology
```

`verify` 覆盖 property fold、关系选择、筛选与 Top N、绑定顺序、profile、重复
lowering 确定性及封闭枚举值域；`invalid` 展示非法请求不发布可信结果的诊断。
