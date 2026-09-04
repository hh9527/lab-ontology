# spider-model INTENT 契约 — INTENT.md

本文定义 `spider-eval/input.json` 的 JSON 契约。Resolver 依据本文写出输入；适配器
`bin/spider-make-query` 调用 `@src/bin/make-query:main` 把它确定性地转换为参数化
SQL Query。

- 词汇（measure/dimension/entity id）见 `DOMAIN.md`。
- 本契约不接受表名、列名、别名、Join、SQL 或表达式。所有动态值只作为过滤/绑定值
  出现，绝不会被拼进 SQL 文本。
- 成功输出（`spider-eval/ok.json`）为一个 JSON 对象：
  ```json
  {"sql":"...","bindings":[...]}
  ```
  `sql` 中只出现 `?` 占位符；所有运行期值按 `?` 出现顺序进入 `bindings`（JSON
  标量）。
- 失败：未知词汇、类型错误、非法组合、契约不匹配都会返回非零退出码、清空 `ok.json`
  并留下确定性、可归因且**区分失败类别**的诊断（消息包含失败位置 id/项与规则说明，
  如 `vocab: …`、`type: …`、`rule: …`、`unsupported: …`）。

## 顶层结构

```jsonc
{
  "measures":   [ Measure, ... ],     // 可为空数组
  "dimensions": [ Dimension, ... ],   // 可为空数组
  "distinct":   true | false,
  "filters":    [ Filter, ... ],      // 可为空数组
  "exists":     [ Exists, ... ],      // 可为空数组
  "absence":    [ Exists, ... ],      // 可为空数组
  "order":      [ Order, ... ],       // 可为空数组
  "limit":      int | null,
  "offset":     int | null
}
```

所有键都必须出现；数组允许为空；`distinct` 必须为布尔。

## 字段定义

### Measure（指标项）

```jsonc
{ "id": "<measure id>", "mode": "all" | "distinct" }
```

- `id` 必须是 `DOMAIN.md` 中定义的 measure id。
- `mode`: `"all"` 普通聚合；`"distinct"` 去重后计数。
- 只含 measures → 全量单行聚合；含 measures+dimensions → 按全部 dimensions 分组
  聚合。

### Dimension（维度项）

```jsonc
{ "id": "<dimension id>" }
```

- `id` 必须是 `DOMAIN.md` 中定义的 dimension id。
- 有 measure 时，全部 dimensions 同时是分组键与输出属性；无 measure 时是行级列表的
  输出属性（普通列表不去重）。

### distinct（行级去重）

- `distinct: true` 只允许用于**不含 measure** 的纯维度列表，语义为“返回互不重复的
  维度值组合”（`SELECT DISTINCT`，对投影维度去重），不引入任何未请求的计数。
- `distinct: true` 时维度必须非空，且不能与 `absence` 组合；只能按已投影维度排序。

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

### Exists（正相关存在过滤）与 absence（反相关存在过滤）

```jsonc
{ "target": "<entity id>", "filters": [ Filter, ... ] }
```

`exists` 与 `absence` 使用同一形状；二者各自表达：

- `exists`（正相关存在）：保留主体中“存在至少一条满足 `filters` 的相关记录”的行；
  多条 Exists 之间为 AND，因此可表达“同一主体分别存在满足 A 与满足 B 的相关记录”
  （A、B 可由不同关联行满足）。
- `absence`（反相关存在，`NOT EXISTS`）：保留主体中“**没有**任何满足 `filters` 的
  相关记录”的行（零匹配主体）。

两者的公共约束：

- `target` 必须是 `DOMAIN.md` 中定义、且与主体之间有已声明可达关系的 entity id；
  `filters` 只能引用**目标实体**自己的维度。
- 主体实体由 measures（有则取第一个的实体）或 dimensions（否则取第一个的实体）
  决定。目标不得等于主体。
- `distinct: true` 不能与 `absence` 组合；集合运算（EXCEPT/INTERSECT 的两个任意
  投影集合求差/交）仍为当前契约**不支持**的形状，会得到 `unsupported: …`
  确定性诊断，不会被改写成其它语义。

### Order（排序项）

```jsonc
{ "measure": "<measure id>" | null, "dimension": "<dimension id>" | null,
  "direction": "asc" | "desc" }
```

