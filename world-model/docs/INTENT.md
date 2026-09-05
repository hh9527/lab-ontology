# world-model INTENT 契约 — INTENT.md

`world-eval/input.json` 是 ontology **共享 closed Intent protocol**（`Value`）的 JSON。
Resolver 写出的输入只引用 `DOMAIN.md` 声明的稳定 measure/dimension/entity id；永不含
表名/列名/别名/join/SQL/表达式。Lowering 由
`ontology/intent::query_intent_lower_factory(payload, "public")` 确定性完成（world-model
不再自带领域 query 模块）。

- 成功输出：`{"sql":"...","bindings":[...]}`；bindings 为原生 JSON 标量。
- 失败：非零退出、清空 ok、带诊断；lowering 失败是原子的（不发布部分 Query）。

## 顶层

每个 intent 是 JSON object，带 `op`（封闭操作词表）与共享请求字段。

```jsonc
{
  "op": "list | count | aggregate | top | distinct | exists | absence | set | set_count | compare | ranked",
  // 共享请求字段（依 op 需要）：
  "measures":   [ "measure id", ... ],
  "dimensions": [ "dimension id", ... ],
  "filters":    [ Filter | FieldFilter, ... ],
  "ordering":   [ { "target": "Measure"|"Dimension", "id": "...", "direction": "Asc"|"Desc" }, ... ],
  "limit":      int | null,
  "offset":     int | null,
  "output_order": [ "dimension id", ... ],   // list/compare/ranked：空 = 默认列序；非空 = 精确
  "exists":     [ ExistsSpec, ... ],
  "having":     [ HavingSpec, ... ],
  "hidden_having": [ HavingSpec, ... ]
}
```

Filter：`{ "dimension": id, "op": "eq|ne|gt|ge|lt|le|contains|not_contains|starts_with|ends_with", "kind": "text"|"int"|"number", "value": scalar }`。
FieldFilter（只用于 `list`）：`{ "left": dimension, "op": 比较算子, "right": dimension }`。
ExistsSpec：`{ "target": entity id, "filters": [Filter...], "min_matches": int|null }`。
HavingSpec：`{ "measure": id, "op": "eq|ne|gt|ge|lt|le", "kind": "int"|"number", "value": numeric }`。

## 操作语义

- `list`：行级维度投影（可选过滤/排序/Top-N）；可带 field-to-field 谓词。
- `count`：标量聚合（measures）概要，保留过滤与存在性。
- `aggregate`：分组聚合（measures + dimensions），可选 ordering/limit/having；也可用
  `hidden_having`（base 实体上未投影简单聚合的 HAVING）。
- `top`：分组 top-N，按隐藏 related measure（`ordering` 中 `target: "Measure"`）排序，
  只返回分组维度。
- `distinct`：行级 `SELECT DISTINCT`（dimensions）。
- `exists`：保留有相关记录（correlated EXISTS）的 base 行/计数。
- `absence`：保留无相关记录的 base 行/计数（NOT EXISTS）。
- `set` / `set_count`：两个分支的集合运算（union/intersect/except），见下。
- `compare`：行级列表 + 数值外层属性 vs 标量聚合（`comparisons`）。
- `ranked`：行级列表 + 外层属性与隐藏 top/bottom 分组 key 比较。

## set / set_count

```jsonc
{
  "op": "set" | "set_count",
  "kind": "union" | "intersect" | "except",
  "branches": [
    {
      "shape": "row" | "exists" | "absence",
      "measures": [ ... ], "dimensions": [ ... ],
      "filters": [ ... ],
      "ordering": [], "limit": null, "offset": null,
      "exists": [ ... ], "having": [ ... ]
    },
    { /* 第二个操作数，形状同上 */ }
  ]
}
```

分支是 dimension-only 或带相关/缺失限定的列表；不得携带本地 ordering/limit/offset。
`set_count` 只返回集合基数。

## compare

```jsonc
{
  "op": "compare",
  "dimensions": [ "list dimension", ... ],
  "filters": [ ... ],
  "comparisons": [
    {
      "attribute": "outer numeric dimension",
      "op": "eq|ne|lt|le|gt|ge",
      "measure": "numeric measure id",
      "scope": [ Filter, ... ]   // 空 = 全局聚合；非空只收窄内层聚合行
    }
  ]
}
```

## 通用示例（一般契约形状，非数据集题目）

```json
{
  "op": "list",
  "measures": [], "dimensions": ["country_name"],
  "filters": [{"dimension": "country_indep_year", "op": "gt", "kind": "int", "value": 1950}],
  "ordering": [], "limit": null, "offset": null, "output_order": []
}
```

```json
{
  "op": "aggregate",
  "measures": ["country_count"], "dimensions": ["country_region"],
  "filters": [], "ordering": [], "limit": null, "offset": null,
  "having": [{"measure": "country_count", "op": "ge", "kind": "int", "value": 10}]
}
```

```json
{
  "op": "set",
  "kind": "intersect",
  "branches": [
    {"shape": "row", "measures": [], "dimensions": ["country_name"],
     "filters": [{"dimension": "country_continent", "op": "eq", "kind": "text", "value": "Asia"}],
     "ordering": [], "limit": null, "offset": null},
    {"shape": "row", "measures": [], "dimensions": ["country_name"],
     "filters": [{"dimension": "country_region", "op": "eq", "kind": "text", "value": "SampleRegion"}],
     "ordering": [], "limit": null, "offset": null}
  ]
}
```

```json
{
  "op": "compare",
  "measures": [], "dimensions": ["country_name"],
  "filters": [], "ordering": [], "limit": null, "offset": null,
  "comparisons": [
    {"attribute": "country_life_expectancy", "op": "gt",
     "measure": "country_life_expectancy_avg", "scope": []}
  ]
}
```

## 拒绝边界

- 词表未知（measure/dimension/target/attribute）、越权、类型/算子不兼容、grain/路径
  不支持、非法 set 分支/kind、field-to-field 用于非 list、输出列序与所选维度不一致等
  均原子失败并给出诊断。
- 结构性非法（未知 `op`、非对象、缺必需字段、字段类型错误、非 2 分支 set、非法
  kind）可由纯探针 `ontology/intent::query_intent_ok` 返回 `False` 判据。
