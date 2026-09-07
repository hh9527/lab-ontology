# EnterpriseKnowledge eDSL

本文档是 `ontology` crate 的使用指南与公共契约。企业知识作者可以只依靠本文档，
用 typed property 声明实体、指标、维度、枚举值域和关系，并把有类型查询请求
确定性地降低为 QueryBuilder `Plan`。

```telora
import "@src/edsl" as edsl;
import "@src/query" as qb;
```

外部 crate 通过 `ontology/edsl` 和 `ontology/query` 导入公共模块。`@src/edsl`
是 ontology crate 内部使用的路径；受 test-root import 限制，共享测试知识暂位于
`@src/test_knowledge`，但不属于 ontology 公共 API。

## 从本体派生查询能力

领域 crate 只需要声明并构建 `PreparedPayload`。公共 `ontology/intent` 模块提供
`query_intent_lower_factory`，将 prepared 本体机械派生为封闭的 Intent lowering：

```telora
import "@src/model" { payload };
import "ontology/intent" { query_intent_lower_factory };
import "ontology/query" as qb;
import "std/value" { Value };

def lower_intent: Fn(Value) -> qb.Query =
    query_intent_lower_factory(payload, "resolver");
```

第一个参数是领域本体经 `build_root` 验证和预计算后的值；第二个参数是执行上下文提供的
授权主体，不是领域查询规则。返回函数只接受使用稳定 measure、dimension、entity id 的
业务 Intent，并依据本体中的 source、column、grain、relation、capability 和授权信息生成
参数化 `Query`。领域不需要另写关系选择、聚合规划、投影整理或 SQL 生成代码。

当前封闭 Intent 协议覆盖 `list`、`count`、`aggregate`、`top`、`distinct`、`exists`、
`absence`、`set`、`compare` 与 `ranked`。未知操作、非法组合、未知或未授权 vocabulary、
不唯一关系路径以及不兼容 grain 都原子失败，不产生部分 Query。同一 payload、subject 和
Intent 的重复 lowering 必须得到逐值相同的 SQL 与 bindings。

`tests/intent.telora` 使用 ontology 自带知识模型验证跨模型派生；领域测试只需把自己的
payload 交给同一 Factory。新增查询形状应扩展公共封闭协议和通用 lowering，不应在领域
crate 中增加查询分支。模型无法表达某项业务语义时，应扩充本体 property，而不是以领域
`query.telora` 补写程序。

## 公共请求类型

```telora
type MeasureInput = enum { All, Distinct };
type DimensionInput = enum { None };
type FilterInput = enum { Text(String), Number(Float), Int(Int) };
type FilterOp = enum {
    Eq, Ne, Gt, Ge, Lt, Le,
    Contains, NotContains, StartsWith, EndsWith,
};
type OrderDirection = enum { Asc, Desc };
type OrderTarget = enum { Measure(String), Dimension(String) };

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

# 封闭 OR-group：维度值属于任一给定值即匹配（lowering 为 query 的 `Or(Eq(...))`）。
# 经 `lower_any(payload, request, any_of, exists, having)` 与普通 AND 条件合并。
type AnyOfRequest = struct {
    id: String,
    subject: String,
    values: Array(FilterInput),
};
```

`AnyOfRequest` 复用普通 `FilterRequest` 的 AND 列表兼容性：它在降低后作为单个
`Or(Eq(...))` 项追加到 scope/AND 条件之后，组内值按请求顺序进入 bindings；空组、
未知/未授权维度、非法值类型或维度不支持 Eq 都原子失败，不发布部分 Plan。

存在性过滤与分组谓词是独立的有类型请求参数，通过 `lower_full` 与基础
`QueryRequest` 一起降低：

```telora
type ExistsRequest = struct {
    target: String,        # 稳定实体 id（见 `entity_id`）
    subject: String,
    filters: Array(FilterRequest),   # 相关实体行上的附加条件（AND）
    any_of: Array(AnyOfRequest),     # 相关实体行上的 OR-group（约束 EXISTS 内层）
    min_matches: Option(Int),        # Some(n)：至少 n 条匹配相关行（相关聚合 EXISTS）
};

type HavingOp = enum { Eq, Ne, Gt, Ge, Lt, Le };
type HavingRequest = struct {
    measure: String,       # 本请求已选择的指标 id
    subject: String,
    op: HavingOp,
    threshold: FilterInput,
};

# Paired-endpoint (peer) 请求：hub base 行的两个互斥端点分别由两个 participant
# 占据时才保留该 hub 行（见“配对的 peer 路线”）。`PeerRef` 由 `entity` 声明
# participant（经 prepare 的 peer route 源/表本身就是已验证身份/类型约束），可选
# 携带精确 key 与零个或多个只引用自身 participant 实体的属性过滤。
type PeerRef = struct {
    entity: String,          # participant 稳定实体 id（entity-only 合法）
    key: Option(FilterInput),# 可选精确 key 值（动态绑定；与属性过滤在该 alias 内 AND）
    filters: Array(FilterRequest),  # 仅引用自身 participant 实体的属性过滤（请求顺序）
};
type PeerRequest = struct {
    subject: String,
    origin: PeerRef,
    peer: PeerRef,
};
```

`lower(payload, request)`、`lower_full(payload, request, exists, having)` 与
`lower_any(payload, request, any_of, exists, having)` 都接受 `QueryRequest`；
`lower_full` 额外降低存在性过滤与分组谓词，`lower_any` 再叠加 subject 的 OR-group，
`lower_peer(payload, request, peers)` 再叠加 paired-endpoint（peer）过滤，
`lower_absence(payload, request, absence, having)` 再叠加反相关存在（`NOT EXISTS`，
“没有匹配关联记录”），`lower_distinct(payload, request)` 返回互不重复的行级结果
（`SELECT DISTINCT`，`Query`）。
基础请求可以没有
`measures`：此时它是行级投影/列表请求（见下文“行级投影”）。
`lower_group_count(payload, request, having)` 返回“满足 HAVING 的分组个数”（嵌套形状
1，`count(1)` 于内层分组查询之上），请求必须选择指标与分组维度且不得指定
ordering/limit/offset/partition。

`id` 来自知识模型声明的封闭业务词汇。筛选按请求顺序以 `And` 组合；筛选维度
不必同时投影。聚合（含指标）请求的排序目标必须是本请求已经选择的指标或维度
（ORDER BY 引用分组表达式/已投影聚合 alias）；行级（无指标）请求把“投影”与
“排序”当作两个独立约束，可以按**任意已授权**、且经 base 安全路径可达的维度排序
——即使该维度不投影（C 不被迫出现在返回列）。`limit` 存在时必须是正整数。

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

`measures` 可以为空：当请求没有 `measures` 时，它是行级投影/列表请求（目标属性、
信息、列表），只投影维度属性、不引入虚构 COUNT 指标。此时必须至少选择一个
`dimensions`，base 实体取自第一个请求维度所属实体；其他被引用实体（投影维度、
筛选、排序、scope）必须经 base 的安全（不扩 grain）路径到达，fan-out 路径原子失败。
行级请求不允许 `partition`，排序目标只能是**已授权的维度**（可以不在投影中，见上文
“投影与排序是两个不同约束”），`limit`/`offset` 与授权/稳定排序规则照常生效。

筛选能力与 `FilterOp` 词表：比较算子 `Eq`/`Ne`/`Gt`/`Ge`/`Lt`/`Le` 降低到
query 的封闭比较 scalar；文本算子 `Contains`/`StartsWith`/`EndsWith`（大小写
不敏感）与 `NotContains`（大小写敏感）通过 query 的封闭 `Instr`/`Lower`/
`Length`/`Substr`/`Add`/`Sub` 词表表达。所有运行期值始终作为参数化 Bind 进入
bindings，绝不进入 SQL 文本。维度通过 `ops`/`input_kinds` 声明允许的算子与输入类型；
文本算子要求 `Text` 输入。封闭 enum 值域仍只支持 `Eq`。

## 知识声明 API

领域作者用具名 struct 表达实体，用 property decorator 就近声明事实：

| provider | 位置 | 语义 |
| --- | --- | --- |
| `column(column)` | 字段 | 字段对应的物理列 |
| `key(value)` | 字段 | 实体 key 标记 |
| `measure(id, aggregate, requires)` | 字段 | 指标、聚合方式和额外必需实体 |
| `filtered_measure(id, aggregate, requires, predicate)` | 字段 | 带领域声明固有 predicate 的条件指标（可组合 fold） |
| `computed_measure(id, op, left, right)` | 字段 | 以已声明指标为依赖的受限计算指标（`Add`/`Sub`） |
| `dimension(id, authorized, filterable, ops, input_kinds)` | 字段 | 普通维度及其能力 |
| `computed_dimension(id, authorized, filterable, ops, input_kinds, build)` | 字段 | 从字段表达式构造的计算维度 |
| `json_dimension(id, authorized, filterable, ops, input_kinds, path)` | 字段 | 把被标注字段的物理 JSON 列按固定 path 声明为业务维度（可组合 fold） |
| `scope(predicates)` | 字段 | 维度成员的固有行范围（`Array(ScopePredicate)`，可组合 fold） |
| `entity_source(table, alias)` | 类型 | 实体的数据源和别名 |
| `union_source(alias, branches)` | 类型 | 联合（多来源）实体：有序物理分支 UNION ALL（与 `entity_source` 互斥） |
| `entity_id(id)` | 类型 | 实体的稳定业务 id（供存在性过滤/行级目标引用；缺省为 alias） |
| `relation(target, kind, from_field, to_field)` | 类型 | 到另一个实体的单列等值关系 |
| `relation_key(target, kind, key)` | 类型 | 带结构化键的关系：`Eq(RelationPair)`/`And`/`Or` 列等值组合 |
| `exists_route(via, target)` | 类型 | 显式声明有界两跳相关存在路径：base → `via`（唯一、grain-safe owner）→ `target`（可组合 fold） |
| `dual_hub(participant, key_field, left_field, right_field)` | 类型（hub 上） | 声明 hub 的两个角色化端点字段均引用 `participant` 的 `key_field`；base 命中任一角色即关联该 hub（可组合 fold） |
| `peer_hub(origin_participant, origin_key, origin_field, peer_participant, peer_key, peer_field)` | 类型（hub 上） | 声明同一 hub 行的 paired-endpoint 路线：两个角色字段分别引用两个 participant 的 key；同 participant 时允许端点交换（可组合 fold） |
| `enum_value(value, label)` | enum variant | 封闭值域的稳定值和展示标签 |

同一字段的同型 property 按 `Option(previous)` 顺序 fold：字段 property 取最后一项，
relation 追加到关系数组。关系字段索引是编译器规范化后的字段顺序（字段名排序，
从 0 开始），不是源码书写顺序。

### 实体、指标与维度

