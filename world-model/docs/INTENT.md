# world-model INTENT 契约 — INTENT.md

定义 `world-eval/input.json` JSON 契约。Resolver 依此写出输入；`bin/world-make-query`
调用 `@src/bin/make-query:main` 确定性地转成参数化 SQL。领域词汇见 `DOMAIN.md`。

输入是**封闭的 tagged request family**：顶层 JSON 对象恰好带一个键，键名选择请求
kind。输入不接受表名/列名/别名/Join/SQL/表达式；动态值只作过滤/绑定值。

- 成功输出：`{"sql":"...","bindings":[...]}`；bindings 为原生 JSON 标量。
- 失败：非零退出、清空 ok、类别化确定性诊断（`vocab:`/`type:`/`rule:`/
  `unsupported:`）。

## 请求 family（顶层）

```jsonc
{ "Ordinary": { /* ordinary 字段 */ } }
{ "DistinctDimensions": { /* distinct_dimensions 字段 */ } }
{ "HiddenRowOrder": { /* hidden_row_order 字段 */ } }
{ "HiddenAggregateOrder": { /* hidden_aggregate_order 字段 */ } }
{ "RelatedExists": { /* related_exists 字段 */ } }
{ "RelatedAbsent": { /* related_absent 字段 */ } }
{ "SetCombine": { /* set_combine 字段 */ } }
{ "SetCount": { /* set_count 字段 */ } }
{ "SelectedHaving": { /* selected_having 字段 */ } }
{ "HiddenHaving": { /* hidden_having 字段 */ } }
{ "AttributeAggregateCompare": { /* attribute_aggregate_compare 字段 */ } }
{ "RelatedHiddenRowOrder": { /* related_hidden_row_order 字段 */ } }
{ "RelatedSetCombine": { /* related_set_combine 字段 */ } }
{ "RelatedSetCount": { /* related_set_count 字段 */ } }
```

其它顶层 kind 尚未加入 family，在 decode 边界稳定拒绝（`unsupported:`），不发布
部分结果。

## 选择指南（重要）

返回列由**请求语义决定**，不由“能否构造数值相关 SQL”决定：

- 只返回分组维度、并按聚合对组排名 → **`HiddenAggregateOrder`**：聚合是内部排序
  目标，**不要**为了排序把它加进 `measures`（否则它会被投影）。
- 行级列表按未投影数值维度排序 → `HiddenRowOrder`。
- 行级列表还要被“相关记录是否存在”限定（跨声明路径）→ `RelatedHiddenRowOrder`。
- 只需要相关存在/不存在作为行级/分组限定、不做隐藏排序 → `RelatedExists` /
  `RelatedAbsent`。
- 需要把**两个独立的 related 限定**（各带 correlated EXISTS）作为集合组合 →
  `RelatedSetCombine` / `RelatedSetCount`（每个操作数是 dimension-only 的 Country
  列表 + 恰好一个 `RelatedClause`）。不要为此用 fan-out join 或 helper count。
- 集合运算操作数**可以是纯 dimension-only 行列表**：不要为“激活 join”而发明
  count/其它 measure；两个操作数保持位置兼容，只保留请求的集合元素列。
- 只有当问题真的要求返回聚合 measure 时，才把 measure 放进 `Ordinary` 的
  `measures` 投影。
- 外层数值属性与标量聚合比较：需要**全局**聚合时用空 `scope_filters`；需要聚合只
  统计某一范围时，把范围条件放进该 comparison 的 `scope_filters`（属于所选
  measure 实体），不要复制到外层 `filters`。

`HiddenAggregateOrder`、dimension-only（含跨实体）集合操作数与 scoped attribute
比较的精确公共投影已由 exact-SQL 测试锁定：helper measure / 排序 / 聚合 / scope
限定从不泄漏进 `SELECT`。

## 显式输出列序（output_order）

`Ordinary`、`RelatedExists`、`RelatedAbsent`、`SelectedHaving` 与 `HiddenHaving`
的 body 可以带 **有序 `output_order`**，精确指定公共结果列序列。token 是封闭的
类别化引用，只指向**已请求**的 measure 或 dimension：

