# Ent-1 查询设计指南

本文档说明如何把业务问题表达为结构化查询意图，以及如何用 Telora 验证公共查询面。
指标口径、维度含义和值域以 `DOMAIN.md` 为准。查询设计者不需要了解表、列、join、
物理 mapping 或 SQL 模板。

## 意图形状

查询意图是一个 JSON 对象：

```json
{
  "measures": ["DeliveredPackages"],
  "dimensions": ["CarrierName"],
  "filters": [
    {"dimension": "OrderMonth", "op": "Eq", "value": "2026-07"}
  ],
  "ordering": [
    {"target": {"Measure": "DeliveredPackages"}, "direction": "Desc"},
    {"target": {"Dimension": "CarrierName"}, "direction": "Asc"}
  ],
  "limit": 5
}
```

字段规则：

- `measures`：指标名称数组，至少一项；
- `dimensions`：分组维度数组，可以为空；
- `filters`：筛选数组，可以为空，按数组顺序以 AND 组合；
- `ordering`：排序数组，可以为空，数组顺序就是排序优先级；
- `limit`：正整数或 `null`。

请求不包含查询发起者、TypeId、物理表达式、Plan 节点或 SQL 片段。

## JSON 标量

筛选值使用原生 JSON 标量：

```json
"Gold"
3
3.5
```

不要使用 variant wrapper：

```json
{"String": "Gold"}
{"Int": 3}
```

Telora 内部仍使用封闭名义类型；untagged 只定义 JSON 边界的表示。

## 筛选

| 维度 | 操作符 | 示例值 |
| --- | --- | --- |
| `OrderMonth` | `Eq`、`Ge`、`Le` | `"2026-07"` |
| `CustomerTier` | `Eq` | `"Gold"`、`"Silver"`、`"Bronze"` |
| `OriginRegion` | `Eq`、`Ge`、`Le` | `"East China"` |
| `ProductCategory` | `Eq`、`Ge`、`Le` | 企业类别文本 |

`CarrierName`、`ServiceName` 和 `DeliveryException` 不能筛选。筛选维度可以不出现在
`dimensions` 中。

同一个开放文本维度可以用 `Ge` 和 `Le` 表达闭区间：

```json
{
  "measures": ["OrdersCreated"],
  "dimensions": [],
  "filters": [
    {"dimension": "OrderMonth", "op": "Ge", "value": "2026-04"},
    {"dimension": "OrderMonth", "op": "Le", "value": "2026-06"}
  ],
  "ordering": [],
  "limit": null
}
```

## 排序与 Top N

排序目标必须已经出现在本请求的 `measures` 或 `dimensions` 中：

```json
{"target": {"Measure": "OrdersCreated"}, "direction": "Desc"}
{"target": {"Dimension": "OrderMonth"}, "direction": "Asc"}
```

方向只能是 `Asc` 或 `Desc`。稳定 Top N 通常先按指标降序，再按业务维度升序，并把
N 写入 `limit`。

完整示例：Gold 客户订单数最多的前 5 个月：

```json
{
  "measures": ["OrdersCreated"],
  "dimensions": ["OrderMonth"],
  "filters": [
    {"dimension": "CustomerTier", "op": "Eq", "value": "Gold"}
  ],
  "ordering": [
    {"target": {"Measure": "OrdersCreated"}, "direction": "Desc"},
    {"target": {"Dimension": "OrderMonth"}, "direction": "Asc"}
  ],
  "limit": 5
}
```

## 设计步骤

1. 从题面确定计数单位，并选择 `DOMAIN.md` 中对应的指标。
2. 确定要输出的分组维度。
3. 把范围、等级、地区等必要条件完整放入 `filters`。
4. 对照 DOMAIN 的组合边界，不删除条件来换取成功。
5. 明确排序目标、方向和并列打破规则。
6. 题面要求 Top N 时填写正整数 `limit`。
7. 反向用业务语言复述结构化意图，确认口径、范围和排序没有漂移。

题面缺少月份、地区、等级、截止时间、计数口径或 Top N 数量时，应先询问。存在多个
合理业务解释时，应列出业务语义选项，不能用 SQL 技术细节要求用户选择。

## 成功结果

动态入口返回规范化意图和参数化 Query：

```json
{
  "intent": {"measures": ["OrdersCreated"], "dimensions": [], "filters": [], "ordering": [], "limit": null},
  "query": {"sql": "SELECT ...", "bindings": []}
}
```

- `query.sql` 中所有动态值都是 `?` 占位符；
- `query.bindings` 与占位符一一对应；
- bindings 使用原生 JSON 标量，不出现 variant wrapper；
- 同一个规范化意图重复执行得到逐字节相同的 SQL 和 binding 顺序。

## 失败与修正

失败通过带外 Telora 诊断报告，不返回部分 intent、Plan 或 Query。常见原因包括：

- JSON 形状或标量类型错误；
- 未知或不可用的指标、维度；
- 不同计数单位的指标组合；
- `ProductCategory` 与订单/包裹指标形成不安全展开；
- 对不可筛选维度提交 filter；
- `CustomerTier` 使用目录外值或范围操作；
- 排序目标没有被请求；
- `limit` 不是正整数。

诊断保留输入来源，应按照它标注的 JSON 字段修正。对于开放业务文本，文档没有给出
规范值时应询问用户，不能猜测。

典型枚举失败：

```json
{"dimension": "CustomerTier", "op": "Eq", "value": "Diamond"}
```

会报告未知枚举值并定位 `value` 字段；使用 `Ge Gold` 会报告该维度不支持对应操作。

## 公共能力与工具

公共 facade 位于 `ent-1/src/query.telora`：

- `lower(Request) -> Query`：有类型入口；
- `lower_value(Value) -> ValueQuery`：JSON 动态边界；
- `measures`、`dimensions`：公开业务词汇；
- `customer_tier_domain`：客户等级的稳定值与展示标签。

当前目录中的可执行验证：

```bash
./bin/telora -C ent-1 run query-surface
./bin/telora -C ent-1 check @test/query-surface
./bin/telora -C ent-1 run invalid --best-effort
```

`query-surface` 验证 typed/dynamic lowering 等价、确定性、JSON round-trip 和原生标量
编码；`invalid --best-effort` 展示未知客户等级及不支持操作的带来源诊断。
