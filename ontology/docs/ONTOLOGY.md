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

type PartitionRequest = struct {
    by: Array(String),   # 定义分区的维度 id
    take: Int,           # 每分区保留前 N 行（正整数，有上限）
};

type QueryRequest = struct {
    measures: Array(MeasureRequest),
    dimensions: Array(DimensionRequest),
    filters: Array(FilterRequest),
    ordering: Array(OrderRequest),
    limit: Option(Int),
    offset: Option(Int),
    partition: Option(PartitionRequest),
};
```

`id` 来自知识模型声明的封闭业务词汇。筛选按请求顺序以 `And` 组合；筛选维度
不必同时投影。排序目标必须是本请求已经选择的指标或维度。`limit` 存在时必须
是正整数。

`offset` 是可选的页面偏移：存在时必须是非负整数，并且只有当请求带有稳定、确定的
`ordering` 时才允许（否则原子失败）。`limit` 与 `offset` 一起降低为标准 Plan 的
`limit`/`offset`；有限结果属于业务查询语义，不能把有限行数或底层 `truncated=false`
解释为已覆盖全量的证明——需要遍历完整分组结果时必须显式分页。

`partition` 是受限的 Top Per Group 请求：对已按请求维度聚合的结果按 `by` 中的维度
分区，在每个分区内部按稳定 `ordering` 排序并保留前 `take` 行。`take` 必须是正上限
内的正整数；存在 `partition` 时不得同时使用全局 `limit` 或 `offset`（v1 组合原子
失败），也不会静默改变它们的含义。结果仍保留请求中的 partition 维度。全局 `limit`
与每分区 `take` 是不同语义：`limit` 截断全局结果，`take` 是每个分区各自的前 N 行；
不足 N 行的分区返回其全部行。

## 知识声明 API

领域作者用具名 struct 表达实体，用 property decorator 就近声明事实：

| provider | 位置 | 语义 |
| --- | --- | --- |
| `column(column)` | 字段 | 字段对应的物理列 |
| `key(value)` | 字段 | 实体 key 标记 |
| `measure(id, aggregate, requires)` | 字段 | 指标、聚合方式和额外必需实体 |
| `filtered_measure(id, aggregate, requires, predicate)` | 字段 | 带领域声明固有 predicate 的条件指标（可组合 fold） |
| `computed_measure(id, op, left, right)` | 字段 | 以已声明指标为依赖的受限计算指标（`'Add`/`'Sub`） |
| `dimension(id, authorized, filterable, ops, input_kinds)` | 字段 | 普通维度及其能力 |
| `computed_dimension(id, authorized, filterable, ops, input_kinds, build)` | 字段 | 从字段表达式构造的计算维度 |
| `json_dimension(id, authorized, filterable, ops, input_kinds, path)` | 字段 | 把被标注字段的物理 JSON 列按固定 path 声明为业务维度（可组合 fold） |
| `scope(predicates)` | 字段 | 维度成员的固有行范围（`Array(ScopePredicate)`，可组合 fold） |
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

`build` 可使用 query 的任意封闭标量，包括 `'Substr`、`'Instr`、`'If`、`'Add`、
`'Sub` 和比较/逻辑算子；标量 arity 由 query 校验。所有常量保持为 `Bind`，不会
成为预渲染 SQL。计算表达式可以稳定用于 projection、grouping、filtering 和
ordering（同一个 `Fn(qb.Expr) -> qb.Expr` 在多个子句复用，bindings 按子句顺序
各自计位）。

```telora
def head_builder: Fn(qb.Expr) -> qb.Expr = fn(col) {
    let sep: qb.Expr = qb.bind_string(" ");
    let pos: qb.Expr = qb.instr(col, sep);
    let found: qb.Expr = qb.scalar('Gt, [pos, qb.bind_int(0)]);
    let rest: qb.Expr = qb.sub(pos, qb.bind_int(1));
    qb.scalar_if(found, qb.substr([col, qb.bind_int(1), rest]), col)
};
```

### JSON-backed Dimension