```jsonc
"output_order": [
  { "Measure":   "measure id" },
  { "Dimension": "dimension id" }
]
```

规则（categorical）：

- **空数组**保留既有 legacy 顺序（dimensions 在前、measures 在后）。
- **非空数组是精确的**：必须把每个已请求 measure 与 dimension 恰好列出一次；不允许
  unknown / duplicate / omitted / hidden-order / hidden-HAVING / compared-attribute /
  related / scope 项（unknown 词表 → `vocab:`；duplicate/omitted/not-requested →
  `rule:`）。
- 只改变 `SELECT` 列序：grouping / HAVING / filters / joins / EXISTS / scalar
  comparisons / ordering / limits / bindings / grain / authorization 均不变。
- 集合操作数（`SetCombine` / `SetCount` 的 `left`/`right`）保持位置兼容，**不接受**
  非空 `output_order`（静默重排一操作数去匹配另一个不被允许）。

## 结果形状纪律（Result-shape discipline）

跨实体、dimension-only 的集合操作是**既有的合法形状**（非特例 lowering）：
City 行经其 Country owner 的关系遍历即可被另一侧过滤，无需 helper count。示例
（一般形状，非数据集题目）：

```json
{
  "SetCombine": {
    "kind": "intersect",
    "left": {
      "measures": [], "dimensions": [{"id": "city_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Asia"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    },
    "right": {
      "measures": [], "dimensions": [{"id": "city_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Europe"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    }
  }
}
```

`SetCombine` 保持通用，不删除聚合操作数支持。

### Ordinary

经典请求形状：投影/过滤/聚合/排序。measures 可为空。

```jsonc
{
  "measures":   [ Measure, ... ],   // 聚合（可为空）
  "dimensions": [ Dimension, ... ], // 属性/分组维度（可为空）
  "filters":    [ Filter, ... ],    // AND
  "order":      [ Order, ... ],
  "limit":      int | null,
  "offset":     int | null,
  "output_order": [ OutputToken, ... ]  // 空 = legacy（dims 先）；非空 = 精确
}
```

### DistinctDimensions

**无 measure** 的行级维度请求：只返回请求维度（互不重复，`SELECT DISTINCT`），
绝不发明或投影 count 指标。必须选择至少一个维度；`order` 只能引用已选择（投影）
维度（隐藏排序目标稳定拒绝）。

```jsonc
{
  "dimensions": [ Dimension, ... ], // 至少一个
  "filters":    [ Filter, ... ],    // AND
  "order":      [ Order, ... ],     // 只能引用已选择维度
  "limit":      int | null,
  "offset":     int | null
}
```

### HiddenRowOrder

**无 measure** 的行级列表：投影 `dimensions`，同时按**一个已授权、数值、未投影**
的维度 `sort_by` 排序并可选取 Top N。隐藏排序字段绝不进入返回列。

```jsonc
{
  "dimensions": [ Dimension, ... ], // 至少一个（返回列，请求序）
  "filters":    [ Filter, ... ],    // AND
  "sort_by":    "dimension id",     // 未投影的数值维度
  "direction":  "asc" | "desc",
  "limit":      int | null,         // 正整数
  "offset":     int | null          // 非负；本 kind 恒有排序
}
```

约束：`sort_by` 必须已知、已授权、数值类型、**未在 `dimensions` 中投影**，且经
base 的安全路径可达（fan-out/跨粒度目标稳定拒绝）。

### HiddenAggregateOrder

**无 measure** 的分组列表：按 `dimensions` 分组并投影，同时按**一个已授权、位于
同一 base 实体、未投影的简单聚合 measure** `sort_by` 排序并可选取 Top N。隐藏
聚合绝不进入返回列。

```jsonc
{
  "dimensions": [ Dimension, ... ], // 至少一个（分组/返回列）
  "filters":    [ Filter, ... ],    // AND
  "sort_by":    "measure id",       // base 实体上的简单聚合，未投影
  "direction":  "asc" | "desc",
  "limit":      int | null          // 正整数
}
```

约束：`sort_by` 必须已知、已授权、简单聚合，位于请求分组维度所属的同一 base
实体（跨 base 实体拒绝）；`offset` 不支持（稳定拒绝）。