- 恰好指定 `measure` 与 `dimension` 中的一个（另一个为 `null`）。
- measure 目标分两种情况：
  - 出现在 `measures` 中：普通聚合排序（该聚合是返回列，排序目标引用已投影聚合）。
  - `measures` 为空、但选择了一个或多个分组维度时：可以是**内部排序聚合**（即
    `lower_internal_top` 语义）——按主体实体上的一个普通/条件 measure 分组排序并取
    Top-N，该聚合**只进 ORDER BY、不成为返回列**。内部排序聚合要求：非 distinct、
    无 offset、不与 exists/absence 组合、measure 已授权且位于主体实体（非计算
    measure）；维度 tie-breaker 必须是已选择的维度。
  - 若 `measures` 非空而排序目标是不在其中（不返回）的 measure，则仍为**不支持**
    （当前基础层不允许隐藏聚合排序的聚合请求），得到 `unsupported:` 诊断。
- dimension 目标可以是已选择维度；也可以是**未返回**的维度，但仅限：
  - 请求不含 measure（纯行级列表）、
  - `distinct` 为 `false`、
  - 该维度已授权，且从主体经**安全（不扩 grain）路径**可达。
  此约束保证“只返回若干属性、按未返回属性排序”这类意图可表达，且不改变行语义或
  输出列。聚合/内部 top-N 意图内按未选择维度排序、`distinct` 列表按未选择维度排序都
  会被拒绝。
- `direction`: `"asc"` 升序、`"desc"` 降序。

### limit / offset（Top-N 与分页）

- `limit`: 正整数（截断返回行数）；`null` 表示不限。
- `offset`: 非负整数（跳过前若干行）；`null` 表示不偏移。**提供 `offset` 时必须同时
  提供非空 `order`**（稳定排序），否则拒绝。
- `limit` 与 `offset` 一起表达“前 N 行”/“跳过 M 行取 N 行”等 Top-N 与分页语义。

## 不支持的形状与禁止的近似替代

**一致性保证**：同一语义意图的不同同义表达以及同一输入的重复执行，都必须得到**一致**
的结果——受支持时得到逐字节相同的 `sql`/`bindings`，不受支持时得到**相同类别**的
确定性 `unsupported:` 诊断。不得因为措辞/编码差异，一部分成功而另一部分退化为
“link count + GROUP BY”近似。

为避免“为满足排序或路径需要而额外返回列”的近似结果，以下形状是**不支持**的；请勿用
加入额外 count measure / 引入分组来“建立路径”。若你真的需要这些结果，应把该意图
交给更上层判定为 `unsupported`（本入口会返回带 `unsupported:` 前缀的确定性诊断），
而不是修改返回列：

1. **“按每组的某统计值排序/筛选取 Top、但只返回分组维度”**：当请求不含任何返回聚合
   （`measures` 为空）且该统计值是**主体实体上的普通/条件 measure** 时，这是**受支持**
   的内部排序聚合（只进 ORDER BY）。只有当请求本身含有返回聚合（`measures` 非空）、
   却又要按一个**不返回**的聚合排序/HAVING 时，才是不支持的形状——请不要把该聚合临时
   加入 `measures` 来换取成功（那会产生多余的返回列）。
2. **“主体维度 + 两跳关系条件”**：正/反存在（exists/absence）支持一跳（含反向）与
   作者声明的两跳路线；fan-out 首跳的两跳路线（如
   `Singer → SingerInConcert → Concert`）由基础层 link 形状表达，只返回主体维度、
   不放大主体 grain。只有当该两跳路径**没有**声明可达路线/关系（例如主体到目标之间
   既无一跳也无已声明 `exists_route`）时才是 unsupported——不要用 link-entity 的
   count measure + GROUP BY 来近似（那会改变返回列与行粒度）。
   这类意图会得到 `unsupported: no declared relation …` 诊断。
3. 一般集合运算（两个任意投影集合的 EXCEPT/INTERSECT）与派生标量子查询比较同样
   不支持，保持确定性 `unsupported:` 拒绝。

## 语义规则（输出列 / 过滤器 / 聚合 / 排序 / Top-N）

1. 至少选择 1 个 measure 或 dimension，否则拒绝。
2. **输出列顺序**：`dimensions` 按请求顺序在前，`measures` 按请求顺序在后。列集合与
   顺序忠实于请求；不会因为排序/存在过滤/去重需要而加入未被请求的列或“幽灵计数”。
3. 聚合：只含 measures → 全量单行聚合；含 measures+dimensions → 按全部 dimensions
   分组聚合。
4. 行级列表：只含 dimensions → 返回这些属性；`distinct: true` 时对投影属性去重，
   否则保留重复行。
5. 多 measures 必须同属一个业务对象（同一实体粒度），否则拒绝。
6. 筛选与正/反相关存在过滤（exists/absence）先于排序/分页；所有动态值参数化绑定，
   绝不进入 SQL 文本。
7. 排序规则见 Order；`offset` 依赖非空 `order`；绑定顺序为过滤/存在绑定后接
   `limit` 再 `offset`。
8. 同一个合法输入总是产生逐字节相同的 `sql` 与顺序相同的 `bindings`。