`json_dimension` 把被标注字段的物理 JSON 列按固定 `path` 声明为业务 Dimension。
领域作者在 knowledge 声明时固定 path；动态 `QueryRequest` 只能选择/筛选/排序业务
Dimension id，不得携带 path、raw predicate、SQLite 函数名或 JSON 表达式。

```telora
@edsl.entity_source("devices", "d")
type Device = struct {
    @edsl.column("attributes_json")
    @edsl.json_dimension("DeviceChannel", flag_true, flag_true, eq_ops, text_kinds, "$.channel")
    @edsl.json_dimension("DeviceRetryCount", flag_true, flag_true, eq_ops, int_kinds, "$.retry.count")
    attributes_json: String,
    # ...
};
```

- path 通过 Query 的公共 `JsonExtract` 构造器成为 String binding（`?`），绝不成为
  SQL literal 或 identifier；JSON Dimension 复用现有 authorization、filterable、
  ops、input kinds、enum domain、scope、grain、relation path、grouping、ordering
  与 Top Per Group 检查。
- knowledge Profile 必须显式允许所使用的 JSON scalar：缺 `'JsonExtract` 的 Profile
  在 lowering 时原子失败。
- 同一 JSON Dimension 在 projection/grouping/filter/order 中重复 lowering 时保持
  确定性与正确 binding 顺序（顶层 `$.channel` 与嵌套 `$.retry.count` 均可用于授权
  选择、参数化筛选、分组、稳定排序，并可作为 Top Per Group 的 ordering/tie-breaker）。
- **SQL NULL 边界**：missing path 与 JSON null 都可能降低为 NULL；v1 不把它们伪装成
  空字符串，也不承诺自动 `coalesce`。

### 领域成员的固有 scope

`scope` 让一个维度成员声明其固有的行范围，调用者无需每次手工重复这组约束。
`ScopePredicate` 引用成员所属实体的规范字段索引：

```telora
type ScopePredicate = struct {
    field: Int,          # 成员所属实体的规范字段索引
    op: FilterOp,        # 'Eq / 'Ge / 'Le
    input: FilterInput,  # 'Text(...) / 'Number(...) / 'Int(...)
};
```

```telora
def head_scope: Array(edsl.ScopePredicate) = [{field: 1, op: 'Eq, input: 'Text("run")}];

type Trace = struct {
    @edsl.column("label")
    @edsl.computed_dimension("TraceHead", flag_true, flag_true, eq_ops, text_kinds, head_builder)
    @edsl.scope(head_scope)
    label: String,
    # ...
};
```

- 机制通用、可组合：`scope` 按 `Option(previous)` fold（多次标注追加），不硬编码
  具体实体、列名或值；scope 只引用成员自身实体上已声明的维度字段。
- 合并顺序确定：选中带 scope 的维度时，scope 谓词（按请求中的成员顺序、声明顺序）
  先于用户筛选（按请求顺序）以 `And` 组合；全部动态值保持参数化 `Bind`。
- 冲突原子失败：同实体同字段上互斥的 `Eq` 约束（scope 之间或 scope 与用户筛选
  之间取值不同）会使 lowering 原子失败；scope 引用未声明维度、未授权/不可筛选
  字段、不支持的操作或非法输入同样原子失败。
- scope 只在成员被请求选中时生效。

### 条件指标与计算指标（filtered & computed measures）

`filtered_measure` 让领域模型作者在既有聚合语义上附加一个固有 predicate：只有满足
predicate 的行计入该指标。predicate 复用 `ScopePredicate`（引用同一实体的已声明、
已授权且可筛选维度），并复用 enum value、operation、input kind 与 scope 校验。
固有 predicate 与用户全局 filters 保持各自语义：全局 filters 限定整个事实集，
固有 predicate 只通过查询的 `FILTER (WHERE ...)` 限定该指标自身，绝不展平成互相
冲突的全局 AND。

`computed_measure` 以已声明的指标（普通、条件或计算）为依赖，用受限 `'Add`/`'Sub`
组合聚合结果。依赖必须存在、已授权、grain 兼容且 relation path 兼容；依赖图必须
无环；alias 唯一无歧义。v1 只暴露 `'Add`/`'Sub`，不开放 raw SQL、任意函数、
用户算术表达式或除法。