### RelatedExists / RelatedAbsent

保留外层 country 行/分组，当已声明的 related target（`city` 或 `country_language`）
**存在（至少一条）** / **不存在（零条）** 匹配记录。外层 body 与 `Ordinary` 相同的
普通投影/过滤请求（measures/dimensions/filters/order/limit/offset），外加一个
`related` 子句：

```jsonc
{
  "measures":   [ Measure, ... ],   // 可为空（与 ordinary 相同的外层投影）
  "dimensions": [ Dimension, ... ], // 可为空
  "filters":    [ Filter, ... ],    // 外层 base（country）上的 AND 过滤
  "order":      [ Order, ... ],
  "limit":      int | null,
  "offset":     int | null,
  "related": {
    "target":       "city" | "country_language",
    "filters":      [ Filter, ... ],  // target 实体维度上的 AND 过滤（有序）
    "min_matches":  int | null        // 可选正整数的匹配下限
  },
  "output_order": [ OutputToken, ... ]  // 空 = legacy（dims 先）；非空 = 精确
}
```

约束与语义：

- 外层必须是 **country base**（measures/dimensions/filters 均引用 country 维度）；
  related target 只支持经 Country 关系图声明的 grain-safe 路线 `city` /
  `country_language`。其它 base/target 组合稳定拒绝。
- `related.filters` 只能引用 **target 实体自己的维度**（多个过滤按请求顺序 AND，
  动态值按占位符顺序进入 bindings）。
- `related` 只限定外层行的去留：related 字段/计数从不进入请求的返回列。
- `min_matches`: `n`（正整数）表达“至少 n 条匹配记录”的相关谓词；`null` 表达
  “至少一条”。字段必须显式给出（`n` 或 `null`），不能靠省略字段表达。
- `RelatedExists` 与 `RelatedAbsent` 是两个封闭、互斥的 variant：前者 lower 为
  相关 `EXISTS`，后者 lower 为相关 `NOT EXISTS`（原生 correlated NULL 语义），
  重复 lowering 的 SQL/bindings 逐字节一致。

### SetCombine / SetCount

对**两个各自完整、彼此兼容的 ordinary 操作数**施加一个封闭集合 kind
（`intersect` | `except` | `union`）。`union` 为去重并集（非 UNION ALL）。

**`left` 与 `right` 是未打标签（untagged）的 `OrdinaryIntent` body**：它们**直接**
包含 `measures`、`dimensions`、`filters`、`order`、`limit`、`offset` 以及
`output_order`（操作数必须为 `output_order: []`，不接受非空）；**不得**再用
`Ordinary` 或 `DistinctDimensions` 等顶层 kind 包裹它们。

```jsonc
{
  "kind":  "intersect" | "except" | "union",
  "left": {
    "measures":   [ Measure, ... ],   // 可为空；dimension-only 集合必须为空
    "dimensions": [ Dimension, ... ],
    "filters":    [ Filter, ... ],
    "order":      [ Order, ... ],     // 必须为空（可嵌入）
    "limit":      null,               // 必须为 null（可嵌入）
    "offset":     null,               // 必须为 null（可嵌入）
    "output_order": []                // 必须为空（不接受非空，避免静默重排）
  },
  "right": {
    "measures":   [ Measure, ... ],   // 与 left 位置兼容
    "dimensions": [ Dimension, ... ],
    "filters":    [ Filter, ... ],
    "order":      [ Order, ... ],
    "limit":      null,
    "offset":     null,
    "output_order": []                // 必须为空
  }
}
```

选择规则（categorical）：当请求的集合元素**只是维度**时，两个操作数的 `measures`
**必须为空**；helper 聚合不是 join 激活器，绝不为了遍历关系而给 dimension-only
操作数补 count/其它 measure。

约束与语义：

- 两个操作数各自先按共享词表/类型规则独立校验（未知 measure/dimension/filter、
  类型错误等照常拒绝）。
- 集合兼容性：两操作数投影**非空且 arity 相同**，位置投影类别兼容
  （measure/dimension 位置一致）；**绝不静默改写操作数**去凑兼容。
