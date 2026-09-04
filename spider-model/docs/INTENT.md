# spider-model INTENT 契约 — INTENT.md

本文定义 `spider-eval/input.json` 的 JSON 契约。Resolver 依据本文写出输入；适配器
`bin/spider-make-query` 调用 `@src/bin/make-query:main` 把它确定性地转换为参数化
SQL Query。

- 词汇（measure/dimension/entity id）见 `DOMAIN.md`。
- 输入不接受表名、列名、别名、Join、SQL 或表达式；动态值只作为过滤/绑定值，绝不拼进
  SQL 文本。
- 成功输出：`{"sql":"...","bindings":[...]}`。
- 失败：非零退出码、清空 `ok.json`，并留下类别化、可归因、确定性诊断
  （`vocab:`/`type:`/`rule:`/`unsupported:`，含失败位置 id/项），不泄露私有 schema。

## 顶层结构

```jsonc
{
  "measures":       [ Measure, ... ],      // 返回的聚合（可为空）
  "dimensions":     [ Dimension, ... ],    // 返回的属性/分组维度（可为空）
  "distinct":       true | false,          // 行级去重（只用于无 measures 的列表）
  "column_order":   [ "<selected id>", ... ], // 可选：显式返回列顺序（跨 measure/dimension）
  "filters":        [ Filter, ... ],       // 属性 vs 外部标量（AND）
  "field_filters":  [ FieldFilter, ... ],  // 同主体属性 vs 属性（AND）
  "exists":         [ Exists, ... ],       // 正相关存在
  "absence":        [ Exists, ... ],       // NOT EXISTS
  "order":          [ Order, ... ],
  "having":         [ Having, ... ],       // 内部隐藏 HAVING（不返回的聚合条件）
  "limit":          int | null,
  "offset":         int | null
}
```

所有键必须出现；数组可为空；`distinct` 必须为布尔。

## 字段定义

### Measure / Dimension / Filter
同前（`DOMAIN.md` 词汇；`mode` all/distinct；算子 eq/ne/gt/ge/lt/le 与文本 contains
not_contains starts_with ends_with）。

**字符串字面量保真**：所有字符串过滤值**逐字**保持请求中的表面形式并原样进入
binding；SQLite 等值比较区分大小写，因此领域层绝不根据常识改写大小写、拼写、单复数或
别名，也不从 modeling 数据猜测替代值。未知或疑似拼写问题仍按原值查询。除非领域词表
明确声明了可证明的规范化规则，否则不做任何规范化。

### distinct
- 只用于无 measures 的纯维度列表，`SELECT DISTINCT`；列顺序按 `dimensions` 顺序。

### column_order（显式返回列序）
- 可选数组；为空时默认顺序为 `dimensions`（请求序）在前、`measures`（请求序）在后。
- 非空时逐项引用**已选择**的 measure/dimension id，必须恰好一次列全所有已选择项；
  未知/未选择/遗漏/重复稳定拒绝。
- 只改变 SELECT 列序，不改变分组/过滤/排序/bindings/行语义。
- 内部 top-N / 隐藏 HAVING 分支同样应用该显式列序（仅重排主体维度投影）。
- 不能与 `distinct` 列表组合（其列序固定为 dimensions 声明顺序）。

### Having（内部隐藏 HAVING）
```jsonc
{ "measure": "<measure id>", "op": "eq|ne|gt|ge|lt|le", "value": <number> }
```
- 只允许在 `measures` 为空、至少一个主体分组维度时使用：把 measure（主体实体或经**一条
  已声明直接关系**到达的关联实体上的普通 measure）的聚合作为隐藏 HAVING 条件，聚合不进
  入返回列；threshold 进入 bindings。
- 不能与 `distinct`、`exists`/`absence`、`offset` 组合；关系缺失/歧义、computed measure
  → `unsupported` 稳定拒绝。

### FieldFilter（同主体属性 vs 属性）
```jsonc
{ "left": "<dimension id>", "right": "<dimension id>", "op": "<comparison>" }
```
同主体、纯列、类型兼容；跨主体/computed/文本搜索算子拒绝；不产生 binding。

### Exists / absence
同前（可达路径、目标维度 filter、目标≠主体）。

### Order
同前（返回列 measure、内部排序聚合、隐藏维度排序）。

### limit / offset
`limit` 为正整数；`offset` 非负且必须带非空 `order`。

## 语义规则

1. 至少选择 1 个 measure 或 dimension。
2. 输出列顺序：默认 dims 先、measures 后；`column_order` 显式覆盖（非 distinct 列表；
   内部 top-N/隐藏 HAVING 分支同样生效）。
3. 聚合/行级/distinct/field filter/存在过滤语义同前；动态值只进 bindings。
4. 字符串过滤值逐字保真（见“Measure / Dimension / Filter”），领域层不做规范化/纠错。
5. 同义表达与重复执行结果一致（受支持逐字节相同，否则同一类 unsupported）。

## NL→intent 映射纪律（领域无关判定表）

