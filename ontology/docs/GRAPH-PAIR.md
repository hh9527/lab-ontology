# 显式聚合配对

GraphPair 分别聚合两个总体，按完整身份做内连接，并显式选择每个展示列来自哪一侧。

```text
{"op":"GraphPair","limit":1000,"left":<Graph intent>,"right":<Graph intent>,
 "align_by":[{"left":{"node":"previous_device"},"right":{"node":"current_device"}}],
 "select":[{"side":"Left","node":"previous_device","dimension":"device_name"},
           {"side":"Right","node":"current_device","dimension":"device_name"}],
 "rank_by":{"op":"Subtract","minuend":"Right","subtrahend":"Left",
            "direction":"Desc","take":5}}
```

## 对齐与输出

`align_by` 必填且非空。每项配对同一实体的节点，节点 ID 可以不同。
每个节点展开为模型声明的完整粒度或键，包括复合身份；任一侧都不能重复节点。
每个操作数的 `group_by_identity` 必须与其对齐节点按顺序完全一致，且从根节点开始，不允许部分身份或额外身份。

若对齐身份包含时间，对齐对应单个样本点或日期。当同一身份列的直接时间边界能证明两个总体不相交时，在返回 SQL 前拒绝请求。
包括相邻半开窗口，支持 EpochMillis、DatetimeUtc 和 DateUtc；也识别共享该物理列的原始维度边界。
相同、重叠或无法证明不相交的窗口仍合法。跨周期比较应对齐身份不含样本时间的资源主体，再通过已声明主体关系聚合各窗口样本。
样本点配对产生的分组可能远多于主体级周期比较。

外层 `select` 必填，可为空数组。每项指定 `side:Left|Right`、`node` 和 `dimension`。
只有对齐节点可提供展示属性：模型身份契约要求完整身份决定这些属性。
历史版本需要单独建模身份，样本属性不能把主体身份拆成多个聚合组。
每个操作数的 `select` 为空或省略，由外层选择派生投影。展示列按需保留在 SQL GROUP BY 中，但绝不成为对齐键。

输出依次为外层 `select`、左侧度量、右侧度量。
别名为 `left_<node>_<dimension or measure>` 和 `right_<node>_<dimension or measure>`。
半开放维度保留相邻的 `__kind` 列。重复结果别名被拒绝。选择两侧展示值可暴露显示变化，而不改变身份匹配。

## 总体

两侧均为 Graph Intent，分别拥有节点、具名边、filters、time_windows、存在性限定、恰好一个度量和可选 measure_having。
两侧独立聚合，原始行从不互相连接，仅保留两侧均存在的身份。
度量 ID 和限定路径可以不同。操作数禁止 count、distinct、include_empty、order_by、take、top_by_measure 和 top_per。

可选外层布尔值 `count_groups:true` 统计所有对齐身份；否则返回所选展示列和两侧度量。

## 排名

可选 `rank_by` 使用以下封闭操作之一：

| `op` | 侧别参数 | 公式 |
|---|---|---|
| `Subtract` | `minuend`、`subtrahend` | 被减数 - 减数 |
| `Ratio` | `numerator`、`denominator` | 分子 / 分母 |
| `GrowthRate` | `current`、`baseline` | (当前值 - 基线) / 基线 |

每个参数为 `Left` 或 `Right`，两参数必须指向不同侧。
每种操作均要求 `direction:Asc|Desc` 及 1..1000 的整数 `take`。
两个度量必须为数值类型；同一度量 ID 兼容，不同 ID 必须声明相同且非空的单位。

NULL 度量被排除。Ratio 排除零分母，但允许负分母；GrowthRate 要求基线严格为正，当前值可为负。
增长率是比例：0.2 表示 20%，不是 0.2%。排名发生在聚合与身份匹配后；并列按所有完整对齐身份键升序、NULLS FIRST 决胜。

运算前，两操作数都转为双精度（SQLite 的 `REAL`、PostgreSQL 的 `DOUBLE PRECISION`）。
整数除法保留小数，但大整数可能失去精度。NULLIF 也防止优化器在筛选前求值除法。
排名结果在两侧度量之后追加数值列 `comparison_value`，并按同列排序。
Subtract 保留声明单位（百分比样本之差以百分点计）；Ratio 是无量纲倍数，GrowthRate 是无量纲比例。
不排名时没有比较列；排名不能与 `count_groups:true` 组合。

配置必须允许 Order、Limit、Scalar、Filter、IsNotNull 以及操作所需标量能力：
Subtract 需要 Sub，Ratio 需要 Div 与 Ne，GrowthRate 需要 Sub、Div 与 Gt。

## 迁移

旧隐式 GraphPair 请求返回迁移诊断。添加 align_by，将操作数 select 中的展示维度移到外层 select 并显式指定 side，为 rank_by 增加操作的侧别参数。
消费方改用带侧别前缀的输出别名。外层对象仅接受 op、left、right、align_by、select、可选布尔 count_groups 及可选 rank_by。