- 可嵌入性：操作数不得携带本地 ordering / limit / offset / partition（本 family
  的 ordinary 无 partition，故校验本地 order/limit/offset 必须为空）。
- `set_combine` 返回两个操作数共享的投影列；`set_count` 只返回一个外层计数列。
- 动态 bindings 按“左操作数先、右操作数后”的 SQL 占位符顺序拼接；重复 lowering
  逐字节一致。

**dimension-only、跨实体的集合示例**（一般契约形状，非数据集题目）。两个操作数都
`measures: []`、投影同一个维度，并经**已声明关系**由另一实体的过滤遍历——City 行
经其 Country owner 按大洲过滤：

```json
{
  "SetCombine": {
    "kind": "intersect",
    "left": {
      "measures": [],
      "dimensions": [{"id": "city_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Asia"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    },
    "right": {
      "measures": [],
      "dimensions": [{"id": "city_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Europe"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    }
  }
}
```

**公共投影不变式**：该请求生成的 `SELECT` 在每个操作数内**只含请求的维度**
（此处为城市名一列）；`country_continent` 只出现在过滤中，任何 count/其它
helper measure 都不会进入投影。

### SelectedHaving / HiddenHaving

聚合/分组请求外加**有序的聚合结果谓词（HAVING）**。谓词字段：

```jsonc
{
  "measure":   "measure id",
  "op":        "eq" | "ne" | "lt" | "le" | "gt" | "ge",
  "threshold": <numeric scalar>   // 数值（int / number），绝不进入 SQL 文本
}
```

`selected_having`：body 为聚合/分组 ordinary 请求，谓词只能引用**已选择（投影）的
measure**。

```jsonc
{
  "measures":   [ Measure, ... ],   // 至少一个
  "dimensions": [ Dimension, ... ],
  "filters":    [ Filter, ... ],
  "order":      [ Order, ... ],
  "limit":      int | null,
  "offset":     int | null,
  "having":     [ HavingPredicate, ... ],
  "output_order": [ OutputToken, ... ]  // 空 = legacy（dims 先）；非空 = 精确
}
```

`hidden_having`：body 必须同时选择 measure 与分组维度；谓词引用 **base 实体上已授权、
未选择（未投影）的简单聚合 measure**。隐藏 measure 只参与 HAVING，绝不进入 SELECT。

```jsonc
{
  "measures":   [ Measure, ... ],   // 至少一个（已选/投影）
  "dimensions": [ Dimension, ... ], // 至少一个分组维度
  "filters":    [ Filter, ... ],
  "order":      [ Order, ... ],
  "limit":      int | null,
  "offset":     int | null,
  "having":     [ HavingPredicate, ... ],
  "output_order": [ OutputToken, ... ]  // 空 = legacy（dims 先）；非空 = 精确
}
```

约束与语义：

- `selected_having` 拒绝未选择/未知 measure，以及非聚合的行级请求（body 无
  measure）。
- `hidden_having` 拒绝 selected / computed / filtered / unauthorized / cross-entity /
  unknown measure，以及没有有效分组/聚合 grain 的请求。
- 多个谓词按请求顺序 AND；阈值动态值按谓词顺序进入 bindings（SQL 占位符顺序），
  绝不进入 SQL 文本。
- 返回列=请求投影：空 `output_order` 为 legacy（dims 在前、measures 在后），非空
  `output_order` 为精确列序；HAVING-only 聚合值在两种模式下都保持隐藏、绝不进入
  SELECT。
- 重复 lowering 的 SQL/bindings 逐字节一致。

### AttributeAggregateCompare

**无 measure 的行级列表**请求，保留外层行当**数值外层属性**与一个**标量聚合**满足
比较。比较列表字段：

```jsonc
{
  "attribute":     "dimension id",  // 已授权、plain、数值维度，位于外层 base 实体
  "op":            "eq" | "ne" | "lt" | "le" | "gt" | "ge",
  "measure":       "measure id",    // 已授权、plain、未过滤的数值 measure（标量阈值）
  "scope_filters": [ Filter, ... ]  // 有序内层 scope 过滤（空 = 全局聚合）
}
```