生成 intent 前先做**结果形状检查**：先枚举请求明确要求返回的列，再单独确定过滤/排序
所需的隐藏计算；禁止因为 checker 接受普通聚合形式，就用额外结果列替代隐藏聚合。

| NL 表达 | 契约映射 |
| --- | --- |
| “有 N 个 / 数量为 N / 恰好 N 个” | HAVING `eq N`（恰好） |
| “至少 / 不少于 / N 个及以上”（明确下界） | HAVING `ge N` |
| 其它“N 个以上 / 多于 N” | 按语义用 `gt N` 或 `ge N+1`，不得用裸数字保守放宽成 `ge N` |
| “按关联数量最多/最少，返回主体若干属性” | 关联 count 仅作 hidden order（`measures` 为空）；除非请求明确要求同时显示数量，否则 count 不进 projection |

约束：

- 不要把没有下界语义的裸数字放宽成 `ge`；
- 隐藏排名场景中 `measures` 必须为空；投影只含请求明确选择的主体属性；
- 明确要求“同时返回数量”时才把对应 measure 加入 `measures`（并按需用 `column_order`
  保持其列位）。

## 不支持的形状与禁止的近似替代

已支持：无返回聚合的 measureless 主体分组请求可使用内部隐藏 Top-N / 隐藏 HAVING（主体
实体或**一条可直接证明的唯一直接关系**到达的关联实体上的普通 measure；聚合不进投影）。

真正不支持的边界（确定性 `unsupported:`）：
- 请求本身**已含返回聚合**（`measures` 非空）时，再按另一不返回的聚合排序/HAVING；
- 隐藏聚合 measure 位于**多跳**或**无法唯一证明**直接关系的实体，或为 computed/
  filtered measure；
- 无可达路径的存在/反存在；跨主体属性比较；一般集合运算（EXCEPT/INTERSECT）；派生
  标量子查询。

禁止的近似替代：
- 不得为排序/路径需要加入额外 count/measure、丢弃 distinct、引入不需要的分组或改变
  重复行语义。

## 通用示例（仅说明契约形状，非数据集题目）

1) 行级去重列表：

```json
{
  "measures": [], "dimensions": [{"id": "degree_summary_name"}],
  "distinct": true, "column_order": [],
  "filters": [], "field_filters": [], "exists": [], "absence": [],
  "order": [], "having": [], "limit": null, "offset": null
}
```

2) 返回属性并按未返回维度排序取 1 行：

```json
{
  "measures": [], "dimensions": [{"id": "student_first_name"}, {"id": "student_last_name"}],
  "distinct": false, "column_order": [],
  "filters": [], "field_filters": [], "exists": [], "absence": [],
  "order": [{"measure": null, "dimension": "student_date_registered", "direction": "asc"}],
  "having": [], "limit": 1, "offset": null
}
```

3) 分组计数并显式列序（计数在前）：

```json
{
  "measures": [{"id": "degree_count", "mode": "all"}],
  "dimensions": [{"id": "department_name"}],
  "distinct": false, "column_order": ["degree_count", "department_name"],
  "filters": [], "field_filters": [], "exists": [], "absence": [],
  "order": [], "having": [], "limit": null, "offset": null
}
```

4) 正相关存在（两跳 link）：

```json
{
  "measures": [], "dimensions": [{"id": "student_first_name"}],
  "distinct": false, "column_order": [],
  "filters": [], "field_filters": [], "absence": [],
  "exists": [
    {"target": "degree_program", "filters": [{"id": "degree_summary_name", "op": "eq", "value": "Master"}]}
  ],
  "order": [], "having": [], "limit": null, "offset": null
}
```

5) 反相关存在：

```json
{
  "measures": [], "dimensions": [{"id": "student_first_name"}],
  "distinct": false, "column_order": [],
  "filters": [], "field_filters": [], "exists": [],
  "absence": [
    {"target": "degree_program", "filters": [{"id": "degree_summary_name", "op": "eq", "value": "Master"}]}
  ],
  "order": [], "having": [], "limit": null, "offset": null
}
```

6) 同主体属性比较：

```json
{
  "measures": [], "dimensions": [{"id": "student_id"}],
  "distinct": false, "column_order": [],
  "filters": [], "exists": [], "absence": [],
  "field_filters": [
    {"left": "student_current_address", "right": "student_permanent_address", "op": "eq"}
  ],
  "order": [], "having": [], "limit": null, "offset": null
}
```

## 错误示例

- `vocab:` 未知 measure / dimension / entity / 相关目标 / 属性 / column_order 项；
- `type:` 数值维度配文本值、文本算子配非字符串值、field-to-field 类型/域不兼容；
- `rule:` 非法算子、维度不可筛选、隐藏排序维度不可达、distinct+measure/absence、
  offset 无排序、limit 非正、跨粒度 measures、相关目标等于主体、内层引用非目标实体、
  column_order 遗漏/重复/未选择、field filter 与 distinct/存在/内部 top 组合；
- `unsupported:` 多跳/无法唯一证明直接关系的关联聚合、含返回聚合的请求再按其它不返回
  聚合排序/HAVING、无可达路径存在、跨主体属性比较、一般集合运算、派生标量子查询。