```telora
def flag_true: Bool = True;
def flag_false: Bool = False;
def no_types: Array(Type) = [];
def eq_ops: Array(edsl.FilterOp) = [edsl.FilterOp.Eq];
def text_kinds: Array(edsl.FilterInputKind) = [edsl.FilterInputKind.Text];

@edsl.entity_source("orders", "o")
@edsl.relation(Customer, edsl.RelationKind.Safe, 1, 0)
type Order = struct {
    @edsl.column("order_id")
    @edsl.key(flag_true)
    @edsl.measure("OrderCount", qb.AggregateFunction.Count, no_types)
    order_id: Int,

    @edsl.column("customer_id")
    customer_id: Int,

    @edsl.column("amount")
    @edsl.measure("OrderAmount", qb.AggregateFunction.Sum, no_types)
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

`build` 可使用 query 的任意封闭标量，包括 `Substr`、`Instr`、`If`、`Add`、
`Sub` 和比较/逻辑算子；标量 arity 由 query 校验。所有常量保持为 `Bind`，不会
成为预渲染 SQL。计算表达式可以稳定用于 projection、grouping、filtering 和
ordering（同一个 `Fn(qb.Expr) -> qb.Expr` 在多个子句复用，bindings 按子句顺序
各自计位）。

```telora
def head_builder: Fn(qb.Expr) -> qb.Expr = fn(col) {
    let sep: qb.Expr = qb.bind_string(" ");
    let pos: qb.Expr = qb.instr(col, sep);
    let found: qb.Expr = qb.scalar(qb.ScalarFunction.Gt, [pos, qb.bind_int(0)]);
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
- knowledge Profile 必须显式允许所使用的 JSON scalar：缺 `JsonExtract` 的 Profile
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
    op: FilterOp,        # Eq / Ge / Le
    input: FilterInput,  # Text(...) / Number(...) / Int(...)
};
```

```telora
def head_scope: Array(edsl.ScopePredicate) = [{field: 1, op: edsl.FilterOp.Eq, input: edsl.FilterInput.Text("run")}];

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

`computed_measure` 以已声明的指标（普通、条件或计算）为依赖，用受限 `Add`/`Sub`
组合聚合结果。依赖必须存在、已授权、grain 兼容且 relation path 兼容；依赖图必须
无环；alias 唯一无歧义。v1 只暴露 `Add`/`Sub`，不开放 raw SQL、任意函数、
用户算术表达式或除法。

