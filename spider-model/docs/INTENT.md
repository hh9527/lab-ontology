# spider-model INTENT 契约 — INTENT.md

本文定义 `spider-eval/input.json` 的 JSON 契约。Resolver 依据本文写出输入；适配器
`bin/spider-make-query` 调用 `@src/bin/make-query:main`，把输入 `Value` 直接交给
`ontology/intent::query_intent_lower_factory(payload, "public")`，确定性地转换为参数化
SQL Query。领域内**没有**自定义 parser/lowering 分支。

- 词汇（measure/dimension/entity id）见 `DOMAIN.md`；id 之外不接受任何表名、列名、别名、
  Join、SQL 或表达式。
- 动态值只作为过滤/阈值/分页绑定值，绝不拼进 SQL 文本。
- 成功输出：`{"sql":"...","bindings":[...]}`。
- 失败：非零退出码、清空 `ok.json`；诊断由 ontology 工厂给出，类别化、可归因且确定性
  （`vocab:`/`type:`/`rule:`/`unsupported:` 类信息），不泄露私有 schema。
- 重复执行相同输入逐字节一致；同义输入（键序不同、语义相同）结果一致。

## 顶层结构

输入是一个对象，必须含 `op`；其值从下列封闭集合中选取。每种 `op` 使用下述公共字段的
子集：

```jsonc
{
  "op": "list | count | aggregate | top | distinct | exists | absence",
  "measures":   [ "<measure id>", ... ],
  "dimensions": [ "<dimension id>", ... ],
  "filters":    [ Filter | FieldFilter, ... ],   // AND；FieldFilter 仅 list 可用
  "ordering":   [ Order, ... ],
  "output_order": [ "<dimension id>", ... ],      // 仅 list 可用，可省略
  "exists":     [ Exists, ... ],                  // exists/absence 的相关条件；count/aggregate 可带
  "having":     [ Having, ... ],
  "hidden_having": [ InternalHaving, ... ],       // aggregate（同源）/ top（关联）可用
  "limit":      int | null,
  "offset":     int | null
}
```

字段类型约定：`measures`/`dimensions`/`ordering`/`output_order` 必须存在（可为空数组，
`output_order` 可省略）；`filters`、`exists`、`having`、`hidden_having` 可省略，省略视为空。
`limit`/`offset` 必须是整数或 `null`。非对象、未知 `op`、未知集合 `kind`、缺失/类型错误
字段由工厂确定性拒绝。

### Filter（标量过滤）
```jsonc
{ "dimension": "<id>", "op": "eq|ne|gt|ge|lt|le|contains|not_contains|starts_with|ends_with",
  "kind": "text|int|number", "value": <标量> }
```
`kind` 与 `value` 类型必须匹配维度类型（文本维度用 `text` 字符串，整数维度用 `int`）；
数值/文本算子的可用性以模型声明为准。**字符串字面量保真**：字符串过滤值逐字保持请求中
的表面形式并原样进入 binding；领域层绝不改写大小写、拼写、单复数、缩写或别名，也不从
modeling 数据猜测替代值；未知或疑似拼写问题仍按原值查询。

### FieldFilter（同主体属性 vs 属性，仅 list）
```jsonc
{ "left": "<dimension id>", "right": "<dimension id>", "op": "eq|ne|gt|ge|lt|le" }
```
同主体、类型兼容、纯列属性对；不产生 binding。放在其它 `op` 下会被拒绝。

### Order
```jsonc
{ "target": "Dimension|Measure", "id": "<id>", "direction": "Asc|Desc" }
```
- `list`：`target: "Dimension"` 的隐藏或已选维度排序（不返回的排序维度合法）。
- `top`：`target` 必须是 `"Measure"`，id 为关联侧的普通 count 指标（隐藏排序聚合）。

### Exists（相关存在条件，exists/absence 语义）
```jsonc
{ "target": "<entity id>", "filters": [ Filter, ... ] }
```
`exists` 的 `op`：返回“存在相关行”的主体行/数；`absence` 的 `op`：返回“不存在相关行”的
主体行/数。target 沿模型声明的可达直接关系到达（两跳 link 由模型 `exists_route` 显式声明），
主体粒度保持去重。

### Having（可见聚合的 HAVING）
```jsonc
{ "measure": "<measure id>", "op": "eq|ne|gt|ge|lt|le", "kind": "int|number", "value": <数> }
```
用于 `count`/`aggregate`/`exists`/`absence` 带可见指标的场景。

### InternalHaving（隐藏聚合 HAVING）
```jsonc
{ "measure": "<measure id>", "op": "eq|ne|gt|ge|lt|le", "kind": "int|number", "value": <数> }
```
- `aggregate` 的 `hidden_having`：同源（根主体自身指标）隐藏聚合 HAVING，不返回该列。
- `top` 的 `hidden_having`：沿一条已声明直接关系到达的关联侧普通 count 指标的隐藏 HAVING，
  不返回该列。
- threshold 进入 bindings；`eq` 表示“恰好 N 个”，`ge`/`gt`/`le`/`lt`/`ne` 分别表示对应
  边界语义。

## op 形状与投影纪律