```telora
def run_predicate: edsl.ScopePredicate = {field: 1, op: 'Eq, input: 'Text("run")};
def skip_predicate: edsl.ScopePredicate = {field: 1, op: 'Eq, input: 'Text("skip")};

type Trace = struct {
    @edsl.column("id")
    @edsl.key(flag_true)
    @edsl.measure("TraceCount", count_agg, requires_none)
    @edsl.filtered_measure("TraceRunCount", count_agg, requires_none, run_predicate)
    @edsl.filtered_measure("TraceSkipCount", count_agg, requires_none, skip_predicate)
    @edsl.computed_measure("TraceDelta", sub_op, "TraceRunCount", "TraceSkipCount")
    id: Int,
    # ...
};
```

- 两类指标均进入现有 knowledge preparation、authorization、grain、relation path、
  selection 与 ordering 机制，不另建旁路。
- 请求计算指标时，其传递依赖会自动进入 projection；最终计算指标可作为普通
  ordering 与 Top Per Group 分区内排序的目标（先完成 measure lowering 再分区排名）。
- 这是领域模型作者声明业务指标的能力，不是让最终调用者构造任意条件聚合。
- `'Add`/`'Sub` 使用 SQLite 原生数值与 NULL 语义；`count`（含 FILTER）永不返回
  NULL，计数净额总是定义良好，lowering 不自动插入 `coalesce`。
- 能力不按特定领域名称或数据形状硬编码：除 Trace 的 run/skip 互斥计数外，
  `@src/knowledge` 还以 Approval（审批状态 approved/rejected）演示同一套
  `filtered_measure`/`computed_measure`/lowering 公共路径，声明互斥条件计数及其
  `'Add`（`ApprovalTotal`）与 `'Sub`（`ApprovalNet`）组合。

### Top Per Group

`QueryRequest.partition` 让一次请求表达“每个业务分区各自取前 N 行”。语义顺序：
先应用 filters 与关系选择，再按请求维度聚合，随后在每个 partition 内部排序并保留
前 `take` 行；结果保留 partition 维度。

```telora
let request: edsl.QueryRequest = {
    measures: [{ id: "OrderAmount", subject: "analyst", input: 'All }],
    dimensions: [
        { id: "OrderRegion", subject: "analyst", input: 'None },
        { id: "OrderWeek", subject: "analyst", input: 'None },
    ],
    filters: [],
    ordering: [
        { target: 'Measure("OrderAmount"), direction: 'Desc },
        { target: 'Dimension("OrderWeek"), direction: 'Asc },
    ],
    limit: 'None,
    offset: 'None,
    partition: 'Some({ by: ["OrderRegion"], take: 2 }),
};
```

约束：

- partition 维度必须已选择、已授权、可分组且 grain 兼容；ordering 只能引用已选择
  的 Measure 或 Dimension。
- 必须稳定排序：ordering 至少覆盖所有非 partition Dimension 作为确定性 tie-breaker
  （computed Dimension 也可作为 tie-breaker）。
- `take` 必须是正上限内的正整数（`qb.max_partition_take`）。
- authorization、relation path、grain、computed dimension scope 与 filters 都在进入
  Top Per Group 阶段前完成；v1 不与全局 `limit`/`offset`/`ordering` 组合（原子失败，
  不静默改变语义）。
- lowering 只使用 query 的公共 `partition` 能力，不在 Ontology 拼接 SQL 或复制
  Query AST 内部实现。
- 全局 `limit` 与每分区 `take` 语义不同；不足 N 行的分区返回其全部行。

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
        'Filter, 'Join, 'Group, 'Order, 'Limit, 'Offset,
    ],
    allowed_join_kinds: ['Inner, 'Left],
    allowed_aggregates: ['Count, 'Sum, 'Avg, 'Min, 'Max],
    allowed_scalars: [
        'Substr, 'Instr, 'If, 'Add, 'Sub,
        'Eq, 'Ne, 'Lt, 'Le, 'Gt, 'Ge, 'And, 'Or, 'Not,
    ],
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
    offset: 'Some(5),
};