```telora
def run_predicate: edsl.ScopePredicate = {field: 1, op: edsl.FilterOp.Eq, input: edsl.FilterInput.Text("run")};
def skip_predicate: edsl.ScopePredicate = {field: 1, op: edsl.FilterOp.Eq, input: edsl.FilterInput.Text("skip")};

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
- `Add`/`Sub` 使用 SQLite 原生数值与 NULL 语义；`count`（含 FILTER）永不返回
  NULL，计数净额总是定义良好，lowering 不自动插入 `coalesce`。
- 能力不按特定领域名称或数据形状硬编码：除 Trace 的 run/skip 互斥计数外，
  `@src/test_knowledge` 还以 Approval（审批状态 approved/rejected）演示同一套
  `filtered_measure`/`computed_measure`/lowering 公共路径，声明互斥条件计数及其
  `Add`（`ApprovalTotal`）与 `Sub`（`ApprovalNet`）组合。

### Top Per Group

`QueryRequest.partition` 让一次请求表达“每个业务分区各自取前 N 行”。语义顺序：
先应用 filters 与关系选择，再按请求维度聚合，随后在每个 partition 内部排序并保留
前 `take` 行；结果保留 partition 维度。

```telora
let request: edsl.QueryRequest = {
    measures: [{ id: "OrderAmount", subject: "analyst", input: edsl.MeasureInput.All }],
    dimensions: [
        { id: "OrderRegion", subject: "analyst", input: edsl.DimensionInput.None },
        { id: "OrderWeek", subject: "analyst", input: edsl.DimensionInput.None },
    ],
    filters: [],
    ordering: [
        { target: edsl.OrderTarget.Measure("OrderAmount"), direction: edsl.OrderDirection.Desc },
        { target: edsl.OrderTarget.Dimension("OrderWeek"), direction: edsl.OrderDirection.Asc },
    ],
    limit: None,
    offset: None,
    partition: Some({ by: ["OrderRegion"], take: 2 }),
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
    Gold,
    @edsl.enum_value("silver", "Silver customer")
    Silver,
    @edsl.enum_value("bronze", "Bronze customer")
    Bronze,
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

`Safe` 关系不扩张当前 grain；`FanOut` 会扩张 grain。准备阶段对实体图按源实体运行
有界广度优先遍历（单源一次遍历记录到所有可达实体的路径；深度上限 8，关系目录索引序
确定性优先），只保存最短的确定性路径矩阵，不在热路径执行 BFS。多个目标按请求顺序
合并并复用已有边。只有全 Safe 路径能进入 Plan；fan-out-only、不可达或被深度截断的
目标都使请求失败。遍历成本按源实体受控：业务模型即使增加若干枢纽关系也不会使
prepare 耗尽求值燃料（`tests/ontology.telora` 内含较密 hub/leaf 关系图的燃料回归）。

关系键可以结构化：`relation(target, kind, from_field, to_field)` 是单列等值糖，
`relation_key(target, kind, key)` 接受 `RelationKey`，其中
`Eq(RelationPair)` 为单列等值，`And`/`Or`（非空）组合列等值
（`RelationPair.from` 是声明实体、`to` 是目标实体的规范字段索引）。复合/析取键降低
为 query 的 `join_on`/`on_eq`/`on_and`/`on_or` 结构化 ON 树，不引入 raw SQL。
同一物理表的角色（a/z 端、父子同表、双口径）以不同实体类型共享同一物理表建模：每个
角色是一个独立实体类型与 alias，relation 指向对应角色类型；这保持领域无关，不新增
ICM 专用关系类型。

## 联合实体（multi-source union）

`union_source(alias, branches)` 让一个逻辑实体由多个同 grain 物理来源组成；它与
`entity_source` 互斥。联合实体仍是一个普通 struct：其字段是逻辑字段，每个字段的
`@edsl.column` 给出该逻辑字段的稳定输出列名。每个分支通过
`columns: Array(UnionColumnDecl { field, column })` 把全部规范逻辑字段映射到该分支的
物理列（`field` 为规范字段索引，`column` 为该分支的物理列名；映射必须完整、不重复且
按字段索引升序）。`filter: Option(ScopePredicate)` 是该分支固定的行级过滤（`Eq`
over 一个逻辑字段），会解析到该分支映射后的物理列；不接受 raw SQL/Expr。

```telora
def merged_item_branch_a_cols: Array(edsl.UnionColumnDecl) = [
    { field: 0, column: "group_id" },
    { field: 1, column: "item_id" },
    { field: 2, column: "kind" },
    { field: 3, column: "owner_id" },
];
def merged_item_branch_b_cols: Array(edsl.UnionColumnDecl) = [
    { field: 0, column: "category_key" },
    { field: 1, column: "resource_key" },
    { field: 2, column: "kind" },
    { field: 3, column: "account_key" },
];
def merged_item_branches: Array(edsl.UnionBranchDecl) = [
    { table: "items_a", alias: "a", columns: merged_item_branch_a_cols, filter: None },
    { table: "items_b", alias: "b", columns: merged_item_branch_b_cols, filter: Some({ field: 2, op: edsl.FilterOp.Eq, input: edsl.FilterInput.Text("retail") }) },
];

@edsl.entity_id("merged_items")
@edsl.union_source("u", merged_item_branches)
type MergedItem = struct {
    @edsl.column("group_id")
    @edsl.dimension("ItemGroup", flag_true, flag_true, eq_ops, int_kinds)
    group_id: Int,
    @edsl.column("item_id")
    @edsl.key(flag_true)
    @edsl.measure("ItemCount", count_agg, no_requires)
    item_id: Int,
    # ...
};
```

`build_root`/prepare 校验联合实体：分支非空、逻辑字段列非空且不重复、每个分支映射完整
规范字段集一次且按升序、物理列/表/分支 alias/联合 alias 均为合法标识符、分支 alias
唯一且不与联合 alias 冲突、固定分支过滤为合法字段上的 `Eq`；映射缺失/重复/越界/
顺序错/非法物理列都原子失败。prepared 表示供热路径直接使用。请求 base 为联合实体时，
lowering 使用 query 已发布的 `derived_source`/`union_branch`/`union_column`：输出名
用联合逻辑列名，输入表达式用各分支映射后的物理列；Plan `sources` 为空、
`derived: Some(...)`、无 join/EXISTS；projection/filter/aggregate/grouping/HAVING/
ordering/partition 全部作用于联合逻辑 alias。动态值按“分支声明顺序后接外层表达式
顺序”进入 bindings；重复 lowering 逐字节确定。

边界：derived 外层不能携带物理 sources/joins/EXISTS。因此本轮联合实体只支持完全由
各分支直接投影出的同 grain 字段；需要额外 join/多跳关系的联合实体请求给出确定诊断，
不退化到任一单一分支。普通单 source 实体的 Plan/SQL/bindings 保持不变；profile 递归
收窄分支的 Source/Column/Bind/Scalar/Filter 与外层 Aggregate/Group/Having/Order/
Partition。

## 行级投影、存在性过滤、分组谓词

### 行级投影（列表/信息请求）

`measures` 为空时请求为行级投影：SELECT 只含维度属性，不引入虚构 COUNT 指标。

```telora
let list_request: edsl.QueryRequest = {
    measures: [],
    dimensions: [
        { id: "OrderRegion", subject: "analyst", input: edsl.DimensionInput.None },
        { id: "CustomerTier", subject: "analyst", input: edsl.DimensionInput.None },
    ],
    filters: [{ id: "OrderRegion", subject: "analyst", op: edsl.FilterOp.Contains, input: edsl.FilterInput.Text("east") }],
    ordering: [{ target: edsl.OrderTarget.Dimension("OrderRegion"), direction: edsl.OrderDirection.Asc }],
    limit: Some(25),
    offset: None,
    partition: None,
};
let plan: qb.Plan = edsl.lower(knowledge.payload, list_request);
```

规则：必须有维度；base 实体取第一个请求维度所属实体；被引用实体必须经 base 的
安全路径（fan-out 会放大行、原子拒绝）；不允许 `partition`；排序目标只能是维度；
`limit`/`offset` 照常；筛选与 scope 照常。文本筛选（`Contains`/`StartsWith`/
`EndsWith`/`NotContains`）保持参数化并降低到封闭的
`Instr`/`Lower`/`Length`/`Substr` 词表。

### 存在性过滤（EXISTS）

```telora
let request: edsl.QueryRequest = {
    measures: [{ id: "CustomerCount", subject: "analyst", input: edsl.MeasureInput.All }],
    dimensions: [],
    filters: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
};
let exists: edsl.ExistsRequest = { target: "orders", subject: "analyst", filters: [], min_matches: None };
let plan: qb.Plan = edsl.lower_full(knowledge.payload, request, [exists], []);
```

- `target` 是稳定实体 id（`entity_id`，缺省为 alias）；subject 需经授权。
- 一跳：目标与 base 之间只需一条已声明关系；方向由 `lookup` 推导：优先 base→target
  正向，缺失时使用 target→base 反向边（反向存在性）推导相关性，不要求模型复制反向
  图边。反向边不参与普通 join 路径闭包；同一对实体声明双向边也不会令 `build_root`
  耗尽燃料（路径搜索按访问集去环，Parent→Child 双向 fixture 通过）。
- 两跳（受控多跳）：当 base 与目标之间没有一跳关系时，lowering 使用作者在 base 上
  显式声明的 `@edsl.exists_route(via, target)` 路线（见下文“两跳相关存在”）。路线在
  prepare 时校验并存入 payload，热路径不做元数据扫描或 BFS；请求无需感知路线。
- fan-out 关系允许（存在性不放大主体 grain）。`min_matches: None` 时是普通相关
  EXISTS；`min_matches: Some(n)`（正整数）时是相关聚合 EXISTS：内层按相关性分组并
  `HAVING count(关联 id) >= n`，仍保持主体 grain（Parent 计数 + `exists child`/
  `child count >= n` 不被 Child 行放大；普通 fan-out join 仍原子拒绝）。
- 关系键必须是列等值合取（`Eq` 或 `And`）；析取键在 EXISTS 中原子拒绝；分组存在性
  要求单列合取键（一个 ColumnEq）。
- 内层 `filters` 只能引用目标实体维度，动态值进入 bindings；任何引用路径终点之外实体
  的内层筛选都原子失败。
- 当 measure 的 `requires` 实体恰好是 exists 目标时，该必需实体由相关存在谓词满足，
  不再生成 fan-out join；`Plan.joins` 不放大 subject measure。
- 未知实体、目标即 base、没有声明一跳关系或路线、内层引用非目标实体、非正整数
  `min_matches` 都原子失败。

### 两跳相关存在（declared bounded route）

KPI 事实或子部件往往不直接关联告警等稳定对象，而是经中间实体再关联（唯一 owner
或 link 实体）。Ontology 不猜测任意可达路径：作者在 base 实体类型上显式声明路线：

```telora
@edsl.entity_id("components")
@edsl.entity_source("components", "m")
@edsl.relation(Site, edsl.RelationKind.Safe, 1, 0)          # component.site_id -> site.id
@edsl.exists_route(Site, Alarm)            # 显式：base -> Site -> Alarm
type Component = struct {
    @edsl.column("id")
    @edsl.key(flag_true)
    @edsl.measure("ComponentCount", qb.AggregateFunction.Count, no_types)
    id: Int,
    @edsl.column("site_id")
    site_id: Int,
};
```

`exists_route(via, target)` 是 base 实体上的 type-level property，可多次标注（按声明
顺序 fold 追加）。prepare 时对每条路线做确定性校验并保存到 `PreparedPayload.routes`：

- 第一跳 base → `via` 必须存在且**唯一**：base 上恰好一条声明到 `via` 的 forward 关系。
  关系缺失（反向-only 属于方向不匹配）、多条候选、同一 base 多条到达同一 target 的
  路线（歧义路径）都原子拒绝。
- 第二跳 `via` → `target` 使用已声明关系（任一方向，存在性语义允许 fan-out）；via 与
  target 之间关系缺失或存在多条候选关系都原子拒绝。

Lowering 依据第一跳的 kind 选择两种**封闭存在**形状，二者都只把整个 A→B→C 条件
表达为谓词：

- 第一跳 `Safe`（唯一 owner）：保持 owner-join 形状——base `INNER JOIN` via（不复制
  base 行），再用 correlated EXISTS 关联 owner 与 target 内层：

```text
SELECT count(m.id) AS ComponentCount
FROM components AS m
INNER JOIN sites AS s ON m.site_id = s.id
WHERE EXISTS (SELECT 1 FROM alarms AS al WHERE s.id = al.site_id [AND al.level = ?])
```

- 第一跳 `FanOut`（subject A 对 B 是 one-to-many）：改用 bounded **link** 形状——B
  与 C 在**同一个 correlated EXISTS 内相互 INNER JOIN**，绝不放 B/C 进外层 FROM，
  因此 one-to-many 首跳不会放大外层 A 的 grain：

```text
SELECT count(s.id) AS SubjectCount
FROM link_subjects AS s
WHERE EXISTS (SELECT 1 FROM link_owners AS b
              INNER JOIN link_targets AS c ON b.id = c.owner_id
              WHERE s.owner_id = b.id [AND c.level = ?])
```

- 永不为该 target 发射外层 fan-out join（`JOIN alarms`/`JOIN link_owners`），因此 base
  计数不被放大；同一 subject 有多个匹配 B/C 时外层仍只计一次。
- `Safe` owner-join 形状的 `min_matches`/内层 `any_of`/授权/profile 递归收窄与参数化
  绑定规则与一跳完全一致；`FanOut` link 形状 v1 不支持 `min_matches` 分组（确定性
  拒绝），内层 filter/any_of/授权/profile 收窄与绑定规则保持一致。
- 一跳直接/反向直接行为完全保留：未声明路线时按原有一跳逻辑解析。

### 双端 hub（dual-end hub union slice）

一个关系对象（hub）具有两个角色化端点：例如 `Pair` 行的 `left_member_id` 与
`right_member_id` 都引用 `Member` 的 key。**hub 是 base grain**，participant
（Member）是筛选 target：查询统计/列出按任一端 participant 筛选后的 hub，每个 hub
base 行天然只计一次（一行一 hub，不依赖未使用的去重键）。本切片只表达“单
participant 命中任一端”；“同一 hub 行的两个互斥端点分别由两个 participant 占据”
由下一节的 paired-endpoint（peer）路线显式表达，不用普通 Join 假装支持 peer。

```telora
@edsl.entity_id("pairs")
@edsl.entity_source("pairs", "pr")
@edsl.dual_hub(Member, 0, 2, 3)   # Pair.left_member_id = Member.id 或 Pair.right_member_id = Member.id
type Pair = struct {
    @edsl.column("id")            # 0: hub base grain key
    @edsl.key(flag_true)
    id: Int,
    @edsl.column("kind")          # 1: hub 属性
    kind: String,
    @edsl.column("left_member_id")   # 2: 左端角色
    left_member_id: Int,
    @edsl.column("right_member_id")  # 3: 右端角色
    right_member_id: Int,
};
```

prepare 校验（`build_root` 对首个问题确定性失败，无部分 payload）：

- 两个端点字段都必须在 hub 上、互不相同、在字段范围内（缺端/同端/越界拒绝）；
- participant 必须已登记、与 hub 不同，且被引用字段必须是 participant **声明的
  key**（非 key 字段或 participant 无 key 拒绝）；
- 同一 hub 对同一 participant 的重复声明（歧义）拒绝。
- 不要求、也不依据 hub 自身的稳定键作去重声明：hub base 行的一行一 hub 来自 base
  grain 的行契约；任何“稳定键去重”都只在使用它的 lowering 中发生。

lowering（`ExistsRequest` base = hub、target = participant）：hub 行只要任一角色命中
participant key 就保留，用**相关 union EXISTS**（Query 基础层的 `exists_union` 封闭
等值析取）生成：

```text
SELECT count(pr.id) AS PairCount
FROM pairs AS pr
WHERE EXISTS (SELECT 1 FROM members AS mb
              WHERE (pr.left_member_id = mb.id OR pr.right_member_id = mb.id)
                    [AND mb.kind = ?])
```

- 这是纯谓词：不产生 JOIN，hub base 行不被 fan-out 放大，每个 hub 行一次。
- 内层筛选引用 participant（筛选 target）维度，动态值继续参数化；绑定顺序与重复
  lowering 逐字节确定。
- `dual_hub` 仍只表达“单 participant 命中任一端”。一个 hub 可以**合法地为多类
  participant 声明** `dual_hub`（例如 PhysicalLink 的多种 participant 表）；prepare
  只拒绝同一 (hub, participant) 的重复声明。请求 lowering 不得把同一 hub 上的多个独立
  `dual_hub` constraints 解释为配对端点；要表达同一 hub 行上的两个互斥端点，必须使用
  下一节的显式 paired-endpoint（peer）路线。

### 配对的 peer 路线（paired-endpoint hub slice）

`peer_hub` 表达“同一 hub 行上两个互斥端点分别由两个 participant 占据”的语义。
hub 是 base grain；origin 与 peer 是两个**指定 participant**（`PeerRef {entity, key}`）。
只有 origin 命中一端、peer 命中另一端时 hub 行才保留；同一 hub 行、peer ≠ origin、
无同端匹配、无笛卡尔积、无 fan-out。

```telora
@edsl.entity_id("pairs")
@edsl.entity_source("pairs", "pr")
@edsl.dual_hub(Member, 0, 2, 3)
@edsl.peer_hub(Member, 0, 2, Member, 0, 3)  # 两个端点都引用 Member.key
type Pair = struct {
    @edsl.column("id")
    @edsl.key(flag_true)
    id: Int,
    @edsl.column("kind")
    kind: String,
    @edsl.column("left_member_id")
    left_member_id: Int,
    @edsl.column("right_member_id")
    right_member_id: Int,
};
```

prepare 校验（`build_root` 对首个问题确定性失败，无部分 payload）：

- origin/peer participant 必须已登记、与 hub 不同；被引用的 key 字段必须是该
  participant **声明的 key**（非 key 字段或 participant 无 key 拒绝）；
- 两个端点字段都必须在 hub 上、互不相同、在字段范围内（缺端/同端/越界拒绝）；
- 同一 hub 上同一 participant 对的重复/歧义 peer 路线拒绝；不同 participant 对（含
  多 participant 表）可各自声明 peer 路线；
- 两个端点引用同一 participant 实体与引用不同 participant 表都被支持；端点交换分支
  与实体是否“同名同表”无关（物理链路 A/Z 不是类型角色）。

请求与 lowering（`lower_peer(payload, request, peers)`）：Query 基础层用封闭的
`qb.PeerCorr`（`exists_peer`）把 **origin/peer 各自的内层 participant 表**与 hub
角色列放在同一个相关 EXISTS 中，并生成两组端点交换分支。Ontology 只按 prepared route
组装 origin/peer 的 table/alias、key 列、hub 角色列，并把每侧约束（可选精确 key 与
属性过滤）AND 到各自的 `origin_filter`/`peer_filter`（都留在同一个 correlated
EXISTS 内、绑定到各自独立 alias）：

```text
SELECT count(pr.id) AS PairCount
FROM pairs AS pr
WHERE EXISTS (SELECT 1 FROM members AS mb_o, members AS mb_p
              WHERE ((pr.left_member_id = mb_o.id AND pr.right_member_id = mb_p.id)
                     OR (pr.right_member_id = mb_o.id AND pr.left_member_id = mb_p.id))
                AND mb_o.kind = ? AND mb_p.kind = ?)
```

每侧 `PeerRef` 规则：

- `entity` 选择 prepared route 中的已声明 participant 实体/源表；entity-only
  （`key = None, filters = []`）合法，表示“该实体集合中的任意 participant”，不是无约束
  笛卡尔语义——两侧 alias 分别通过端点等式绑定到 hub 的相对角色；
- 可选精确 key（`key: Some(...)`）与零个或多个属性过滤（`filters`）可混用；同一侧
  key 与属性过滤在该 alias 内 AND（绑定顺序：该侧 key 先、属性过滤按请求顺序）；
- 属性过滤复用现有封闭 filter/operator/profile 词表与动态值绑定，只引用该 participant
  自身实体上的已授权、可筛选维度；引用其它实体、未知/未授权维度、非法算子或值都原子
  拒绝；
- 绑定顺序确定：origin 侧约束先、peer 侧约束后，每侧内部 key 先于属性过滤；重复
  lowering 逐字节一致。

能力边界与拒绝：

- 身份证明在 SQL 结构内：hub 端点值只经请求声明的 participant 表解释，跨表 key 碰撞
  不会把同一端点值同时解释为两种实体，也不会静默把两个 participant 配到同一端；
- **同实体身份不等**：origin/peer 是同一实体/表时，Query `PeerCorr` 的
  `distinct_keys=True` 会渲染并校验 `origin.key <> peer.key`，单个 participant 行不能
  同时占据 hub 两端（self-loop）；exact-key、attribute-only、key+attribute 一律适用。
  相同属性过滤值可合法表示两个不同、都满足该属性的 participant（SQL 含身份不等证明）。
  异构实体/不同表不增加裸 key 不等条件：两表相同 key 仍是不同身份，跨表 collision 继续
  合法；
- 两种端点交换分支对同类型与异构（不同表）participant 都生成；`dual_hub` 只表达单
  participant 命中任一端，不会把同一 hub 上两个普通 existence request 猜成 peer；
- 纯相关 EXISTS：不产生外层 participant JOIN、无 fan-out；
- 同实体同 key 的自配、未知 participant 实体、hub 没有覆盖该
  participant 对的 peer 路线、union 实体 base 都确定性拒绝；entity-only 合法；
  可用纯探针 `peer_request_ok(payload, hub_entity, request)` 断言可行/拒绝而不触发失败；
- peer 结果上的告警/KPI、二次聚合等未实现形状继续确定性拒绝。

### 分组计数（count of groups）

`lower_group_count(payload, request, having)` 对聚合/分组请求的“满足 HAVING 的组数”
计数（query 的嵌套形状 1）：

```telora
let group_request: edsl.QueryRequest = {
    measures: [{ id: "OrderAmount", subject: "analyst", input: edsl.MeasureInput.All }],
    dimensions: [{ id: "OrderRegion", subject: "analyst", input: edsl.DimensionInput.None }],
    filters: [],
    ordering: [],
    limit: None,
    offset: None,
    partition: None,
};
let having: edsl.HavingRequest = {
    measure: "OrderAmount", subject: "analyst", op: edsl.HavingOp.Ge, threshold: edsl.FilterInput.Number(100.0),
};
let query: qb.Query = edsl.lower_group_count(knowledge.payload, group_request, [having]);
```

返回 `count(1)` 于内层分组查询之上；阈值恒为参数化绑定。请求不得携带
ordering/limit/offset/partition，且必须同时选择指标与分组维度。

### 分组谓词（HAVING）

```telora
let having: edsl.HavingRequest = {
    measure: "OrderAmount",
    subject: "analyst",
    op: edsl.HavingOp.Ge,
    threshold: edsl.FilterInput.Number(100.0),
};
let plan: qb.Plan = edsl.lower_full(knowledge.payload, request, [], [having]);
```

- `measure` 必须已在本请求选择（投影聚合/计算聚合）；未请求引用原子失败。
- `threshold` 是动态标量，恒为尾部 `?` 绑定。
- 与全局 `limit`/`offset`/`ordering`、分组内 Top N、分页的组合边界由 query 统一
  校验；HAVING 与分组 Top N 组合时 HAVING 进入内层分组查询。
- 无 measure 的行级请求带 HAVING 原子失败（"having requires an aggregated measure"）。
- 使用 HAVING/EXISTS/Lower/Length 时，profile 的 `allowed_operators` 需含
  `Having`/`Exists`、`allowed_scalars` 需含所用 scalar（`Lower`/`Length` 等），
  否则 `qb.validate` 原子拒绝。

## 准备知识

```telora
def profile: qb.PlanProfile = {
    allowed_operators: [
        qb.Operator.Source, qb.Operator.Project, qb.Operator.Column, qb.Operator.Bind, qb.Operator.Scalar, qb.Operator.Aggregate,
        qb.Operator.Filter, qb.Operator.Exists, qb.Operator.Join, qb.Operator.Group, qb.Operator.Having, qb.Operator.Order,
        qb.Operator.Limit, qb.Operator.Offset, qb.Operator.Partition,
    ],
    allowed_join_kinds: [qb.JoinKind.Inner, qb.JoinKind.Left],
    allowed_aggregates: [qb.AggregateFunction.Count, qb.AggregateFunction.Sum, qb.AggregateFunction.Avg, qb.AggregateFunction.Min, qb.AggregateFunction.Max],
    allowed_scalars: [
        qb.ScalarFunction.Substr, qb.ScalarFunction.Instr, qb.ScalarFunction.If, qb.ScalarFunction.Add, qb.ScalarFunction.Sub, qb.ScalarFunction.Lower, qb.ScalarFunction.Length,
        qb.ScalarFunction.JsonExtract, qb.ScalarFunction.JsonType, qb.ScalarFunction.JsonValid,
        qb.ScalarFunction.Eq, qb.ScalarFunction.Ne, qb.ScalarFunction.Lt, qb.ScalarFunction.Le, qb.ScalarFunction.Gt, qb.ScalarFunction.Ge, qb.ScalarFunction.And, qb.ScalarFunction.Or, qb.ScalarFunction.Not,
    ],
    allow_distinct: True,
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
建立索引，验证关系图，校验相关存在路线，预计算有界路径并返回 `PreparedPayload`。
payload 含实体、指标、维度、枚举目录、关系、已声明路线（`routes`）、路径矩阵、
Safe 路径歧义矩阵（`ambiguous_paths`，供必须唯一选择路由的隐藏 join 使用）、
profile 和普通 closure。业务 lowering 只消费 payload，不重新扫描 metadata 或执行 BFS。

```telora
type PreparedPayload = struct {
    revision: String,
    entities: Array(EntityEntry),
    measures: Array(MeasureEntry),
    dimensions: Array(DimensionEntry),
    relations: Array(RelationEntry),
    routes: Array(RouteEntry),
    hub_routes: Array(HubRouteEntry),
    peer_routes: Array(PeerRouteEntry),
    paths: Array(Array(PathResult)),
    ambiguous_paths: Array(Array(Bool)),
    profile: qb.PlanProfile,
    authorize: Fn(String) -> Bool,
};
```

## 请求与 Lowering

```telora
let request: edsl.QueryRequest = {
    measures: [{ id: "OrderCount", subject: "analyst", input: edsl.MeasureInput.All }],
    dimensions: [{ id: "CustomerTier", subject: "analyst", input: edsl.DimensionInput.None }],
    filters: [
        { id: "CustomerTier", subject: "analyst", op: edsl.FilterOp.Eq, input: edsl.FilterInput.Text("gold") },
    ],
    ordering: [
        { target: edsl.OrderTarget.Measure("OrderCount"), direction: edsl.OrderDirection.Desc },
        { target: edsl.OrderTarget.Dimension("CustomerTier"), direction: edsl.OrderDirection.Asc },
    ],
    limit: Some(5),
    offset: Some(5),
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

## 从本体派生查询能力（query_intent_lower_factory）

`query_intent_lower_factory(payload, subject)` 只绑定一个已 prepare 的
`PreparedPayload` 与一个调用主体，机械派生封闭的 `Value -> Query` 能力：

```telora
import "@src/intent" { query_intent_lower_factory, query_intent_ok };

def payload: edsl.PreparedPayload = edsl.build_root(...);  # 唯一需要新领域作者声明的东西
def lower: Fn(Value) -> qb.Query = query_intent_lower_factory(payload, "analyst");
```

领域**不得**再写独立的查询程序补写自己的查询空间；新增领域只声明本体（`build_root`
模型 + profile + 授权），再加一个薄 Host 入口调用 Factory。Factory 的 Intent 解析、
结构校验、能力判断、关系规划、投影整理与 SQL 转换全部在 foundation 内完成；它不含
任何领域实体、字段、关系或值分支。Intent 值只引用**稳定 measure/dimension/entity
id** 与封闭算子词表，绝不携带表、列、alias、join 数组或 raw SQL/Expr。

```json
{ "op": "list", "measures": [], "dimensions": ["MemberKind"],
  "filters": [{"dimension": "MemberKind", "op": "eq", "kind": "text", "value": "staff"}],
  "ordering": [], "exists": [], "having": [], "limit": null, "offset": null }
```

### 支持形状（`op`）

| op | 语义 | 备注 |
| --- | --- | --- |
| `list` | 行级维度投影（可筛选/排序）；支持 field-to-field 谓词与 `output_order` | measureless；隐藏行排序允许 |
| `count` | 标量聚合摘要 + 筛选/existence/selected HAVING | `measures` 单/多个聚合无分组 |
| `aggregate` | 分组聚合 + 可选 ordering/limit/selected HAVING/existence | 可选 `hidden_having`（同源隐藏聚合 HAVING） |
| `top` | 分组 Top-N，按隐藏相关聚合排序（只返回组列） | 可选 `hidden_having`（related 隐藏 HAVING） |
| `distinct` | 互不重复的行级维度投影（SELECT DISTINCT） | |
| `exists` / `absence` | 保留 base 行/组存在（不存在）相关关联记录 | related existence/absence |
| `compare` | 行级列表 + 属性 vs 标量聚合比较 | `comparisons` |
| `ranked` | 外层明细行与隐藏 top/bottom 分组键比较 | `ranked` |
| `set` | 两个兼容投影的 union/intersect/except | `branches` |
| `set_count` | 集合之上的外层 count(1) | `branches` |

### 通用字段与规则

- `measures`/`dimensions` 是 id 字符串数组；`filters` 是**有序**数组；`ordering`
  是 target/id/direction 对象数组（`target` 为 `"Measure"` 或 `"Dimension"`）；
  `limit`/`offset` 是 null 或非负整数；`output_order` 是可选的投影 token 数组。字符串
  token 是行级维度的兼容简写；通用形式为 `{"kind":"dimension","id":...}` 或
  `{"kind":"measure","id":...}`，必须把请求中的 measure/dimension 各列恰好列出一次。
- `filters` 条目有两种封闭形式：
  - 标量：`{"dimension": id, "op": op, "kind": kind, "value": value}`；
  - field-to-field 谓词：`{"left": id, "op": op, "right": id}`（无 value；只允许
    `list` 形状；比较同一 subject 实体的两个纯列属性）。
- `exists`/`having` 用于相关存在/absence、selected HAVING；`hidden_having` 引用
  隐藏聚合 measure（`aggregate` 的同源隐藏 HAVING / `top` 的 related 隐藏 HAVING）。
- 隐藏排序/HAVING/辅助值**永不进入投影**；返回投影精确且可用 `output_order` 显式
  重排。重复 lowering 的 SQL/bindings 逐字节一致。
- 能力只有当 prepared 模型能证明该形状时才可用：不根据标识拼写推断业务含义，也不
  静默发明 measure/dimension/grouping/join/projection。
- 授权 subject 是执行上下文：Factory 每次 vocabulary 访问与嵌套子句都使用同一
  subject；`payload.authorize` 拒绝时原子失败。
- measure 的 aggregate input 是本体语义，不是 Intent 参数。`@edsl.measure(...)`
  声明固定 `All`；`@edsl.distinct_measure(...)` 声明固定 `Distinct`。两者都以独立、
  稳定的 measure id 暴露，Factory 按 id 从 `PreparedPayload` 读取 input；调用者不能把
  同一个业务 measure 临时切换为另一种语义。distinct measure 还必须通过
  `PlanProfile.allow_distinct` 的执行能力校验。
- 纯结构探针 `query_intent_ok(payload, subject, intent)`：未授权 subject、非对象
  Intent、未知 op/kind、请求字段类型错误、非 `list` 上的 field-to-field 谓词等都返回
  `False`，供绿色单元测试断言。它不判断 vocabulary、授权、grain 或路径可行性，不能
  当作完整的 `CanLower`；真实 lowering 才执行这些语义检查，并对失败形状原子
  `fail!`，不发布部分 Query。

## 失败语义与边界

以下情况原子失败：未知 id、授权失败、缺失筛选能力、非法筛选输入、未知枚举值、
非正 limit、负 offset、缺稳定排序的 offset、互斥的 scope/filter 约束、scope 引用
非法字段或缺失能力、未请求的排序目标、grain 冲突、不安全或缺失路径、profile
越界，以及 Top Per Group、条件/计算指标与 JSON-backed Dimension 相关的非法组合：
未选择的 partition 维度、未请求的 partition 排序目标、非稳定 partition 排序、
非正或超上限的 `take`、partition 与全局 limit/offset 组合、条件指标 predicate
引用未授权/不可筛选/未知枚举值维度、计算指标未知依赖、依赖环、跨 grain 算术、
Profile 缺 `JsonExtract` 时使用 JSON Dimension、选择未授权 JSON Dimension、
非法 JSON 筛选输入、按未请求 JSON Dimension 排序。相关存在失败还包括：目标即 base、
没有声明一跳关系或路线、两跳路线第一跳缺失/反向-only（方向不匹配）或非唯一
（多条候选）、`via`/`target` 之间缺失或多条候选关系、同一 base 对同一 target
声明多条路线、内层筛选引用路径终点之外的实体、EXISTS 键含析取、fan-out link 形状
使用 `min_matches` 分组。
distinct/absence 与行级排序的失败还包括：distinct 请求携带 measures、无维度、
组合 Top Per Group、按未投影/未知/未授权维度排序；反存在用于 union 实体 base；
行级排序目标是 measure 或未知/未授权维度；internal-top 请求携带 measures、无
分组维度、内部 measure 为计算指标/跨 base 实体（`lower_internal_top` 路径）/未知/
未授权，或维度 tie-breaker
不是已选维度。related aggregate（`lower_internal_related`）失败还包括：请求带
measures、无分组维度、分组维度不在主体实体（grain 无法证明）、关联 measure 为
computed/filtered、subject role 未授权、主体与聚合实体之间无可用有界路线
（missing）、存在多条等长最短路线（ambiguous）、filter 引用
非主体属性、HAVING threshold 类型与聚合不兼容。field-to-field 谓词失败还包括：未知/未授权/非纯列属性、跨实体属性
引用、两侧类型或 domain 不兼容、算子未被两侧支持或非比较算子。hidden same-source HAVING
（`lower_hidden_having`）失败还包括：请求非聚合（无 measure）或缺少分组维度、隐藏
measure 未知/未授权/位于其它实体、隐藏 measure 为 computed 或 filtered、HAVING
threshold 类型不兼容。attribute-versus-aggregate（`lower_attribute_compare`）失败还包括：
请求带 measures 或无列表维度、外层属性未知/未授权/computed/不属 base 实体、内层
measure 未知/未授权/computed/filtered、算子不受支持、两侧类型/domain 不兼容
（text-vs-number、enum-vs-number 等跨类别组合）。paired-endpoint（peer）失败还包括：同一 (hub, participant) 的重复 `dual_hub` 声明、
自配（同实体同 key 的 origin == peer）、未知 participant 实体、hub 没有覆盖该
participant 对的 peer 路线、peer 路线端点同字段/越界/引用非 key 字段、同一 hub 上
同一 participant 对的重复 peer 路线、union 实体 base 上的 peer 请求。把多个独立
`dual_hub` 请求约束当作配对端点使用不是受支持的形状，必须用显式 peer 路线。ranked
grouped-key（`lower_ranked_key_compare`）失败还包括：外层属性未知/未授权/computed、
外层属性所属实体只能经 **fan-out 路由**到达、经 **多条不同 Safe 路径（歧义路由）**
到达（绝不由声明顺序选择）、与 base **无已声明路由**、外层为 **derived（union）
Plan** 且父属性需要新增 join、分组维度未知/未授权/computed、外层属性与分组 key
类型/domain 不兼容、排名 measure 未知/未授权/computed/filtered/不在内层
population grain/`requires` 非空、scope filter 归属或输入错误；这些路由失败彼此
可区分（fan-out / 歧义 / 缺失 / derived-join），调用者据此修正意图或模型。
model-derived intent factory（`query_intent_lower_factory`）失败还包括：未授权
subject、非对象 Intent、未知 op / set kind / branch shape、请求字段类型错误、
未知/未授权词汇（measure/dimension/entity id）、field-to-field 谓词用于非
`list` 形状、field 谓词属性未知/未授权/非纯列/跨实体/类型或 domain 不兼容、
`aggregate` 的 `hidden_having` 与 selected having/existence 组合、missing/ambiguous
路径、grain 不兼容；全部原子失败、不发布部分 Query。诊断由
Host 机制承载；公共 API 不返回 Rejection 或诊断数组。

公共 Request、Plan、Query 和业务词汇均保持精确具名类型，不使用 `Any`、`Dyn` 或
进程内 TypeId 作为交换协议。eDSL 只负责知识到 Plan；`transform_sqlite` 是端到端
演示使用的 QueryBuilder 能力，不属于 eDSL API。

## 查询形状边界（spider 评估复核）

本轮明确以下通用形状的契约与用法。全部在封闭 Query eDSL 内表达：不开放 raw SQL、
任意 Expr、alias 或 Join 拼装；不加入 Spider 专用实体或字段；新表达保持确定性
SQL、确定性 bindings、可验证结构并明确拒绝边界。

1. **投影与排序是两个不同约束**。行级（无指标）请求可以只返回 A、B，却按已授权
   的维度 C 排序并取 Top N；C 不会被迫出现在返回列。若 C 属于另一个实体，则它经
   base 的安全路径 join 进入 FROM（fan-out 路径仍原子失败）。聚合请求仍要求排序
   目标必须是本请求已选择的指标/维度（否则 ORDER BY 无法引用分组表达式/已投影
   聚合 alias）。
2. **结果集 distinct（互不重复的维度行）**。`lower_distinct(payload, request)`
   把无指标、至少一个维度的行级请求降低为 `qb.transform_sqlite_distinct` 的
   `SELECT DISTINCT`：覆盖多维度、过滤、排序与 limit/offset 边界；不能被普通投影
   或 `count(distinct ...)` 替代。排序目标必须是已投影（已请求）维度（SQLite 的
   DISTINCT ORDER BY 规则）；不能与 Top Per Group 组合，也不能携带 measures。
3. **没有匹配关联记录的主体**。`lower_absence(payload, request, absence_specs,
   having)` 把每个 `absence_spec`（复用 `ExistsRequest` 的目标/主体/内层 filter/
   min_matches 词汇）降低为同一相关 body 的 `NOT EXISTS`。两跳路线仍只加
   grain-safe owner join；NULL 语义保持 SQL 原生；`plan.exists[i].negated` 为真。
   这是纯相关反存在：不产生外层 JOIN、不放宽相关引用，`Exists` operator 语义不变。
4. **分别存在满足 A 和 B 的关联记录**。用 `lower_full(payload, request, [specA,
   specB], [])` 表达两个**独立**的 correlated EXISTS（每个带各自内层 filter），在
   WHERE 中 AND 合并。两个谓词各自成立即可，A、B 可以由不同的关联行满足，绝不会
   被压成同一行上的 `A AND B`。
5. **跨关系只投影维度、不附加 measure**。行级请求的 base 实体取自第一个请求维度
   所属实体，其它实体的维度经安全路径 join 后投影；不引入虚构 COUNT，也不产生
   GROUP BY。fan-out 路径与任何会放大行的关系继续原子失败。
6. **返回列顺序是结果契约**。`QueryRequest` 分别承载 measures 与 dimensions；
   默认 lowering 的 projection 顺序为：请求的 measures（按请求顺序，含其传递依赖），
   随后是请求的 dimensions（按请求顺序）。需要跨类交错时调用方用
   `lower_ordered(payload, request, order)` 显式声明（见下文“显式投影顺序”）。

### Spider round 3：内部排序聚合与关系存在

**内部（未投影）排序聚合**。一个分组维度请求可以按“组内聚合结果”排序并取
Top N，却不返回该聚合值（例如按每组记录数选出最大组，只返回组名）。
`lower_internal_top(payload, request, internal_orders)`：`request` 只选择维度
（measures 为空），`internal_orders` 逐条命名一个**已授权、位于请求 base 实体上**
的普通/条件 measure 与其方向；该 measure 只作为 ORDER BY 的内部聚合（lowering 经
query 的 `OrderKey Aggregate` 表达），绝不出现在 projection。请求可携带筛选、
维度排序 tie-breaker（必须是已选维度）与 `limit`；`qb.validate` 用 payload profile
收窄内部聚合的 operator/aggregate/scalar。计算 measure、未知/未授权 measure 均
原子拒绝；`lower_internal_top` 只接受 base 实体的 measure，跨 base 实体（关联实体）
的隐藏聚合使用 `lower_internal_related`（见下文“跨关系隐藏聚合”）。

**沿（已声明）关系的存在/筛选并只返回主体维度**。relation-existence 本身不需要
link-count measure 来选择入口/路径：`lower_full(payload, request, exists, [])` 接受
行级（measures 为空）请求，存在谓词保持主体 grain——一跳（任意方向，fan-out
允许）与显式两跳 route 都只产生 correlated EXISTS/owner join（第一跳为 fan-out 时
用 bounded link 形状，B/C 在同一个 EXISTS 内互相 JOIN），projection 仍只是请求的
主体维度，不新增 COUNT 或 GROUP BY。fan-out 首跳路线不再被拒绝：它走 link 形状，
不会静默降级为外层 join；仍确定性拒绝非唯一/反向-only 首跳与 fan-out link 形状的
`min_matches`。

### 显式投影顺序（lower_ordered）

最终列顺序是结果契约。`lower_ordered(payload, request, order)` 用 `ProjectionToken`
（`Measure(id)` / `Dimension(id)`）显式声明所有已选择项的交错顺序：

- 每个 token 必须恰好对应一个**已请求**的 measure 或 dimension；
- 不允许遗漏、重复、引用隐藏计算或引用未选择项；
- `order` 为空时完全保留默认行为（`lower` 的 measure-then-dimension 顺序，兼容既有
  调用方）；
- 显式顺序只改变 SELECT 列序：过滤、分组、排序、bindings 与 grain 不变；
- 非法顺序产生稳定、可归因的 contract 诊断，不发布部分 Plan/Query；
- 计算 measure 的传递依赖仍按默认位置投影（不被 token 引用，也不从 projection 移除）。

### 跨关系隐藏聚合（related aggregate）

外层主体可以沿**恰好一条已 prepare、方向确定、授权且唯一的限定路线**，对关联实体
（聚合 population）计算聚合，并只把该聚合用于隐藏 ORDER BY/Top-N 或隐藏 HAVING，
不加入最终投影。路线由**已声明关系构成，长度至多两条**（主体 → 中间实体 →
聚合 population；一条关系即原有直接关系行为）。调用方只提供已授权 measure id、
subject 与 order/HAVING 字段——不暴露表、列、alias 或 join 数组。
`lower_internal_related(payload, request, internal_orders, internal_having)`：

```telora
# internal_orders / internal_having 引用同一个封闭“关联聚合 measure”：
# InternalOrderRequest {measure, subject, direction}
# InternalHavingRequest {measure, subject, op, threshold}
```

语义与约束：

- 请求只选主体维度（measures 为空），分组维度必须属于主体实体（否则无法证明主体
  grain，原子失败）；关联侧多行只参与聚合、绝不放大最终主体结果；
- 每个内部 measure 必须是已声明、已授权的**普通** measure（非 computed/filtered）；
  若 measure 位于关联实体，则主体到该实体必须存在**恰好一条可用的限定路线**：
  - 长度 1：正向或反向声明的一条直接关系（原有直接关系行为不变）；
  - 长度 2：主体 → 中间实体 → 聚合 population 的两条已声明关系（每跳可以是任一
    方向；路线上的 fan-out 方向允许，因为被到达的行全部由隐藏聚合消费，分组仍精确
    停在主体维度）；
  - route 的 join 按**确定性依赖顺序**物化（先到中间实体、再到聚合 population），
    同一 route 同时服务于隐藏 ORDER BY/Top-N 与隐藏 HAVING；join 按 source alias
    复用、不重复。
- 关联侧沿用封闭 aggregate 枚举（Count/Sum/Avg/Min/Max）；`lowering` 只把聚合作为
  `OrderKey Aggregate` / HAVING `Call` 使用，不出现特例 SQL；
- 隐藏 ORDER BY 支持升降序与 Top-N（`limit`）；隐藏 ORDER BY 本身不产生 binding；
- 隐藏 HAVING 复用现有聚合比较算子与类型化 threshold；动态 threshold 进入 bindings
  （`Count` 要求 `Int`，其余聚合接受 `Int`/`Number`），类型不兼容原子失败；
- projection 只含请求方选择的维度，聚合从不进入投影；显式 projection order 可与
  `lower_ordered` 在已有 grouped listing 上配合使用；
- 主体级普通 scalar filter/scope 先按既有确定顺序 lowering（要求引用主体实体属性，
  保证 grain 可证明）；重复 lowering 的 SQL/bindings 完全一致；
- 纯探针 `related_measure_ok(payload, subject_entity, role, measure_id)` 供测试断言
  合法/未知 measure/越权/无路线/歧义而不触发失败；
- `lower_internal_top` 仍是“关联 measure 位于主体自身”时的既有入口（隐藏
  `OrderKey Aggregate`）；`lower_internal_related` 在其上扩展到统一
  `path_depth_cap` 内的最短 relation 路径。

**限定路线的拒绝边界**（原子失败、带可归因诊断：subject/measure/entity，绝不发布
部分 Plan）：恰好一条可用路线是必需条件——
- **missing（无已声明路线）**：主体与聚合实体之间没有可用路线 → 拒绝；
- **ambiguous（歧义）**：存在多条等长最短路线 → 拒绝；较长 detour 不制造歧义，
  路线也**绝不按声明顺序挑选**；
- **bounded**：只枚举统一 `path_depth_cap` 内、不重复实体的简单路径；
- **cyclic / unauthorized**：路线无法构成合法简单链、subject role 未授权、
  measure 未知/computed/filtered → 拒绝。

仍维持的边界（稳定、可归因的拒绝，而非静默近似）：超过统一 path cap 的关联聚合、
关联侧 computed/filtered measure、HAVING threshold 类型不兼容等均不支持，不会通过
加入投影聚合列、改用 EXISTS、结果后处理或近似另一关系来绕过。

### 同主体 field-to-field 谓词（属性间比较）

过滤既可以是“属性 vs 外部标量”，也可以是**同一 prepared 主体上的两个属性**之间的
比较。公开契约如下：

```telora
type FieldFilterRequest = struct {
    subject: String,   # 授权主体（role）
    op: FilterOp,      # 封闭比较算子（至少 Eq / Ne）
    left: String,      # 主体实体上已声明、已授权、纯列属性的 id
    right: String,     # 同一主体实体上的另一属性 id
};
```

调用方式：

```telora
# 追加零个或多个 field-to-field 谓词；既有 lowering 全部保留
let plan: qb.Plan = edsl.lower_field_filtered(payload, request, field_filters);

# 纯可行性探针（不失败）：subject_entity 为 PreparedPayload 中的主体实体 index
let feasible: Bool = edsl.field_filter_ok(payload, subject_entity, field_filter);
```

约束与验证：

- **同主体**：`left` 与 `right` 必须属于同一 prepared 主体实体，且都是**已声明、已
  授权、纯列承载**（非 computed/JSON）的属性（dimension id）；未知属性、越权属性、
  computed/JSON 属性、其它实体属性（跨实体引用）一律稳定拒绝；
- **算子**：只接受封闭比较算子（`Eq`/`Ne`/`Gt`/`Ge`/`Lt`/`Le`；最低 `Eq`/
  `Ne`），且该算子必须同时被两侧属性声明支持；文本搜索算子（`Contains` 等）拒绝；
- **类型/domain 兼容**：封闭 enum 域要求两侧稳定值域相同；开放维度要求可比较标量类别
  一致（text/int/number）；不兼容稳定拒绝；
- **lowering**：只产生经验证的两个列引用比较（如 `a.x = a.y`），**不产生动态
  binding**，也**不进入 projection**；
- **profile 收窄**：谓词经知识 profile 校验。profile 只保留部分 scalar/算子能力时，
  调用方只能引用该属性在 profile 下实际保留的算子能力；profile 不允许该比较 scalar 时
  原子失败；
- **组合顺序**：与普通标量过滤/scope 组合时，既有过滤先按既有确定顺序 lowering，
  field-to-field 谓词按请求顺序作为尾部 AND 项追加；因为谓词不产生 binding，bindings
  顺序不变；重复 lowering 得到完全一致的 SQL/bindings；
- 实际 lowering 对非法形状原子失败、不发布部分 Plan/Query；纯探针 `field_filter_ok`
  对成功/各类拒绝返回预期，供测试断言。

### 同主体隐藏聚合 HAVING（hidden same-source aggregate HAVING）

`lower_hidden_having(payload, request, hidden)` 让**聚合（分组）请求**额外携带零个或
多个 HAVING 谓词，谓词引用一个**已授权、位于请求 base 实体上、但未被投影**的普通
measure：

```telora
type InternalHavingRequest = struct {
    measure: String,    # base 实体上已声明、已授权的普通（非 computed/filtered）measure
    subject: String,
    op: HavingOp,       # Eq / Ne / Gt / Ge / Lt / Le
    threshold: FilterInput,
};

# request 必须是聚合请求（至少一个 measure 与至少一个分组维度）
let plan: qb.Plan = edsl.lower_hidden_having(payload, request, hidden);
# 纯可行性探针（不失败）：subject_entity 为 PreparedPayload 中的主体实体 index
let feasible: Bool = edsl.same_source_having_ok(payload, subject_entity, role, measure_id);
```

约束与语义：

- 隐藏 measure 只参与分组/HAVING 校验与 SQL 生成，**绝不进入 projection**
  （请求结果列保持原本的 measures/dimensions 投影，不新增列）；
- 多个隐藏谓词与既有 HAVING 一起按请求顺序 AND，绑定顺序确定（threshold 动态值按
  谓词顺序追加）；重复 lowering 的 SQL/bindings 逐字节一致；
- 隐藏 measure 必须是 base 实体的**简单聚合**：unknown、未授权、computed、filtered、
  跨 base 实体、或者请求非聚合/无分组维度（无法证明分组）都原子失败，不发布部分
  Plan；
- 既有 `HavingRequest`（已选 measure 上的 HAVING）行为不改变、不削弱；
- profile 递归收窄照常生效（隐藏聚合同样经知识 profile 校验）。

### 属性 vs 标量聚合子查询（attribute-versus-scalar aggregate comparison）

`lower_attribute_compare(payload, request, comparisons)` 让**行级（measureless）列表
请求**按“外层属性 与 一个独立验证的内层标量聚合 的比较”保留 base 行：

```telora
type ScalarCompareRequest = struct {
    attribute: String,    # base 实体上已声明、已授权、纯列承载的 dimension id
    subject: String,      # 授权主体（role）
    op: HavingOp,         # 封闭比较算子 Eq / Ne / Gt / Ge / Lt / Le
    measure: String,      # 已声明、已授权、普通（简单）measure 的 id
    scope_filters: Array(FilterRequest),  # 有序的内层 scope 过滤（空 = 全局聚合）
};

# request 必须是 measureless、至少一个列表维度的行级请求
let plan: qb.Plan = edsl.lower_attribute_compare(payload, request, comparisons);
# 纯可行性探针（不失败）：base_entity 为 PreparedPayload 中的主体实体 index
let feasible: Bool = edsl.attribute_compare_ok(payload, base_entity, role, attribute_id, measure_id);
# scoped 纯探针（不失败）：额外校验每个 scope filter 的完整 filter/ownership 契约
let scoped_feasible: Bool = edsl.scoped_attribute_compare_ok(payload, base_entity, role, attribute_id, measure_id, scope_filters);
```

这是 query-core Plan-level `scalar_comparisons` 的封闭 typed 入口：每个比较作为
**独立的标量聚合比较谓词**只在 WHERE 中渲染为
`<outer 属性列> <op> (SELECT <agg>(<内层列>) FROM <内层实体表> AS <alias>
[WHERE <scope filters>])`，
与普通 filters 以既有顺序 AND；投影、分组、排序、bindings 与 grain 均不变。

**内层 scope filters（scoped comparisons）**：

- `scope_filters` 是**有序**的 `FilterRequest` 数组，每条都解析到**内层 measure 自身
  实体**的维度与词汇：每条 filter 只收窄内层标量聚合的输入行（进入标量子查询的
  `WHERE`），**绝不**进入外层 plan filter，也**绝不**按外层属性实体解析；
- 多个 scope filters 以确定性 **AND** 语义按声明顺序组合；
- 内层标量计划保持**扁平且非递归**：scope filters 不会授权 join、grouping、嵌套
  标量比较、raw SQL、alias、表名或开放表达式；内层仍是单源单聚合；
- 未知维度、未授权维度、不可筛选维度、算子不被维度支持、非法输入类型/枚举值、以及
  **属于其它实体（含外层属性实体）**的维度都原子失败（带可归因诊断：维度 id 与
  measure id）；纯探针 `scoped_attribute_compare_ok` 对完整 filter/ownership 契约
  返回预期而不失败；
- 空 `scope_filters` 完全保留**全局聚合**行为（与既有无 scope 请求一致）；
- **binding 顺序**：外层请求 filters 先（原有顺序），随后每个 comparison 按请求
  顺序、该 comparison 的 scope filters 按声明顺序进入子查询的占位符，最后是外层
  分页（limit/offset）；
- profile 递归收窄照常生效：内层聚合函数、scope filter 所用 scalar 都必须被允许，
  否则 `profile_accepts`/validation 拒绝。

类型/domain 兼容（**类型安全是契约的一部分**，通过 `std/type-desc` 反射 prepared
`FieldEntry.ty` 的 `Type` 元数据判定，绝不依据 filterability、算子列表、名称或样例
值推断）：

| 侧面 | 类别推导 | 数值族 |
| --- | --- | --- |
| 外层属性 | 其 prepared 字段 `Type` 的 kind | `Int` / `Float` 为受支持的数值族 |
| `Count` | 结果恒为整数 | 数值族 |
| `Sum` / `Avg` | 数值输入、数值结果 | 数值族 |
| `Min` / `Max` | 保留其输入列的可比较类别（数值列即数值族） | 取决于输入列 |

- 只有**两侧都属于数值族**（Int/Float）的比较被接受；text-vs-number、
  enum-vs-number 及其它跨类别组合被纯探针与 lowering 双重拒绝，并给出可归因诊断
  （指出属性 id 与 measure id）；
- 内层 measure 必须是已声明、已授权、**简单聚合**（非 computed/filtered）；外层
  attribute 必须是已授权、纯列承载、位于请求 base 实体的 dimension（computed/
  未授权/其它实体拒绝）；
- 算子只接受封闭比较；NULL 语义保持 SQL 原生（比较与 scope filter 都不注入
  `coalesce`）；
- **不做自然语言量化**：foundation 只暴露“比较 + 聚合”的精确结构，不解释
  “any/all”等词；那是领域层职责；
- 重复 lowering 的 SQL/bindings 逐字节一致；profile 对外层与内层能力**递归**收窄。

### 排序分组键比较（ranked grouped-key comparison）

`lower_ranked_key_compare(payload, request, comparisons)` 暴露 query-core 的
`RankedKeyComparison`：measureless 行级请求的外层行，被“外层属性 vs **按聚合排序后
第一个分组的 key**”过滤。它是**独立的 typed request**，绝不通过把排名组作为外层
结果、暴露排名 measure、或接受 SQL/表/列/alias fragment 来模拟：

```telora
type RankedKeyCompareRequest = struct {
    attribute: String,               # 外层属性（request base 实体或其安全父实体上的 dimension id）
    subject: String,
    op: HavingOp,                    # 封闭比较算子
    group: String,                   # 内层分组维度 id（内层 population 实体）
    measure: String,                 # 排名 measure id（同一内层 population grain）
    direction: OrderDirection,       # Asc / Desc
    scope_filters: Array(FilterRequest),  # 有序内层 scope 过滤（空 = 全局）
};

let plan: qb.Plan = edsl.lower_ranked_key_compare(payload, request, comparisons);
let feasible: Bool = edsl.ranked_key_compare_ok(payload, base_entity, role,
    attribute_id, group_id, measure_id, direction, scope_filters);
```

语义与约束：

- 外层属性、内层分组维度、排名 measure 都通过**已声明的领域词汇与关系归属**解析：
  - 外层 attribute 必须是已授权、纯列的 dimension。它既可以位于 request base 实体，
    **也可以位于从 base 经“恰好一条已 prepare 的 Safe 路径”可达的父实体**
    （safe parent-attribute join）：此时 lowering 把该 Safe 路径的 join 物化到外层
    Plan（按 source alias 复用已存在 join，只追加缺失边；`sources` 与 `joins`
    在 `qb.validate` 前一致重建），隐藏比较 `ColumnRef` 使用属主实体的 alias；
  - 内层 `group` 维度必须是已授权、纯列、位于**内层 population 实体**的 dimension；
  - 排名 `measure` 必须是已声明、已授权、**简单聚合**（非 computed/filtered），且
    **必须位于内层 population 实体**（grain）；measure 的 `requires` 必须为空（无
    额外必需实体/路由的测量）；否则给出可归因诊断（角色：外层 key / 分组 key /
    排名 measure / 路由）；
- **类型兼容**在外层属性与分组 key 之间按封闭可比较类别判定（复用
  `field_domains_compatible`：同 enum 稳定值域或同为开放 text/int/number 类别）；
  排名 measure 的类型**独立**——它只用于聚合排序，不参与该兼容判定；
- `scope_filters` 属于内层 population，按声明顺序以确定性 AND 组合，绝不泄漏到
  外层 filter 或改变外层投影；
- lowering 只生成 query-core 的 grouped-key scalar spec：
  `<outer> <op> (SELECT <group key> FROM <population> [WHERE <scope>] GROUP BY
  <group key> ORDER BY <measure agg> <ASC|DESC> LIMIT 1)`；外层投影逐字保持、排名
  measure 永不投影，safe parent-attribute join 也不改变外层 detail grain（Inner
  join，不放大行）；比较 attribute 与排名 measure 都**不进入投影**；
- **外层父属性路由的拒绝边界**（诊断可区分，调用者可据此修正意图或模型，绝不发布
  部分 Plan）：
  - **fan-out-only 路由**：owner 只能经 fan-out 关系到达（join 会放大 detail
    grain）→ 拒绝；
  - **歧义路由**：owner 经**多条不同 Safe 路径**（并行/其它歧义已声明 Safe 路由）
    到达 → 拒绝；路线**绝不按声明顺序挑选**。prepare 阶段对每个 (source, target)
    预计算“Safe 路径多于一条”的歧义矩阵 `PreparedPayload.ambiguous_paths`，
    lowering 与纯探针都据此拒绝；
  - **缺失/未声明路由**：owner 与 base 无任何已声明可达关系 → 拒绝；
  - **derived（union）外层 Plan**：base 为联合实体且父属性在 base 之外、需要新增
    join → 拒绝（derived UNION ALL 外层不能携带物理 join）。
- 未知/未授权/跨归属/类型不兼容/不支持（measure 在错误 grain、requires 非空）
  的请求原子失败；NULL 语义保持 SQL 原生；重复 lowering 逐字节一致；profile 递归
  收窄（缺内层排名聚合函数等拒绝）。纯探针 `ranked_key_compare_ok` 对 fan-out、
  歧义、缺失与 derived-join 路由都返回拒绝而不失败。

### 集合运算（set operations）

两个已授权的 ontology 请求先经正常 lowering 成为完整 Plan，然后可以按集合语义组合：
`lower_set(kind, payload, left_req, right_req)` 直接返回集合 `Query`，
`lower_set_count(kind, payload, left_req, right_req)` 在派生集合上返回 `count(1)`。
`kind` 复用 Query 的 `qb.SetOpKind`（`Intersect`/`Except`/`Union`，后者为去重
union，不是 UNION ALL）。

- 操作数投影必须非空、arity 相同且逐位置类别兼容；两个操作数都不得携带本地
  ordering/limit/offset/partition（否则会改变嵌入语义，稳定拒绝）；
- bindings 按从左到右操作数顺序拼接（含嵌套操作数），动态值不进入 SQL；
- `lower_set_count` 的外层只暴露一个 count 列，不暴露操作数列；
- 拒绝（空操作数、零列投影、arity/位置类型不匹配、非法 kind、越权来源/字段、不可嵌入
  的本地排序/分页、不安全的嵌套组合）原子失败、不发布部分 Query；query 层纯探针
  `qb.set_ok(kind, left_plan, right_plan)` 用于区分“不支持复合形状”与“词表错误”；
- 重复 lowering 的 SQL/bindings 完全一致。

## 验证

在资产根目录运行：

```bash
./bin/telora -C ontology test ontology
./bin/telora -C ontology test intent
```

`tests/ontology.telora` 覆盖 property fold、关系选择、筛选与 Top N、绑定顺序、profile、重复
lowering 确定性、封闭枚举值域、封闭计算表达式（`If`/`Instr` 参与
projection/grouping/ordering）、分页（offset 降低与绑定顺序、确定性）、领域
scope（声明、合并顺序、参数化）、Top Per Group（每分区 Top 2、computed 维度
tie-breaker、与全局 limit/offset 不组合）、条件/计算指标（FILTER lowering、
依赖投影、计算指标参与普通与分区排序、全局 filter 与固有 predicate 分离、
非 Timeline 的 Approval 条件计数与 Add/Sub 组合）及 JSON-backed Dimension（顶层
与嵌套 path 的 projection/grouping/filter/order、path 参与 Top Per Group
tie-breaker、binding 顺序确定性），并验证非法请求不发布可信结果，
包括负 offset、缺排序 offset、scope/filter 冲突、partition 非法组合、计算指标
契约破坏（未知依赖、依赖环、跨 grain）、filtered Measure 非法 predicate（引用
未授权/不可筛选维度、不允许的 operation/input kind、enum 未知稳定值）与 JSON
Dimension 拒绝（Profile 缺 JsonExtract、未授权 JSON Dimension、非法筛选输入、
未请求排序目标）。测试还覆盖下一轮能力：measureless
行级投影（无虚构 COUNT、无 grouping、跨安全 join 列表、contains 参数化绑定）、
文本筛选算子（starts-with/contains/not-contains/ends-with 的封闭 lowering 与
binding 顺序）、HAVING（阈值绑定、需已选 measure）、EXISTS（fan-out 必需实体改为
相关存在谓词、不产生 fan-out join）与结构化复合关系键（`And` 合取键降低为
`join_on` 的 AND ON 条件）。本轮的受控两跳相关存在也纳入覆盖：知识 payload 保存
Component → Site → Alarm 路线；两跳 lowering 只发 grain-safe owner join + 相关
EXISTS（SQL 形状、外层 grain 不被 Site→Alarm fan-out 放大、`min_matches` 分组计数、
内层筛选绑定顺序与重复 lowering 逐字节一致）；fan-out 首跳的两跳路线走 link 形状
（B/C 在同一个 EXISTS 内 JOIN）；纯可行性/内层筛选探针对未知/自指/无关
target 返回拒绝；路线 prepare 探针验证合法路线解析一次，并拒绝非唯一 owner、方向不匹配、
同 base 同 target 多路线歧义与 `via`→target 关系歧义；较密的 hub/leaf 关系图在
prepare 时保持有界不耗尽求值燃料。双端 hub 切片也纳入覆盖：payload 保存 Pair(hub base)→Member 双端路线；union EXISTS
lowering 方向为 `FROM hub WHERE EXISTS(participant ...)`（左右角色两条 alternative、
无 fan-out join、绑定顺序与逐字节确定性）、participant 属性内层筛选参数化、可行性
探针，以及 prepare 对同端、非 key participant、participant 缺 key、端点越界与重复
声明的确定性拒绝。paired-endpoint（peer）切片也纳入覆盖：payload 保存
Pair(hub base) 的同 participant peer 路线；`lower_peer` 对两个指定 Member key 生成
双内层 alias 的 correlated EXISTS（`((left = mo.id AND right = mp.id) OR
(right = mo.id AND left = mp.id)) AND mo.id <> mp.id AND mo.id = ? AND mp.id = ?`）、
bindings 按占位符
顺序、无外层 JOIN/fan-out、交换顺序共享同一 SQL 形状且 key 绑定镜像、重复 lowering
逐字节一致；`peer_request_ok` 纯探针对合法/自配/未知实体/无路线 hub 返回预期；异构
（不同 participant 表）peer 路线 forward/swap 请求都各自以请求声明的 participant
表为内层源生成两组交换分支，跨表同值 key 保持独立内层 alias，杜绝把同一端点值同时
解释为两种实体；filtered-participant 能力覆盖：同类型两侧属性过滤、异构两侧属性过滤、
key+属性混合（同侧 AND，key 绑定先于属性）、A/Z 交换、跨表相同 key、两侧过滤值相同
（各自独立 alias 绑定）、过滤引用错误实体、entity-only participant（合法）、未授权算子、
self-pair、
无 route，以及重复 lowering SQL/bindings 完全一致；同实体（exact-key / attribute-only /
key+attribute / entity-only）SQL 均含 `origin.key <> peer.key` 身份不等（self-loop 结构性
证明），相同过滤值双 alias 成功且含身份不等，异构（不同表）不出现裸 key 不等、跨表相同
key 保持合法；结构断言验证只有一个 correlated
EXISTS、两个 participant alias、两个交换分支，每侧过滤只引用自己的 alias；query 结构
测试验证两个 participant alias 都存在、各自只出现在自己的端点 equality 与 filter、
两组交换分支齐全，并确定性拒绝同端、self-pair 身份缺失形状；prepare 对同端字段、非
key participant、越界与同一 participant 对的重复 peer 路线确定性拒绝；同一 hub 的
多类 participant `dual_hub` 元数据仍合法。本轮 spider 评估形状测试另覆盖：行级请求
按未投影的已授权维度排序（含 Top N、返回列不含 C）、`lower_distinct` 的
`SELECT DISTINCT`（多维度、含 JSON 维度过滤/排序/limit 的占位符顺序与确定性）、
`lower_absence` 的 `NOT EXISTS`（零匹配主体、owner join、`negated` 结构标志）、
两个独立 correlated EXISTS 表达“分别满足 A/B 的不同关联行”、跨关系无 measure 维度
投影（无虚构 COUNT、无 GROUP BY）与返回列顺序契约（measures 在 dims 前、各自保持
请求顺序）。spider round 3 测试另覆盖：`lower_internal_top` 分组维度请求只返回组列、
按内部（未投影）聚合排序（含维度 tie-breaker 与 Top N 绑定）、`check_internal_top_group`
的 SQL/分组/投影结构断言，以及 measureless 请求用直接关系（反向 fan-out）的
correlated EXISTS 证明主体存在而只返回主体维度（无 link-count measure、无 join/group）。
spider round 4 测试另覆盖 fan-out 首跳的两跳 link 存在：`check_link_route_prepared`
（fan-out 首跳路线 resolve 一次）、`check_link_two_hop_lowering`（B/C 在同一个
correlated EXISTS 内 JOIN、无外层 fan-out join、目标过滤绑定）、
`check_link_two_hop_returns_subject_dims_only`（measureless 只返回主体维度）与
`check_link_two_hop_deterministic_and_absence`（重复 lowering 逐字节一致、NOT EXISTS
反存在）。related aggregate 测试另覆盖 `check_related_aggregate_ordering_top_n`（隐藏
关联计数排序 + Top-N）、`check_related_aggregate_having`（隐藏关联计数 HAVING + 阈值
binding）、`check_related_aggregate_reverse_relation`（反向声明关系按 prepared 方向
join）与 `check_related_aggregate_deterministic_and_rejections`（重复 lowering 一致；
越权/未知 measure/无关系/歧义经 `related_measure_ok` 确定性拒绝）。bounded two-hop
related aggregate 测试另覆盖合成 `rm_subjects`/`rm_intermediates`/`rm_events` fixture：
`check_related_two_hop_ordering_top_n`（subject → intermediate → event population 的
唯一两跳 route：隐藏 count 排序 + Top-N 的精确 SQL、两个 route join 依依赖顺序、只按
主体维度分组、只投影主体维度）、`check_related_two_hop_having`（同一两跳 route 的隐藏
聚合 HAVING 精确 SQL/绑定、隐藏 measure 不投影）、
`check_related_two_hop_determinism`（重复 lowering 逐字节一致）与
`check_related_two_hop_rejection_probes`（唯一两跳 route 可行；直接路线优先于较长
detour；唯一三跳 route 可 lower 为三个依赖有序 join 的精确 SQL；无已声明路线、越权
role、未知 measure 经 `related_measure_ok` 确定性拒绝）。集合运算测试另覆盖
`check_set_intersect_direct`（直接 INTERSECT + 左到右 bindings）、
`check_set_union_and_except_keywords`（去重 UNION/EXCEPT 关键字，非 UNION ALL）、
`check_set_outer_count`（外层单列 count over 派生集合）与 `check_set_deterministic`
（重复 lowering 一致）。显式投影顺序测试另覆盖 `check_explicit_projection_order`（跨 measure/dimension
交错列序、只改 SELECT 列序）与 `check_default_projection_order_compat`（空 order 保留
默认 measure-then-dimension 行为）。field-to-field 谓词测试另覆盖
`check_field_to_field_success`（双列比较、无 binding、不加入投影）、
`check_field_to_field_combination_and_determinism`（与普通标量过滤组合的谓词/bindings
顺序与重复 lowering）与 `check_field_to_field_rejections`（未知/未授权/跨实体/类型不兼容/
非法算子经纯探针确定性拒绝）。hidden same-source HAVING 测试另覆盖
`check_hidden_having_same_source`（隐藏 OrderCount HAVING 不进入投影、SQL
`GROUP BY ... HAVING count(...) >= ?`、阈值绑定）与
`check_hidden_having_determinism_and_probe`（重复 lowering 一致；同源/越权/未知/跨实体
measure 经 `same_source_having_ok` 确定性拒绝）。attribute-versus-aggregate 测试另覆盖
`check_attribute_vs_scalar_aggregate`（**数值正例**：外层 Int 属性 OrderId vs 数值
`sum(OrderAmount)`——Plan 级单一标量聚合比较谓词、投影只含列表维度、
`o.order_id > (SELECT sum(o.amount) FROM orders AS o)` 的 SQL 形状、无动态绑定）与
`check_attribute_vs_scalar_aggregate_probe_and_determinism`（重复 lowering 逐字节一致；
数值外层 + 数值聚合与 Count 整数结果可行；text-vs-number（OrderRegion vs sum）、
enum-vs-number（CustomerTier vs count）、越权、未知/跨实体属性、未知 measure 经
`attribute_compare_ok` 确定性拒绝）。scoped attribute-versus-aggregate 测试另覆盖
合成领域 `sc_accounts`/`sc_txns` fixture：`check_scoped_attribute_compare_positive`
（数值外层 ScAccountId vs 带**两个有序 scope filter** 的 `avg` 内层聚合，精确
SQL/bindings、投影保持、无 join/EXISTS、无 `coalesce`）、
`check_scoped_attribute_compare_min_max`（带单 scope filter 的 `max`/`min` 聚合精确
SQL/bindings）、`check_scoped_attribute_compare_empty_and_determinism`（空 scope
保持全局聚合行为、`scoped_attribute_compare_ok([])` 与既有无 scope 探针一致、重复
lowering 逐字节一致）、`check_scoped_attribute_compare_profile_and_projection`
（全 profile 接受、缺 `Avg` 的 profile 递归拒绝、投影保持）与
`check_scoped_attribute_compare_rejections`（scope filter 属于外层 base 实体而非内层
实体、跨实体维度、未知/未授权/不可筛选维度、不支持算子、非法输入类型、越权 role 全部
经 `scoped_attribute_compare_ok` 确定性拒绝；两个合法内层实体 scope filter 可行）。
ranked grouped-key comparison 测试另覆盖合成 `sc_accounts`/`sc_txns` fixture：
`check_ranked_key_positive`（多实体正例：外层 account kind 行被“按
`max(amount_max) DESC` 排名第一的 txn category key”过滤，精确 projection/SQL/
bindings）、`check_ranked_key_scoped_and_min_asc`（带内层 scope filter 的 asc
`min` 排名与直接同 grain `count` DESC 排名的精确 SQL/bindings）、
`check_ranked_key_rejections`（外 key/分组 key 类型不兼容、measure 非内层
population grain、未知外属性/分组维度/measure、未授权分组维度、scope 归属/输入
错误全部经 `ranked_key_compare_ok` 拒绝）与
`check_ranked_key_determinism_profile_and_compat`（重复 lowering 逐字节一致、
全 profile 接受而缺排名聚合的 profile 拒绝、既有 scalar aggregate comparison 未被
注入/保持不变）。ranked outer-join 与路由边界另覆盖合成
`rk_lines`/`rk_parents`/`rk_events`（及 fan-out/歧义/union 变体）fixture：
`check_ranked_key_outer_parent_join`（detail-grain base 的比较属性位于安全可达的
父实体：外层 Plan 精确物化唯一 Safe 路径的 Inner join、SQL/bindings/projection
精确、detail grain 不被分组、比较属性与排名 measure 不进入投影、探针可行）与
`check_ranked_key_fanout_route_rejected`（fan-out-only owner 被探针拒绝，base 自身
属性仍可行）、`check_ranked_key_ambiguous_route_rejected`（两条并行 Safe 路由：
路径矩阵仍记录首条 Safe 路径、`ambiguous_paths` 歧义标志为真、探针拒绝而不按声明
顺序选择）、`check_ranked_key_missing_route_rejected`（与 base 无已声明路由的
owner 被拒绝）及 `check_ranked_key_derived_plan_join_rejected`（derived(union)
外层 Plan 对需要新增 join 的父属性拒绝、base 自身属性可行）。
query 模块测试另覆盖 `qb.transform_sqlite_distinct`、
`qb.exists_not`、`OrderKey Aggregate` 内部排序聚合与 `qb.exists_two_hop`
（SQL/bindings/确定性）。model-derived intent factory 测试（`@test/intent`）另覆盖
**两份结构不同的领域中性模型**（虚构企业 `@src/test_knowledge` 与本地 org
teams/members 模型）：`count_members`/`filtered_members`/`knowledge_distinct`
（精确 SQL/bindings），`org_field_to_field`（`list` 内 field-to-field 谓词降低为
双列比较、无 binding）、`org_hidden_row_ordering`（行级按未投影维度排序）、
`org_selected_having` / `org_hidden_having`（selected 与隐藏同源聚合 HAVING 精确
SQL/bindings）、`org_related_exists` / `org_related_absence`（相关存在/NOT EXISTS）、
`org_related_hidden_ordering`（`top`：隐藏相关聚合排序 + Top-N 的 route join）、
`org_set_intersect` / `org_set_count`（集合组合与外层 count），以及
`deterministic_knowledge` / `deterministic_org`（重复 lowering 逐字节一致）；拒绝侧
经纯探针 `query_intent_ok` 覆盖未授权 subject、未知 op、malformed measures、非
`list` 上的 field-to-field 谓词、未知 set kind，并保留合法 intent 的正控断言。