## 通用示例（仅说明契约形状，非数据集题目）

以下使用占位业务值；实际 measure/dimension id 以 `DOMAIN.md` 为准。

1) 统计某文本维度等于给定值的记录数：

```json
{
  "measures": [{"id": "singer_count", "mode": "all"}],
  "dimensions": [],
  "distinct": false,
  "filters": [{"id": "singer_country", "op": "eq", "value": "AAA"}],
  "exists": [],
  "absence": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

2) 按某个文本维度分组计数（输出列：该维度在前、计数在后）：

```json
{
  "measures": [{"id": "singer_count", "mode": "all"}],
  "dimensions": [{"id": "singer_country"}],
  "distinct": false,
  "filters": [],
  "exists": [],
  "absence": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

3) 行级去重列表（只返回互不重复的属性值）：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_country"}],
  "distinct": true,
  "filters": [],
  "exists": [],
  "absence": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

4) 行级列表：按数值属性范围筛选并列出两个属性：

```json
{
  "measures": [],
  "dimensions": [{"id": "stadium_location"}, {"id": "stadium_name"}],
  "distinct": false,
  "filters": [
    {"id": "stadium_capacity", "op": "ge", "value": 5000},
    {"id": "stadium_capacity", "op": "le", "value": 10000}
  ],
  "exists": [],
  "absence": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

5) 返回两个属性但按未返回的第三个维度排序，取 1 行（未返回维度只进 ORDER BY）：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_song_name"}, {"id": "singer_song_year"}],
  "distinct": false,
  "filters": [],
  "exists": [],
  "absence": [],
  "order": [{"measure": null, "dimension": "singer_age", "direction": "asc"}],
  "limit": 1,
  "offset": null
}
```

6) 排序 + Top-N + 一个文本筛选：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_name"}, {"id": "singer_country"}],
  "distinct": false,
  "filters": [{"id": "singer_country", "op": "eq", "value": "AAA"}],
  "exists": [],
  "absence": [],
  "order": [{"measure": null, "dimension": "singer_country", "direction": "asc"}],
  "limit": 5,
  "offset": null
}
```

7) 正相关存在：返回分别存在满足 A 与满足 B 关联记录的主体属性：

```json
{
  "measures": [],
  "dimensions": [{"id": "stadium_name"}],
  "distinct": false,
  "filters": [],
  "exists": [
    {"target": "concert", "filters": [{"id": "concert_year", "op": "eq", "value": 2014}]},
    {"target": "concert", "filters": [{"id": "concert_year", "op": "eq", "value": 2015}]}
  ],
  "absence": [],
  "order": [],
  "limit": null,
  "offset": null
}
```

8) 反相关存在（absence / NOT EXISTS）：返回没有任何满足条件的关联记录的主体属性：

```json
{
  "measures": [],
  "dimensions": [{"id": "stadium_name"}],
  "distinct": false,
  "filters": [],
  "exists": [],
  "absence": [
    {"target": "concert", "filters": [{"id": "concert_year", "op": "eq", "value": 2014}]}
  ],
  "order": [],
  "limit": null,
  "offset": null
}
```

9) 分页（带稳定排序）：

```json
{
  "measures": [],
  "dimensions": [{"id": "singer_name"}],
  "distinct": false,
  "filters": [],
  "exists": [],
  "absence": [],
  "order": [{"measure": null, "dimension": "singer_name", "direction": "asc"}],
  "limit": 10,
  "offset": 20
}
```

## 错误示例（会确定性拒绝，消息含类别前缀）

- `vocab:` 未知 measure / dimension / entity / 存在或反存在目标；
- `type:` 数值维度配文本值、文本算子配非字符串值、值类型不在维度声明内；
- `rule:` 未知/非法算子、维度不可筛选、未选择排序目标（维度）、聚合意图内隐藏排序
  维度、隐藏排序维度不可安全到达、`distinct` 与 measure 或 absence 并用、`offset`
  无排序、`limit` 非正、`offset` 为负、跨实体多 measures、exists/absence 目标等于
  主体、exists/absence 内层引用非目标实体；
- `unsupported:` 含返回聚合的请求按未返回聚合排序/HAVING、exists/absence 无可达关系
  路径（未声明的一跳/两跳 route）、内部排序 measure 位于非主体实体或是计算 measure、
  两个任意投影集合的一般集合运算（EXCEPT/INTERSECT）与派生标量子查询比较。

**近似替代一律不被接受**：本入口不会为排序/路径需要自动加入返回列、不会丢弃
distinct、不会引入不需要的分组，也不会改变重复行语义。若底层能力无法忠实表达，
就以 `unsupported:` 确定性失败。