| op | measures | dimensions | 可用附加 | 语义 |
| --- | --- | --- | --- | --- |
| `list` | 空 | 至少 1 | filters(含 FieldFilter), ordering(Dimension), output_order, limit/offset | 行级列表；按 dimensions 请求序投影；output_order 可把已选维度重排（须恰好列全一次） |
| `count` | 1 个 count 指标 | 空 | filters, exists, having | 单行计数 |
| `aggregate` | 至少 1 | 至少 1 | filters, exists, having, hidden_having(同源), ordering | 分组聚合；投影列序固定为 measures（请求序）在前、dimensions（请求序）在后 |
| `top` | 空 | 至少 1 | filters, ordering(Measure 隐藏排序), hidden_having(关联), limit/offset | 关联聚合隐藏 Top-N；投影只含 dimensions（请求序），聚合绝不进投影 |
| `distinct` | 空 | 至少 1 | filters | 行级去重列表（dimensions 请求序） |
| `exists` | 可选 count | 可为空 | exists, having | 存在相关行的主体行/计数，主体去重 |
| `absence` | 可选 count | 可为空 | exists, having | 无相关行的主体行/计数，主体去重 |

- “按关联数量最多/最少，返回主体若干属性”：一律 `top`，关联 count 只作 `ordering` 的
  隐藏聚合，`measures` 必须为空；除非请求明确要求同时显示数量，否则 count 不进投影。
- “恰好 N 个 / 数量为 N”：HAVING/`hidden_having` 用 `eq N`；只有“至少 / 不少于 / N 个
  及以上”明确下界语义才用 `ge N`，不得把裸数字保守放宽成下界。
- 隐藏计算（top 排序、hidden_having）不得改写成可见 measure/额外投影列。
- 只含 dimensions → 行级；只含 measures → 全量单行；measures+dimensions → 分组。
- `limit` 正整数；`offset` 非负且需搭配非空 `ordering`/确定排序语义的 top。
- `output_order` 只对 `list` 生效（用于显式投影列序，见 `INTENT` 投影列规则）。

## 字符串字面量保真

除非领域词表声明可证明的规范化规则，所有字符串过滤值必须逐字进入 binding，SQLite 等值
比较区分大小写，因此不得修正大小写、拼写、单复数或别名，也不得从 modeling 数据猜测替代
值。未知/疑似拼写按原值查询，不由领域层静默纠正。

## 不支持的形状与禁止的近似替代

确定性 `unsupported:`/拒绝，不做普通 measure/EXISTS/自连接/结果后处理或手写 SQL 旁路：

- 多跳或无 `exists_route`/无法唯一证明直接关系的关联聚合、存在路由；
- `top`/`hidden_having` 的目标 measure 位于多跳或无法唯一证明直接关系的实体；
- `output_order` 用在 `list` 以外的形状；distinct 计数（对某维度取值去重后的计数值，本
  公共协议不提供 distinct 计数 measure）；
- 任意表名/列名/alias/Join/SQL/表达式作为输入；
- 把隐藏排序/HAVING 所需的聚合作为可见 measure 混入投影；
- `aggregate` 的 `hidden_having` 与 `having`/`exists` 混用；`top` 携带可见 measures。

## 通用示例（仅说明契约形状，非数据集题目）

1) `list`：学生姓名列表，按注册日期取最早 1 行（隐藏维度排序 + limit）：

```json
{
  "op": "list", "measures": [], "dimensions": ["student_first_name", "student_last_name"],
  "filters": [], "ordering": [{"target": "Dimension", "id": "student_date_registered", "direction": "Asc"}],
  "output_order": ["student_last_name", "student_first_name"], "limit": 1, "offset": null
}
```

2) `count`：某系下学位项目数：

```json
{
  "op": "count", "measures": ["degree_count"], "dimensions": [],
  "filters": [{"dimension": "department_name", "op": "eq", "kind": "text", "value": "engineer"}],
  "ordering": [], "limit": null, "offset": null
}
```

3) `aggregate`：按系统计学位项目数（投影列序：指标前、维度后）：

```json
{
  "op": "aggregate", "measures": ["degree_count"], "dimensions": ["department_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null
}
```

4) `distinct`：去重学位摘要名：

```json
{
  "op": "distinct", "measures": [], "dimensions": ["degree_summary_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null
}
```

5) `exists`：注册了某学位项目（两跳）的学生名：

```json
{
  "op": "exists", "measures": [], "dimensions": ["student_first_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null,
  "exists": [{"target": "degree_program", "filters": [{"dimension": "degree_summary_name", "op": "eq", "kind": "text", "value": "Master"}]}]
}
```

6) `absence`：未注册某学位项目的学生名：

```json
{
  "op": "absence", "measures": [], "dimensions": ["student_first_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null,
  "exists": [{"target": "degree_program", "filters": [{"dimension": "degree_summary_name", "op": "eq", "kind": "text", "value": "Master"}]}]
}
```

7) `top`：注册数最多的学期名（隐藏关联聚合排序，limit 参数化）：

```json
{
  "op": "top", "measures": [], "dimensions": ["semester_name"],
  "filters": [], "ordering": [{"target": "Measure", "id": "enrolment_count", "direction": "Desc"}],
  "limit": 1, "offset": null
}
```

8) `top` + `hidden_having`：注册数恰好为 3 的学生姓名（eq 阈值进入 bindings）：

```json
{
  "op": "top", "measures": [], "dimensions": ["student_first_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null,
  "hidden_having": [{"measure": "enrolment_count", "op": "eq", "kind": "int", "value": 3}]
}
```

## 错误分类（诊断前缀示例）

- `vocab:` 未知 measure/dimension/entity/exists target/ordering id；
- `type:` 文本维度配数值值或反之、`kind` 与 `value` 不符、文本算子配非字符串值、字段比较
  类型不兼容；
- `rule:` 非法/不支持算子、`output_order` 非 list、非正 limit、offset 无排序、跨粒度组合、
  FieldFilter 用于非 list 形状、top 携带 measures；
- `unsupported:` 无唯一直接关系/无路由的关联聚合或存在、多跳隐藏聚合、distinct 计数、
  一般集合运算与派生标量子查询（本领域不发布 `set`/`set_count`/`compare`/`ranked` 形状的
  intent）。