```jsonc
{
  "dimensions":  [ Dimension, ... ],  // 至少一个（返回列，请求序）
  "filters":     [ Filter, ... ],     // 外层 base 上的 AND 过滤
  "order":       [ Order, ... ],
  "limit":       int | null,
  "offset":      int | null,
  "comparisons": [ AttributeCompare, ... ]  // 至少一个
}
```

约束与语义：

- 外层 body 必须是 measureless 行级列表（本 variant 无 measures 字段），至少一个
  投影维度与至少一个 comparison。
- `attribute` 必须是外层 base 实体上已授权、plain、**数值**维度的语义 ID；内层
  `measure` 必须是已授权、plain、未过滤的数值 measure。
- `scope_filters`：每条都解析到**所选 measure 自身实体**的 ordinary 维度词汇；多个
  scope filter 按声明顺序 AND，只收窄内层标量聚合的输入行（进入标量子查询
  `WHERE`），**绝不**复制进外层 `filters`。空数组 = 全局聚合（与旧行为一致）。
- public payload 只含语义 ID，不含 alias/物理标识/join/子查询结构/表达式/SQL。
- 比较只限定行去留：外层投影保持恰好请求的维度；被比较的属性、聚合与 scope 维度
  都是限定机制，**绝不**成为公共结果列。
- text/enum 属性对数值聚合（`type:`）、unknown / unauthorized / computed / filtered
  / 跨 base 属性、非 measureless body、空投影、空 comparisons、未知或跨实体 scope
  id、scope 上非法算子/输入类型、非数值比较均稳定拒绝。
- 多个比较按请求顺序 AND；binding 顺序为外层 filters 先，随后每个 comparison 按
  请求顺序、其 scope filters 按声明顺序，最后是分页；SQL NULL 保持原生；重复
  lowering 逐字节一致。
- **自然语言量词仍是 resolver 职责**：模型只发布显式聚合选择与 scope，不在
  lowering 里猜测/改写 min/max/avg 语义。

### RelatedHiddenRowOrder

把 **City 行级列表**按隐藏数值属性排序，并只保留其所在国家（owner）有匹配
CountryLanguage 记录的 City 行。qualifier 是**多跳相关存在**：
City → Country（唯一 owner）→ CountryLanguage；它降低为 grain-safe owner join +
一个 correlated `EXISTS`，绝不使用合成的直接 City–CountryLanguage join 或 fan-out
join 放大外层 City 行。

```jsonc
{
  "dimensions": [ Dimension, ... ],  // City 维度（返回列，请求序）
  "filters":    [ Filter, ... ],     // 外层 City base 上的 AND 过滤
  "sort_by":    "City numeric dimension id",  // 未投影的隐藏排序维度
  "direction":  "asc" | "desc",
  "limit":      int | null,          // 正整数
  "offset":     int | null,          // 非负；本 kind 恒有排序
  "related": {
    "target":  "country_language",
    "filters": [ Filter, ... ]       // target 维度上的有序 AND 过滤
  }
}
```

约束与语义：

- 外层 base 必须是 **City**（dims/filters/sort_by 均引用 City 维度），related
  target 只支持经声明的 City→Country→CountryLanguage 路线的 `country_language`
  （其它 base/target、未知 target 组合稳定拒绝）。
- related 过滤只能引用 target 实体自身维度；只作行限定，绝不进入投影。
- 隐藏排序字段绝不投影；ORDER BY/LIMIT 作用于外层 City 行；外层 City grain 不被
  相关行放大（无重复外层行）。
- binding 顺序：外层 filters 先，随后 related（EXISTS 内层）filters，最后分页。
- route / outer-target 属主 / 过滤词表 / 数值排序类型 / 方向 / 正 limit / 路径安全
  均类别化校验；重复 lowering 逐字节一致。

### RelatedSetCombine / RelatedSetCount

对**两个各自独立降低的 related-qualified Country 列表**施加一个封闭集合 kind
（`intersect` | `except` | 去重 `union`）。每个操作数是一个**dimension-only** 的
Country 行级列表（一个或多个投影维度 + 有序外层过滤 + **恰好一个** `RelatedClause`
：correlated EXISTS 经声明的 Country → related target 路线限定外层 Country 行）。
没有 measures / ordering / pagination / open body——公共集合元素形状因此是结构的，
不是 prompt 约定。

