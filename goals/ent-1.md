# Ent-1 目标

`ent-1` 使用 `ontology` eDSL 建立物流履约 EnterpriseKnowledge，并提供不暴露物理模型的
公共查询面。本文件完整定义模型输入要求；`docs/` 中的领域说明和查询设计指南是根据
实现形成的公共输出。

## 领域模型要求

- 用 nominal entity structs 和 property 声明 Customer、Order、Warehouse、Region、
  Carrier、ServiceLevel、Package、PackageItem、Product 和 Category。
- 模型发布 `OrdersCreated`、`DeliveredPackages`、`UnitsShipped` 三个指标，并保持各自
  Order、Package、PackageItem 的计数单位。
- 模型发布文档定义的分组和筛选维度；`CustomerTier` 是只支持 Eq 的
  Gold/Silver/Bronze 封闭值域。
- `OrderMonth`、`OriginRegion`、`ProductCategory` 支持已声明的参数化筛选。
- `ProductCategory` 只与 `UnitsShipped` 形成安全组合；会重复订单或包裹计数的组合失败。
- `DeliveryException` 保持为已知但未授权的业务概念，查询或筛选时产生 capability 诊断。
- PlanProfile、关系图和物理 mapping 全部来自同一个显式 ontology root。

## 私有物理事实

模型使用以下数据源和字段：

| 实体 | 表 / alias | 字段 |
| --- | --- | --- |
| Order | `orders` / `o` | `id`、`created_at`、`customer_id`、`warehouse_id`、`carrier_id`、`service_level_id` |
| Customer | `customers` / `c` | `id`、`tier` |
| Warehouse | `warehouses` / `w` | `id`、`region_id` |
| Region | `regions` / `r` | `id`、`name` |
| Carrier | `carriers` / `cr` | `id`、`name` |
| ServiceLevel | `service_levels` / `sl` | `id`、`name` |
| Package | `packages` / `p` | `id`、`order_id`、`exception` |
| PackageItem | `package_items` / `pi` | `id`、`package_id`、`product_id` |
| Product | `products` / `pr` | `id`、`category_id` |
| Category | `categories` / `cat` | `id`、`name` |

关系按同名 id 外键连接：Order 到 Customer、Warehouse、Carrier、ServiceLevel 是安全
关系；Order 到 Package 是 fan-out。Warehouse 到 Region 安全；Package 到 Order 安全，
Package 到 PackageItem 是 fan-out；PackageItem 到 Package、Product 以及 Product 到
Category 安全。

三个指标分别对 `orders.id`、`packages.id`、`package_items.id` 做 Count。
`OrderMonth` 是 `substr(orders.created_at, 1, 7)`，其中常量保持为 bindings。
公共 facade 使用固定 subject `analyst`；模型接受该 subject。Profile 接受 Inner Join、
Count、Substr、Eq、Ge、Le、And，以及完成筛选、分组、排序和 limit 所需的标准算子。

## 公共查询面要求

- `src/query.telora` 从 prepared payload 导出业务 vocabulary、typed `Request`、
  `lower(Request) -> Query` 和 `lower_value(Value) -> ValueQuery`。
- 公共 Request 表达指标、分组维度、筛选、排序和可选正整数 Top N；调用者不提交
  subject、TypeId、物理表达式、Plan 节点或 SQL。
- `lower` 和 `lower_value` 复用同一条 ontology lowering 与 query 转换路径。
- `lower_value` 返回规范化 intent 和参数化 Query；bindings 使用原生 JSON 标量。
- JSON 解码、未知词汇、非法枚举值、筛选能力、grain、排序和 limit 问题通过带外
  诊断失败，不返回部分 `ValueQuery`。
- 动态输入的 source provenance 保留到诊断，使问题能够归因到对应 JSON 字段。
- 公共文档只表达业务词汇和结构化查询能力，不公开表、列、alias、Join 路径、mapping
  或 SQL 模板。

## 交付物

- `src/model.telora`：完整物流领域模型和 prepared payload。
- `src/query.telora`：公共 typed/dynamic 查询 facade。
- `src/bin/main.telora`：合法领域 Request 到 Plan 与 Query 的演示。
- `src/bin/verify.telora`：领域能力、参数化筛选、排序、Top N 和确定性验证。
- `src/bin/invalid.telora`：非法组合和动态 JSON 输入的诊断演示。
- `src/bin/query-surface.telora`：公共查询面的端到端入口。
- `tests/logistics.telora`、`tests/query-surface.telora`：模型与公共 facade 契约检查。
- `docs/DOMAIN.md`、`docs/QUERY-DESIGN-GUIDE.md`：业务知识与查询设计指南。
- `telora-crate.json`：声明 crate 模块及对 `ontology`、`query` 的依赖。

## 完成条件

以下命令通过；`invalid` 按预期产生带来源诊断且不输出部分 Query：

```bash
./bin/telora -C ent-1 eval @src/bin/main:main
./bin/telora -C ent-1 eval @src/bin/verify:main
./bin/telora -C ent-1 eval @src/bin/query-surface:main
./bin/telora -C ent-1 check @src/bin/invalid
./bin/telora -C ent-1 check @test/logistics
./bin/telora -C ent-1 check @test/query-surface
./bin/telora -C ent-1 query exports @src/bin/main
```