let plan: qb.Plan = edsl.lower(payload, request);
let query: qb.Query = qb.transform_sqlite(plan);
```

`lower` 依次解析并授权请求项，验证 grain，合并指标、维度和筛选所需实体，选择
安全关系路径，构造精确覆盖请求的 Plan，再用 payload 的 profile 校验。指标排序
降低为投影聚合引用，维度排序复用投影/分组表达式。成功结果是稳定 Plan；任一步
失败都通过 Telora `fail!` 产生带外诊断，不发布部分 Plan 或 Query。

分页：`offset` 与 `limit` 一起降低为标准 Plan 的 `limit`/`offset`，bindings 中
offset 位于 limit 之后。使用 `offset` 的请求必须带有稳定排序；`limit` 截断结果行
数、`offset` 跳过前若干行，二者都不等于“已覆盖全量”，上层必须显式分页遍历。

QueryBuilder 的 `Val` 使用 untagged JSON codec，因此 Query 编码后的 bindings 是
`["gold", 5]` 这样的原生 JSON 标量，不是 variant wrapper。

## 失败语义与边界

以下情况原子失败：未知 id、授权失败、缺失筛选能力、非法筛选输入、未知枚举值、
非正 limit、负 offset、缺稳定排序的 offset、互斥的 scope/filter 约束、scope 引用
非法字段或缺失能力、未请求的排序目标、grain 冲突、不安全或缺失路径、profile
越界，以及 Top Per Group、条件/计算指标与 JSON-backed Dimension 相关的非法组合：
未选择的 partition 维度、未请求的 partition 排序目标、非稳定 partition 排序、
非正或超上限的 `take`、partition 与全局 limit/offset 组合、条件指标 predicate
引用未授权/不可筛选/未知枚举值维度、计算指标未知依赖、依赖环、跨 grain 算术、
Profile 缺 `'JsonExtract` 时使用 JSON Dimension、选择未授权 JSON Dimension、
非法 JSON 筛选输入、按未请求 JSON Dimension 排序。诊断由 Host 机制承载；公共 API
不返回 Rejection 或诊断数组。

公共 Request、Plan、Query 和业务词汇均保持精确具名类型，不使用 `Any`、`Dyn` 或
进程内 TypeId 作为交换协议。eDSL 只负责知识到 Plan；`transform_sqlite` 是端到端
演示使用的 QueryBuilder 能力，不属于 eDSL API。

## 验证

在资产根目录运行：

```bash
./bin/telora -C ontology eval @src/bin/main:main
./bin/telora -C ontology eval @src/bin/verify:main
./bin/telora -C ontology check @src/bin/invalid
./bin/telora -C ontology check @test/ontology
./bin/telora -C ontology query exports @src/bin/main
```

`verify` 覆盖 property fold、关系选择、筛选与 Top N、绑定顺序、profile、重复
lowering 确定性、封闭枚举值域、封闭计算表达式（`'If`/`'Instr` 参与
projection/grouping/ordering）、分页（offset 降低与绑定顺序、确定性）、领域
scope（声明、合并顺序、参数化）、Top Per Group（每分区 Top 2、computed 维度
tie-breaker、与全局 limit/offset 不组合）、条件/计算指标（FILTER lowering、
依赖投影、计算指标参与普通与分区排序、全局 filter 与固有 predicate 分离、
非 Timeline 的 Approval 条件计数与 Add/Sub 组合）及 JSON-backed Dimension（顶层
与嵌套 path 的 projection/grouping/filter/order、path 参与 Top Per Group
tie-breaker、binding 顺序确定性）；`invalid` 展示非法请求不发布可信结果的诊断，
包括负 offset、缺排序 offset、scope/filter 冲突、partition 非法组合、计算指标
契约破坏（未知依赖、依赖环、跨 grain）、filtered Measure 非法 predicate（引用
未授权/不可筛选维度、不允许的 operation/input kind、enum 未知稳定值）与 JSON
Dimension 拒绝（Profile 缺 JsonExtract、未授权 JSON Dimension、非法筛选输入、
未请求排序目标）。
