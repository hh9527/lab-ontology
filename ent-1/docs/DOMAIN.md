# Ent-1 物流履约领域

本文档描述查询设计者可使用的业务领域知识：业务对象、指标口径、分析维度、值域和
组合边界。它不描述结构化意图的 JSON 写法、命令行用法、数据库表列或 SQL 实现；这些
内容分别属于 `QUERY-DESIGN-GUIDE.md` 和系统内部实现。

## 业务对象

物流履约领域包含以下对象：

- Customer 创建 Order；
- Order 从 Warehouse 发货，Warehouse 位于 Region；
- Order 选择 Carrier 和 ServiceLevel；
- 一个 Order 产生一个或多个 Package；
- Package 包含 PackageItem；
- PackageItem 指向 Product，Product 属于 Category。

从订单、包裹或包裹货品行向其所属对象观察，不会增加当前计数单位；从订单向包裹、
从包裹向货品行展开，则可能把一条业务记录扩张为多条。查询能力会拒绝导致计数重复的
组合。

## 指标

| 指标 | 业务口径 | 计数单位 |
| --- | --- | --- |
| `OrdersCreated` | 已创建订单数；每个订单计一次 | Order |
| `DeliveredPackages` | 已送达包裹数；每个包裹计一次 | Package |
| `UnitsShipped` | 已发货商品件数；每个包裹货品行计一次 | PackageItem |

一个请求中的指标必须具有相同计数单位。系统不会自动把订单、包裹和货品行口径相互
换算，也没有预聚合或 allocation policy。

## 维度

| 维度 | 业务含义 | 可分组 | 可筛选 |
| --- | --- | --- | --- |
| `OrderMonth` | 订单创建的日历月份 | 是 | `Eq`、`Ge`、`Le` |
| `CustomerTier` | 下单客户的等级 | 是 | 仅 `Eq` |
| `OriginRegion` | 订单发货仓库所在地区 | 是 | `Eq`、`Ge`、`Le` |
| `CarrierName` | 承运商名称 | 是 | 否 |
| `ServiceName` | 服务水平名称 | 是 | 否 |
| `ProductCategory` | 商品类别 | 有条件 | `Eq`、`Ge`、`Le` |

筛选维度不必同时成为结果的分组维度。例如，可以筛选 Gold 客户，但只按月份输出结果。

### CustomerTier

`CustomerTier` 是封闭业务目录，只包含：

| 稳定值 | 展示含义 |
| --- | --- |
| `Gold` | Gold customer |
| `Silver` | Silver customer |
| `Bronze` | Bronze customer |

该维度只支持相等筛选。目录外的值以及 `Ge`、`Le` 等范围操作都不具有业务含义。

### 开放文本维度

`OrderMonth`、`OriginRegion` 和 `ProductCategory` 使用开放业务文本。

- `OrderMonth` 采用 `YYYY-MM` 形式，例如 `2026-07`；`Ge` 与 `Le` 可组合成闭区间。
- `OriginRegion` 的 `East China`、`South China`、`North China` 是已出现的规范示例，
  不是完整目录。遇到没有明确规范文本的地区，应向用户澄清，不能自行翻译或类推。
- `ProductCategory` 使用企业定义的类别文本。

## 组合边界

`OrderMonth`、`CustomerTier`、`OriginRegion`、`CarrierName` 和 `ServiceName` 可以与
三个指标安全组合。

`ProductCategory` 只能与 `UnitsShipped` 安全组合。一个订单或包裹可能包含多个商品
类别，因此：

- `UnitsShipped + ProductCategory`：合法；
- `OrdersCreated + ProductCategory`：会重复订单计数，拒绝；
- `DeliveredPackages + ProductCategory`：会重复包裹计数，拒绝。

不同计数单位的指标也不能放入同一个请求，例如 `OrdersCreated` 与
`DeliveredPackages` 不能直接组合。

## 排序与 Top N 的业务解释

Top N 必须说明按什么指标排序，并在需要稳定结果时给出业务维度作为并列打破规则。
例如“Gold 客户订单数最多的前 5 个月”对应：

- 指标：`OrdersCreated`；
- 筛选：`CustomerTier = Gold`；
- 分组：`OrderMonth`；
- 主排序：订单数降序；
- 并列排序：月份升序；
- 条数：5。

“履约量”“表现最好”“最重要”等表述可能对应订单数、包裹数或商品件数。题面没有
明确计数单位时，应先让用户确认业务口径。

## 当前不可用能力

`DeliveryException` 是可理解的业务概念，但当前没有对应的查询、分组或筛选能力。
查询中引用它会失败。

查询能力也不会：

- 猜测缺失的月份、地区、等级或 Top N 数量；
- 自动选择不同计数单位之间的换算方式；
- 为不安全的展开关系分配或去重计数；
- 把未声明的地区文本、客户等级或业务别名当作规范值。