```jsonc
{
  "kind":  "intersect" | "except" | "union",
  "left": {
    "dimensions": [ Dimension, ... ],   // 一个或多个（Country 维度）
    "filters":    [ Filter, ... ],      // Country 外层 AND 过滤
    "related": {
      "target":      "city" | "country_language",
      "filters":     [ Filter, ... ],
      "min_matches": int | null
    }
  },
  "right": {
    "dimensions": [ Dimension, ... ],
    "filters":    [ Filter, ... ],
    "related": {
      "target":      "city" | "country_language",
      "filters":     [ Filter, ... ],
      "min_matches": int | null
    }
  }
}
```

约束与语义：

- 每个操作数独立 lower 为 Country 行级 Plan + correlated `EXISTS`（经声明 route；
  绝不用直接 fan-out join，也不把不安全路线标安全），再把两个已验证 Plan 用既有
  query-core SQLite set transform 组合。
- `related_set_combine` 返回两个操作数**共享的外层维度**；`related_set_count` 只返回
  结果集合的基数。related 字段、count 或 helper measure 绝不进入操作数投影。
- 两操作数投影非空、arity 相同、位置类别兼容；保留各自声明的维度顺序。
- 复用既有 related target / route / ownership / authorization / filter / `min_matches`
  校验。
- binding 顺序确定：左外层 filters → 左 related filters → 右外层 filters → 右
  related filters；set count 不再增加绑定。
- 拒绝未知 kind / 未知维度或 target / 跨实体外层维度或过滤 / 属于其它实体的 target
  过滤 / 不支持路线 / 非法输入 / 空或不匹配投影（类别化诊断）。

## 字段

- Measure: `{ "id": "...", "mode": "all" | "distinct" }`；`id` 使用 `DOMAIN.md`
  声明的 `<entity>_<attribute>_<func>` 稳定词汇（同一数值属性发布多个函数 variant，
  例如人口 `_sum`/`_avg`/`_min`/`_max`；预期寿命/年份/占比等非可加数值发布
  `_avg`/`_min`/`_max` 而不发布 `_sum`）。选择哪个函数由语义决定，不从上下文猜测，
  不用 `avg` 替代 raw 投影/sum/min/max。
- Dimension: `{ "id": "..." }`
- Filter: `{ "id": "...", "op": "eq|ne|gt|ge|lt|le|contains|not_contains|starts_with|ends_with", "value": <scalar> }`
- Order: `{ "measure": "<id>"|null, "dimension": "<id>"|null, "direction": "asc"|"desc" }`
- `limit` 正整数；`offset` 非负且要求非空排序。

## 语义

1. 每个请求至少选择 1 个 measure 或 dimension；行级 distinct/hidden 两类请求必须
   至少选择 1 个 dimension。
2. `ordinary` 聚合：只含 measures → 单行；含 measures + dimensions → 按全部维度
   分组；measure `mode: "distinct"` → 去重计数（如 count distinct）。
3. `ordinary` 行级：只含 dimensions → 非去重列表。
4. `distinct_dimensions`：行级 `SELECT DISTINCT`；返回列=请求维度（请求序）。
5. `hidden_row_order` / `hidden_aggregate_order`：返回列=请求维度（请求序）；排序
   目标（数值维度 / 隐藏聚合）只出现在 ORDER BY，绝不成为返回列。
6. `related_exists` / `related_absent`：外层返回列=普通请求投影（空 `output_order`
   为 legacy dims 在前、measures 在后；非空 `output_order` 为精确列序）；related
   谓词只限定外层行，其字段/计数绝不进入返回列。
7. `set_combine`：返回两个兼容操作数的共同投影列（结果列 = 操作数投影形状）；
   `set_count`：只返回一个计数列。操作数不得携带本地 order/limit/offset，且
   `output_order` 必须为空。
8. `selected_having` / `hidden_having`：返回列=请求投影（空 `output_order` 为 legacy
   dims 在前、measures 在后；非空 `output_order` 为精确列序）；HAVING-only 聚合值
   只出现在 GROUP BY 之后（HAVING），在两种模式下都绝不进入返回列。
