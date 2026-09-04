# spider-model INTENT 契约 — INTENT.md

本文定义 `spider-eval/input.json` 的 JSON 契约。Resolver 依据本文写出输入；适配器
`bin/spider-make-query` 调用 `@src/bin/make-query:main` 把它确定性地转换为参数化
SQL Query。

- 词汇（measure/dimension id）见 `DOMAIN.md`。
- 本契约不接受表名、列名、别名、Join、SQL 或表达式。所有动态值只作为过滤/绑定值
  出现，绝不会被拼进 SQL 文本。
- 成功输出（`spider-eval/ok.json`）为一个 JSON 对象：
  ```json
  {"sql":"...","bindings":[...]}
  ```
  `sql` 中只出现 `?` 占位符；所有运行期值按 `?` 出现顺序进入 `bindings`（JSON
  标量）。
- 失败：未知词汇、类型错误、非法组合、契约不匹配都会返回非零退出码、清空 `ok.json`
  并留下确定性可归因诊断。

## 顶层结构

```jsonc
{
  "measures":   [ Measure, ... ],     // 可为空数组
  "dimensions": [ Dimension, ... ],   // 可为空数组
  "filters":    [ Filter, ... ],      // 可为空数组
  "order":      [ Order, ... ],       // 可为空数组
  "limit":      int | null,
  "offset":     int | null
}
```

所有键都必须出现；数组允许为空。

## 字段定义

### Measure（指标项）

```jsonc
{ "id": "<measure id>", "mode": "all" | "distinct" }
```

- `id` 必须是 `DOMAIN.md` 中定义的 measure id。
- `mode`: `"all"` 普通聚合；`"distinct"` 去重后计数。
- 只含 measure 的请求对全量做一次聚合；同时含 dimensions 时按维度分组。

### Dimension（维度项）

```jsonc
{ "id": "<dimension id>" }
```

- `id` 必须是 `DOMAIN.md` 中定义的 dimension id。
- 有 measure 时，全部 dimensions 同时是分组键与输出属性；无 measure 时是行级列表的
  输出属性。

### Filter（筛选项）

```jsonc
{ "id": "<dimension id>", "op": "<operator>", "value": <scalar> }
```

- `id` 必须是可筛选的 dimension id。
- `value` 是 JSON 标量：字符串、整数或浮点数。
- 算子（`op`）：
  - 数值/文本通用的比较：`"eq"`, `"ne"`, `"gt"`, `"ge"`, `"lt"`, `"le"`；
  - 文本专用：`"contains"`, `"not_contains"`, `"starts_with"`, `"ends_with"`
    （requires 字符串 value）。
- 多条 Filter 之间为 AND；筛选维度不要求同时出现在 `dimensions` 中。
- 语义约束：数值维度不接受文本算子；文本算子不接受非字符串值；算子和值类型必须被
  该维度声明支持，否则是类型错误。

### Order（排序项）

```jsonc
{ "measure": "<measure id>" | null, "dimension": "<dimension id>" | null,
  "direction": "asc" | "desc" }
```

- 恰好指定 `measure` 与 `dimension` 中的一个（另一个为 `null`）。
- 目标必须是**本请求已选择**（出现在 `measures` 或 `dimensions` 中）的项。
- `direction`: `"asc"` 升序、`"desc"` 降序。

### limit / offset（Top-N 与分页）

- `limit`: 正整数（截断返回行数）；`null` 表示不限。
- `offset`: 非负整数（跳过前若干行）；`null` 表示不偏移。**提供 `offset` 时必须同时
  提供非空 `order`**（稳定排序），否则拒绝。
- `limit` 与 `offset` 一起表达“前 N 行”/“跳过 M 行取 N 行”等 Top-N 与分页语义。

## 语义规则（过滤器 / 聚合 / 排序 / Top-N）

1. 至少选择 1 个 measure 或 dimension，否则拒绝。
2. 聚合：只含 measures → 全量单行聚合；含 measures+dimensions → 按全部 dimensions
   分组聚合（dimensions 输出并分组）。
3. 行级列表：只含 dimensions → SELECT 这些属性；不分组、无虚拟计数。
4. 多 measures 必须同属一个业务对象（同一实体粒度），否则拒绝。
5. 筛选先于聚合/排序；筛选是参数化绑定，值绝不进入 SQL 文本。
6. 排序目标必须是已选择项；`direction` 只允许 asc/desc。
7. `limit` 必须为正、`offset` 必须为非负且要求排序；`offset` 与 `limit` 按 SQL 语义
   确定绑定顺序（`limit` 值在 `offset` 值之前）。
8. 同一个合法输入总是产生逐字节相同的 `sql` 与顺序相同的 `bindings`。

## 通用示例（仅说明契约形状，非数据集题目）

以下使用占位业务值；实际 measure/dimension id 以 `DOMAIN.md` 为准。

1) 统计某文本维度等于给定值的记录数：

```json
{
  "measures": [{"id": "singer_count", "mode": "all"}],
  "dimensions": [],
  "filters": [{"id": "singer_country", "op": "eq", "value": "AAA"}],
  "order": [],
  "limit": null,
  "offset": null
}
```

2) 按某个文本维度分组计数（列出每组与计数）：

```json
{
  "measures": [{"id": "singer_count", "mode": "all"}],
  "dimensions": [{"id": "singer_country"}],
  "filters": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

3) 行级列表：按数值属性范围筛选并列出两个属性：

```json
{
  "measures": [],
  "dimensions": [{"id": "stadium_location"}, {"id": "stadium_name"}],
  "filters": [
    {"id": "stadium_capacity", "op": "ge", "value": 5000},
    {"id": "stadium_capacity", "op": "le", "value": 10000}
  ],
  "order": [],
  "limit": null,
  "offset": null
}
```

4) 排序 + Top-N + 一个文本筛选：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_name"}, {"id": "singer_country"}],
  "filters": [{"id": "singer_country", "op": "eq", "value": "AAA"}],
  "order": [{"measure": null, "dimension": "singer_country", "direction": "asc"}],
  "limit": 5,
  "offset": null
}
```

5) 分页（带稳定排序）：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_name"}],
  "filters": [],
  "order": [{"measure": null, "dimension": "singer_name", "direction": "asc"}],
  "limit": 10,
  "offset": 20
}
```

## 错误示例（会确定性拒绝）

- 未知 measure / dimension / 筛选维度 id；
- 算子拼写错误、数值维度配文本算子、文本算子配非字符串值；
- 排序目标未选择、同时指定 measure 与 dimension、方向非法；
- `offset` 无排序、`limit` 非正、`offset` 为负；
- 只含一个 measure、无 measures 也无 dimensions、跨实体多 measures。

这些输入不会产出部分 SQL；诊断确定且可归因。