9. `attribute_aggregate_compare`：measureless 行级列表只返回请求维度；被比较的外层
   属性与内层标量聚合保持隐藏，内层聚合绝不成为输出列。
10. `related_hidden_row_order`：City 行级列表只返回请求的 City 维度；隐藏排序字段
    与 related 限定（多跳 correlated EXISTS）只负责排序/去留，绝不进入投影，外层
    City 行不被放大。
11. 输出列序：空 `output_order` 使用 legacy dims（请求序）在前、measures（请求序）
    在后的顺序；非空 `output_order` 是 `Ordinary`、selected/hidden HAVING 与相关
    存在 variant 的精确公共列序。hidden HAVING/order/related/scalar 机制在两种模式下
    都不进入公共输出。
12. 多 measures 须同实体粒度。
13. 字符串过滤值逐字保真，领域层不做规范化/纠错。
14. 过滤算子/输入类型按 `DOMAIN.md` 中维度声明的能力校验；文本算子只接受文本值。
15. 绑定顺序严格按 SQL 占位符顺序（filter → group/having（threshold 按谓词顺序）→
    order 无绑定 → limit/offset；related 内层过滤在行过滤位置按其有序 AND 顺序；
    集合操作按左操作数先、右操作数后）；同义表达与重复执行结果一致（SQL 与
    bindings 逐字节确定）。

## 通用示例（非数据集题目，仅示契约形状）

```json
{
  "Ordinary": {
    "measures": [], "dimensions": [{"id": "country_name"}],
    "filters": [{"id": "country_indep_year", "op": "gt", "value": 1950}],
    "order": [], "limit": null, "offset": null, "output_order": []
  }
}
```

```json
{
  "Ordinary": {
    "measures": [{"id": "country_life_expectancy_avg", "mode": "all"}],
    "dimensions": [{"id": "country_region"}],
    "filters": [], "order": [], "limit": null, "offset": null, "output_order": []
  }
}
```

```json
{
  "DistinctDimensions": {
    "dimensions": [{"id": "country_region"}],
    "filters": [], "order": [], "limit": null, "offset": null
  }
}
```

```json
{
  "HiddenRowOrder": {
    "dimensions": [{"id": "country_name"}],
    "filters": [], "sort_by": "country_population",
    "direction": "desc", "limit": 3, "offset": null
  }
}
```

```json
{
  "HiddenAggregateOrder": {
    "dimensions": [{"id": "language_name"}],
    "filters": [], "sort_by": "language_count",
    "direction": "desc", "limit": 1
  }
}
```

```json
{
  "RelatedExists": {
    "measures": [{"id": "country_count", "mode": "all"}],
    "dimensions": [], "filters": [], "order": [], "limit": null, "offset": null,
    "related": {
      "target": "country_language",
      "filters": [{"id": "language_official", "op": "eq", "value": "T"}],
      "min_matches": null
    },
    "output_order": []
  }
}
```

```json
{
  "RelatedAbsent": {
    "measures": [{"id": "country_population_sum", "mode": "all"}],
    "dimensions": [], "filters": [], "order": [], "limit": null, "offset": null,
    "related": {
      "target": "country_language",
      "filters": [{"id": "language_name", "op": "eq", "value": "English"}],
      "min_matches": null
    },
    "output_order": []
  }
}
```

```json
{
  "SetCount": {
    "kind": "intersect",
    "left": {
      "measures": [], "dimensions": [{"id": "country_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Asia"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    },
    "right": {
      "measures": [], "dimensions": [{"id": "country_name"}],
      "filters": [{"id": "country_region", "op": "eq", "value": "SampleRegion"}],
      "order": [], "limit": null, "offset": null, "output_order": []
    }
  }
}
```

```json
{
  "SelectedHaving": {
    "measures": [{"id": "country_count", "mode": "all"}],
    "dimensions": [{"id": "country_region"}],
    "filters": [], "order": [], "limit": null, "offset": null,
    "having": [{"measure": "country_count", "op": "ge", "threshold": 10}],
    "output_order": []
  }
}
```

```json
{
  "HiddenHaving": {
    "measures": [{"id": "country_count", "mode": "all"}],
    "dimensions": [{"id": "country_region"}],
    "filters": [], "order": [], "limit": null, "offset": null,
    "having": [{"measure": "country_population_sum", "op": "ge", "threshold": 100000000}],
    "output_order": []
  }
}
```

```json
{
  "HiddenHaving": {
    "measures": [{"id": "country_count", "mode": "all"}],
    "dimensions": [{"id": "country_region"}],
    "filters": [], "order": [], "limit": null, "offset": null,
    "having": [{"measure": "country_population_sum", "op": "ge", "threshold": 100000000}],
    "output_order": [
      {"Measure": "country_count"},
      {"Dimension": "country_region"}
    ]
  }
}
```

```json
{
  "AttributeAggregateCompare": {
    "dimensions": [{"id": "country_name"}],
    "filters": [], "order": [], "limit": null, "offset": null,
    "comparisons": [
      {"attribute": "country_life_expectancy", "op": "gt", "measure": "country_life_expectancy_avg", "scope_filters": []}
    ]
  }
}
```

```json
{
  "RelatedHiddenRowOrder": {
    "dimensions": [{"id": "city_name"}],
    "filters": [], "sort_by": "city_population", "direction": "desc",
    "limit": 5, "offset": null,
    "related": {
      "target": "country_language",
      "filters": [{"id": "language_name", "op": "eq", "value": "English"}]
    }
  }
}
```

```json
{
  "RelatedSetCombine": {
    "kind": "intersect",
    "left": {
      "dimensions": [{"id": "country_name"}],
      "filters": [{"id": "country_continent", "op": "eq", "value": "Asia"}],
      "related": {
        "target": "country_language",
        "filters": [{"id": "language_official", "op": "eq", "value": "T"}],
        "min_matches": null
      }
    },
    "right": {
      "dimensions": [{"id": "country_name"}],
      "filters": [{"id": "country_region", "op": "eq", "value": "SampleRegion"}],
      "related": {
        "target": "country_language",
        "filters": [{"id": "language_official", "op": "eq", "value": "F"}],
        "min_matches": null
      }
    }
  }
}
```

```json
{
  "RelatedSetCount": {
    "kind": "intersect",
    "left": {
      "dimensions": [{"id": "country_name"}],
      "filters": [],
      "related": {
        "target": "city",
        "filters": [{"id": "city_population", "op": "gt", "value": 100000}],
        "min_matches": 2
      }
    },
    "right": {
      "dimensions": [{"id": "country_name"}],
      "filters": [],
      "related": {
        "target": "country_language",
        "filters": [{"id": "language_name", "op": "eq", "value": "English"}],
        "min_matches": null
      }
    }
  }
}
```

## 错误类别（确定性拒绝）

- `vocab:` 未知 measure / dimension / 过滤维度 / 隐藏排序目标 / related target /
  集合操作数 / related set 操作数 / HAVING measure / 比较 attribute / measure（十四
  个 kind 共用同一词表校验）；
- `type:` 类型不匹配（文本算子配非文本值、文本维度配数值字面量、非数值隐藏排序
  维度、非数值 HAVING threshold、text/enum 属性对数值标量聚合等）；
- `rule:` 未知算子、维度不可筛选、空维度、隐藏排序目标已投影/跨粒度/不可达、
  隐藏聚合跨 base 实体、`hidden_aggregate_order` 带 offset、related target 过滤
  引用其它实体、外层非 country/city base 或引用其它实体维度、非正 `min_matches`、
  未知集合 kind、集合/related set 操作数非可嵌入或投影 arity/位置类别不兼容、
  related set 跨实体外层维度/过滤、相关集合并集带 ordering/pagination、
  HAVING measure 未选择 / 被选择（hidden）/ 跨 base 实体、非聚合或无分组维度的
  HAVING 请求、未知 HAVING 算子、比较 attribute 跨 base / 非外层 base 实体、非
  measureless body 或空投影、不支持的 related 多跳组合、未选择排序目标、offset 无
  排序、limit 非正、跨粒度 measures 等；
- `unsupported:` 非 family 的顶层 kind / decode 不匹配、以及尚未发布的能力形状。
